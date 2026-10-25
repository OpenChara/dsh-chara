import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lifeSection, nowContext, MEMORY_CAP } from '../src/lib/prompts.js'
import { loadPersona } from '../src/lib/persona.js'

const persona = loadPersona('dafeiyu')
const life = { autonomy: true, nextWakeAt: 1_800_000_000_000 }

test('the life section is stable and names the home layout and tools', () => {
  const a = lifeSection(persona)
  assert.equal(a, lifeSection(persona), 'byte-stable for the cached system prompt')
  for (const needle of ['site/index.html', 'diary/', 'MEMORY.md', '`chara_task`', '`chara_rest`', persona.wakeTitle, persona.homeTabLabel]) {
    assert.ok(a.includes(needle), needle)
  }
  assert.ok(!/hermes|\{\{/i.test(a), 'no foreign brand, no prompt-variable syntax')
  assert.ok(!/aspiration/i.test(a), 'no aspiration in the DSH chara')
})

test('the context carries tasks, memory and the rhythm', () => {
  const text = nowContext({ tasksBlock: 'Your tasks: ...', memory: '# MEMORY\n\nlikes jazz', life })
  assert.match(text, /Your tasks/)
  assert.match(text, /Your memory \(MEMORY\.md\):\nlikes jazz/)
  assert.match(text, /free time is on/)
})

test('the context does not change from turn to turn on its own', () => {
  // DSH appends a new runtime-context snapshot whenever this text changes, so a
  // per-turn value (such as the next wake time) must not appear in it.
  const a = nowContext({ tasksBlock: 'x', memory: '', life })
  const b = nowContext({ tasksBlock: 'x', memory: '', life: { ...life, nextWakeAt: life.nextWakeAt + 60_000 } })
  assert.equal(a, b)
})

test('empty parts are left out; autonomy off is stated', () => {
  const text = nowContext({ tasksBlock: '', memory: '# MEMORY\n\n', life: { autonomy: false } })
  assert.ok(!text.includes('memory'))
  assert.match(text, /switched off/)
})

test('a long MEMORY.md is capped with a note', () => {
  const text = nowContext({ tasksBlock: '', memory: 'm'.repeat(MEMORY_CAP + 100), life })
  assert.ok(text.includes('m'.repeat(MEMORY_CAP)))
  assert.ok(!text.includes('m'.repeat(MEMORY_CAP + 1)))
  assert.match(text, /Trim it/)
})

test('the persona is complete and its wake prompts take the time', () => {
  assert.equal(persona.id, 'dafeiyu')
  assert.ok(persona.wakePrompt.includes('{{time}}'))
  assert.ok(persona.firstWakePrompt.includes('{{time}}'))
  assert.ok(persona.wakeTitle.length <= 120)
})
