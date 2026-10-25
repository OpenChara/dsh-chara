/**
 * dsh-chara: browser half.
 *
 * A self-registering client bundle (DSH's convention; it is not an ES module):
 *   window.__ModuleLoader__.load({ id: '<package name>', factory: (require) => ({ inject, apply }) })
 *
 * It fills two slots:
 *   - settings.section  "大肥鱼": free time on/off, rhythm, the persona and
 *                       aspiration (user-owned), tasks, where the home lives;
 *   - conversation.view "大肥鱼的小窝": the chara's website, sandboxed, plus
 *                       its status and tasks. Slots are global in DSH, so the
 *                       view shows the same home from any session: visiting
 *                       the chara from anywhere.
 * All data comes from the host half at /api/chara. React is the only module
 * required (the client baseline); no Harness client package is touched.
 */
window.__ModuleLoader__.load({
  id: 'dsh-chara',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const API = '/api/chara'
    const zh = () => !/^en/i.test(document.documentElement.lang || navigator.language || 'zh')
    const T = (zhText, enText) => (zh() ? zhText : enText)

    async function asJson(res) {
      let body = null
      try { body = await res.json() } catch { /* no JSON body */ }
      if (!res.ok || !body || body.ok === false) {
        const why = body && body.error ? body.error : `HTTP ${res.status}`
        throw new Error(why)
      }
      return body
    }
    const jget = (path) => fetch(API + path, { credentials: 'same-origin' }).then(asJson)
    const jpost = (path, payload) => fetch(API + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(asJson)

    function pad(n) { return String(n).padStart(2, '0') }
    function clock(ms) {
      if (!ms) return '—'
      const d = new Date(ms)
      const today = new Date()
      const sameDay = d.toDateString() === today.toDateString()
      const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
      return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
    }

    // Last good state, shared by both slots so the tab label and a fresh mount
    // have something to show before the first request settles.
    let cached = null
    const listeners = new Set()
    function publish(state) {
      cached = state
      for (const fn of listeners) fn(state)
    }

    function useChara() {
      const [state, setState] = useState(cached)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(!cached)
      useEffect(() => {
        listeners.add(setState)
        return () => { listeners.delete(setState) }
      }, [])
      const reload = useCallback(() => {
        setLoading(true)
        return jget('/state')
          .then((s) => { publish(s); setError('') })
          .catch((e) => setError(String(e.message || e)))
          .finally(() => setLoading(false))
      }, [])
      useEffect(() => { reload() }, [reload])
      return { state, error, loading, reload }
    }

    function Spinner() { return h('span', { 'data-chara-spin': '' }) }

    function Notice({ text, kind }) {
      if (!text) return null
      return h('div', { 'data-chara-notice': kind || 'error' }, text)
    }

    function Avatar({ size }) {
      return h('img', { src: `${API}/avatar`, alt: '', width: size, height: size, 'data-chara-avatar': '' })
    }

    function WakeButton() {
      const [busy, setBusy] = useState(false)
      const [status, setStatus] = useState({ text: '', kind: '' })
      useEffect(() => {
        if (status.kind !== 'ok') return undefined
        const timer = setTimeout(() => setStatus({ text: '', kind: '' }), 6000)
        return () => clearTimeout(timer)
      }, [status])
      const wake = () => {
        setBusy(true)
        setStatus({ text: '', kind: '' })
        jpost('/wake', {})
          .then((s) => { publish(s); setStatus({ text: T('已叫醒，几秒后开始。', 'Waking it up in a few seconds.'), kind: 'ok' }) })
          .catch((e) => setStatus({ text: String(e.message || e), kind: 'error' }))
          .finally(() => setBusy(false))
      }
      return h(React.Fragment, null,
        h('button', { 'data-chara-btn': '', disabled: busy, onClick: wake },
          busy ? h(Spinner) : null, T('现在叫醒它', 'Wake it now')),
        status.text ? h('span', { 'data-chara-notice': status.kind, 'data-chara-inline': '' }, status.text) : null)
    }

    // ---- settings section ----

    function FreeTime({ state }) {
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [on, setOn] = useState(state.life.autonomy)
      const [minutes, setMinutes] = useState(String(state.life.patienceMinutes))
      useEffect(() => { setOn(state.life.autonomy) }, [state.life.autonomy])
      useEffect(() => { setMinutes(String(state.life.patienceMinutes)) }, [state.life.patienceMinutes])

      const toggle = () => {
        const next = !on
        setOn(next) // optimistic: the switch moves at once, and reverts on failure
        setBusy('toggle')
        setError('')
        jpost('/settings', { autonomy: next })
          .then(publish)
          .catch((e) => { setOn(!next); setError(String(e.message || e)) })
          .finally(() => setBusy(''))
      }
      const savePatience = () => {
        setBusy('patience')
        setError('')
        jpost('/settings', { patienceMinutes: Number(minutes) })
          .then(publish)
          .catch((e) => setError(String(e.message || e)))
          .finally(() => setBusy(''))
      }
      return h('section', { 'data-chara-card': '' },
        h('h3', null, T('自由时间', 'Free time')),
        h('p', { 'data-chara-hint': '' }, T(
          '开着的时候，它空闲一段时间后会自己醒来，做自己的事。你跟它说话时不会被打断。',
          'When on, it wakes on its own after a quiet while and does its own things. It never interrupts a conversation with you.')),
        h('label', { 'data-chara-row': '' },
          h('input', { type: 'checkbox', checked: on, disabled: busy === 'toggle', onChange: toggle, 'data-chara-switch': '' }),
          h('span', null, on ? T('开', 'On') : T('关', 'Off')),
          busy === 'toggle' ? h(Spinner) : null),
        h('div', { 'data-chara-row': '' },
          h('span', null, T('空闲多久后醒来（分钟）', 'Wake after a quiet stretch of (minutes)')),
          h('input', {
            type: 'number', min: 1, max: 10080, value: minutes,
            onChange: (e) => setMinutes(e.target.value), 'data-chara-number': '',
          }),
          h('button', { 'data-chara-btn': '', disabled: busy === 'patience', onClick: savePatience },
            busy === 'patience' ? h(Spinner) : null, T('保存', 'Save'))),
        h('p', { 'data-chara-hint': '' },
          T('下次醒来：', 'Next wake: '), on ? clock(state.life.nextWakeAt) : T('（已关）', '(off)'),
          T(' · 已醒来 ', ' · woke '), String(state.life.wakes), T(' 次', ' time(s)')),
        h('div', { 'data-chara-row': '' }, h(WakeButton)),
        h(Notice, { text: error }))
    }

    function TextFile({ title, hint, value, route, rows, required }) {
      const [text, setText] = useState(value)
      const [busy, setBusy] = useState(false)
      const [status, setStatus] = useState({ text: '', kind: '' })
      useEffect(() => { setText(value) }, [value])
      const dirty = text !== value
      const save = () => {
        setBusy(true)
        setStatus({ text: '', kind: '' })
        jpost(route, { text })
          .then((s) => { publish(s); setStatus({ text: T('已保存，下一轮生效。', 'Saved; applies from the next turn.'), kind: 'ok' }) })
          .catch((e) => setStatus({ text: String(e.message || e), kind: 'error' }))
          .finally(() => setBusy(false))
      }
      return h('section', { 'data-chara-card': '' },
        h('h3', null, title),
        h('p', { 'data-chara-hint': '' }, hint),
        h('textarea', { value: text, rows, onChange: (e) => setText(e.target.value), 'data-chara-text': '', spellCheck: false }),
        h('div', { 'data-chara-row': '' },
          h('button', {
            'data-chara-btn': 'primary',
            disabled: busy || !dirty || (required && text.trim() === ''),
            onClick: save,
          }, busy ? h(Spinner) : null, T('保存', 'Save')),
          dirty ? h('button', { 'data-chara-btn': '', disabled: busy, onClick: () => setText(value) }, T('还原', 'Revert')) : null),
        h(Notice, { text: status.text, kind: status.kind }))
    }

    function TaskList({ tasks, compact }) {
      const active = tasks.active || []
      const done = tasks.done || []
      if (active.length === 0 && done.length === 0) {
        return h('p', { 'data-chara-hint': '' }, T('还没有任务。', 'No tasks yet.'))
      }
      return h('div', null,
        h('ul', { 'data-chara-tasks': '' }, active.map(t => h('li', { key: t.id }, h('code', null, t.id), ' ', t.content))),
        !compact && done.length > 0
          ? h('details', null,
            h('summary', null, T(`已完成（${done.length}）`, `Done (${done.length})`)),
            h('ul', { 'data-chara-tasks': 'done' }, done.slice().reverse().map(t => h('li', { key: t.id }, t.content))))
          : null)
    }

    function SettingsPanel() {
      const { state, error, loading, reload } = useChara()
      if (!state) {
        return h('div', { 'data-chara-root': '' },
          loading ? h('p', null, h(Spinner), T('正在读取…', 'Loading…')) : null,
          h(Notice, { text: error }),
          error ? h('button', { 'data-chara-btn': '', onClick: reload }, T('重试', 'Retry')) : null)
      }
      return h('div', { 'data-chara-root': '' },
        h('header', { 'data-chara-head': '' },
          h(Avatar, { size: 48 }),
          h('div', null, h('h2', null, state.persona.name), h('p', { 'data-chara-hint': '' }, state.persona.description))),
        state.sessionId
          ? null
          : h(Notice, { kind: 'warn', text: T('它的会话还没建好（DSH 刚启动时可能要等几秒）。', 'Its session is not set up yet (this can take a few seconds after DSH starts).') }),
        h(FreeTime, { state }),
        h(TextFile, {
          title: T('人格（soul.md）', 'Persona (soul.md)'),
          hint: T('它是谁、怎么说话、守住什么。这个文件只有你能改，它自己改不了。', 'Who it is, how it talks, what it holds to. Only you can edit this file; it cannot.'),
          value: state.soul, route: '/soul', rows: 14, required: true,
        }),
        h(TextFile, {
          title: T('理想（aspiration.md）', 'Aspiration (aspiration.md)'),
          hint: T('它长期朝着走的方向，由你来定。它会自己拆成任务去推进。', 'The direction it keeps moving toward, set by you. It breaks it into tasks of its own.'),
          value: state.aspiration, route: '/aspiration', rows: 4, required: false,
        }),
        h('section', { 'data-chara-card': '' },
          h('h3', null, T('它的任务', 'Its tasks')),
          h(TaskList, { tasks: state.tasks })),
        h('section', { 'data-chara-card': '' },
          h('h3', null, T('它的家', 'Its home')),
          h('p', { 'data-chara-hint': '' }, T('网站在 site/，日记在 diary/，长期记忆在 MEMORY.md：', 'Website in site/, diary in diary/, long-term memory in MEMORY.md:')),
          h('code', { 'data-chara-path': '' }, state.home)))
    }

    // ---- conversation view: the home ----

    function HomeView() {
      const { state, error, reload } = useChara()
      const [frameKey, setFrameKey] = useState(0)
      const [refreshing, setRefreshing] = useState(false)
      const refresh = () => {
        setRefreshing(true)
        reload().finally(() => { setFrameKey(k => k + 1); setRefreshing(false) })
      }
      if (!state) {
        return h('div', { 'data-chara-root': '', 'data-chara-home': '' },
          h(Notice, { text: error || T('正在读取…', 'Loading…'), kind: error ? 'error' : 'info' }))
      }
      const life = state.life
      return h('div', { 'data-chara-home': '' },
        h('div', { 'data-chara-bar': '' },
          h(Avatar, { size: 28 }),
          h('strong', null, state.persona.name),
          h('span', { 'data-chara-hint': '' },
            life.autonomy
              ? T(`自由时间开 · 下次醒来 ${clock(life.nextWakeAt)}`, `Free time on · next wake ${clock(life.nextWakeAt)}`)
              : T('自由时间关', 'Free time off')),
          h('span', { 'data-chara-spacer': '' }),
          h(WakeButton),
          h('button', { 'data-chara-btn': '', disabled: refreshing, onClick: refresh },
            refreshing ? h(Spinner) : null, T('刷新', 'Refresh')),
          h('a', { 'data-chara-btn': '', href: state.siteUrl, target: '_blank', rel: 'noopener noreferrer' },
            T('新窗口打开', 'Open in new window'))),
        (state.tasks.active || []).length > 0
          ? h('div', { 'data-chara-strip': '' }, T('在做：', 'Working on: '),
            state.tasks.active.map(t => h('span', { key: t.id, 'data-chara-chip': '' }, t.content)))
          : null,
        h('iframe', {
          key: frameKey,
          src: state.siteUrl,
          title: state.persona.homeTabLabel,
          sandbox: 'allow-scripts',
          referrerPolicy: 'no-referrer',
          'data-chara-frame': '',
        }))
    }

    const CSS = `
[data-chara-root]{display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);max-width:760px}
[data-chara-head]{display:flex;gap:12px;align-items:center}
[data-chara-head] h2{margin:0;font-size:18px}
[data-chara-head] p{margin:2px 0 0}
[data-chara-card]{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1)}
[data-chara-card] h3{margin:0 0 6px;font-size:14px}
[data-chara-hint]{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0 0 8px;line-height:1.6}
[data-chara-row]{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0;font-size:13px}
[data-chara-btn]{display:inline-flex;gap:6px;align-items:center;padding:4px 12px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;text-decoration:none}
[data-chara-btn]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
[data-chara-btn]:disabled{opacity:.5;cursor:default}
[data-chara-btn="primary"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
[data-chara-number]{width:90px;padding:3px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
[data-chara-text]{width:100%;box-sizing:border-box;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;padding:8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);resize:vertical}
[data-chara-notice]{font-size:12px;padding:6px 10px;border-radius:6px;margin-top:6px}
[data-chara-notice="error"]{color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-state-error-primary)}
[data-chara-notice="warn"]{color:var(--dsw-alias-state-warn-label);border:1px solid var(--dsw-alias-state-warn-primary)}
[data-chara-notice="ok"]{color:var(--dsw-alias-state-success-primary)}
[data-chara-notice="info"]{color:var(--dsw-alias-label-secondary)}
[data-chara-inline]{margin:0;padding:0 4px}
[data-chara-tasks]{margin:0;padding-left:18px;font-size:13px;line-height:1.8}
[data-chara-tasks="done"]{color:var(--dsw-alias-label-tertiary)}
[data-chara-path]{font-size:12px;word-break:break-all;color:var(--dsw-alias-label-secondary)}
[data-chara-avatar]{border-radius:50%;flex:none}
[data-chara-home]{display:flex;flex-direction:column;height:100%;min-height:480px;color:var(--dsw-alias-label-primary)}
[data-chara-bar]{display:flex;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}
[data-chara-bar] [data-chara-hint]{margin:0}
[data-chara-spacer]{flex:1}
[data-chara-strip]{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 12px;font-size:12px;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l2)}
[data-chara-chip]{padding:1px 8px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
[data-chara-frame]{flex:1;width:100%;border:0;background:#fff}
[data-chara-spin]{width:10px;height:10px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;animation:chara-spin .8s linear infinite}
@keyframes chara-spin{to{transform:rotate(360deg)}}
`

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-chara')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-chara: styles')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'dsh-chara', order: 40, label: () => (cached ? cached.persona.name : '大肥鱼') },
          () => h(SettingsPanel),
        ))
        slots.inject('conversation.view', () => slots.register(
          { name: 'conversation.view', id: 'dsh-chara-home', order: 50, label: () => (cached ? cached.persona.homeTabLabel : '大肥鱼的小窝') },
          () => h(HomeView),
        ))
      },
    }
  },
})
