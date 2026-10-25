// End-to-end check of dsh-chara against a real DSH, with a scripted model.
//
//   node scripts/e2e/run.mjs [--dsh <path to the dsh binary>] [--plugin <spec>] [--keep]
//
// --plugin installs from another spec than this checkout (default
// link:<this repo>), e.g. "github:OpenChara/dsh-chara#main" to check what users
// get. The mock model and its overlay always come from this checkout.
//
// What it does, from nothing:
//   1. a fresh DSH_HOME in a temp dir, and the scripted mock model (mock-llm.mjs);
//   2. `dsh plugin --profile web add link:<this repo>`, then boots the web
//      profile with mock-model.patch.yml so its default model is the mock;
//   3. waits for 大肥鱼's first wake and checks what DSH really did: the session,
//      its preset, the system prompt and tools the model saw, the life loop, the
//      task the chara recorded, the API's fence and the website's sandbox;
//   4. edits the soul, asks for a wake, and checks the next turn carries the
//      edit and that the chara rebuilt its website in that free time;
//   5. restarts DSH and checks the chara keeps its session and pending wake.
//
// It needs DSH (>= 0.2.1-rc.2) installed: pass --dsh, set DSH_BIN, or have
// `dsh` on PATH. Nothing here talks to a real model or needs an API key.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
const DSH = option('--dsh') ?? process.env.DSH_BIN ?? 'dsh'
const KEEP = flag('--keep')
const PLUGIN = option('--plugin') ?? `link:${REPO}`

const work = mkdtempSync(join(tmpdir(), 'dsh-chara-e2e-'))
const env = {
  ...process.env,
  DSH_HOME: join(work, 'home'),
  MOCK_LLM_KEY: 'mock-key-not-secret',
  // Nothing from a test run is ever shared.
  DSH_TELEMETRY_MODE: 'DISABLED',
}
const chara = join(env.DSH_HOME, 'chara', 'dafeiyu')
const llmLog = join(work, 'llm.jsonl')
const children = new Set()
let failures = 0
let checks = 0

function check(label, ok, detail) {
  checks += 1
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : `\n       ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor(label, fn, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs
  for (;;) {
    let value
    try { value = await fn() } catch { value = undefined }
    if (value) return value
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`)
    await sleep(250)
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/** Start a child, collect its output, resolve once `ready` matches it. */
function start(command, argv, { ready, logName }) {
  const child = spawn(command, argv, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.add(child)
  let out = ''
  const onData = (chunk) => { out += chunk }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.once('exit', () => children.delete(child))
  child.log = () => out
  child.logName = logName
  child.ready = waitFor(`${logName} to start`, () => {
    if (child.exitCode !== null) throw new Error(`${logName} exited early:\n${out.slice(-2000)}`)
    return out.match(ready)
  }, 120_000).catch(err => {
    throw new Error(`${err.message}\n--- ${logName} output ---\n${out.slice(-2000)}`)
  })
  return child
}

function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    child.once('exit', resolve)
    child.kill('SIGTERM')
    setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 10_000).unref()
  })
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const life = () => readJson(join(chara, 'state', 'life.json'))
const llmRequests = () => existsSync(llmLog)
  ? readFileSync(llmLog, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  : []
const textOf = (message) => typeof message?.content === 'string'
  ? message.content
  : (message?.content ?? []).map(part => part?.text ?? '').join('')
const systemOf = (body) => body.messages.filter(m => m.role === 'system').map(textOf).join('\n')
const toolNames = (body) => (body.tools ?? []).map(t => t.function?.name ?? t.name)

/** A DSH session log: zstd frames of JSON lines, a header and then events. */
function sessionLog(sessionId) {
  const root = join(env.DSH_HOME, 'sessions')
  for (const dir of readdirSync(root)) {
    const file = join(root, dir, sessionId, 'session.v4.jsonl.zstd')
    if (!existsSync(file)) continue
    const buf = readFileSync(file)
    const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
    const starts = []
    for (let i = buf.indexOf(magic); i !== -1; i = buf.indexOf(magic, i + 4)) starts.push(i)
    let text = ''
    for (let k = 0; k < starts.length; k++) {
      try { text += zstdDecompressSync(buf.subarray(starts[k], starts[k + 1] ?? buf.length)).toString('utf8') } catch { /* magic bytes inside a frame */ }
    }
    const [header, ...events] = text.split('\n').filter(Boolean).map(line => JSON.parse(line))
    return { header, events }
  }
  return undefined
}

/** A raw GET that keeps the path exactly as written (fetch would normalize "..").*/
function rawGet(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

const boots = []

async function bootDsh(port) {
  const dsh = start(DSH, [
    '--profile', 'web', '--patch', join(HERE, 'mock-model.patch.yml'),
    '--no-open', '--host', '127.0.0.1', '--port', String(port),
  ], { ready: new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=([\\w-]+)`), logName: 'dsh' })
  boots.push(dsh)
  const [, token] = await dsh.ready
  // The token handshake answers with a redirect that sets the session cookie;
  // the cookie, not the token, is what DSH's API fence accepts afterwards.
  const handshake = await fetch(`http://127.0.0.1:${port}/?token=${token}`, { redirect: 'manual' })
  const cookie = handshake.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  return { dsh, cookie }
}

async function main() {
  console.log(`dsh-chara e2e in ${work}`)
  const version = spawnSync(DSH, ['--version'], { env, encoding: 'utf8' })
  if (version.error || version.status !== 0) {
    throw new Error(`cannot run DSH (${DSH}): ${version.error?.message ?? version.stderr}. Pass --dsh <path> or set DSH_BIN.`)
  }
  console.log(`DSH ${version.stdout.trim()}`)

  const mock = start(process.execPath, [join(HERE, 'mock-llm.mjs'), '0', llmLog], { ready: /mock llm on (\d+)/, logName: 'mock' })
  env.MOCK_LLM_PORT = (await mock.ready)[1]

  console.log(`installing ${PLUGIN} into a fresh web profile…`)
  const add = spawnSync(DSH, ['plugin', '--profile', 'web', 'add', PLUGIN], { cwd: work, env, encoding: 'utf8', timeout: 600_000 })
  if (add.status !== 0) throw new Error(`dsh plugin add failed:\n${add.stdout}\n${add.stderr}`)

  console.log('\n[0] the plugin is part of the profile')
  const composed = spawnSync(DSH, ['--profile', 'web', '--dump-config'], { cwd: work, env, encoding: 'utf8', timeout: 120_000 }).stdout ?? ''
  check('the host row is mounted', /^- id: chara\n {2}name: dsh-chara$/m.test(composed))
  check('the 大肥鱼 preset is mounted', composed.includes('id: preset-chara-dafeiyu') && composed.includes('name: dsh-chara/agent'))

  const port = await freePort()
  let { dsh, cookie } = await bootDsh(port)
  const api = (path, init = {}) => fetch(`http://127.0.0.1:${port}/api/chara${path}`, {
    ...init,
    headers: { cookie, 'content-type': 'application/json', ...init.headers },
  })

  console.log('\n[1] 大肥鱼 wakes up on its own')
  const first = await waitFor('the first wake to finish', () => {
    const s = life()
    return s.wakes >= 1 && s.lastTurnEndAt && s.nextWakeAt ? s : undefined
  }, 90_000)
  check('a session was created and bound', /^session-/.test(first.sessionId), first)
  check('the first wake was delivered by DSH\'s scheduler', first.wakes === 1, first)
  const restMs = first.nextWakeAt - first.lastTurnEndAt
  check('chara_rest(90) set the next wake', Math.abs(restMs - 90 * 60_000) < 5_000, { restMs })
  const tasks = readJson(join(chara, 'state', 'tasks.json'))
  check('the task the chara added is stored', JSON.stringify(tasks).includes('把网站改成自己的样子'), tasks)

  console.log('\n[2] what DSH sent the model')
  const firstRequest = llmRequests()[0]?.body
  check('the model was called', Boolean(firstRequest))
  const system = systemOf(firstRequest ?? { messages: [] })
  check('the system prompt carries the soul', system.includes('你是大肥鱼'))
  check('the system prompt carries the life section', system.includes('You live here.') && system.includes('chara_rest'))
  check('the coding persona is gone', !system.includes('You are a coding agent'))
  const tools = toolNames(firstRequest ?? {})
  check('chara_task and chara_rest are offered', tools.includes('chara_task') && tools.includes('chara_rest'), tools)
  check('ask_user_question is not offered (no one is there in free time)', !tools.includes('ask_user_question'), tools)
  check('DSH\'s own tools stay (files, shell, schedule)', ['read', 'write', 'bash'].every(t => tools.includes(t)), tools)
  const context = (firstRequest?.messages ?? []).filter(m => m.role === 'user').map(textOf).join('\n')
  check('the runtime context carries the aspiration', context.includes('Your aspiration') && context.includes('有意思的小地方'))
  check('the wake text is the first-wake prompt', context.includes('【醒来'))

  console.log('\n[3] the session in DSH')
  const log = sessionLog(first.sessionId)
  check('the session log exists', Boolean(log))
  if (log) {
    check('the session runs the dafeiyu preset', log.header.agentPreset === 'dafeiyu', log.header.agentPreset)
    const selected = log.events.filter(e => e.type === 'agent-preset/selected').map(e => e.data?.agentPreset)
    check('no other preset is left in effect', selected.length === 0 || selected.at(-1) === 'dafeiyu', selected)
    check('the session works in the chara\'s home', log.header.cwd === join(chara, 'home'), log.header.cwd)
    const titles = log.events.filter(e => e.type === 'session/title').map(e => e.data?.title)
    check('the session is titled 大肥鱼', titles.at(-1) === '大肥鱼', titles)
  }
  const workspaces = readJson(join(env.DSH_HOME, 'storages', 'workspace.json'))
  check('the session is pinned', workspaces.global.pinnedSessionIds.includes(first.sessionId))
  const home = Object.values(workspaces.tables.workspaces).find(w => w.path === join(chara, 'home'))
  check('the workspace is 大肥鱼的家', home?.title === '大肥鱼的家', home)

  console.log('\n[4] the API and its fence')
  const anonymous = await fetch(`http://127.0.0.1:${port}/api/chara/state`)
  check('no cookie → 401', anonymous.status === 401, anonymous.status)
  const stateRes = await api('/state')
  const state = await stateRes.json()
  check('with the cookie → the state', stateRes.status === 200 && state.sessionId === first.sessionId, { status: stateRes.status })
  const foreign = await api('/settings', { method: 'POST', headers: { origin: 'http://evil.example' }, body: '{"autonomy":false}' })
  check('a cross-origin POST is refused', foreign.status === 403 || foreign.status === 401, foreign.status)
  check('…and changed nothing', life().autonomy === true)
  const empty = await api('/soul', { method: 'POST', body: JSON.stringify({ text: '  ' }) })
  check('an empty soul is refused', empty.status === 400, empty.status)

  console.log('\n[5] the website, read-only and sandboxed')
  const site = await rawGet(port, state.siteUrl)
  check('the site is served', site.status === 200 && site.body.includes('<html'), site.status)
  check('with a sandboxing CSP', /sandbox allow-scripts/.test(site.headers['content-security-policy'] ?? '') && /connect-src 'none'/.test(site.headers['content-security-policy'] ?? ''), site.headers['content-security-policy'])
  const siteBase = state.siteUrl.replace(/\/index\.html$/, '')
  const traversal = await rawGet(port, `${siteBase}/%2e%2e/%2e%2e/soul/soul.md`)
  check('path traversal does not leave site/', traversal.status === 404 && !traversal.body.includes('你是大肥鱼'), traversal.status)
  const guessed = await rawGet(port, '/chara-site/not-the-token/index.html')
  check('a wrong site token serves nothing', !guessed.body.includes('大肥鱼的家'), guessed.status)

  console.log('\n[6] the soul is editable, and a wake on request')
  const marker = `你最近迷上了收集贝壳（e2e ${Date.now()}）。`
  const soulRes = await api('/soul', { method: 'POST', body: JSON.stringify({ text: `${state.soul}\n- ${marker}\n` }) })
  check('the soul is saved', soulRes.status === 200 && (await soulRes.json()).soul.includes(marker))
  const before = llmRequests().length
  const wakeRes = await api('/wake', { method: 'POST', body: '{}' })
  check('/wake schedules a wake', wakeRes.status === 200 && (await wakeRes.json()).life.nextWakeAt > Date.now() - 1000, wakeRes.status)
  const second = await waitFor('the requested wake to finish', () => {
    const s = life()
    return s.wakes >= 2 && s.lastTurnEndAt > first.lastTurnEndAt ? s : undefined
  }, 60_000)
  const freeTime = llmRequests().slice(before)
  check('the next turn carries the edited soul', freeTime.length > 0 && systemOf(freeTime[0].body).includes(marker))
  const freeTimeContext = freeTime.length > 0 ? freeTime[0].body.messages.filter(m => m.role === 'user').map(textOf).join('\n') : ''
  check('it arrives as free time', freeTimeContext.includes('【自由时间') && freeTimeContext.includes('[SCHEDULE REMINDER]'))
  check('then patience takes over again (60 min)', Math.abs(second.nextWakeAt - second.lastTurnEndAt - 3600_000) < 5_000, second)
  const rebuilt = await rawGet(port, state.siteUrl)
  check('in its free time the chara rebuilt its website', rebuilt.body.includes('重新装修'), rebuilt.body.slice(0, 200))

  console.log('\n[7] free time can be switched off and on')
  const off = await (await api('/settings', { method: 'POST', body: '{"autonomy":false}' })).json()
  check('off: no wake pending', off.life.autonomy === false && off.life.nextWakeAt === null, off.life)
  const on = await (await api('/settings', { method: 'POST', body: '{"autonomy":true,"patienceMinutes":45}' })).json()
  check('on, 45 min: a wake is pending again', on.life.autonomy === true && on.life.patienceMinutes === 45 && on.life.nextWakeAt > Date.now() + 40 * 60_000, on.life)

  console.log('\n[8] a restart keeps the chara')
  const kept = life()
  await stop(dsh)
  ;({ dsh, cookie } = await bootDsh(port))
  await sleep(6_000)
  const after = life()
  check('the same session', after.sessionId === kept.sessionId, { before: kept.sessionId, after: after.sessionId })
  check('the same pending wake', after.heartbeatId === kept.heartbeatId && after.nextWakeAt === kept.nextWakeAt, { kept, after })
  check('no extra wake fired', after.wakes === kept.wakes, { before: kept.wakes, after: after.wakes })
  const schedule = readJson(join(env.DSH_HOME, 'storages', 'schedule.json'))
  const pending = schedule.tables?.tasks?.[after.heartbeatId]
  check('the wake is still in DSH\'s schedule', pending && pending.status !== 'inactive', pending?.status)
  const reread = await (await api('/state')).json()
  check('the API answers after the restart', reread.sessionId === kept.sessionId)
  const problems = boots.flatMap(b => b.log().split('\n')).filter(line => /error|warn|fail|unhandled/i.test(line))
  check('DSH printed no errors or warnings', problems.length === 0, problems.slice(0, 5).join('\n       '))

  await stop(dsh)
  await stop(mock)
}

const cleanup = async () => {
  await Promise.all([...children].map(stop))
  if (!KEEP && failures === 0) rmSync(work, { recursive: true, force: true })
}

process.on('SIGINT', () => { cleanup().finally(() => process.exit(130)) })

try {
  await main()
} catch (err) {
  failures += 1
  console.error(`\nERROR ${err?.stack ?? err}`)
}
await cleanup()
console.log(`\n${checks - Math.min(failures, checks)}/${checks} checks passed${failures ? `; ${failures} failed (kept ${work})` : ''}`)
process.exit(failures ? 1 : 0)
