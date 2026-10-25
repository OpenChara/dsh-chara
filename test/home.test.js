import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { resolveSitePath, seedChara, serveSiteFile, SITE_CSP } from '../src/lib/home.js'
import { charaPaths } from '../src/lib/paths.js'
import { loadPersona } from '../src/lib/persona.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'chara-home-'))

test('seeding lays down soul, home, site avatar and memory, once', () => {
  const persona = loadPersona('dafeiyu')
  const paths = charaPaths(tmp(), 'dafeiyu')
  const created = seedChara(paths, persona.dir)
  for (const p of [paths.soul, join(paths.site, 'index.html'), join(paths.site, 'avatar.png'), paths.memory]) {
    assert.ok(existsSync(p), `${p} seeded`)
  }
  assert.ok(created.length >= 5)
  assert.deepEqual(seedChara(paths, persona.dir), [], 'a second seed creates nothing')
})

test('seeding never overwrites the user or the chara', () => {
  const persona = loadPersona('dafeiyu')
  const paths = charaPaths(tmp(), 'dafeiyu')
  seedChara(paths, persona.dir)
  writeFileSync(paths.soul, 'edited by the user')
  writeFileSync(join(paths.site, 'index.html'), 'rebuilt by the chara')
  seedChara(paths, persona.dir)
  assert.equal(readFileSync(paths.soul, 'utf8'), 'edited by the user')
  assert.equal(readFileSync(join(paths.site, 'index.html'), 'utf8'), 'rebuilt by the chara')
})

test('the soul lives outside the working directory (home)', () => {
  const paths = charaPaths('/data', 'dafeiyu')
  assert.ok(!paths.soul.startsWith(paths.home), 'the chara cannot rewrite its own soul through its cwd')
  assert.ok(paths.site.startsWith(paths.home))
})

test('chara ids are validated', () => {
  assert.throws(() => charaPaths('/data', '../etc'), /invalid chara id/)
})

function site() {
  const root = tmp()
  const siteDir = join(root, 'site')
  mkdirSync(join(siteDir, 'pages'), { recursive: true })
  writeFileSync(join(siteDir, 'index.html'), '<h1>home</h1>')
  writeFileSync(join(siteDir, 'pages', 'index.html'), '<h1>pages</h1>')
  writeFileSync(join(root, 'secret.txt'), 'diary')
  return { root, siteDir }
}

test('resolveSitePath serves files and directory indexes inside the site', () => {
  const { siteDir } = site()
  assert.equal(resolveSitePath(siteDir, '/index.html'), join(siteDir, 'index.html'))
  assert.equal(resolveSitePath(siteDir, '/'), join(siteDir, 'index.html'))
  assert.equal(resolveSitePath(siteDir, '/pages/'), join(siteDir, 'pages', 'index.html'))
  assert.equal(resolveSitePath(siteDir, '/%69ndex.html'), join(siteDir, 'index.html'))
})

test('resolveSitePath refuses traversal, NUL bytes, bad escapes and missing files', () => {
  const { siteDir } = site()
  for (const bad of ['/../secret.txt', '/pages/../../secret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/index.html%00.png', '/%E0%A4%A', '/missing.html']) {
    assert.equal(resolveSitePath(siteDir, bad), null, bad)
  }
})

test('resolveSitePath refuses a symlink that leaves the site', () => {
  const { root, siteDir } = site()
  symlinkSync(join(root, 'secret.txt'), join(siteDir, 'link.txt'))
  symlinkSync(root, join(siteDir, 'up'))
  assert.equal(resolveSitePath(siteDir, '/link.txt'), null)
  assert.equal(resolveSitePath(siteDir, '/up/secret.txt'), null)
})

function fakeRes() {
  const res = new PassThrough()
  const body = []
  res.on('data', c => body.push(c))
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers }
  res.text = () => Buffer.concat(body).toString('utf8')
  return res
}

test('serveSiteFile sends the sandboxing CSP on every answer', async () => {
  const { siteDir } = site()
  const ok = fakeRes()
  serveSiteFile({ method: 'GET' }, ok, siteDir, '/index.html')
  await new Promise(resolve => ok.on('finish', resolve))
  assert.equal(ok.status, 200)
  assert.equal(ok.headers['content-type'], 'text/html; charset=utf-8')
  assert.equal(ok.headers['content-security-policy'], SITE_CSP)
  assert.match(SITE_CSP, /sandbox allow-scripts/)
  assert.match(SITE_CSP, /connect-src 'none'/)
  assert.match(SITE_CSP, /form-action 'none'/)
  assert.equal(ok.text(), '<h1>home</h1>')

  const missing = fakeRes()
  serveSiteFile({ method: 'GET' }, missing, siteDir, '/../secret.txt')
  assert.equal(missing.status, 404)
  assert.equal(missing.headers['content-security-policy'], SITE_CSP)

  const post = fakeRes()
  serveSiteFile({ method: 'POST' }, post, siteDir, '/index.html')
  assert.equal(post.status, 405)
})
