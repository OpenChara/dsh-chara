// The chara's tasks: its own lasting threads, advanced toward the aspiration.
// Ported from OpenCharaAgent (src/chara/tools/task.py) with the same rules:
// a few short active tasks the chara edits freely; completing a task seals it
// into an immutable record that never re-enters the prompt.
import { readJson, writeJson } from './fsutil.js'

export const MAX_CONTENT = 280 // rendered every turn: keep each task short
export const MAX_ACTIVE = 12 // a few real threads, never a scatter of trivia
export const MAX_DONE = 50 // sealed records kept for the UI; oldest trimmed beyond this

export class TaskStore {
  constructor(path, now = () => Date.now()) {
    this.path = path
    this.now = now
  }

  read() {
    const data = readJson(this.path, null)
    if (data && Array.isArray(data.tasks) && Number.isInteger(data.seq)) return data
    return { seq: 0, tasks: [] }
  }

  active() { return this.read().tasks.filter(t => t.status !== 'done') }
  done() { return this.read().tasks.filter(t => t.status === 'done') }

  add(content) {
    const text = clean(content)
    const data = this.read()
    if (data.tasks.filter(t => t.status !== 'done').length >= MAX_ACTIVE) {
      throw new Error(`you already have ${MAX_ACTIVE} active tasks; finish or drop one before adding another`)
    }
    data.seq += 1
    const item = { id: `t${data.seq}`, content: text, status: 'active', createdAt: this.now() }
    data.tasks.push(item)
    writeJson(this.path, data)
    return item
  }

  update(id, content) {
    const text = clean(content)
    const data = this.read()
    const item = find(data, id)
    if (item.status === 'done') throw new Error(`${id} is sealed (already done) and cannot be edited`)
    item.content = text
    item.updatedAt = this.now()
    writeJson(this.path, data)
    return item
  }

  complete(id, note = '') {
    const data = this.read()
    const item = find(data, id)
    if (item.status === 'done') throw new Error(`${id} is already done`)
    item.status = 'done'
    item.doneAt = this.now()
    if (note) item.note = String(note).slice(0, MAX_CONTENT)
    trimDone(data)
    writeJson(this.path, data)
    return item
  }

  remove(id) {
    const data = this.read()
    const item = find(data, id)
    if (item.status === 'done') throw new Error(`${id} is sealed (done); a finished task is a record and cannot be removed`)
    data.tasks = data.tasks.filter(t => t !== item)
    writeJson(this.path, data)
    return item
  }

  /**
   * The per-turn block: active tasks only. With none active, a gentle
   * invitation when there is an aspiration to work toward, else nothing.
   */
  renderBlock({ hasAspiration = false } = {}) {
    const active = this.active()
    if (active.length > 0) {
      return 'Your tasks: the threads you are advancing toward your aspiration (manage them with the `chara_task` tool):\n'
        + active.map(t => `  [${t.id}] ${t.content}`).join('\n')
    }
    if (hasAspiration) {
      return 'You have no task right now. If something you could move toward your aspiration comes to mind, '
        + 'set it with the `chara_task` tool to keep a thread going, or have none if this stretch of life is '
        + 'better lived at the pace of the moment.'
    }
    return ''
  }
}

function clean(content) {
  const text = String(content ?? '').trim()
  if (!text) throw new Error('a task needs a description')
  return text.slice(0, MAX_CONTENT)
}

function find(data, id) {
  const item = data.tasks.find(t => t.id === id)
  if (!item) throw new Error(`no task with id ${JSON.stringify(id)}`)
  return item
}

function trimDone(data) {
  const done = data.tasks.filter(t => t.status === 'done')
  if (done.length <= MAX_DONE) return
  const drop = new Set(done.sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0)).slice(0, done.length - MAX_DONE))
  data.tasks = data.tasks.filter(t => !drop.has(t))
}
