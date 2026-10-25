import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageDeduplicator, RefusalThrottle, accessPosture, senderAllowed } from '../src/gateway/access.js'
import { DeliveryDeferred, writeState } from '../src/gateway/adapters/base.js'
import { QQAdapter, parseOnebotEvent } from '../src/gateway/adapters/qq.js'
import { TelegramAdapter, parseUpdate } from '../src/gateway/adapters/telegram.js'
import { WeixinAdapter, itemListToText, weixinQrStatus } from '../src/gateway/adapters/weixin.js'
import { loadConfig, maskConfig, mergeEdit, normalizeConfig } from '../src/gateway/config.js'
import { GatewayHost } from '../src/gateway/host.js'
import { qrSvg } from '../src/gateway/qr.js'
import { isSilenceNarration, splitText } from '../src/gateway/text.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'chara-gw-'))
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// ---- text -----------------------------------------------------------------

test('splitText keeps short text whole and prefers sentence breaks', () => {
  assert.deepEqual(splitText('你好。', 10), ['你好。'])
  const parts = splitText('第一句话。第二句话。第三句话。', 6)
  assert.deepEqual(parts, ['第一句话。', '第二句话。', '第三句话。'])
  assert.equal(parts.join(''), '第一句话。第二句话。第三句话。')
})

test('splitText never cuts a surrogate pair', () => {
  const text = '🐋'.repeat(5) // 10 UTF-16 units
  for (const part of splitText(text, 3)) {
    assert.ok(part.length <= 3)
    assert.doesNotMatch(part, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
  }
  assert.equal(splitText(text, 3).join(''), text)
})

test('splitText cuts before a code fence rather than through it', () => {
  const text = `intro line here\n\`\`\`\ncode one\ncode two\n\`\`\`\n`
  const parts = splitText(text, 20)
  assert.equal(parts[0], 'intro line here\n')
  assert.equal(parts.join(''), text)
})

test('silence tokens are dropped, prose that mentions silence is not', () => {
  for (const t of ['', '  ', '*(silent)*', '(no reply)', '.', '…', '🔇']) assert.equal(isSilenceNarration(t), true, t)
  for (const t of ['The deploy ran silently.', '咕噜？', 'silence is golden, here is the plan']) assert.equal(isSilenceNarration(t), false, t)
})

// ---- access ---------------------------------------------------------------

test('owner-only by default, "*" opens, a list restricts', () => {
  assert.equal(senderAllowed('me', new Set(), 'me'), true)
  assert.equal(senderAllowed('stranger', new Set(), 'me'), false)
  assert.equal(senderAllowed('friend', new Set(['friend']), 'me'), true)
  assert.equal(senderAllowed('anyone', new Set(['*']), 'me'), true)
  assert.equal(accessPosture(new Set(), 'me'), 'owner-only')
  assert.equal(accessPosture(new Set(), ''), 'closed')
  assert.equal(accessPosture(new Set(['*']), 'me'), 'open')
})

test('one refusal per sender per day; dedup within the TTL', () => {
  let day = 'd1'
  const throttle = new RefusalThrottle(() => day)
  assert.equal(throttle.allow('x'), true)
  assert.equal(throttle.allow('x'), false)
  day = 'd2'
  assert.equal(throttle.allow('x'), true)
  let now = 0
  const dedup = new MessageDeduplicator({ ttlMs: 100, now: () => now })
  assert.equal(dedup.isDuplicate('a'), false)
  assert.equal(dedup.isDuplicate('a'), true)
  now = 150
  assert.equal(dedup.isDuplicate('a'), false)
  assert.equal(dedup.isDuplicate(''), false)
})

// ---- config ---------------------------------------------------------------

test('config is normalized, secrets are masked and survive a masked edit', () => {
  const saved = normalizeConfig({ allowedSenders: 'a, b，c', telegram: { enabled: 1, botToken: '123:secret-token' } })
  assert.deepEqual(saved.allowedSenders, ['a', 'b', 'c'])
  assert.equal(saved.telegram.enabled, true)
  assert.equal(saved.qq.url, '')
  const masked = maskConfig(saved)
  assert.equal(masked.telegram.botToken, '••••oken')
  const edited = mergeEdit(saved, { telegram: { ...masked.telegram, ownerId: '42' } })
  assert.equal(edited.telegram.botToken, '123:secret-token', 'the masked value kept the real token')
  assert.equal(edited.telegram.ownerId, '42')
  assert.equal(mergeEdit(saved, { telegram: { botToken: 'new' } }).telegram.botToken, 'new')
  assert.deepEqual(loadConfig(join(tmp(), 'gateway.json')).allowedSenders, [])
})

test('QR codes are rendered locally as SVG', () => {
  const svg = qrSvg('https://example.com/q/中文')
  assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/)
})

// ---- telegram -------------------------------------------------------------

test('telegram parses private text messages only', () => {
  const base = { update_id: 7, message: { chat: { id: 42, type: 'private' }, from: { first_name: 'Ann' }, text: ' hi ' } }
  assert.deepEqual(parseUpdate(base), { senderId: '42', senderName: 'Ann', text: 'hi', messageId: '7' })
  assert.equal(parseUpdate({ ...base, message: { ...base.message, chat: { id: 1, type: 'group' } } }), null)
  assert.equal(parseUpdate({ ...base, message: { ...base.message, from: { is_bot: true } } }), null)
  assert.equal(parseUpdate({ update_id: 1, edited_message: {} }), null)
})

test('telegram polls, persists its offset, and replies to the last chat', async () => {
  const dir = tmp()
  const calls = []
  const fetch = async (url, init) => {
    const method = url.split('/').pop()
    calls.push([method, JSON.parse(init.body)])
    if (method === 'getUpdates') return json({ ok: true, result: [{ update_id: 10, message: { chat: { id: 5, type: 'private' }, text: 'yo' } }] })
    return json({ ok: true, result: {} })
  }
  const statePath = join(dir, 'telegram_state.json')
  const adapter = new TelegramAdapter({ botToken: 't' }, { statePath, fetch })
  await assert.rejects(adapter.send('hello'), DeliveryDeferred, 'a bot cannot speak first')
  const pushed = []
  assert.equal(await adapter.pollOnce(m => pushed.push(m)), 1)
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).offset, 11)
  assert.equal((statSync(statePath).mode & 0o777).toString(8), '600')
  adapter.rememberPeer(pushed[0])
  await adapter.send('hello')
  assert.deepEqual(calls.at(-1), ['sendMessage', { chat_id: 5, text: 'hello' }])
  const again = new TelegramAdapter({ botToken: 't' }, { statePath, fetch })
  assert.equal(again.offset, 11)
  assert.equal(again.lastChatId, '5')
})

test('telegram flood control defers instead of queueing', async () => {
  const fetch = async () => json({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 30 } }, 429)
  const adapter = new TelegramAdapter({ botToken: 't' }, { statePath: join(tmp(), 's.json'), fetch })
  await assert.rejects(adapter.send('x', '5'), /flood control/)
  await assert.rejects(adapter.send('y', '5'), /flood control for another/)
})

// ---- weixin ---------------------------------------------------------------

test('weixin folds media into markers instead of dropping it', () => {
  assert.equal(itemListToText([{ type: 1, text_item: { text: '你好' } }, { type: 2, image_item: {} }, { type: 3, voice_item: { text: '语音转文字' } }]), '你好\n[图片]\n语音转文字')
  assert.equal(itemListToText([{ type: 99 }]), '[媒体]')
})

test('weixin: QR confirmation saves the login; replies need the context token; echoes are dropped', async () => {
  const dir = tmp()
  const statePath = join(dir, 'weixin_state.json')
  const sent = []
  const fetch = async (url, init) => {
    if (url.includes('get_qrcode_status')) return json({ status: 'confirmed', bot_token: 'tok', ilink_bot_id: 'bot@im.bot', ilink_user_id: 'me@im.wechat' })
    if (url.includes('sendmessage')) {
      sent.push(JSON.parse(init.body).msg)
      return json({ ret: 0 })
    }
    return json({ ret: 0 })
  }
  assert.deepEqual(await weixinQrStatus('q', { statePath, fetch }), { status: 'confirmed', accountId: 'bot@im.bot' })
  const adapter = new WeixinAdapter({}, { statePath, fetch })
  assert.equal(adapter.needsLogin(), false)
  assert.equal(adapter.ownerId(), 'me@im.wechat')
  await assert.rejects(adapter.send('hi'), DeliveryDeferred)
  const pushed = []
  adapter.handleInbound({ from_user_id: 'me@im.wechat', context_token: 'ctx1', item_list: [{ type: 1, text_item: { text: '在吗' } }] }, m => pushed.push(m))
  assert.equal(pushed.length, 1)
  adapter.rememberPeer(pushed[0])
  await adapter.send('在的')
  assert.equal(sent[0].to_user_id, 'me@im.wechat')
  assert.equal(sent[0].context_token, 'ctx1')
  // The chara's own reply echoes back from the same account: dropped once.
  adapter.handleInbound({ from_user_id: 'me@im.wechat', item_list: [{ type: 1, text_item: { text: '在的' } }] }, m => pushed.push(m))
  assert.equal(pushed.length, 1)
  adapter.handleInbound({ from_user_id: 'bot@im.bot', item_list: [{ type: 1, text_item: { text: 'self' } }] }, m => pushed.push(m))
  assert.equal(pushed.length, 1, 'the bot id is pure self')
})

test('weixin session timeout asks for a new QR scan', async () => {
  const statePath = join(tmp(), 'weixin_state.json')
  writeState(statePath, { token: 'tok', ilink_user_id: 'me' })
  const adapter = new WeixinAdapter({}, { statePath, fetch: async () => json({ ret: -1, errcode: -14 }) })
  await assert.rejects(adapter.pollOnce(() => {}), /scan the QR code again/)
  assert.equal(adapter.needsLogin(), true)
})

// ---- qq -------------------------------------------------------------------

test('qq parses private OneBot messages and checks every send', async () => {
  assert.deepEqual(parseOnebotEvent(JSON.stringify({ post_type: 'message', message_type: 'private', user_id: 10001, message_id: 3, sender: { nickname: 'N' }, message: [{ type: 'text', data: { text: 'hi' } }, { type: 'image', data: {} }] })), { senderId: '10001', senderName: 'N', text: 'hi', messageId: '3' })
  assert.equal(parseOnebotEvent(JSON.stringify({ post_type: 'message', message_type: 'group', user_id: 1, message: 'x' })), null)
  const adapter = new QQAdapter({ url: 'ws://x', peerId: '10001' })
  await assert.rejects(adapter.send('hi'), /disconnected/)
  const frames = []
  adapter.socket = { send: (raw) => {
    const frame = JSON.parse(raw)
    frames.push(frame)
    queueMicrotask(() => adapter.resolveAck(JSON.stringify({ echo: frame.echo, retcode: frames.length === 1 ? 0 : 100, wording: 'not a friend' })))
  } }
  await adapter.send('hello')
  assert.deepEqual(frames[0].params, { user_id: 10001, message: 'hello' })
  await assert.rejects(adapter.send('again'), /retcode=100 not a friend/)
})

// ---- the relay ------------------------------------------------------------

function fakeAdapter(name, { owner = 'owner', max = 0 } = {}) {
  return {
    name,
    maxMessageLength: max,
    sent: [],
    peer: '',
    ownerId: () => owner,
    needsLogin: () => false,
    rememberPeer(m) { this.peer = m.senderId },
    async send(text, peer) {
      const to = peer || this.peer
      if (!to) throw new DeliveryDeferred('nobody yet')
      this.sent.push([to, text])
    },
    run: () => new Promise(() => {}),
    close() {},
  }
}

function relay({ texts } = {}) {
  const dir = tmp()
  writeState(join(dir, 'gateway.json'), { telegram: { enabled: true, botToken: 't' }, qq: { enabled: true, url: 'ws://x' } })
  const adapters = { telegram: fakeAdapter('telegram', { max: 8 }), qq: fakeAdapter('qq') }
  const prompts = []
  const host = new GatewayHost({
    stateDir: dir,
    persona: { name: 'Fish', gateway: texts ?? { ack: 'got it' } },
    sessionId: () => 'sess-1',
    prompt: async (request) => { prompts.push(request) },
    factories: { weixin: () => fakeAdapter('weixin'), telegram: () => adapters.telegram, qq: () => adapters.qq },
    retryMs: 0,
  })
  host.reconcile()
  return { host, adapters, prompts }
}

test('a message from the owner is queued into the session and the turn answers it', async () => {
  const { host, adapters, prompts } = relay()
  await host.enqueue('telegram', adapters.telegram, { senderId: 'owner', senderName: 'Me', text: '你好', messageId: '1' })
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].sessionId, 'sess-1')
  assert.equal(prompts[0].mode, 'queue')
  assert.deepEqual(prompts[0].content, [{ type: 'text', text: '[Telegram] 你好' }])
  assert.deepEqual(adapters.telegram.sent, [['owner', 'got it']])
  host.onSessionEvent({ type: 'turn/start', data: {} })
  host.onSessionEvent({ type: 'user/message', data: { source: { kind: 'user', rpcId: prompts[0].requestId } } })
  host.onSessionEvent({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '咕噜，' }, { type: 'tool-call' }] } } })
  host.onSessionEvent({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '在呢。' }] } } })
  host.onSessionEvent({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  await new Promise(resolve => setImmediate(resolve))
  // "咕噜，\n\n在呢。" is 8 units: exactly the fake cap, so one message.
  assert.deepEqual(adapters.telegram.sent.slice(1), [['owner', '咕噜，\n\n在呢。']])
  assert.deepEqual(adapters.qq.sent, [], 'the reply goes only where the message came from')
})

test('a stranger gets one refusal and no turn; a redelivery runs nothing', async () => {
  const { host, adapters, prompts } = relay()
  await host.enqueue('qq', adapters.qq, { senderId: 'stranger', text: 'hi', messageId: '9' })
  await host.enqueue('qq', adapters.qq, { senderId: 'stranger', text: 'hi again', messageId: '10' })
  assert.equal(prompts.length, 0)
  assert.equal(adapters.qq.sent.length, 1)
  assert.equal(adapters.qq.sent[0][0], 'stranger')
  await host.enqueue('qq', adapters.qq, { senderId: 'owner', text: 'one', messageId: '11' })
  await host.enqueue('qq', adapters.qq, { senderId: 'owner', text: 'one', messageId: '11' })
  assert.equal(prompts.length, 1)
  assert.equal(adapters.qq.peer, 'owner', 'only an allowed sender becomes the speak destination')
})

test('free time and DSH-driven turns are not echoed out; chara_speak is', async () => {
  const { host, adapters } = relay()
  host.onSessionEvent({ type: 'turn/start', data: {} })
  host.onSessionEvent({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'my own thoughts' }] } } })
  assert.deepEqual(await host.speak('look at this'), [
    { platform: 'telegram', label: 'Telegram', ok: false, detail: 'nobody yet' },
    { platform: 'qq', label: 'QQ', ok: false, detail: 'nobody yet' },
  ])
  adapters.qq.peer = 'owner'
  const results = await host.speak('看看这个')
  assert.deepEqual(results.find(r => r.platform === 'qq'), { platform: 'qq', label: 'QQ', ok: true })
  host.onSessionEvent({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.deepEqual(adapters.qq.sent, [['owner', '看看这个']])
  assert.deepEqual(adapters.telegram.sent, [])
})

test('chara_speak during a reply joins that reply instead of arriving twice', async () => {
  const { host, adapters, prompts } = relay()
  adapters.qq.peer = 'owner'
  await host.enqueue('telegram', adapters.telegram, { senderId: 'owner', text: 'hey', messageId: '1' })
  host.onSessionEvent({ type: 'turn/start', data: {} })
  host.onSessionEvent({ type: 'user/message', data: { source: { rpcId: prompts[0].requestId } } })
  const results = await host.speak('news')
  assert.equal(results.find(r => r.platform === 'telegram').ok, true)
  host.onSessionEvent({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(adapters.telegram.sent.slice(1), [['owner', 'news']])
  assert.deepEqual(adapters.qq.sent, [['owner', 'news']], 'the other app still gets it')
})

test('approvals and unfinished turns are reported back to the chat', async () => {
  const { host, adapters, prompts } = relay({ texts: { ack: 'ok', approval: 'need {tool}', unfinished: 'stopped: {reason}' } })
  await host.enqueue('qq', adapters.qq, { senderId: 'owner', text: 'do it', messageId: '1' })
  host.onSessionEvent({ type: 'turn/start', data: {} })
  host.onSessionEvent({ type: 'user/message', data: { source: { rpcId: prompts[0].requestId } } })
  host.onSessionEvent({ type: 'approval/asked', data: { toolName: 'bash' } })
  host.onSessionEvent({ type: 'turn/end', data: { reason: { kind: 'cancelled' } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(adapters.qq.sent.map(([, t]) => t), ['ok', 'need bash', 'stopped: cancelled'])
})

test('long replies are split to the platform cap; a refused part stops the rest', async () => {
  const { host, adapters } = relay()
  adapters.telegram.peer = 'owner'
  assert.deepEqual(await host.deliver('telegram', '一二三。四五六。七八九。'), { ok: true })
  assert.deepEqual(adapters.telegram.sent.map(([, t]) => t), ['一二三。四五六。', '七八九。'])
  let calls = 0
  adapters.qq.send = async () => { calls += 1; throw new DeliveryDeferred('refused') }
  assert.deepEqual(await host.deliver('qq', 'x', 'owner'), { ok: false, detail: 'refused' })
  assert.equal(calls, 1, 'a deferral is not retried')
})

test('a prompt that fails is reported to the sender, not swallowed', async () => {
  const { host, adapters } = relay({ texts: { ack: 'ok', failed: 'lost: {error}' } })
  host.prompt = async () => { throw new Error('session archived') }
  await host.enqueue('qq', adapters.qq, { senderId: 'owner', text: 'hi', messageId: '1' })
  assert.deepEqual(adapters.qq.sent.map(([, t]) => t), ['ok', 'lost: session archived'])
  assert.equal(host.pending.size, 0)
})

test('turning an app off stops it; the status says what runs', () => {
  const { host } = relay()
  assert.deepEqual(host.status().platforms.map(p => [p.platform, p.state]), [['weixin', 'off'], ['telegram', 'running'], ['qq', 'running']])
  host.update({ qq: { enabled: false } })
  assert.deepEqual(host.status().platforms.map(p => [p.platform, p.state]), [['weixin', 'off'], ['telegram', 'running'], ['qq', 'off']])
  assert.equal(host.view().config.telegram.botToken, '••••t')
})
