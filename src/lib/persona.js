// Personas shipped with the package (personas/<id>/). v0.1 ships one: dafeiyu.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const REQUIRED = ['id', 'name', 'presetId', 'sessionTitle', 'homeTabLabel', 'wakeTitle', 'wakePrompt', 'firstWakePrompt']

export function personaDir(id) {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(id)) throw new Error(`invalid persona id: ${JSON.stringify(id)}`)
  return join(PACKAGE_DIR, 'personas', id)
}

export function loadPersona(id) {
  const dir = personaDir(id)
  const persona = JSON.parse(readFileSync(join(dir, 'persona.json'), 'utf8'))
  const missing = REQUIRED.filter(key => typeof persona[key] !== 'string' || persona[key].trim() === '')
  if (missing.length > 0) throw new Error(`persona ${id}: missing ${missing.join(', ')}`)
  if (persona.id !== id) throw new Error(`persona ${id}: persona.json says id ${JSON.stringify(persona.id)}`)
  if (persona.wakeTitle.length > 120) throw new Error(`persona ${id}: wakeTitle exceeds DSH's 120-character limit`)
  return { ...persona, dir }
}
