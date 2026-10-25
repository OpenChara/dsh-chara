// QQ through a OneBot v11 implementation (NapCat, Lagrange) over its forward
// WebSocket. Ported from OpenCharaAgent (chara/messaging/qq.py).
//
// The plugin is the WebSocket client; QQ login happens in the NapCat/Lagrange
// WebUI. Private text messages only. Every send waits for the OneBot action
// response (matched by `echo`) so a refused send (not a friend, muted) is a
// visible DeliveryDeferred instead of a silent success.
import { randomUUID } from 'node:crypto'
import { DeliveryDeferred, sleep } from './base.js'

export const QQ_TEXT_MAX = 4500
const ACK_TIMEOUT_MS = 10_000

/** OneBot v11 message (string or segment array) → its text segments. */
export function onebotMessageText(message) {
  if (typeof message === 'string') return message.trim()
  if (!Array.isArray(message)) return ''
  return message
    .filter(seg => seg?.type === 'text')
    .map(seg => String(seg.data?.text ?? ''))
    .join('')
    .trim()
}

/** One OneBot event frame → InboundMessage, for private messages only. */
export function parseOnebotEvent(raw) {
  let event
  try {
    event = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'))
  } catch {
    return null
  }
  if (event?.post_type !== 'message' || event.message_type !== 'private') return null
  const senderId = String(event.user_id ?? '').trim()
  const text = onebotMessageText(event.message)
  if (!senderId || !text) return null
  return {
    senderId,
    senderName: String(event.sender?.nickname || event.sender?.card || senderId),
    text,
    // NapCat/Lagrange can redeliver after a reconnect.
    messageId: String(event.message_id ?? ''),
  }
}

export class QQAdapter {
  name = 'qq'
  label = 'QQ'
  maxMessageLength = QQ_TEXT_MAX

  /**
   * @param {object} config - { url, accessToken?, peerId? }
   * @param {object} opts - { connect?: (url, headers) => WebSocket-like, log? }
   */
  constructor(config, { connect, log = () => {} } = {}) {
    this.url = String(config.url ?? '').trim()
    if (!this.url) throw new Error('QQ needs the OneBot WebSocket URL')
    this.accessToken = String(config.accessToken ?? '').trim()
    // The configured QQ number is the owner, and the default destination.
    this.peerId = String(config.peerId ?? '').trim()
    this.connectFn = connect ?? ((url, headers) => new WebSocket(url, { headers }))
    this.log = log
    this.abort = new AbortController()
    this.socket = null
    this.pendingAcks = new Map()
    this.lastSender = ''
  }

  ownerId() { return this.peerId }
  needsLogin() { return false }

  rememberPeer(message) {
    const peer = String(message.senderId).trim()
    if (peer) this.lastSender = peer
  }

  /** Open one connection and serve it until it closes. */
  connectOnce(push) {
    return new Promise((resolve) => {
      const headers = this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : undefined
      let socket
      try {
        socket = this.connectFn(this.url, headers)
      } catch (err) {
        this.log(`qq: cannot connect to ${this.url}: ${err.message}`)
        resolve(false)
        return
      }
      let opened = false
      const onAbort = () => socket.close()
      this.abort.signal.addEventListener('abort', onAbort, { once: true })
      socket.addEventListener('open', () => {
        opened = true
        this.socket = socket
        this.log(`qq: connected to ${this.url}`)
      })
      socket.addEventListener('message', (ev) => {
        if (this.resolveAck(ev.data)) return
        const message = parseOnebotEvent(ev.data)
        if (message) push(message)
      })
      socket.addEventListener('close', () => {
        this.abort.signal.removeEventListener('abort', onAbort)
        if (this.socket === socket) this.socket = null
        this.failPendingAcks()
        resolve(opened)
      })
      socket.addEventListener('error', () => { /* a close follows */ })
    })
  }

  async run(push) {
    let backoff = 1000
    while (!this.abort.signal.aborted) {
      const opened = await this.connectOnce(push)
      if (this.abort.signal.aborted) return
      if (opened) backoff = 1000
      this.log(`qq: OneBot connection closed; reconnecting in ${backoff / 1000}s`)
      await sleep(backoff, this.abort.signal)
      backoff = Math.min(backoff * 2, 60_000)
    }
  }

  /** Route an action response (has `echo`, no `post_type`) to its waiting send. */
  resolveAck(raw) {
    let frame
    try {
      frame = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'))
    } catch {
      return false
    }
    if (!frame || typeof frame !== 'object' || 'post_type' in frame || !frame.echo) return false
    this.pendingAcks.get(String(frame.echo))?.(frame)
    return true
  }

  failPendingAcks() {
    for (const settle of this.pendingAcks.values()) settle(null)
  }

  async send(text, peer) {
    const target = String(peer ?? '').trim() || this.lastSender || this.peerId
    if (!target) throw new DeliveryDeferred('QQ has no destination yet (no QQ number configured and nobody has messaged)')
    const socket = this.socket
    if (!socket) throw new DeliveryDeferred('QQ OneBot is disconnected (reconnecting); this message was dropped, not queued')
    const echo = randomUUID()
    const ack = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), ACK_TIMEOUT_MS)
      this.pendingAcks.set(echo, (frame) => {
        clearTimeout(timer)
        resolve(frame)
      })
    })
    try {
      socket.send(JSON.stringify({
        action: 'send_private_msg',
        params: { user_id: /^\d+$/.test(target) ? Number(target) : target, message: text },
        echo,
      }))
      const frame = await ack
      if (frame === undefined) {
        // The frame was written; a slow server is not a failure, but say so.
        this.log(`qq: no OneBot response within ${ACK_TIMEOUT_MS / 1000}s; assuming delivered`)
        return
      }
      if (frame === null) throw new DeliveryDeferred('QQ OneBot connection dropped before it answered; the message may not have arrived')
      const retcode = Number(frame.retcode)
      if (retcode !== 0) {
        const wording = String(frame.wording || frame.message || frame.msg || '').trim()
        throw new DeliveryDeferred(`QQ OneBot refused send_private_msg (retcode=${Number.isFinite(retcode) ? retcode : '?'}${wording ? ` ${wording}` : ''})`)
      }
    } finally {
      this.pendingAcks.delete(echo)
    }
  }

  close() {
    this.abort.abort()
    this.socket?.close()
  }
}
