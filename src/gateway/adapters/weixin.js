// Personal WeChat over Tencent's iLink / ClawBot API.
// Ported from OpenCharaAgent (chara/messaging/weixin.py).
//
// Login is a QR scan driven from the settings page (weixinQr / weixinQrStatus
// below); the adapter itself never opens a QR flow, it reports needsLogin()
// until a token is saved. A reply needs the per-user context_token that only
// arrives with an inbound message, so the chara can speak only to someone who
// has messaged it in the current iLink session. Media upload and CDN
// decryption are out of scope: images arrive as a marker ("[图片]").
import { randomBytes, randomUUID } from 'node:crypto'
import { DeliveryDeferred, deadline, readState, sleep, writeState } from './base.js'

export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
export const DEFAULT_BOT_TYPE = '3'
export const WEIXIN_TEXT_MAX = 4000
const LONG_POLL_TIMEOUT_MS = 35_000
const API_TIMEOUT_MS = 15_000
const SESSION_TIMEOUT_ERRCODE = -14
const ECHO_DEDUP_TTL_MS = 180_000
const CHANNEL_VERSION = 'chara'

const str = (value) => (typeof value === 'string' ? value.trim() : '')
const normalizeBase = (value) => String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '') || DEFAULT_BASE_URL
const ok = (payload) => Number(payload?.ret || 0) === 0 && Number(payload?.errcode || 0) === 0
const errcode = (payload) => Number(payload?.errcode || 0)
const formatError = (payload) => `ret=${payload?.ret ?? 0}, errcode=${payload?.errcode ?? 0}, errmsg=${payload?.errmsg ?? ''}`

export class WeixinAPI {
  constructor({ baseUrl = DEFAULT_BASE_URL, fetch = globalThis.fetch } = {}) {
    this.baseUrl = normalizeBase(baseUrl)
    this.fetch = fetch
  }

  async request(method, endpoint, { params, payload, token, timeoutMs = API_TIMEOUT_MS, headers, signal } = {}) {
    let url = `${this.baseUrl}/${endpoint.replace(/^\/+/, '')}`
    if (params) url += `?${new URLSearchParams(params)}`
    const res = await this.fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        'X-WECHAT-UIN': randomBytes(4).toString('base64'),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: deadline(signal, timeoutMs),
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(`WeChat iLink ${endpoint}: HTTP ${res.status}`)
    if (!raw) return {}
    const out = JSON.parse(raw)
    if (!out || typeof out !== 'object' || Array.isArray(out)) throw new Error(`WeChat iLink ${endpoint} returned non-object JSON`)
    return out
  }

  getBotQrcode(botType) {
    return this.request('GET', 'ilink/bot/get_bot_qrcode', { params: { bot_type: botType } })
  }

  getQrcodeStatus(qrcode, { timeoutMs = LONG_POLL_TIMEOUT_MS } = {}) {
    return this.request('GET', 'ilink/bot/get_qrcode_status', {
      params: { qrcode },
      timeoutMs,
      headers: { 'iLink-App-ClientVersion': '1' },
    })
  }

  getUpdates({ token, syncBuf, signal }) {
    return this.request('POST', 'ilink/bot/getupdates', {
      payload: { base_info: { channel_version: CHANNEL_VERSION }, get_updates_buf: syncBuf },
      token,
      timeoutMs: LONG_POLL_TIMEOUT_MS,
      signal,
    })
  }

  sendText({ token, toUserId, contextToken, text }) {
    return this.request('POST', 'ilink/bot/sendmessage', {
      payload: {
        base_info: { channel_version: CHANNEL_VERSION },
        msg: {
          from_user_id: '',
          to_user_id: toUserId,
          client_id: randomUUID().replaceAll('-', ''),
          message_type: 2,
          message_state: 2,
          context_token: contextToken,
          item_list: [{ type: 1, text_item: { text } }],
        },
      },
      token,
    })
  }
}

// iLink item types: 1 (text) and 3 (voice, with the cloud transcript) are
// confirmed; the media numbers are unverified, so the typed sub-object decides
// first and an unknown item becomes a generic marker instead of vanishing.
const ITEM_TEXT = 1
const ITEM_IMAGE = 2
const ITEM_VOICE = 3
const ITEM_EMOJI = 5
const ITEM_FILE = 6

function mediaUrl(item, sub) {
  for (const src of [sub, item]) {
    for (const key of ['url', 'cdn_url', 'file_url']) {
      const value = str(src?.[key])
      if (/^https?:\/\//.test(value)) return value
    }
  }
  return ''
}

/** An iLink item_list → its text, with media folded in as markers. */
export function itemListToText(itemList) {
  if (!Array.isArray(itemList)) return ''
  const parts = []
  for (const item of itemList) {
    if (!item || typeof item !== 'object') continue
    const type = Number(item.type) || 0
    const image = item.image_item ?? item.img_item
    const file = item.file_item ?? item.doc_item
    const emoji = item.emoji_item ?? item.sticker_item ?? item.custom_emoji_item
    if (type === ITEM_TEXT || item.text_item) {
      const text = str(item.text_item?.text)
      if (text) parts.push(text)
    } else if (type === ITEM_VOICE || item.voice_item) {
      const text = str(item.voice_item?.text)
      parts.push(text || '[语音]')
    } else if (type === ITEM_IMAGE || image) {
      const url = mediaUrl(item, image)
      parts.push(url ? `[图片: ${url}]` : '[图片]')
    } else if (type === ITEM_FILE || file) {
      const name = str(file?.file_name) || str(file?.name)
      parts.push(name ? `[文件: ${name}]` : '[文件]')
    } else if (type === ITEM_EMOJI || emoji) {
      parts.push('[表情]')
    } else {
      parts.push('[媒体]')
    }
  }
  return parts.join('\n').trim()
}

export class WeixinAdapter {
  name = 'weixin'
  label = '微信'
  maxMessageLength = WEIXIN_TEXT_MAX

  constructor(config, { statePath, fetch, log = () => {} } = {}) {
    this.statePath = statePath
    this.log = log
    this.abort = new AbortController()
    const state = readState(statePath, 'WeChat')
    this.token = str(state.token)
    this.accountId = str(state.account_id)
    this.botId = str(state.ilink_bot_id)
    this.userId = str(state.ilink_user_id)
    this.syncBuf = str(state.sync_buf)
    this.needsRelogin = Boolean(state.needs_relogin)
    this.contextTokens = new Map(Object.entries(state.context_tokens ?? {}).filter(([k, v]) => str(k) && str(v)))
    this.api = new WeixinAPI({ baseUrl: str(state.base_url) || config.baseUrl, fetch })
    this.lastSender = ''
    // In personal WeChat the bound account is both the owner typing to the chara
    // and the echo of the chara's own replies, so echoes are told apart by
    // content: recently sent texts are remembered and their echo dropped once.
    this.recentSends = []
  }

  // The logged-in account is the owner; its id is opaque in the WeChat app, so
  // owner-allow is what lets an empty allow-list mean "only me".
  ownerId() { return this.userId }
  needsLogin() { return !(this.token && !this.needsRelogin) }

  rememberPeer(message) {
    const peer = String(message.senderId).trim()
    if (peer) this.lastSender = peer
  }

  saveState() {
    writeState(this.statePath, {
      token: this.token,
      account_id: this.accountId || this.botId || this.userId,
      ilink_bot_id: this.botId,
      ilink_user_id: this.userId,
      base_url: this.api.baseUrl,
      sync_buf: this.syncBuf,
      context_tokens: Object.fromEntries([...this.contextTokens].sort()),
      needs_relogin: this.needsRelogin,
    })
  }

  sessionTimedOut(action, payload) {
    this.needsRelogin = true
    this.saveState()
    throw new Error(`WeChat iLink ${action} session timed out (${formatError(payload)}); scan the QR code again`)
  }

  rememberSend(text) {
    const t = text.trim()
    if (!t) return
    const now = Date.now()
    this.recentSends = this.recentSends.filter(([, at]) => now - at <= ECHO_DEDUP_TTL_MS)
    this.recentSends.push([t, now])
  }

  /** Whether `text` is the echo of a recent send; consumes the match. */
  isEchoOfRecentSend(text) {
    const t = text.trim()
    if (!t) return false
    const now = Date.now()
    this.recentSends = this.recentSends.filter(([, at]) => now - at <= ECHO_DEDUP_TTL_MS)
    const at = this.recentSends.findIndex(([sent]) => sent === t)
    if (at === -1) return false
    this.recentSends.splice(at, 1)
    return true
  }

  handleInbound(msg, push) {
    const senderId = str(msg.from_user_id) || str(msg.ilink_user_id) || str(msg.sender_id)
    if (!senderId) return false
    // The bot's own service ids are pure self: always drop.
    if ([this.accountId, this.botId].filter(Boolean).includes(senderId)) return false
    let dirty = false
    const contextToken = str(msg.context_token)
    if (contextToken && this.contextTokens.get(senderId) !== contextToken) {
      this.contextTokens.set(senderId, contextToken)
      dirty = true
    }
    const text = itemListToText(msg.item_list)
    if (senderId === this.userId && this.isEchoOfRecentSend(text)) return dirty
    if (text) {
      push({
        senderId,
        senderName: senderId === this.userId ? '' : senderId,
        text,
        messageId: str(String(msg.message_id ?? msg.msg_id ?? '')),
      })
    }
    return dirty
  }

  async pollOnce(push) {
    const data = await this.api.getUpdates({ token: this.token, syncBuf: this.syncBuf, signal: this.abort.signal })
    if (!ok(data)) {
      if (errcode(data) === SESSION_TIMEOUT_ERRCODE) this.sessionTimedOut('getupdates', data)
      throw new Error(`WeChat iLink getupdates failed: ${formatError(data)}`)
    }
    let dirty = false
    if (data.get_updates_buf) {
      this.syncBuf = String(data.get_updates_buf)
      dirty = true
    }
    let count = 0
    for (const msg of Array.isArray(data.msgs) ? data.msgs : []) {
      if (!msg || typeof msg !== 'object') continue
      dirty = this.handleInbound(msg, push) || dirty
      count += 1
    }
    if (dirty) this.saveState()
    return count
  }

  async run(push) {
    const signal = this.abort.signal
    if (this.needsLogin()) throw new Error('WeChat is not logged in; scan the QR code in the settings')
    while (!signal.aborted) {
      try {
        await this.pollOnce(push)
      } catch (err) {
        if (signal.aborted) return
        if (this.needsRelogin) throw err // only a session timeout is fatal: it needs a new QR scan
        this.log(`weixin: getupdates error (${err.message}); retrying in 5s`)
        await sleep(5000, signal)
      }
    }
  }

  targetFor(peer) {
    const explicit = String(peer ?? '').trim()
    if (explicit) return explicit
    if (this.lastSender) return this.lastSender
    if (this.contextTokens.size === 1) return [...this.contextTokens.keys()][0]
    return ''
  }

  async send(text, peer) {
    if (this.needsLogin()) throw new DeliveryDeferred('WeChat is not logged in')
    const target = this.targetFor(peer)
    if (!target) throw new DeliveryDeferred('WeChat is waiting for someone to say hi first (a reply needs their context_token)')
    const contextToken = this.contextTokens.get(target)
    if (!contextToken) throw new DeliveryDeferred(`WeChat cannot send to ${target} until they message first (no context_token)`)
    const payload = await this.api.sendText({ token: this.token, toUserId: target, contextToken, text })
    if (ok(payload)) {
      this.rememberSend(text)
      return
    }
    if (errcode(payload) === SESSION_TIMEOUT_ERRCODE) this.sessionTimedOut('sendmessage', payload)
    throw new Error(`WeChat iLink sendmessage failed: ${formatError(payload)}`)
  }

  close() { this.abort.abort() }
}

/**
 * Start a QR login. `scanContent` is what the phone scans; `qrcode` is only
 * the polling handle for weixinQrStatus (encoding the handle is the classic
 * "scans to nothing" bug).
 */
export async function weixinQr({ baseUrl, botType = DEFAULT_BOT_TYPE, fetch } = {}) {
  const api = new WeixinAPI({ baseUrl, fetch })
  const data = await api.getBotQrcode(botType)
  const qrcode = str(data.qrcode)
  const scanContent = str(data.qrcode_img_content)
  if (!qrcode || !scanContent) throw new Error('WeChat iLink returned no qrcode / qrcode_img_content')
  return { qrcode, scanContent }
}

/**
 * One poll of a QR login. On "confirmed" the login is saved to `statePath`, so
 * the adapter starts logged in. A slow poll is "wait", not an error.
 */
export async function weixinQrStatus(qrcode, { baseUrl, statePath, fetch } = {}) {
  const api = new WeixinAPI({ baseUrl, fetch })
  let status
  try {
    status = await api.getQrcodeStatus(qrcode, { timeoutMs: 5000 })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { status: 'wait' }
    throw err
  }
  const raw = str(status.status) || 'wait'
  if (raw !== 'confirmed') return { status: raw }
  const token = str(status.bot_token)
  if (!token) throw new Error('WeChat iLink confirmed the login but returned no bot_token')
  const previous = readState(statePath, 'WeChat')
  const botId = str(status.ilink_bot_id)
  const userId = str(status.ilink_user_id)
  writeState(statePath, {
    token,
    account_id: botId || userId,
    ilink_bot_id: botId,
    ilink_user_id: userId,
    base_url: normalizeBase(str(status.baseurl) || baseUrl),
    // A new login is a new iLink session: old sync position and context tokens
    // belong to the previous one.
    sync_buf: previous.ilink_user_id === userId ? str(previous.sync_buf) : '',
    context_tokens: previous.ilink_user_id === userId ? (previous.context_tokens ?? {}) : {},
    needs_relogin: false,
  })
  return { status: 'confirmed', accountId: botId || userId }
}
