import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskStore, MAX_ACTIVE, MAX_CONTENT, MAX_DONE } from '../src/lib/tasks.js'

const store = () => new TaskStore(join(mkdtempSync(join(tmpdir(), 'chara-tasks-')), 'tasks.json'))

test('add, update, complete, remove', () => {
  const tasks = store()
  const a = tasks.add('  build the site  ')
  assert.equal(a.id, 't1')
  assert.equal(a.content, 'build the site')
  tasks.update('t1', 'build the site, with a gallery')
  assert.equal(tasks.active()[0].content, 'build the site, with a gallery')
  tasks.add('write a diary entry')
  tasks.remove('t2')
  assert.deepEqual(tasks.active().map(t => t.id), ['t1'])
  tasks.complete('t1', 'done with three pages')
  assert.equal(tasks.active().length, 0)
  assert.equal(tasks.done()[0].note, 'done with three pages')
})

test('a completed task is sealed', () => {
  const tasks = store()
  tasks.add('x')
  tasks.complete('t1')
  assert.throws(() => tasks.update('t1', 'y'), /sealed/)
  assert.throws(() => tasks.complete('t1'), /already done/)
  assert.throws(() => tasks.remove('t1'), /sealed/)
})

test('ids are never reused after removal', () => {
  const tasks = store()
  tasks.add('a')
  tasks.remove('t1')
  assert.equal(tasks.add('b').id, 't2')
})

test('limits: empty text, length cap, active cap', () => {
  const tasks = store()
  assert.throws(() => tasks.add('   '), /needs a description/)
  assert.equal(tasks.add('x'.repeat(MAX_CONTENT + 50)).content.length, MAX_CONTENT)
  for (let i = 1; i < MAX_ACTIVE; i++) tasks.add(`task ${i}`)
  assert.throws(() => tasks.add('one too many'), /already have/)
})

test('sealed records are trimmed to the newest MAX_DONE', () => {
  const tasks = store()
  let clock = 0
  tasks.now = () => ++clock
  for (let i = 0; i < MAX_DONE + 5; i++) {
    const t = tasks.add(`t${i}`)
    tasks.complete(t.id)
  }
  const done = tasks.done()
  assert.equal(done.length, MAX_DONE)
  assert.ok(!done.some(t => t.content === 't0'), 'the oldest sealed task is dropped first')
})

test('unknown ids are reported', () => {
  assert.throws(() => store().complete('t9'), /no task with id "t9"/)
})

test('renderBlock: active tasks, an invitation, or nothing', () => {
  const tasks = store()
  assert.equal(tasks.renderBlock(), '')
  assert.match(tasks.renderBlock({ hasAspiration: true }), /You have no task right now/)
  tasks.add('tend the garden')
  const block = tasks.renderBlock({ hasAspiration: true })
  assert.match(block, /\[t1\] tend the garden/)
  assert.match(block, /chara_task/)
})
