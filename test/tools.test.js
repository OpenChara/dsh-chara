import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { restTool, taskTool } from '../src/agent.js'
import { LifeLoop } from '../src/lib/life.js'
import { TaskStore } from '../src/lib/tasks.js'

const dir = () => mkdtempSync(join(tmpdir(), 'chara-tools-'))

test('chara_task drives the task store and renders JSON', async () => {
  const tool = taskTool(new TaskStore(join(dir(), 'tasks.json')))
  assert.equal(tool.name, 'chara_task')
  assert.equal(tool.parameters.required[0], 'action')
  const added = await tool.execute({ action: 'add', content: 'paint the hallway' })
  assert.equal(added.added.id, 't1')
  await tool.execute({ action: 'update', id: 't1', content: 'paint the hallway blue' })
  const listed = await tool.execute({ action: 'list' })
  assert.equal(listed.active[0].content, 'paint the hallway blue')
  const done = await tool.execute({ action: 'complete', id: 't1', note: 'two coats' })
  assert.equal(done.completed.status, 'done')
  assert.deepEqual(tool.output.render({}, done), [{ type: 'text', text: JSON.stringify(done) }])
})

test('chara_task failures throw, so DSH records a failed call', async () => {
  const tool = taskTool(new TaskStore(join(dir(), 'tasks.json')))
  await assert.rejects(tool.execute({ action: 'complete' }), /needs the task id/)
  await assert.rejects(tool.execute({ action: 'fly' }), /unknown action/)
  await assert.rejects(tool.execute({ action: 'add', content: '' }), /needs a description/)
})

test('chara_rest records the choice and reports the wake time', async () => {
  const life = new LifeLoop({ path: join(dir(), 'life.json'), persona: { patienceSeconds: 3600 } })
  const tool = restTool(life, () => 0)
  const result = await tool.execute({ minutes: 45 })
  assert.equal(result.ok, true)
  assert.ok(result.wakeAround)
  assert.equal(life.state().pendingRestSeconds, 45 * 60)
  await assert.rejects(tool.execute({ minutes: 'later' }), /must be a number/)
})

test('chara_rest says so when free time is off', async () => {
  const life = new LifeLoop({ path: join(dir(), 'life.json'), persona: {} })
  life.save({ autonomy: false })
  const result = await restTool(life).execute({ minutes: 30 })
  assert.match(result.note, /switched off/)
})
