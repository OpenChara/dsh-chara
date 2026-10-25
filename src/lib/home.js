// Seeding a chara's files, and serving its website read-only.
import { createReadStream, existsSync, realpathSync, statSync, copyFileSync } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { atomicWrite, copyTreeIfMissing, ensureDir } from './fsutil.js'

/**
 * Lay down a chara's files from its persona folder. Idempotent and
 * non-destructive: an existing file (the user's edits to soul.md, the chara's
 * own pages) is never overwritten.
 * @returns the paths created by this call.
 */
export function seedChara(paths, personaDir, avatarFile = 'avatar.png') {
  const created = []
  ensureDir(paths.soulDir)
  ensureDir(paths.stateDir)
  if (!existsSync(paths.soul)) {
    copyFileSync(join(personaDir, 'soul.md'), paths.soul)
    created.push(paths.soul)
  }
  created.push(...copyTreeIfMissing(join(personaDir, 'home'), paths.home))
  const avatar = join(paths.site, avatarFile)
  if (!existsSync(avatar)) {
    copyFileSync(join(personaDir, avatarFile), avatar)
    created.push(avatar)
  }
  if (!existsSync(paths.memory)) {
    atomicWrite(paths.memory, '# MEMORY\n\n')
    created.push(paths.memory)
  }
  return created
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}

/**
 * The site runs chara-authored pages, so it is locked down whether it is
 * framed by the client or opened on its own: the CSP `sandbox` directive gives
 * every page an opaque origin (no access to the host's cookies or storage),
 * and no page may make requests, submit forms or set a base URL.
 */
export const SITE_CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  'sandbox allow-scripts',
].join('; ')

/**
 * Resolve a URL path below the site root to a real file inside it, or null.
 * Rejects traversal, NUL bytes, and symlinks that point outside the root.
 */
export function resolveSitePath(siteRoot, urlPath) {
  let rel
  try {
    rel = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (rel.includes('\0')) return null
  const parts = rel.split('/').filter(p => p !== '' && p !== '.')
  if (parts.some(p => p === '..')) return null
  let root
  try {
    root = realpathSync(siteRoot)
  } catch {
    return null
  }
  let target = join(root, ...parts)
  try {
    target = realpathSync(target)
    if (statSync(target).isDirectory()) target = realpathSync(join(target, 'index.html'))
  } catch {
    return null
  }
  if (target !== root && !target.startsWith(root + sep)) return null
  return statSync(target).isFile() ? target : null
}

/** Answer one GET/HEAD for the site. */
export function serveSiteFile(req, res, siteRoot, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  const file = resolveSitePath(siteRoot, urlPath)
  const headers = {
    'content-security-policy': SITE_CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  }
  if (!file) {
    res.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  res.writeHead(200, {
    ...headers,
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': statSync(file).size,
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(file).pipe(res)
}
