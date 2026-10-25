// Where one chara's files live. Three areas with different owners:
//   soul/   user-owned identity (soul.md, aspiration.md). Outside the chara's
//           working directory, so its own file tools cannot rewrite it.
//   state/  plugin-owned bookkeeping (life.json, tasks.json).
//   home/   the chara's own world and the session's working directory:
//           site/ (its website), diary/, MEMORY.md and whatever else it makes.
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** The default data root: $DSH_HOME/chara, else ~/.dsh/chara. */
export function defaultRoot() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'chara')
}

export function charaPaths(root, id) {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(id)) throw new Error(`invalid chara id: ${JSON.stringify(id)}`)
  const base = resolve(root, id)
  const home = join(base, 'home')
  return {
    base,
    soulDir: join(base, 'soul'),
    soul: join(base, 'soul', 'soul.md'),
    aspiration: join(base, 'soul', 'aspiration.md'),
    stateDir: join(base, 'state'),
    life: join(base, 'state', 'life.json'),
    tasks: join(base, 'state', 'tasks.json'),
    home,
    site: join(home, 'site'),
    diary: join(home, 'diary'),
    memory: join(home, 'MEMORY.md'),
  }
}
