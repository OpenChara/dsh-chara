// Who may reach the chara through a messaging app, and inbound dedup.
// Ported from OpenCharaAgent (chara/messaging/access.py, gateway.py).
//
// The chara has real tools (shell, files), so the default is owner-only: each
// platform knows its owner (the logged-in WeChat account, the configured
// Telegram user or QQ number), an empty allow-list means "only me", and "*" is
// an explicit opt-in to everyone.

/**
 * @param {string} senderId
 * @param {Set<string>} allowed - extra senders; "*" opens the chara to everyone.
 * @param {string} [ownerId]
 */
export function senderAllowed(senderId, allowed, ownerId = '') {
  if (ownerId && senderId === ownerId) return true
  if (allowed.has('*')) return true
  return allowed.has(senderId)
}

/** How open a platform is, for the settings page and the startup log. */
export function accessPosture(allowed, ownerId = '') {
  if (allowed.has('*')) return 'open'
  if (allowed.size > 0) return 'restricted'
  return ownerId ? 'owner-only' : 'closed'
}

/** At most one refusal per sender per day: redeliveries must not spam them. */
export class RefusalThrottle {
  constructor(today = () => new Date().toDateString()) {
    this.today = today
    this.lastDay = new Map()
  }

  allow(senderId) {
    const day = this.today()
    if (this.lastDay.get(senderId) === day) return false
    this.lastDay.set(senderId, day)
    return true
  }
}

/**
 * A TTL cache over platform message ids, so a redelivery (OneBot after a
 * reconnect, an unconfirmed long-poll offset) never runs a second turn.
 */
export class MessageDeduplicator {
  constructor({ maxSize = 2000, ttlMs = 300_000, now = () => performance.now() } = {}) {
    this.maxSize = maxSize
    this.ttlMs = ttlMs
    this.now = now
    this.seen = new Map()
  }

  isDuplicate(key) {
    if (!key) return false
    const now = this.now()
    const at = this.seen.get(key)
    if (at !== undefined && now - at < this.ttlMs) return true
    this.seen.delete(key)
    this.seen.set(key, now)
    if (this.seen.size > this.maxSize) {
      for (const [k, t] of this.seen) {
        if (now - t >= this.ttlMs) this.seen.delete(k)
      }
      // Still over: drop the oldest (Map keeps insertion order).
      for (const k of this.seen.keys()) {
        if (this.seen.size <= this.maxSize) break
        this.seen.delete(k)
      }
    }
    return false
  }
}
