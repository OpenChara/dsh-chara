// gateway.json: which messaging apps the chara is reachable on, and who may
// reach it. Lives in the chara's state dir, readable only by its owner (it
// holds bot tokens); the API hands out a masked copy.
import { readState, writeState } from './adapters/base.js'

export const PLATFORMS = Object.freeze(['weixin', 'telegram', 'qq'])

const FIELDS = Object.freeze({
  weixin: { enabled: false, baseUrl: '' },
  telegram: { enabled: false, botToken: '', ownerId: '', apiBase: '' },
  qq: { enabled: false, url: '', accessToken: '', peerId: '' },
})

const SECRETS = Object.freeze({ telegram: ['botToken'], qq: ['accessToken'] })
const MASK = '••••'

/** A complete, well-typed config from anything (missing fields get defaults). */
export function normalizeConfig(input = {}) {
  const out = { allowedSenders: senders(input.allowedSenders) }
  for (const platform of PLATFORMS) {
    const given = input[platform] && typeof input[platform] === 'object' ? input[platform] : {}
    out[platform] = {}
    for (const [key, fallback] of Object.entries(FIELDS[platform])) {
      const value = given[key]
      out[platform][key] = typeof fallback === 'boolean' ? Boolean(value ?? fallback) : String(value ?? fallback).trim()
    }
  }
  return out
}

function senders(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[\s,，]+/)
  return [...new Set(list.map(v => String(v).trim()).filter(Boolean))]
}

export function loadConfig(path) {
  return normalizeConfig(readState(path, 'Gateway'))
}

export function saveConfig(path, config) {
  const normalized = normalizeConfig(config)
  writeState(path, normalized)
  return normalized
}

/** The config with every secret replaced by a mask that keeps its last 4 characters. */
export function maskConfig(config) {
  const out = structuredClone(config)
  for (const [platform, keys] of Object.entries(SECRETS)) {
    for (const key of keys) {
      const value = out[platform][key]
      if (value) out[platform][key] = `${MASK}${value.slice(-4)}`
    }
  }
  return out
}

/**
 * Apply an edit from the settings page onto the saved config. A secret that
 * comes back still masked keeps its saved value; any other value replaces it.
 */
export function mergeEdit(saved, edit) {
  const next = normalizeConfig({ ...saved, ...edit, ...Object.fromEntries(
    PLATFORMS.map(p => [p, { ...saved[p], ...(edit?.[p] ?? {}) }]),
  ) })
  for (const [platform, keys] of Object.entries(SECRETS)) {
    for (const key of keys) {
      if (next[platform][key].startsWith(MASK)) next[platform][key] = saved[platform][key]
    }
  }
  return next
}
