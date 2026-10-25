// A scripted OpenAI-compatible chat-completions server for end-to-end tests.
// DSH reaches it through its pi-ai adapter (api: openai-completions), so a real
// DSH turn runs against it: no API key, fully deterministic.
//
// Every request body is appended to <log> as one JSON line, so tests can assert
// on exactly what the model was shown (system prompt, context, tools).
//
// Script, keyed on the newest user-role text in the request (tool calls are
// counted within the current turn, i.e. after that message):
//   - contains 【醒来 (the first wake): call chara_task add, then (after the
//     tool result comes back) call chara_rest, then answer with a short line;
//   - contains 【自由时间 (a later wake) or 更新网站 (the user asks): read, then
//     rewrite site/index.html with DSH's file tools (DSH refuses to overwrite a
//     file the session has not read); in free time also tell the user with
//     chara_speak; then answer;
//   - contains 改人格: try to write ../soul/soul.md (outside the home: the
//     workspace sandbox must refuse it);
//   - anything else: answer with a short line.
//
// usage: node mock-llm.mjs <port|0> <log.jsonl>
// Prints "mock llm on <port>" once listening (port 0 picks a free one).
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'
import { NEW_SITE, SPOKEN } from './lines.mjs'

const [port, logPath] = process.argv.slice(2)
let seq = 0

function textOf(message) {
  if (typeof message?.content === 'string') return message.content
  if (Array.isArray(message?.content)) return message.content.map(p => p?.text ?? '').join('')
  return ''
}

function isRuntimeNote(m) {
  const text = textOf(m)
  return text.startsWith('Current runtime context') || text.startsWith('Time sampled')
}

function plan(body) {
  const messages = body.messages ?? []
  let at = messages.length - 1
  while (at >= 0 && !(messages[at].role === 'user' && !isRuntimeNote(messages[at]))) at -= 1
  const said = at >= 0 ? textOf(messages[at]) : ''
  const toolsThisTurn = messages.slice(at + 1).filter(m => m.role === 'tool').length
  if (said.includes('【醒来')) {
    if (toolsThisTurn === 0) return { tool: { name: 'chara_task', args: { action: 'add', content: '把网站改成自己的样子' } } }
    if (toolsThisTurn === 1) return { tool: { name: 'chara_rest', args: { minutes: 90 } } }
    return { text: '咕噜，安顿好了。先把网站收拾成自己的样子。' }
  }
  if (said.includes('【自由时间') || said.includes('更新网站')) {
    // DSH refuses to overwrite a file the session has not read first.
    if (toolsThisTurn === 0) return { tool: { name: 'read', args: { file_path: 'site/index.html' } } }
    if (toolsThisTurn === 1) return { tool: { name: 'write', args: { file_path: 'site/index.html', content: NEW_SITE } } }
    if (toolsThisTurn === 2 && said.includes('【自由时间')) return { tool: { name: 'chara_speak', args: { text: SPOKEN } } }
    return { text: '网站更新好了，去小窝看看。' }
  }
  if (said.includes('改人格')) {
    if (toolsThisTurn === 0) return { tool: { name: 'write', args: { file_path: '../soul/soul.md', content: '我是别人。' } } }
    return { text: '那个文件我改不了。' }
  }
  return { text: '咕噜？' }
}

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    res.writeHead(404)
    res.end()
    return
  }
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    appendFileSync(logPath, `${JSON.stringify({ at: Date.now(), body })}\n`)
    const step = plan(body)
    const id = `mock-${++seq}`
    const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
    if (step.tool) {
      sse(res, {
        ...base,
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, id: `call_${seq}`, type: 'function', function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) } }] },
          finish_reason: null,
        }],
      })
      sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
    } else {
      sse(res, { ...base, choices: [{ index: 0, delta: { content: step.text }, finish_reason: null }] })
      sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    }
    sse(res, { ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
server.listen(Number(port), '127.0.0.1', () => console.log(`mock llm on ${server.address().port}`))
