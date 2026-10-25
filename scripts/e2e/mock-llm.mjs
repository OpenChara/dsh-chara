// A scripted OpenAI-compatible chat-completions server for end-to-end tests.
// DSH reaches it through its pi-ai adapter (api: openai-completions), so a real
// DSH turn runs against it: no API key, fully deterministic.
//
// Every request body is appended to <log> as one JSON line, so tests can assert
// on exactly what the model was shown (system prompt, context, tools).
//
// Script, keyed on the newest user-role text in the request:
//   - contains 【醒来 (the first wake): call chara_task add, then (after the
//     tool result comes back) call chara_rest, then answer with a short line;
//   - anything else: answer with a short line.
//
// usage: node mock-llm.mjs <port> <log.jsonl>
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

const [port, logPath] = process.argv.slice(2)
let seq = 0

function textOf(message) {
  if (typeof message?.content === 'string') return message.content
  if (Array.isArray(message?.content)) return message.content.map(p => p?.text ?? '').join('')
  return ''
}

function plan(body) {
  const messages = body.messages ?? []
  const lastUser = [...messages].reverse().find(m => m.role === 'user' && !textOf(m).startsWith('Current runtime context') && !textOf(m).startsWith('Time sampled'))
  const toolResults = messages.filter(m => m.role === 'tool').length
  if (textOf(lastUser).includes('【醒来')) {
    if (toolResults === 0) {
      return { tool: { name: 'chara_task', args: { action: 'add', content: '把网站改成自己的样子' } } }
    }
    if (toolResults === 1) return { tool: { name: 'chara_rest', args: { minutes: 90 } } }
    return { text: '咕噜，安顿好了。先把网站收拾成自己的样子。' }
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
server.listen(Number(port), '127.0.0.1', () => console.log(`mock llm on ${port}`))
