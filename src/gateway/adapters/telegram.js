// Telegram bot adapter over long-poll getUpdates (no public URL, no webhook).
// Ported from OpenCharaAgent (chara/messaging/telegram.py).
//
// Private text chats only. The confirmed offset and the last chat id persist in
// the state file (0600) so a restart never replays old messages and
// chara_speak keeps a destination. A bot cannot message a user who has never
// messaged it, so speaking before first contact is a visible DeliveryDeferred.
import { DeliveryDeferred, deadline, readState, sleep, writeState } from './base.js'

export const DEFAULT_API_BASE = 'https://api.telegram.org'
export const TELEGRAM_TEXT_MAX = 4096
const LONG_POLL_TIMEOUT_S = 25
const LONG_POLL_SLACK_MS = 10_000
const API_TIMEOUT_MS = 15_000

/** A Bot API call that came back non-ok. Never carries the URL: it embeds the token. */
export class TelegramAPIError extends Error {
  constructor(method, status, description, retryAfter) {
    super(`Telegram ${method} failed: HTTP ${status}${description ? ` ${description}` : ''}`)
    this.name = 'TelegramAPIError'
    this.method = method
    this.status = status
    this.description = description
    this.retryAfter = retryAfter
  }
}

/** The bot token was refused: fatal for this adapter, never retried. */
export class TelegramTokenRejected extends Error {
  constructor() {
    super('Telegram rejected the bot token (401 Unauthorized)')
    this.name = 'TelegramTokenRejected'
  }
}

const retryAfterOf = (body) => {
  const value = Number(body?.parameters?.retry_after)
  return Number.isFinite(value) ? value : undefined
}

export class TelegramAPI {
  constructor(botToken, { apiBase = DEFAULT_API_BASE, fetch = globalThis.fetch } = {}) {
    this.botToken = botToken
    this.apiBase = String(apiBase || DEFAULT_API_BASE).trim().replace(/\/+$/, '') || DEFAULT_API_BASE
    this.fetch = fetch
  }

  async call(method, payload = {}, { timeoutMs = API_TIMEOUT_MS, signal } = {}) {
    let res
    try {
      res = await this.fetch(`${this.apiBase}/bot${this.botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: deadline(signal, timeoutMs),
      })
    } catch (err) {
      // fetch errors can quote the URL, which holds the token: rethrow bare.
      throw new Error(`Telegram ${method}: network error (${err?.name ?? 'Error'})`)
    }
    let body = {}
    try {
      body = await res.json()
    } catch {
      body = {}
    }
    if (!body || typeof body !== 'object') body = {}
    if (!res.ok) throw new TelegramAPIError(method, res.status, String(body.description ?? res.statusText ?? ''), retryAfterOf(body))
    if (!body.ok) {
      // Self-hosted Bot API servers may answer 200 with ok=false.
      throw new TelegramAPIError(method, Number(body.error_code) || 0, String(body.description ?? ''), retryAfterOf(body))
    }
    return body.result
  }
}

/** One getUpdates entry → InboundMessage, for new private text messages only. */
export function parseUpdate(update) {
  const message = update?.message
  if (!message || typeof message !== 'object') return null
  const chatId = message.chat?.id
  if (chatId === undefined || chatId === null) return null
  if (message.chat?.type !== 'private') return null
  if (message.from?.is_bot) return null // reply-loop guard
  const text = typeof message.text === 'string' ? message.text.trim() : ''
  if (!text) return null
  return {
    senderId: String(chatId),
    senderName: String(message.from?.first_name || message.from?.username || chatId),
    text,
    // update_id is unique per bot and survives redelivery after an unconfirmed offset.
    messageId: update.update_id === undefined ? '' : String(update.update_id),
  }
}

export class TelegramAdapter {
  name = 'telegram'
  label = 'Telegram'
  maxMessageLength = TELEGRAM_TEXT_MAX

  /**
   * @param {object} config - { botToken, ownerId?, apiBase? }
   * @param {object} opts - { statePath, fetch?, log? }
   */
  constructor(config, { statePath, fetch, log = () => {} } = {}) {
    this.botToken = String(config.botToken ?? '').trim()
    if (!this.botToken) throw new Error('Telegram needs a bot token')
    // The owner's numeric user id (from @userinfobot): configured, not first-come,
    // so a stranger cannot claim the bot.
    this.owner = String(config.ownerId ?? '').trim()
    this.statePath = statePath
    this.log = log
    this.api = new TelegramAPI(this.botToken, { apiBase: config.apiBase, fetch })
    this.abort = new AbortController()
    this.floodUntil = 0
    const state = readState(statePath, 'Telegram')
    this.offset = Number.isInteger(state.offset) ? state.offset : undefined
    this.lastChatId = String(state.last_chat_id ?? '').trim()
  }

  ownerId() { return this.owner }
  needsLogin() { return false }

  rememberPeer(message) {
    const peer = String(message.senderId).trim()
    if (peer && peer !== this.lastChatId) {
      this.lastChatId = peer
      this.saveState()
    }
  }

  saveState() {
    writeState(this.statePath, { offset: this.offset ?? null, last_chat_id: this.lastChatId })
  }

  /** getMe once (a bad token is a clear error, not a retry loop), then drop any webhook. */
  async startupCheck() {
    let me
    try {
      me = await this.api.call('getMe', {}, { signal: this.abort.signal })
    } catch (err) {
      if (err instanceof TelegramAPIError && err.status === 401) throw new TelegramTokenRejected()
      throw err
    }
    this.log(`telegram: bot @${me?.username ?? me?.id} ready`)
    try {
      await this.api.call('deleteWebhook', { drop_pending_updates: false }, { signal: this.abort.signal })
    } catch (err) {
      this.log(`telegram: deleteWebhook failed (getUpdates may 409 while a webhook is active): ${err.message}`)
    }
    return me
  }

  /** One long poll. Returns the number of messages pushed. */
  async pollOnce(push) {
    const payload = { timeout: LONG_POLL_TIMEOUT_S, allowed_updates: ['message'] }
    if (this.offset !== undefined) payload.offset = this.offset
    const result = await this.api.call('getUpdates', payload, {
      timeoutMs: LONG_POLL_TIMEOUT_S * 1000 + LONG_POLL_SLACK_MS,
      signal: this.abort.signal,
    })
    if (!Array.isArray(result)) throw new Error('Telegram getUpdates returned a non-list result')
    let count = 0
    let dirty = false
    for (const update of result) {
      const id = update?.update_id
      if (Number.isInteger(id) && (this.offset === undefined || id + 1 > this.offset)) {
        this.offset = id + 1
        dirty = true
      }
      const message = parseUpdate(update)
      if (message) {
        push(message)
        count += 1
      }
    }
    if (dirty) this.saveState()
    return count
  }

  async run(push) {
    const signal = this.abort.signal
    // A transient blip at startup must not kill inbound for good; a rejected
    // token is fatal (thrown) instead of a retry loop.
    while (!signal.aborted) {
      try {
        await this.startupCheck()
        break
      } catch (err) {
        if (signal.aborted) return
        if (err instanceof TelegramTokenRejected) throw err
        this.log(`telegram: getMe failed (${err.message}); retrying in 5s`)
        await sleep(5000, signal)
      }
    }
    while (!signal.aborted) {
      try {
        await this.pollOnce(push)
      } catch (err) {
        if (signal.aborted) return
        if (err instanceof TelegramAPIError) {
          if (err.status === 401) throw new TelegramTokenRejected()
          if (err.status === 409) {
            this.log('telegram: getUpdates conflict (409): another bot instance or a webhook is active; retrying in 10s')
            await sleep(10_000, signal)
            continue
          }
          if (err.status === 429) {
            await sleep(Math.min(err.retryAfter ?? 5, 60) * 1000, signal)
            continue
          }
        }
        this.log(`telegram: getUpdates error (${err.message}); retrying in 5s`)
        await sleep(5000, signal)
      }
    }
  }

  async send(text, peer) {
    const now = Date.now()
    if (now < this.floodUntil) {
      throw new DeliveryDeferred(`Telegram flood control for another ${Math.ceil((this.floodUntil - now) / 1000)}s; this message was dropped, not queued`)
    }
    const target = String(peer ?? '').trim() || this.lastChatId
    if (!target) throw new DeliveryDeferred('Telegram bots cannot message a user first; waiting for them to say hi')
    const chatId = /^-?\d+$/.test(target) ? Number(target) : target
    try {
      await this.api.call('sendMessage', { chat_id: chatId, text })
    } catch (err) {
      if (err instanceof TelegramAPIError && err.status === 429) {
        const wait = err.retryAfter ?? 1
        this.floodUntil = Date.now() + wait * 1000
        throw new DeliveryDeferred(`Telegram flood control: retry after ${wait}s; this message was dropped, not queued`)
      }
      if (!(err instanceof TelegramAPIError)) {
        throw new DeliveryDeferred(`Telegram sendMessage failed (${err.message}); this message was dropped, not queued`)
      }
      throw err
    }
  }

  close() { this.abort.abort() }
}
