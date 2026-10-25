// Host half of dsh-chara: the part that is not tied to one agent.
//   * seeds the chara's files (soul, home, state);
//   * makes sure the chara has its own session, in a workspace that is its home;
//   * keeps the life loop's next wake armed through DSH's schedule service and
//     re-arms it whenever a turn in that session ends;
//   * serves the client's JSON API (/api/chara) and the chara's website
//     (/chara-site/<token>/), read-only and sandboxed.
// Each concern waits only for the services it needs, so a profile without a web
// server or a session controller still gets everything else.
//
// No @deepseek-ai/* imports: everything comes through ctx (see agent.js).
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite, readText } from './lib/fsutil.js'
import { seedChara, serveSiteFile } from './lib/home.js'
import { clamp, sharedLife, MIN_PATIENCE, MAX_PATIENCE } from './lib/life.js'
import { charaPaths, defaultRoot } from './lib/paths.js'
import { loadPersona } from './lib/persona.js'
import { TaskStore } from './lib/tasks.js'

export const name = 'dsh-chara'

const API = '/api/chara'
const SITE = '/chara-site'
const MAX_BODY = 256 * 1024
const MAX_SOUL = 64 * 1024

export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console
  const log = (msg) => logger.info?.(`dsh-chara: ${msg}`)
  const warn = (msg) => logger.warn?.(`dsh-chara: ${msg}`)

  const persona = loadPersona(config.persona ?? 'dafeiyu')
  const paths = charaPaths(config.root ?? defaultRoot(), persona.id)
  const created = seedChara(paths, persona.dir)
  if (created.length > 0) log(`seeded ${created.length} file(s) for ${persona.name} at ${paths.base}`)
  const tasks = new TaskStore(paths.tasks)
  const life = sharedLife(paths.life, { persona, log })
  // The website lives under an unguessable per-boot path: the sandboxed frame
  // has an opaque origin and so carries no session cookie, and this capability
  // is what lets its stylesheets and images load. Only /api/chara hands it out.
  const siteToken = randomBytes(18).toString('base64url')
  const siteBase = `${SITE}/${siteToken}`

  let disposed = false
  ctx.effect(() => () => { disposed = true }, 'dsh-chara: lifetime')

  ctx.inject(['schedule', 'sessionController', 'workspaceRegistry', 'agentPresets'], (sctx) => {
    life.scheduler = {
      create: (sessionId, request) => sctx.schedule.create(sessionId, request),
      delete: (sessionId, id) => sctx.schedule.delete({ sessionId, id }),
      list: (sessionId) => sctx.schedule.list({ sessionId }),
    }
    sctx.on('session/event', (session, event) => {
      const { sessionId } = life.state()
      if (!sessionId || session?.id !== sessionId) return
      if (event?.type === 'turn/end') {
        life.onTurnEnd().catch(err => warn(`could not re-arm the next wake: ${err?.message ?? err}`))
      } else if (event?.type === 'user/message' && event.data?.source?.kind === 'schedule') {
        life.onWakeDelivered().catch(() => {})
      } else if (event?.type === 'agent-preset/selected' && event.data?.agentPreset !== persona.presetId) {
        // The web client reuses the first blank session of a workspace as its
        // "new conversation" draft and stamps the user's default preset on it.
        // Until its first turn starts, the chara's session is such a blank:
        // take it back.
        reclaimPreset(sctx, sessionId).catch(err => warn(`could not restore ${persona.name}'s preset: ${err?.message ?? err}`))
      }
    })
    bootstrapSession(sctx).catch(err => warn(`could not set up ${persona.name}'s session: ${err?.message ?? err}`))
  })

  /**
   * Make sure the chara's session runs the chara's preset. While the session is
   * blank this re-selects it; once a turn has started DSH locks the
   * composition, and a session that started under another preset can never
   * carry the persona, so the chara gets a fresh session (the old conversation
   * is left as it is).
   * @returns whether the session runs the chara's preset afterwards.
   */
  async function reclaimPreset(sctx, sessionId) {
    const resolved = await sctx.sessionController.resolveAgent(sessionId)
    if (!resolved?.agent) throw new Error(resolved?.error?.message ?? 'session not available')
    if (sctx.agentPresets.composedPreset(resolved.agent.ctx) === persona.presetId) return true
    try {
      await sctx.agentPresets.select(resolved.agent, persona.presetId)
      log(`restored the ${persona.presetId} preset on ${persona.name}'s blank session`)
      return true
    } catch (err) {
      warn(`${persona.name}'s session ${sessionId} started under another preset (${err?.message ?? err})`)
      return false
    }
  }

  async function bootstrapSession(sctx) {
    // The preset row activates alongside this plugin; creating a session before
    // the registry knows it fails with agent-preset/not-found, so retry briefly.
    for (let attempt = 1; ; attempt++) {
      if (disposed) return
      try {
        await ensureSession(sctx)
        await life.ensureArmed()
        return
      } catch (err) {
        if (attempt >= 6) throw err
        await new Promise(resolve => setTimeout(resolve, attempt * 2000))
      }
    }
  }

  async function ensureSession(sctx) {
    const registry = sctx.workspaceRegistry
    const workspace = await registry.resolveByPath(paths.home)
      ?? await registry.create(paths.home, persona.workspaceTitle ?? persona.name)
    const { sessionId } = life.state()
    if (sessionId && workspace.sessionIds.includes(sessionId)) {
      if (registry.archivedSessionIds?.includes(sessionId)) {
        // The user put the chara away: respect it, do not resurrect it.
        await life.setAutonomy(false)
        log(`${persona.name}'s session is archived; free time stays off`)
        return
      }
      if (await reclaimPreset(sctx, sessionId)) return
      log(`starting a fresh session for ${persona.name}`)
    }
    const created = await sctx.sessionController.create({ workspaceId: workspace.id, agentPreset: persona.presetId })
    await sctx.sessionController.rename({ sessionId: created.sessionId, title: persona.sessionTitle })
    try {
      await registry.pinSession(created.sessionId)
    } catch (err) {
      warn(`could not pin ${persona.name}'s session: ${err?.message ?? err}`)
    }
    await life.bindSession(created.sessionId)
    log(`created ${persona.name}'s session ${created.sessionId} in workspace ${workspace.id}`)
  }

  ctx.inject(['webServer'], (wctx) => {
    wctx.effect(() => wctx.webServer.register({
      kind: 'prefix',
      path: siteBase,
      handler: (req, res) => {
        const { pathname } = new URL(req.url ?? '/', 'http://localhost')
        serveSiteFile(req, res, paths.site, pathname.slice(siteBase.length))
      },
    }), 'dsh-chara: website route')
    wctx.effect(() => wctx.webServer.register({
      kind: 'prefix',
      path: API,
      handler: (req, res) => {
        handleApi(req, res).catch(err => sendJson(res, 500, { ok: false, error: err?.message ?? String(err) }))
      },
    }), 'dsh-chara: api route')
  })

  const fence = trustFence(ctx, warn)

  async function handleApi(req, res) {
    if (!fence(req, res)) return
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    const route = pathname.slice(API.length) || '/'
    if (req.method === 'GET' && route === '/state') return sendJson(res, 200, stateView())
    if (req.method === 'GET' && route === '/avatar.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      res.end(readFileSync(join(persona.dir, 'avatar.svg')))
      return
    }
    if (req.method !== 'POST') return sendJson(res, 404, { ok: false, error: 'not found' })
    if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'cross-origin request refused' })
    const body = await readJsonBody(req)
    if (route === '/settings') {
      if (body.autonomy !== undefined) await life.setAutonomy(Boolean(body.autonomy))
      if (body.patienceMinutes !== undefined) {
        await life.setPatience(clamp(Number(body.patienceMinutes) * 60, MIN_PATIENCE, MAX_PATIENCE))
      }
      return sendJson(res, 200, stateView())
    }
    if (route === '/soul' || route === '/aspiration') {
      const text = String(body.text ?? '')
      if (text.length > MAX_SOUL) return sendJson(res, 413, { ok: false, error: 'too long' })
      if (route === '/soul' && text.trim() === '') return sendJson(res, 400, { ok: false, error: 'the persona cannot be empty' })
      atomicWrite(route === '/soul' ? paths.soul : paths.aspiration, text.endsWith('\n') ? text : `${text}\n`)
      return sendJson(res, 200, stateView())
    }
    return sendJson(res, 404, { ok: false, error: 'not found' })
  }

  function stateView() {
    const state = life.state()
    return {
      ok: true,
      persona: { id: persona.id, name: persona.name, description: persona.description, homeTabLabel: persona.homeTabLabel },
      sessionId: state.sessionId,
      life: {
        autonomy: state.autonomy,
        patienceMinutes: Math.round(state.patienceSeconds / 60),
        nextWakeAt: state.nextWakeAt,
        wakes: state.wakes,
      },
      siteUrl: `${siteBase}/index.html`,
      tasks: { active: tasks.active(), done: tasks.done().slice(-20) },
      soul: readText(paths.soul, ''),
      aspiration: readText(paths.aspiration, ''),
      home: paths.home,
    }
  }
}

/**
 * DSH's trust fence (the same check its own /api routes use). When the
 * connection service cannot be found, fall back to loopback + same origin and
 * say so once in the log, instead of failing open silently.
 */
function trustFence(ctx, warn) {
  let connection
  let looked = false
  let warned = false
  const find = () => {
    if (looked) return connection
    looked = true
    for (const get of [() => ctx.get?.('connection'), () => Reflect.get(ctx, 'connection'), () => ctx.root?.connection]) {
      try {
        const candidate = get()
        if (candidate && typeof candidate.requestRejection === 'function') return (connection = candidate)
      } catch { /* try the next accessor */ }
    }
    return undefined
  }
  return (req, res) => {
    const conn = find()
    if (conn) {
      const rejection = conn.requestRejection({ headers: req.headers })
      if (rejection === undefined) return true
      res.writeHead(typeof rejection === 'number' ? rejection : 403)
      res.end()
      return false
    }
    if (!warned) {
      warned = true
      warn('DSH connection fence unavailable; /api/chara accepts only loopback same-origin requests')
    }
    if (isLoopback(req) && sameOrigin(req)) return true
    res.writeHead(403)
    res.end()
    return false
  }
}

function isLoopback(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)
}

/** A browser request from another origin carries an Origin that differs from Host. */
function sameOrigin(req) {
  const origin = req.headers?.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(value && typeof value === 'object' && !Array.isArray(value) ? value : {})
      } catch {
        reject(new Error('the request body is not JSON'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  if (res.headersSent) return
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}
