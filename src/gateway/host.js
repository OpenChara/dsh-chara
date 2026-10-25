// The messaging gateway: one chara, one session, reachable from every app.
// Ported from OpenCharaAgent's in-process MessagingHost
// (chara/server/messaging_host.py) onto DSH's session API.
//
//   * A message from an allowed sender is queued into the chara's own session
//     (sessionController.prompt), tagged with the app it came from, so the
//     exchange shows in DSH live and the chara answers with its full context.
//   * The text of the turn that answers it goes back to that chat. Turns the
//     user drives from DSH, and the chara's free time, are never echoed out.
//   * The chara reaches out on its own only through chara_speak, which goes to
//     every connected app's latest chat (ported from the speak tool).
//   * Owner-only by default; a stranger gets one refusal a day and no turn.
//
// Adapters are built from gateway.json and reconciled per platform, so turning
// one app on or off never drops the others' connections.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { DeliveryDeferred, readState, writeState } from './adapters/base.js'
import { QQAdapter } from './adapters/qq.js'
import { TelegramAdapter } from './adapters/telegram.js'
import { WeixinAdapter, weixinQr, weixinQrStatus } from './adapters/weixin.js'
import { MessageDeduplicator, RefusalThrottle, accessPosture, senderAllowed } from './access.js'
import { PLATFORMS, loadConfig, maskConfig, mergeEdit, saveConfig } from './config.js'
import { isSilenceNarration, splitText } from './text.js'

/** How each app is named to the model, at the start of a message from it. */
export const MODEL_TAGS = Object.freeze({ weixin: 'WeChat', telegram: 'Telegram', qq: 'QQ' })
export const LABELS = Object.freeze({ weixin: '微信', telegram: 'Telegram', qq: 'QQ' })

const SEND_RETRY_MS = 3000

const DEFAULT_TEXTS = Object.freeze({
  ack: '{name} got it, thinking…',
  refusal: 'Sorry, {name} only talks with the people it knows here.',
  approval: '({name} wants to use {tool} and needs your approval in DSH.)',
  notReady: "({name}'s session is not ready yet; try again in a moment.)",
  failed: "(Your message did not reach {name}: {error})",
  unfinished: '({name} did not finish that turn: {reason})',
})

const fill = (template, values) => template.replace(/\{(\w+)\}/g, (all, key) => (key in values ? String(values[key]) : all))

export function defaultFactories({ fetch, log }) {
  return {
    weixin: (config, statePath) => new WeixinAdapter(config, { statePath, fetch, log }),
    telegram: (config, statePath) => new TelegramAdapter(config, { statePath, fetch, log }),
    qq: (config) => new QQAdapter(config, { log }),
  }
}

export class GatewayHost {
  /**
   * @param {object} opts
   * @param {string} opts.stateDir - gateway.json and the adapters' state files live here
   * @param {object} opts.persona - name, and optional `gateway` texts (ack, refusal, ...)
   * @param {() => string|null} opts.sessionId - the chara's session, once it exists
   * @param {(request: object) => Promise<unknown>} opts.prompt - sessionController.prompt
   * @param {object} [opts.factories] - platform → (config, statePath) => adapter
   * @param {typeof fetch} [opts.fetch] - for the WeChat QR login calls
   */
  constructor({ stateDir, persona, sessionId, prompt, factories, fetch = globalThis.fetch, log = () => {}, warn = log, retryMs = SEND_RETRY_MS }) {
    this.configPath = join(stateDir, 'gateway.json')
    this.statePaths = {
      weixin: join(stateDir, 'weixin_state.json'),
      telegram: join(stateDir, 'telegram_state.json'),
      qq: join(stateDir, 'qq_state.json'),
    }
    this.persona = persona
    this.texts = { ...DEFAULT_TEXTS, ...(persona.gateway ?? {}) }
    this.sessionId = sessionId
    this.prompt = prompt
    this.fetch = fetch
    this.log = log
    this.warn = warn
    this.retryMs = retryMs
    this.factories = factories ?? defaultFactories({ fetch, log })
    this.config = loadConfig(this.configPath)
    this.live = new Map() // platform → { adapter, fingerprint }
    this.errors = new Map() // platform → why it stopped
    this.dedup = new MessageDeduplicator()
    this.refusals = new RefusalThrottle()
    this.pending = new Map() // prompt requestId → origin { platform, peer }
    this.turn = null // { origins: Map<key, origin>, texts: string[] } for the running turn
    this.inbound = Promise.resolve() // serializes inbound handling, in arrival order
    this.stopped = false
  }

  text(key, values = {}) {
    return fill(this.texts[key], { name: this.persona.name, ...values })
  }

  // ---- lifecycle ----------------------------------------------------------

  /** Bring the running adapters in line with gateway.json. */
  reconcile() {
    if (this.stopped) return this.status()
    for (const platform of PLATFORMS) {
      const settings = this.config[platform]
      const fingerprint = JSON.stringify(settings)
      const running = this.live.get(platform)
      if (running && (!settings.enabled || running.fingerprint !== fingerprint)) this.stopOne(platform)
      if (!settings.enabled || this.live.has(platform)) continue
      this.startOne(platform, settings, fingerprint)
    }
    return this.status()
  }

  startOne(platform, settings, fingerprint) {
    let adapter
    try {
      adapter = this.factories[platform](settings, this.statePaths[platform])
    } catch (err) {
      this.errors.set(platform, err.message)
      this.warn(`gateway: ${platform} not started: ${err.message}`)
      return
    }
    this.errors.delete(platform)
    if (adapter.needsLogin()) {
      // Waits for the QR scan in the settings; started by weixinQrStatus.
      adapter.close()
      return
    }
    const entry = { adapter, fingerprint }
    this.live.set(platform, entry)
    const posture = accessPosture(this.allowed(), adapter.ownerId())
    this.log(`gateway: ${platform} started (${posture})`)
    if (posture === 'open') this.warn(`gateway: ${platform} is OPEN to everyone ("*" in the allow-list), and the chara has tools`)
    if (posture === 'closed') this.warn(`gateway: ${platform} has no owner and an empty allow-list: nobody can reach the chara`)
    Promise.resolve()
      .then(() => adapter.run((message) => this.enqueue(platform, adapter, message)))
      .catch((err) => {
        if (this.live.get(platform) !== entry) return // stopped on purpose
        this.live.delete(platform)
        this.errors.set(platform, err?.message ?? String(err))
        this.warn(`gateway: ${platform} stopped: ${err?.message ?? err}`)
      })
  }

  stopOne(platform) {
    const entry = this.live.get(platform)
    this.live.delete(platform)
    try {
      entry?.adapter.close()
    } catch (err) {
      this.warn(`gateway: closing ${platform} failed: ${err.message}`)
    }
  }

  stop() {
    this.stopped = true
    for (const platform of [...this.live.keys()]) this.stopOne(platform)
  }

  allowed() {
    return new Set(this.config.allowedSenders)
  }

  status() {
    const platforms = PLATFORMS.map((platform) => {
      const settings = this.config[platform]
      const entry = this.live.get(platform)
      let state = 'off'
      let detail = ''
      if (entry) state = 'running'
      else if (this.errors.has(platform)) [state, detail] = ['error', this.errors.get(platform)]
      else if (settings.enabled) [state, detail] = ['needs_login', 'scan the QR code to log in']
      return {
        platform,
        label: LABELS[platform],
        enabled: settings.enabled,
        state,
        detail,
        access: entry ? accessPosture(this.allowed(), entry.adapter.ownerId()) : undefined,
      }
    })
    return { platforms, allowedSenders: this.config.allowedSenders }
  }

  view() {
    return { config: maskConfig(this.config), status: this.status() }
  }

  /** Save an edit from the settings page and apply it. */
  update(edit) {
    this.config = saveConfig(this.configPath, mergeEdit(this.config, edit))
    this.reconcile()
    return this.view()
  }

  // ---- inbound ------------------------------------------------------------

  enqueue(platform, adapter, message) {
    this.inbound = this.inbound
      .then(() => this.handleInbound(platform, adapter, message))
      .catch((err) => this.warn(`gateway: ${platform} message failed: ${err?.message ?? err}`))
    return this.inbound
  }

  async handleInbound(platform, adapter, message) {
    if (message.messageId && this.dedup.isDuplicate(`${platform}:${message.messageId}`)) return
    const sender = String(message.senderId)
    const owner = adapter.ownerId()
    if (!senderAllowed(sender, this.allowed(), owner)) {
      this.log(`gateway: ignored ${platform} sender ${sender} (not allowed)`)
      if (this.refusals.allow(`${platform}:${sender}`)) await this.deliver(platform, this.text('refusal'), sender)
      return
    }
    // Only an allowed sender may become the destination of chara_speak.
    adapter.rememberPeer(message)
    const text = String(message.text ?? '').trim()
    if (!text) return
    const sessionId = this.sessionId()
    if (!sessionId) {
      await this.deliver(platform, this.text('notReady'), sender)
      return
    }
    await this.deliver(platform, this.text('ack'), sender)
    const name = sender === owner ? '' : String(message.senderName || sender)
    const tag = `[${MODEL_TAGS[platform]}${name ? ` · ${name}` : ''}]`
    const requestId = `gateway-${platform}-${message.messageId || randomUUID()}`
    this.pending.set(requestId, { platform, peer: sender })
    try {
      await this.prompt({ requestId, sessionId, mode: 'queue', content: [{ type: 'text', text: `${tag} ${text}` }] })
    } catch (err) {
      this.pending.delete(requestId)
      await this.deliver(platform, this.text('failed', { error: err?.message ?? String(err) }), sender)
    }
  }

  // ---- the chara's session ------------------------------------------------

  /** Feed every event of the chara's session. */
  onSessionEvent(event) {
    const data = event?.data ?? {}
    switch (event?.type) {
      case 'turn/start':
        this.turn = { origins: new Map(), texts: [] }
        break
      case 'user/message': {
        const origin = this.pending.get(data.source?.rpcId)
        if (!origin) break
        this.pending.delete(data.source.rpcId)
        this.turn ??= { origins: new Map(), texts: [] }
        this.turn.origins.set(`${origin.platform}:${origin.peer}`, origin)
        break
      }
      case 'assistant/message': {
        if (!this.turn?.origins.size) break
        const parts = Array.isArray(data.message?.content) ? data.message.content : []
        const text = parts.filter(p => p?.type === 'text').map(p => p.text ?? '').join('').trim()
        if (text) this.turn.texts.push(text)
        break
      }
      case 'approval/asked': {
        if (!this.turn?.origins.size) break
        const note = this.text('approval', { tool: data.toolName ?? 'a tool' })
        for (const origin of this.turn.origins.values()) this.deliver(origin.platform, note, origin.peer)
        break
      }
      case 'turn/end': {
        const turn = this.turn
        this.turn = null
        if (!turn?.origins.size) break
        const reason = data.reason?.kind ?? 'completed'
        let reply = turn.texts.join('\n\n')
        if (!reply && reason !== 'completed') reply = this.text('unfinished', { reason })
        if (!reply) break
        for (const origin of turn.origins.values()) this.deliver(origin.platform, reply, origin.peer)
        break
      }
      default:
        break
    }
  }

  // ---- outbound -----------------------------------------------------------

  /**
   * chara_speak: reach the user on every connected app, at its latest chat.
   * During a turn that answers a message, the text also joins that reply, and
   * the chat it came from is not sent it twice.
   * @returns {Promise<Array<{platform: string, label: string, ok: boolean, detail?: string}>>}
   */
  async speak(text) {
    const origins = this.turn?.origins ?? new Map()
    if (origins.size) this.turn.texts.push(text)
    const results = []
    for (const platform of [...this.live.keys()]) {
      const originHere = [...origins.values()].some(o => o.platform === platform)
      if (originHere) {
        results.push({ platform, label: LABELS[platform], ok: true, detail: 'with the reply to this conversation' })
        continue
      }
      const outcome = await this.deliver(platform, text)
      results.push({ platform, label: LABELS[platform], ...outcome })
    }
    return results
  }

  /**
   * Send one message: drop silence tokens, split to the platform's cap, retry a
   * failed part once, stop at a part that cannot be delivered (the rest would
   * read garbled). Never throws.
   * @returns {Promise<{ok: boolean, detail?: string}>}
   */
  async deliver(platform, text, peer) {
    const adapter = this.live.get(platform)?.adapter
    if (!adapter) return { ok: false, detail: 'not connected' }
    if (isSilenceNarration(text)) return { ok: false, detail: 'nothing to say' }
    const parts = adapter.maxMessageLength ? splitText(text, adapter.maxMessageLength) : [text]
    for (const [index, part] of parts.entries()) {
      for (let attempt = 1; ; attempt++) {
        try {
          await adapter.send(part, peer)
          break
        } catch (err) {
          const dropped = parts.length - index - 1
          const tail = dropped > 0 ? `; ${dropped} following part(s) dropped too` : ''
          if (err instanceof DeliveryDeferred || attempt === 2 || this.stopped) {
            this.warn(`gateway: ${platform} could not deliver: ${err.message}${tail}`)
            return { ok: false, detail: err.message }
          }
          await new Promise(resolve => setTimeout(resolve, this.retryMs))
        }
      }
    }
    return { ok: true }
  }

  // ---- WeChat login -------------------------------------------------------

  weixinLoggedIn() {
    try {
      const state = readState(this.statePaths.weixin, 'WeChat')
      return Boolean(state.token && !state.needs_relogin)
    } catch {
      return false
    }
  }

  async weixinQr() {
    return weixinQr({ baseUrl: this.config.weixin.baseUrl, fetch: this.fetch })
  }

  /** Poll a QR login; on confirmation turn WeChat on and start it. */
  async weixinQrStatus(qrcode) {
    const result = await weixinQrStatus(qrcode, { baseUrl: this.config.weixin.baseUrl, statePath: this.statePaths.weixin, fetch: this.fetch })
    if (result.status === 'confirmed') {
      this.stopOne('weixin')
      this.config = saveConfig(this.configPath, { ...this.config, weixin: { ...this.config.weixin, enabled: true } })
      this.reconcile()
    }
    return result
  }

  weixinLogout() {
    this.stopOne('weixin')
    const state = readState(this.statePaths.weixin, 'WeChat')
    writeState(this.statePaths.weixin, { ...state, token: '', needs_relogin: true, context_tokens: {} })
    this.config = saveConfig(this.configPath, { ...this.config, weixin: { ...this.config.weixin, enabled: false } })
    return this.view()
  }
}
