// Small file helpers. Writes are atomic (temp file + rename) so a crash never
// leaves a half-written state or persona file behind.
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}

export function atomicWrite(path, text) {
  ensureDir(dirname(path))
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

/** The file's text, or `fallback` when it does not exist. Other read errors throw. */
export function readText(path, fallback = '') {
  try {
    return readFileSync(path, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback
    throw err
  }
}

/** Parsed JSON, or `fallback` when the file is missing. A corrupt file throws. */
export function readJson(path, fallback) {
  const text = readText(path, null)
  if (text === null) return fallback
  return JSON.parse(text)
}

export function writeJson(path, value) {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Copy a directory tree, skipping every file that already exists at the
 * destination: seeding must never overwrite what the user or the chara made.
 * @returns the destination paths that were created.
 */
export function copyTreeIfMissing(src, dest) {
  const created = []
  ensureDir(dest)
  for (const name of readdirSync(src)) {
    const from = join(src, name)
    const to = join(dest, name)
    if (statSync(from).isDirectory()) {
      created.push(...copyTreeIfMissing(from, to))
    } else if (!existsSync(to)) {
      copyFileSync(from, to)
      created.push(to)
    }
  }
  return created
}
