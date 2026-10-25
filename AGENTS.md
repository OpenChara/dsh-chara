# AGENTS.md

Notes for AI coding assistants (Claude Code, Codex, DSH itself, ...) that are
asked to install dsh-chara for a user or to work on its code.

## Installing it for a user

1. Check DSH is there and new enough: `dsh --version` must be at least
   `0.2.1-rc.2`, and `node --version` at least 22.
2. Install into the profile the user runs (usually `web`):
   `dsh plugin --profile web add "github:OpenChara/dsh-chara#main"`.
   It is a bundle (it ships `dsh.bundle.patch`), so it takes effect only after
   DSH restarts. Tell the user to restart; do not kill their running DSH
   yourself.
3. Check it is composed in: `dsh --profile web --dump-config` lists the rows
   `id: chara` (`name: dsh-chara`) and `id: preset-chara-dafeiyu`.
4. After the restart: a pinned session 「大肥鱼」 appears in the workspace
   「大肥鱼的家」, and within seconds it takes its first turn by itself (a
   scheduled message that starts with 【醒来).
5. Its files live in `$DSH_HOME/chara/dafeiyu/` (default `~/.dsh/chara/dafeiyu/`).
   The persona is `soul/soul.md`. Edit it only when the user asks, and show
   them the change: the persona belongs to the user.

The desktop app manages its own profile; there, install through the app's
plugin manager.

## Working on the code

- `npm test` runs the unit tests (Node's built-in runner, no dependencies).
- `npm run e2e -- --dsh <path to dsh>` runs the end-to-end check against a
  real DSH, with a scripted mock model (`scripts/e2e/mock-llm.mjs`). It needs
  no API key and leaves nothing behind when it passes. Run it before you
  claim a change to the session, preset, life loop, API or website works.
  `--plugin "github:OpenChara/dsh-chara#<ref>"` installs a pushed ref
  instead of the checkout, which is how users get it.
- Never import `@deepseek-ai/*` packages: the desktop profile does not install
  optional peers. Every DSH service comes through `ctx` (`ctx.inject`,
  `ctx.systemPrompt`, `ctx.tools`, ...), and every registration goes through
  `ctx.effect` / `ctx.on` so it is undone when the plugin unloads.
- Do not add new session event types; the wakes are ordinary DSH scheduled
  messages so that every other plugin sees them.
- Keep `chara:now` (the runtime context) free of anything that changes every
  turn: DSH appends a new runtime-context snapshot to the history whenever its
  text changes.
- The model-facing life text (`src/lib/prompts.js`) is neutral guidance about
  how this place works, not values. The chara's identity comes only from
  `soul.md`.
- `cordis.patch.yml` copies DSH's standard preset. When DSH updates, re-check
  it against `dsh-web-app/presets/standard.patch.yml`.
- Bundle no 大肥鱼 artwork from the community (see NOTICE.md).
