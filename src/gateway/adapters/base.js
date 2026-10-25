// The adapter seam, ported from OpenCharaAgent (chara/messaging/base.py).
//
// An adapter owns one platform's I/O:
//   name, label            - id ("weixin") and display name ("WeChat")
//   maxMessageLength       - the platform's cap, in UTF-16 code units
//   run(push)              - loop until close(); push(InboundMessage) per message
//   send(text, peer?)      - deliver to `peer`, or to its default peer when absent
//   rememberPeer(message)  - make an authorized sender the default peer (used by
//                            the chara's chara_speak); never called for strangers
//   ownerId()              - the owner's sender id, always allowed ("" if unknown)
//   needsLogin()           - true while an interactive login (WeChat QR) is due
//   close()
//
// InboundMessage: { senderId, senderName, text, messageId }. messageId is the
// platform's id when one exists ("" otherwise) and keys the inbound dedup.
//
// Unlike the Python version, the reply target is an argument of send() rather
// than adapter state: sends for different chats can be in flight at once here.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * A visible non-delivery that is not worth retrying (no destination yet, the
 * platform refused, flood control): logged, never queued, never faked.
 */
export class DeliveryDeferred extends Error {
  constructor(message) {
    super(message)
    this.name = 'DeliveryDeferred'
  }
}

/** Read an adapter's JSON state file; missing = {}. Corrupt = a loud error. */
export function readState(path, label) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') return {}
    throw new Error(`${label} state file ${path} is unreadable: ${err.message}`)
  }
  let data
  try {
    data = JSON.parse(raw)
  } catch (err) {
    throw new Error(`${label} state file ${path} is unreadable: ${err.message}`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${label} state file ${path} must contain a JSON object`)
  }
  return data
}

/** Write a state file atomically, readable only by its owner (it holds tokens). */
export function writeState(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
  chmodSync(path, 0o600)
}

/** Sleep that ends early when `signal` aborts. */
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

/** An AbortSignal that fires on `parent` abort or after `ms`. */
export function deadline(parent, ms) {
  return parent ? AbortSignal.any([parent, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)
}
