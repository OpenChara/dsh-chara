// Agent-scope half of dsh-chara. It is mounted inside the chara's agent preset
// (see cordis.patch.yml), so every registration below applies to that chara's
// sessions only; standard sessions never see any of it.
//
// No @deepseek-ai/* imports, on purpose: everything comes through ctx, so the
// plugin activates on every profile (the desktop profile does not install
// optional peers).
import { readText } from './lib/fsutil.js'
import { seedChara } from './lib/home.js'
import { localTime, sharedLife, MIN_REST, MAX_REST } from './lib/life.js'
import { charaPaths, defaultRoot } from './lib/paths.js'
import { loadPersona } from './lib/persona.js'
import { lifeSection, nowContext } from './lib/prompts.js'
import { TaskStore } from './lib/tasks.js'

export const name = 'dsh-chara-agent'
export const inject = ['systemPrompt', 'tools']

// DSH's own placement table has no slot for us; sit just before the persona
// suffix (10200) so the life guidance closes the cached system prompt.
const LIFE_SECTION_ORDER = 10150
// Runtime-context order: after the working directory and sandbox facts.
const NOW_CONTEXT_ORDER = 150

export function apply(ctx, config = {}) {
  const persona = loadPersona(config.persona ?? 'dafeiyu')
  const paths = charaPaths(config.root ?? defaultRoot(), persona.id)
  seedChara(paths, persona.dir)
  const tasks = new TaskStore(paths.tasks)
  const life = sharedLife(paths.life, { persona })

  // Identity: shadow the deployment persona for this preset's sessions with
  // the user's soul.md, read fresh at each assembly so an edit applies on the
  // next turn. interpolate:false because a hand-edited persona may well contain
  // SillyTavern-style {{user}}, which DSH would otherwise reject as an unknown
  // prompt variable.
  ctx.systemPrompt.section({
    name: 'deployment:persona-prefix',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: () => readText(paths.soul, '').trim(),
    interpolate: false,
  })
  ctx.systemPrompt.section({
    name: 'chara:life',
    order: LIFE_SECTION_ORDER,
    text: lifeSection(persona),
    interpolate: false,
  })
  ctx.systemPrompt.context({
    name: 'chara:now',
    order: NOW_CONTEXT_ORDER,
    required: true,
    interpolate: false,
    text: () => {
      const aspiration = readText(paths.aspiration, '')
      return nowContext({
        aspiration,
        tasksBlock: tasks.renderBlock({ hasAspiration: aspiration.trim() !== '' }),
        memory: readText(paths.memory, ''),
        life: life.state(),
      })
    },
  })

  ctx.tools.register(taskTool(tasks))
  ctx.tools.register(restTool(life))
}

const JSON_OUTPUT = {
  schema: { type: 'object' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

export function taskTool(tasks) {
  return {
    name: 'chara_task',
    description: [
      'Manage your tasks: the few lasting threads you are advancing toward your aspiration.',
      'Actions: "add" (content), "update" (id, content), "complete" (id, optional note; this seals the task as a finished record),',
      '"remove" (id; drop an active task you no longer want), "list" (active and recently finished tasks).',
      'Keep each task one short line; keep the list short and real.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'update', 'complete', 'remove', 'list'] },
        id: { type: 'string', description: 'Task id such as "t3" (update, complete, remove).' },
        content: { type: 'string', description: 'The task, in one short line (add, update).' },
        note: { type: 'string', description: 'Optional closing note when completing.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: JSON_OUTPUT,
    async execute(args) {
      const { action, id, content, note } = args ?? {}
      switch (action) {
        case 'add': return { added: tasks.add(content) }
        case 'update': return { updated: tasks.update(requireId(id), content) }
        case 'complete': return { completed: tasks.complete(requireId(id), note ?? '') }
        case 'remove': return { removed: tasks.remove(requireId(id)) }
        case 'list': return { active: tasks.active(), done: tasks.done().slice(-10) }
        default: throw new Error(`unknown action ${JSON.stringify(action)}; use add, update, complete, remove or list`)
      }
    },
  }
}

export function restTool(life, now = () => Date.now()) {
  return {
    name: 'chara_rest',
    description: [
      `Choose when your next free time begins, in minutes from now (${MIN_REST / 60}-${MAX_REST / 60}).`,
      'It applies once, after this turn ends; afterwards your usual rhythm resumes.',
      'Your user can still reach you at any time.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: { minutes: { type: 'number', description: 'Minutes until you wake next.' } },
      required: ['minutes'],
      additionalProperties: false,
    },
    output: JSON_OUTPUT,
    async execute(args) {
      const minutes = Number(args?.minutes)
      if (!Number.isFinite(minutes)) throw new Error('minutes must be a number')
      const state = await life.requestRest(minutes * 60)
      if (!state.autonomy) {
        return { ok: true, note: 'Your free time is switched off, so you will act when your user next writes to you.' }
      }
      return { ok: true, wakeAround: localTime(now() + state.pendingRestSeconds * 1000) }
    },
  }
}

function requireId(id) {
  if (typeof id !== 'string' || id.trim() === '') throw new Error('this action needs the task id')
  return id.trim()
}
