// The life loop: when autonomy is on, the chara wakes on its own.
//
// It rides DSH's own schedule service instead of a private timer. Each wake is
// one one-shot reminder bound to the chara's session; DSH delivers it into the
// session when due (resuming the session even when no one has it open), so the
// wake is an ordinary, logged turn that every other plugin can see.
//
// The rhythm (ported from OpenCharaAgent's patience / rest / quiet):
//   * every turn that ends, user-driven or a wake, re-arms the next wake at
//     now + patience, so while you are talking the chara never wakes itself;
//   * the chara may pick its own next wake with the `chara_rest` tool, which
//     replaces patience once, for the turn that is ending;
//   * autonomy off deletes the pending wake. The chara still answers you.
import { readJson, writeJson } from './fsutil.js'

export const MIN_PATIENCE = 60
export const MAX_PATIENCE = 7 * 24 * 3600
export const MIN_REST = 60
export const MAX_REST = 24 * 3600

const DEFAULTS = Object.freeze({
  sessionId: null,
  autonomy: true,
  patienceSeconds: 3600,
  heartbeatId: null,
  nextWakeAt: null,
  pendingRestSeconds: null,
  firstWakeArmed: false,
  wakes: 0,
  lastTurnEndAt: null,
})

export function clamp(value, min, max) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) throw new Error(`not a number: ${JSON.stringify(value)}`)
  return Math.min(max, Math.max(min, n))
}

/** Local wall-clock time, e.g. "2026-10-25 23:10", for the wake text. */
export function localTime(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const shared = new Map()

/**
 * The one LifeLoop for a life.json path in this process. The host plugin (which
 * owns the scheduler) and the agent-scope plugin (whose `chara_rest` tool records
 * a choice) must share it, so all mutations run through one serial queue.
 */
export function sharedLife(path, init) {
  let life = shared.get(path)
  if (!life) {
    life = new LifeLoop({ path, ...init })
    shared.set(path, life)
  } else if (init) {
    Object.assign(life, Object.fromEntries(Object.entries(init).filter(([, v]) => v !== undefined)))
  }
  return life
}

/** The scheduler used before the host plugin has attached the real one. */
export const NO_SCHEDULER = Object.freeze({
  async create() { throw new Error('the schedule service is not ready yet') },
  async delete() {},
  async list() { return [] },
})

export class LifeLoop {
  /**
   * @param {object} opts
   * @param {string} opts.path - life.json
   * @param {object} opts.persona - persona.json (wake texts, default patience)
   * @param {{create: Function, delete: Function, list: Function}} opts.scheduler -
   *   thin adapter over ctx.schedule, bound to nothing; every call names the session.
   * @param {() => number} [opts.now]
   * @param {(msg: string) => void} [opts.log]
   */
  constructor({ path, persona = {}, scheduler = NO_SCHEDULER, now = () => Date.now(), log = () => {} }) {
    this.path = path
    this.persona = persona
    this.scheduler = scheduler
    this.now = now
    this.log = log
    // Serialize every mutation: turn ends, tool calls and settings edits can
    // arrive together, and the arm step is a delete-then-create pair.
    this.queue = Promise.resolve()
  }

  state() {
    const stored = readJson(this.path, null) || {}
    return { ...DEFAULTS, patienceSeconds: this.persona.patienceSeconds ?? DEFAULTS.patienceSeconds, ...stored }
  }

  save(patch) {
    const next = { ...this.state(), ...patch }
    writeJson(this.path, next)
    return next
  }

  serial(fn) {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  /**
   * Bind the chara's session; called once the session exists. Binding a new
   * session starts its rhythm over: the previous session's pending wake is
   * removed (it would otherwise fire into a conversation that is no longer the
   * chara's), and the first wake comes again, soon, so the new session gets its
   * first turn quickly.
   */
  bindSession(sessionId) {
    return this.serial(async () => {
      const s = this.state()
      if (s.sessionId === sessionId) return s
      if (s.sessionId && s.heartbeatId) await this.deleteQuietly(s.sessionId, s.heartbeatId)
      return this.save({ sessionId, heartbeatId: null, nextWakeAt: null, pendingRestSeconds: null, firstWakeArmed: false })
    })
  }

  /** Startup: make sure exactly the right wake is pending. */
  ensureArmed() {
    return this.serial(async () => {
      const s = this.state()
      if (!s.sessionId || !s.autonomy) return s
      if (s.heartbeatId) {
        const pending = await this.scheduler.list(s.sessionId)
        if (pending.some(r => r.id === s.heartbeatId)) return s
      }
      if (!s.firstWakeArmed) {
        const delay = this.persona.firstWakeDelaySeconds ?? 30
        return this.arm(delay, this.persona.firstWakePrompt, { firstWakeArmed: true })
      }
      return this.arm(s.patienceSeconds)
    })
  }

  setAutonomy(on) {
    return this.serial(async () => {
      const s = this.save({ autonomy: Boolean(on) })
      if (!s.sessionId) return s
      if (!on) return this.disarm()
      return this.arm(s.firstWakeArmed ? s.patienceSeconds : (this.persona.firstWakeDelaySeconds ?? 30),
        s.firstWakeArmed ? undefined : this.persona.firstWakePrompt, { firstWakeArmed: true })
    })
  }

  setPatience(seconds) {
    return this.serial(async () => {
      const s = this.save({ patienceSeconds: clamp(seconds, MIN_PATIENCE, MAX_PATIENCE) })
      // Re-anchor a pending wake to the new rhythm.
      if (s.sessionId && s.autonomy && s.heartbeatId) return this.arm(s.patienceSeconds)
      return s
    })
  }

  /**
   * The user asked for a wake now: deliver one in a moment through the same
   * schedule path. Works with free time off too (it is an explicit request);
   * afterwards the usual rhythm, or none, resumes.
   */
  wakeNow() {
    return this.serial(async () => {
      const s = this.state()
      if (!s.sessionId) throw new Error('the session is not set up yet')
      return this.arm(2)
    })
  }

  /** The chara chose when to wake next; applies when the current turn ends. */
  requestRest(seconds) {
    return this.serial(async () => this.save({ pendingRestSeconds: clamp(seconds, MIN_REST, MAX_REST) }))
  }

  /** A turn in the chara's session ended: re-arm from now. */
  onTurnEnd() {
    return this.serial(async () => {
      const s = this.state()
      if (!s.sessionId) return s
      const patch = { lastTurnEndAt: this.now(), pendingRestSeconds: null }
      if (!s.autonomy) return this.save(patch)
      const delay = s.pendingRestSeconds ?? s.patienceSeconds
      return this.arm(delay, undefined, patch)
    })
  }

  /** A wake was delivered (its reminder fired). */
  onWakeDelivered() {
    return this.serial(async () => {
      const s = this.state()
      return this.save({ wakes: s.wakes + 1, heartbeatId: null, nextWakeAt: null })
    })
  }

  // ---- internals (call only inside serial) ----

  async disarm(patch = {}) {
    const s = this.state()
    if (s.sessionId && s.heartbeatId) await this.deleteQuietly(s.sessionId, s.heartbeatId)
    return this.save({ ...patch, heartbeatId: null, nextWakeAt: null })
  }

  async arm(delaySeconds, promptTemplate, patch = {}) {
    const s = this.state()
    if (s.heartbeatId) await this.deleteQuietly(s.sessionId, s.heartbeatId)
    // patience and rest clamp their own ranges; this floor only keeps the
    // target safely in the future (DSH refuses an `at` that is not).
    const at = this.now() + Math.max(2, delaySeconds) * 1000
    const template = promptTemplate ?? this.persona.wakePrompt
    const record = await this.scheduler.create(s.sessionId, {
      title: this.persona.wakeTitle,
      prompt: template.replaceAll('{{time}}', localTime(at)),
      at: new Date(at).toISOString(),
    })
    this.log(`next wake ${localTime(at)} (${record.id})`)
    return this.save({ ...patch, heartbeatId: record.id, nextWakeAt: at })
  }

  async deleteQuietly(sessionId, id) {
    try {
      await this.scheduler.delete(sessionId, id)
    } catch (err) {
      // Already delivered (one-shots end) or deleted by the user from the
      // Automation tasks page: nothing left to remove.
      this.log(`previous wake ${id} not deleted: ${err?.message ?? err}`)
    }
  }
}
