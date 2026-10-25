import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LifeLoop, sharedLife, clamp, localTime, MIN_PATIENCE, MAX_REST } from '../src/lib/life.js'

const persona = {
  patienceSeconds: 3600,
  firstWakeDelaySeconds: 3,
  wakeTitle: 'free time',
  wakePrompt: 'wake at {{time}}',
  firstWakePrompt: 'first wake at {{time}}',
}

/** An in-memory stand-in for DSH's schedule service. */
function fakeScheduler() {
  const records = new Map()
  let seq = 0
  return {
    records,
    calls: [],
    async create(sessionId, request) {
      this.calls.push(['create', sessionId, request])
      const record = { id: `s${++seq}`, sessionId, ...request }
      records.set(record.id, record)
      return record
    },
    async delete(sessionId, id) {
      this.calls.push(['delete', sessionId, id])
      if (!records.delete(id)) throw new Error('schedule_not_found')
    },
    async list(sessionId) {
      return [...records.values()].filter(r => r.sessionId === sessionId)
    },
  }
}

function setup(now = 1_000_000) {
  const clock = { now }
  const scheduler = fakeScheduler()
  const path = join(mkdtempSync(join(tmpdir(), 'chara-life-')), 'life.json')
  const life = new LifeLoop({ path, persona, scheduler, now: () => clock.now })
  return { life, scheduler, clock }
}

test('defaults come from the persona', () => {
  const { life } = setup()
  const s = life.state()
  assert.equal(s.autonomy, true)
  assert.equal(s.patienceSeconds, 3600)
  assert.equal(s.sessionId, null)
})

test('nothing is armed before a session is bound', async () => {
  const { life, scheduler } = setup()
  await life.ensureArmed()
  await life.onTurnEnd()
  assert.equal(scheduler.calls.length, 0)
})

test('the first wake comes quickly, with the first-wake prompt', async () => {
  const { life, scheduler, clock } = setup()
  await life.bindSession('sess-1')
  const s = await life.ensureArmed()
  const [kind, sessionId, request] = scheduler.calls.at(-1)
  assert.equal(kind, 'create')
  assert.equal(sessionId, 'sess-1')
  assert.equal(request.title, 'free time')
  assert.equal(Date.parse(request.at), clock.now + 3000)
  assert.equal(request.prompt, `first wake at ${localTime(clock.now + 3000)}`)
  assert.equal(s.firstWakeArmed, true)
  assert.equal(s.heartbeatId, 's1')
})

test('ensureArmed keeps a pending wake instead of stacking another', async () => {
  const { life, scheduler } = setup()
  await life.bindSession('sess-1')
  await life.ensureArmed()
  await life.ensureArmed()
  assert.equal(scheduler.records.size, 1)
})

test('ensureArmed re-arms with patience when the pending wake is gone', async () => {
  const { life, scheduler, clock } = setup()
  await life.bindSession('sess-1')
  await life.ensureArmed()
  scheduler.records.clear() // delivered, or deleted from the Automation tasks page
  await life.ensureArmed()
  const request = scheduler.calls.at(-1)[2]
  assert.equal(Date.parse(request.at), clock.now + 3600_000)
  assert.equal(request.prompt, `wake at ${localTime(clock.now + 3600_000)}`)
})

test('every turn end replaces the pending wake with now + patience', async () => {
  const { life, scheduler, clock } = setup()
  await life.bindSession('sess-1')
  await life.ensureArmed()
  clock.now += 120_000
  const s = await life.onTurnEnd()
  assert.equal(scheduler.records.size, 1, 'exactly one wake is ever pending')
  assert.equal(s.nextWakeAt, clock.now + 3600_000)
  assert.equal(s.lastTurnEndAt, clock.now)
})

test('chara_rest applies once, then patience resumes', async () => {
  const { life, clock } = setup()
  await life.bindSession('sess-1')
  await life.ensureArmed()
  await life.requestRest(90 * 60)
  let s = await life.onTurnEnd()
  assert.equal(s.nextWakeAt, clock.now + 90 * 60_000)
  assert.equal(s.pendingRestSeconds, null)
  s = await life.onTurnEnd()
  assert.equal(s.nextWakeAt, clock.now + 3600_000)
})

test('rest and patience are clamped', async () => {
  const { life } = setup()
  assert.equal((await life.requestRest(5)).pendingRestSeconds, 60)
  assert.equal((await life.requestRest(10 ** 9)).pendingRestSeconds, MAX_REST)
  assert.equal((await life.setPatience(1)).patienceSeconds, MIN_PATIENCE)
  assert.throws(() => clamp('soon', 1, 2), /not a number/)
})

test('autonomy off removes the pending wake and stops re-arming', async () => {
  const { life, scheduler } = setup()
  await life.bindSession('sess-1')
  await life.ensureArmed()
  let s = await life.setAutonomy(false)
  assert.equal(scheduler.records.size, 0)
  assert.equal(s.heartbeatId, null)
  s = await life.onTurnEnd()
  assert.equal(scheduler.records.size, 0)
  s = await life.setAutonomy(true)
  assert.equal(scheduler.records.size, 1)
})

test('wakeNow delivers a wake in a moment, even with free time off', async () => {
  const { life, scheduler, clock } = setup()
  await assert.rejects(life.wakeNow(), /not set up/)
  await life.bindSession('sess-1')
  await life.setAutonomy(false)
  const s = await life.wakeNow()
  assert.equal(scheduler.records.size, 1)
  assert.equal(s.nextWakeAt, clock.now + 2000)
  assert.equal(scheduler.calls.at(-1)[2].prompt, `wake at ${localTime(clock.now + 2000)}`)
})

test('changing patience re-anchors a pending wake', async () => {
  const { life, clock } = setup()
  await life.bindSession('sess-1')
  await life.ensureArmed()
  const s = await life.setPatience(600)
  assert.equal(s.nextWakeAt, clock.now + 600_000)
})

test('binding a new session drops the old wake and starts the rhythm over', async () => {
  const { life, scheduler } = setup()
  await life.bindSession('old')
  await life.ensureArmed()
  const s = await life.bindSession('new')
  assert.equal(s.sessionId, 'new')
  assert.equal(s.firstWakeArmed, false)
  assert.equal([...scheduler.records.values()].filter(r => r.sessionId === 'old').length, 0)
  await life.ensureArmed()
  assert.equal(scheduler.calls.at(-1)[2].prompt.startsWith('first wake'), true)
})

test('a failed delete (already delivered) does not block re-arming', async () => {
  const { life, scheduler } = setup()
  await life.bindSession('sess-1')
  await life.ensureArmed()
  scheduler.records.clear()
  await life.onTurnEnd()
  assert.equal(scheduler.records.size, 1)
})

test('mutations are serialized', async () => {
  const { life, scheduler } = setup()
  await life.bindSession('sess-1')
  await Promise.all([life.ensureArmed(), life.onTurnEnd(), life.onTurnEnd(), life.setPatience(900)])
  assert.equal(scheduler.records.size, 1, 'concurrent re-arms still leave one pending wake')
})

test('sharedLife hands every caller the same loop for a path', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'chara-life-')), 'life.json')
  const a = sharedLife(path, { persona })
  const scheduler = fakeScheduler()
  const b = sharedLife(path, { scheduler })
  assert.equal(a, b)
  assert.equal(a.scheduler, scheduler)
  assert.equal(a.persona, persona, 'an undefined field does not overwrite')
})
