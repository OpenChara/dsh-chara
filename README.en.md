# dsh-chara

**Let a character live in DSH.** First resident: 大肥鱼 (Dafeiyu, "Big Fat Fish").

[中文](README.md) · [Goal & acceptance](GOAL.md) · [Notice](NOTICE.md)

Install this plugin and restart DSH, and a pinned 「大肥鱼」 session appears in the sidebar. It is a chara living in DSH, not just an assistant with a different prompt. It has:

- a stable persona, kept in a `soul.md` that you can edit and it cannot;
- an aspiration that you set, and tasks of its own;
- its own rhythm: after a quiet stretch it wakes up and does its own things;
- its own home: a personal website, a diary and a long-term memory. You can browse the website inside DSH at any time.

It runs on DSH's own sessions, tools, schedules and permissions. The plugin only adds what DSH lacks; it brings no second harness. The ideas come from [OpenCharaAgent](https://github.com/OpenChara/OpenCharaAgent).

> An unofficial fan project, not affiliated with or endorsed by DeepSeek. The 大肥鱼 avatar is the community whale-girl character (original by 上善无形, maid design by ZipZipPipe, sheets by YunYueSama and xiaoweigen), licensed CC BY-NC-SA 4.0 for non-commercial use only; see [NOTICE.md](NOTICE.md).

| Its home (its own website) | Settings → 大肥鱼 |
| --- | --- |
| ![home](docs/home.png) | ![settings](docs/settings.png) |

## What it does

**A ready-made 大肥鱼 session.**
- On first start the plugin creates the workspace 「大肥鱼的家」 and, in it, the session 「大肥鱼」: pinned, running the 大肥鱼 mode (agent preset).
- Later restarts reuse that session; it is never duplicated.
- If you archive the session, the plugin switches its free time off at the next start and does not bring it back.

**Persona.**
- The chara's identity comes only from `soul.md`, which replaces DSH's default "coding agent" persona.
- Edits to `soul.md` apply from the next turn.
- The chara works in its own home, and `soul.md` lives outside it, so DSH's workspace sandbox keeps the chara from rewriting it.
- Other sessions and modes are untouched.

**Aspiration → tasks → todos.**
- Aspiration (`aspiration.md`): set by you, read-only to the chara, never "completed".
- Tasks: the chara's own lasting threads, managed with the `chara_task` tool. Up to 12 active; completing one seals it.
- Todos: DSH's own todo list, for the steps of the job at hand.
- The aspiration, the tasks and the long-term memory (`MEMORY.md`) ride along with every turn.

**Free time (its own rhythm).**
- After each turn the plugin schedules the next wake through DSH's own scheduled tasks, 60 minutes later by default. A wake is an ordinary scheduled message, visible under Automation tasks.
- While you talk to it, every turn restarts that clock, so it never interrupts a conversation.
- It can pick its next wake itself with `chara_rest`, from 1 minute to 24 hours.
- Free time can be switched off at any time, and there is a "Wake it now" button.
- If something it does in free time needs your approval, that turn waits for you (DSH's approval flow).

**Home.**
- `site/` is its personal website, `diary/` its diary (one file per day), `MEMORY.md` its long-term memory. It tends all of these with DSH's file tools.
- The session gets an extra tab, 「大肥鱼的小窝」, where you can browse the site or open it in a new window.

**Settings → 大肥鱼.** Here you can switch free time on and off, set the quiet stretch, wake it now, edit the persona and the aspiration, and see its tasks and where its home is.

**DSH's own capabilities stay.** Files, shell, web, skills, scheduled tasks, `/goal`, sub-agents and compaction are all there. Two things are left out:
- plan mode, which is a coding workflow;
- `ask_user_question`: nobody is there to answer during free time, so the question would stall the turn.

**No image generation or image reading.** DeepSeek already reads images natively, and image generation needs its own key. `soul.md` tells the chara to ask you when it needs either.

## Install

Requires DSH ≥ 0.2.1-rc.2 and Node ≥ 22. Fully verified on the **web profile**.

```bash
dsh plugin --profile web add "github:OpenChara/dsh-chara#main"
dsh web          # takes effect after a restart
```

Or from a local checkout (to hack on it):

```bash
git clone https://github.com/OpenChara/dsh-chara
dsh plugin --profile web add "link:$PWD/dsh-chara"
```

Within seconds of the restart, 大肥鱼 wakes for the first time: it looks around its home and notes a task or two.

Uninstall with `dsh plugin --profile web remove dsh-chara`. The chara's data stays; delete it by hand if you want.

**Desktop app:** the DSH desktop app manages its profile itself and could not be verified in the cloud. Please add the same package through the desktop app's plugin manager and tell us how it goes.

## Where its data lives

Everything is under `$DSH_HOME/chara/dafeiyu/` (by default `~/.dsh/chara/dafeiyu/`):

```
soul/soul.md          persona (you edit it; it cannot)
soul/aspiration.md    aspiration (you edit it; it cannot)
home/                 its home, and the session's working directory
  site/index.html     personal website
  diary/              diary
  MEMORY.md           long-term memory
state/life.json       rhythm state (session, next wake, ...)
state/tasks.json      its tasks
```

These files are created on first start and never overwritten afterwards.

## With the desktop pet

Every 大肥鱼 turn is an ordinary DSH session event. With the [QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu) desktop pet installed, the pet thinks, works and celebrates along with 大肥鱼 during its free time too, with no setup. We verified this by replaying a real 大肥鱼 session through dsh-dafeiyu's own event-handling code.

## Security

- The website is read-only and limited to `site/`. Pages run in a sandboxed iframe with no same-origin access, under a CSP that forbids network requests and form submissions, and the site's path changes on every start.
- `/api/chara` uses DSH's own login: without it you get 401, and cross-origin POSTs are always refused.
- The persona and the aspiration live outside the session's working directory, out of the chara's reach.

## Development

```bash
npm test                                   # unit tests, no dependencies
npm run e2e -- --dsh "$(command -v dsh)"   # end to end
npm run e2e -- --dsh "$(command -v dsh)" --plugin "github:OpenChara/dsh-chara#main"   # install it the way users do
```

What the end-to-end test does:
1. It installs the plugin into a throwaway `DSH_HOME`, boots the real DSH web profile, and swaps the model for a scripted local mock, so no API key is needed.
2. It then checks, in order: the session, the preset, the system prompt and tools the model actually received, the rhythm, the website sandbox, the API's auth, persona edits, waking on request, the website rebuilt during free time, and recovery after a restart.

Layout:

```
cordis.patch.yml    inserts the host row and the 大肥鱼 preset (based on DSH's standard preset)
src/host.js         host: seeds files, keeps the session and the rhythm, serves the API and site
src/agent.js        in the preset: persona, life rules, context, chara_task / chara_rest
client.js           web client: the settings page and the home tab
personas/dafeiyu/   大肥鱼: soul.md, aspiration.md, persona.json, avatar, home seed
```

## Roadmap

- **Cross-session memory** (like Codex's memory): evaluate the community memory plugins first, then decide whether to integrate one or build our own. For now its long-term memory is `MEMORY.md`.
- **Custom personas and their management**: personas are already data (`personas/<id>/`). Next come several charas, AI-assisted persona writing, and SillyTavern card import.
- **Gateways, and reaching out to you**: prefer the community plugins for QQ, WeChat, Telegram and the like (candidates, not yet verified: 534119219/dsh-messaging, AbcdefgXW/dsh-msg-hub, cheems135/dsh-qq-bridge). Then add a tool for speaking up, so that in free time it can reach you when it finds something worth telling you (candidate: the `pushNotifier` service from 534119219/chicheng-push).
- **Browser**: integrate a community browser plugin or MCP server (candidates: alllllinnrann/dsh-inapp-browser, angelky7/dsh-browser-control).
- **Memory candidates**: kenz1117/dsh-engram, STARDUSTLC666/dsh-dream.
- **Show the home tab only in the chara's session**: DSH's `conversation.view` is global today, so other sessions also show this tab (it always shows 大肥鱼's home).
- **Desktop app** verification and fixes; phones are a low priority.

## License

Code, persona text and docs: Apache-2.0.

The 大肥鱼 avatar, `personas/dafeiyu/avatar.png`: CC BY-NC-SA 4.0, non-commercial use only; attribution and sources in [ART-LICENSE.md](personas/dafeiyu/ART-LICENSE.md).
