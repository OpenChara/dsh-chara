// Stand-ins for the messaging platforms, for the end-to-end test: the Telegram
// Bot API calls and the WeChat iLink calls the adapters make, served from
// localhost. A test pushes what a person would send and reads what the chara
// sent back. They prove the plugin's side of each protocol; the real
// platforms still need a live check with real accounts.
import { createServer } from 'node:http'

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) }
    })
  })
}

const send = (res, body) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Hold a long poll until something is queued or `ms` passes. */
function longPoll(queue, ms) {
  if (queue.items.length) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    queue.waiters.push(done)
    function done() {
      clearTimeout(timer)
      resolve()
    }
  })
}

function makeQueue() {
  return {
    items: [],
    waiters: [],
    push(item) {
      this.items.push(item)
      for (const wake of this.waiters.splice(0)) wake()
    },
  }
}

export async function startFakeTelegram({ token }) {
  const queue = makeQueue()
  const sent = []
  let nextUpdate = 1
  const server = await listen(async (req, res) => {
    const body = await readBody(req)
    const match = /^\/bot([^/]+)\/(\w+)$/.exec(req.url)
    if (!match || match[1] !== token) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }))
      return
    }
    const method = match[2]
    if (method === 'getMe') return send(res, { ok: true, result: { id: 1, is_bot: true, username: 'e2e_bot' } })
    if (method === 'deleteWebhook') return send(res, { ok: true, result: true })
    if (method === 'sendMessage') {
      sent.push({ chatId: String(body.chat_id), text: body.text })
      return send(res, { ok: true, result: { message_id: sent.length } })
    }
    if (method === 'getUpdates') {
      const offset = body.offset ?? 0
      queue.items = queue.items.filter(u => u.update_id >= offset)
      await longPoll(queue, 1000)
      return send(res, { ok: true, result: queue.items.filter(u => u.update_id >= offset) })
    }
    send(res, { ok: false, error_code: 404, description: `no method ${method}` })
  })
  return {
    apiBase: `http://127.0.0.1:${server.address().port}`,
    sent,
    /** A private text message from `chatId`, as Telegram would deliver it. */
    message(chatId, text, name = 'E2E') {
      queue.push({ update_id: nextUpdate++, message: { message_id: nextUpdate, chat: { id: chatId, type: 'private' }, from: { id: chatId, is_bot: false, first_name: name }, text } })
    },
    close: () => server.close(),
  }
}

export async function startFakeIlink({ ownerId = 'owner@im.wechat', botId = 'e2e@im.bot' } = {}) {
  const queue = makeQueue()
  const sent = []
  let statusPolls = 0
  let base
  const server = await listen(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const body = await readBody(req)
    const authorized = req.headers.authorization === 'Bearer e2e-wx-token'
    switch (url.pathname) {
      case '/ilink/bot/get_bot_qrcode':
        return send(res, { qrcode: 'e2e-qr', qrcode_img_content: 'https://liteapp.weixin.qq.com/q/e2e?qrcode=e2e-qr&bot_type=3' })
      case '/ilink/bot/get_qrcode_status':
        statusPolls += 1
        if (url.searchParams.get('qrcode') !== 'e2e-qr') return send(res, { status: 'expired' })
        // The phone scans on the first poll and confirms on the second.
        if (statusPolls === 1) return send(res, { status: 'scaned' })
        return send(res, { status: 'confirmed', bot_token: 'e2e-wx-token', ilink_bot_id: botId, ilink_user_id: ownerId, baseurl: base })
      case '/ilink/bot/getupdates': {
        if (!authorized) return send(res, { ret: -1, errcode: -14, errmsg: 'session timeout' })
        await longPoll(queue, 1000)
        const msgs = queue.items.splice(0)
        return send(res, { ret: 0, msgs, get_updates_buf: `buf-${Date.now()}` })
      }
      case '/ilink/bot/sendmessage': {
        if (!authorized) return send(res, { ret: -1, errcode: -14 })
        const msg = body.msg ?? {}
        sent.push({ to: msg.to_user_id, contextToken: msg.context_token, text: msg.item_list?.[0]?.text_item?.text })
        // WeChat echoes the account's own sends back through getupdates.
        if (msg.to_user_id === ownerId) queue.push({ from_user_id: ownerId, item_list: msg.item_list })
        return send(res, { ret: 0 })
      }
      default:
        res.writeHead(404)
        res.end()
    }
  })
  base = `http://127.0.0.1:${server.address().port}`
  let seq = 0
  return {
    baseUrl: base,
    sent,
    /** A text message from `from`, carrying the context token a reply needs. */
    message(text, from = ownerId) {
      seq += 1
      queue.push({ message_id: seq, from_user_id: from, context_token: `ctx-${from}`, item_list: [{ type: 1, text_item: { text } }] })
    },
    close: () => server.close(),
  }
}
