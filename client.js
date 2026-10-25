/**
 * dsh-chara: browser half.
 *
 * A self-registering client bundle (DSH's convention; it is not an ES module):
 *   window.__ModuleLoader__.load({ id: '<package name>', factory: (require) => ({ inject, apply }) })
 *
 * It fills two slots:
 *   - settings.section  "大肥鱼": a header with its state, then four tabs:
 *                       rhythm (free time, how long it waits, wake now),
 *                       messaging apps (WeChat QR login, Telegram, QQ, who
 *                       may talk to it), persona (soul.md, user-owned), and
 *                       tasks & home;
 *   - conversation.view "大肥鱼的小窝": the chara's website, sandboxed, under a
 *                       bar with its state and tasks. Slots are global in DSH,
 *                       so the view shows the same home from any session.
 *
 * The look follows DSH's own controls (its --dsw-alias-* tokens, rows with
 * hairline separators, the capsule switch, primary / outline / ghost buttons,
 * state dots), so the pages read as part of DSH in light and dark themes.
 * All data comes from the host half at /api/chara. React is the only module
 * required (the client baseline); no Harness client package is touched.
 */
window.__ModuleLoader__.load({
  id: 'dsh-chara',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

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
    const message = (e) => String((e && e.message) || e)

    function pad(n) { return String(n).padStart(2, '0') }
    function clock(ms) {
      if (!ms) return '—'
      const d = new Date(ms)
      const now = new Date()
      const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
      if (d.toDateString() === now.toDateString()) return hm
      const tomorrow = new Date(now.getTime() + 86_400_000)
      if (d.toDateString() === tomorrow.toDateString()) return T(`明天 ${hm}`, `tomorrow ${hm}`)
      return `${d.getMonth() + 1}/${d.getDate()} ${hm}`
    }
    function minutesLabel(minutes) {
      if (minutes % 60 === 0) {
        const hours = minutes / 60
        return T(`${hours} 小时`, `${hours} h`)
      }
      return T(`${minutes} 分钟`, `${minutes} min`)
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
          .catch((e) => setError(message(e)))
          .finally(() => setLoading(false))
      }, [])
      useEffect(() => { reload() }, [reload])
      return { state, error, loading, reload }
    }

    /** A status line that clears itself after a success. */
    function useFlash() {
      const [flash, setFlash] = useState({ text: '', kind: '' })
      useEffect(() => {
        if (flash.kind !== 'ok') return undefined
        const timer = setTimeout(() => setFlash({ text: '', kind: '' }), 4000)
        return () => clearTimeout(timer)
      }, [flash])
      return [flash, setFlash]
    }

    // ---- primitives (DSH's look, plain DOM) ----

    function Spinner() { return h('span', { 'data-chara-spin': '', 'aria-hidden': 'true' }) }

    function Icon({ name }) {
      const paths = {
        wake: 'M8 2.5v1.2M8 12.3v1.2M2.5 8h1.2M12.3 8h1.2M4.1 4.1l.9.9M11 11l.9.9M4.1 11.9l.9-.9M11 5l.9-.9M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
        refresh: 'M13 8a5 5 0 1 1-1.5-3.6M13 3v2.5h-2.5',
        open: 'M9.5 3H13v3.5M13 3 7.5 8.5M11.5 9.5V13H3V4.5h3.5',
        copy: 'M5.5 5.5V3.5h7v7h-2M3.5 5.5h7v7h-7z',
      }
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', 'data-chara-icon': '' },
        h('path', { d: paths[name], stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function Button({ variant, busy, icon, children, ...rest }) {
      return h('button', { type: 'button', 'data-chara-btn': variant || 'outline', ...rest, disabled: rest.disabled || busy },
        busy ? h(Spinner) : (icon ? h(Icon, { name: icon }) : null), children)
    }

    function Switch({ checked, onChange, disabled, label }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked ? 'true' : 'false', 'aria-label': label,
        disabled, onClick: () => onChange(!checked), 'data-chara-switch': '',
      }, h('span', { 'data-chara-thumb': '' }))
    }

    /** A colored status dot: on (green), wait (amber), off (grey), error (red). */
    function Dot({ state }) { return h('span', { 'data-chara-dot': state, 'aria-hidden': 'true' }) }

    function Status({ state, children }) {
      return h('span', { 'data-chara-status': '' }, h(Dot, { state }), children)
    }

    /** One settings row: title and hint on the left, the control on the right. */
    function Row({ title, hint, control, children, lead }) {
      return h('div', { 'data-chara-row': '' },
        h('div', { 'data-chara-row-main': '' },
          lead || null,
          h('div', { 'data-chara-row-text': '' },
            h('div', { 'data-chara-row-title': '' }, title),
            hint ? h('div', { 'data-chara-row-hint': '' }, hint) : null),
          control ? h('div', { 'data-chara-row-control': '' }, control) : null),
        children || null)
    }

    function Note({ flash }) {
      if (!flash || !flash.text) return null
      return h('p', { 'data-chara-note': flash.kind || 'error', role: flash.kind === 'error' ? 'alert' : 'status' }, flash.text)
    }

    function Avatar({ size }) {
      return h('img', { src: `${API}/avatar`, alt: '', width: size, height: size, 'data-chara-avatar': '' })
    }

    function lifeLine(life) {
      if (!life.autonomy) return { state: 'off', text: T('自由时间已关', 'Free time off') }
      return { state: 'on', text: T(`自由时间 · ${clock(life.nextWakeAt)} 醒来`, `Free time · wakes ${clock(life.nextWakeAt)}`) }
    }

    function WakeButton({ variant, onFlash }) {
      const [busy, setBusy] = useState(false)
      const wake = () => {
        setBusy(true)
        jpost('/wake', {})
          .then((s) => { publish(s); onFlash({ text: T('已叫醒，几秒后开始。', 'Waking it up in a few seconds.'), kind: 'ok' }) })
          .catch((e) => onFlash({ text: message(e), kind: 'error' }))
          .finally(() => setBusy(false))
      }
      return h(Button, { variant: variant || 'outline', icon: 'wake', busy, onClick: wake }, T('现在叫醒它', 'Wake it now'))
    }

    // ---- settings: rhythm ----

    const PATIENCE_CHOICES = [15, 30, 60, 180]

    function RhythmPanel({ state }) {
      const life = state.life
      const [on, setOn] = useState(life.autonomy)
      const [minutes, setMinutes] = useState(life.patienceMinutes)
      const [custom, setCustom] = useState(String(life.patienceMinutes))
      const [busy, setBusy] = useState('')
      const [flash, setFlash] = useFlash()
      useEffect(() => { setOn(life.autonomy) }, [life.autonomy])
      useEffect(() => { setMinutes(life.patienceMinutes); setCustom(String(life.patienceMinutes)) }, [life.patienceMinutes])

      const save = (payload, key, revert) => {
        setBusy(key)
        jpost('/settings', payload)
          .then(publish)
          .catch((e) => { revert(); setFlash({ text: message(e), kind: 'error' }) })
          .finally(() => setBusy(''))
      }
      const toggle = (next) => {
        setOn(next) // optimistic: the switch moves at once and reverts on failure
        save({ autonomy: next }, 'toggle', () => setOn(!next))
      }
      const choose = (value) => {
        const previous = minutes
        setMinutes(value)
        setCustom(String(value))
        save({ patienceMinutes: value }, 'patience', () => setMinutes(previous))
      }
      const isPreset = PATIENCE_CHOICES.includes(minutes)
      return h('div', { 'data-chara-panel': '' },
        h(Row, {
          title: T('自由时间', 'Free time'),
          hint: T('开着的时候，它空闲一阵后会自己醒来，做自己的事。你跟它说话时不会被打断。',
            'When on, it wakes on its own after a quiet while and does its own things. It never interrupts a conversation with you.'),
          control: h('span', { 'data-chara-inline': '' }, busy === 'toggle' ? h(Spinner) : null,
            h(Switch, { checked: on, onChange: toggle, disabled: busy === 'toggle', label: T('自由时间', 'Free time') })),
        }),
        h(Row, {
          title: T('安静多久后醒来', 'Wake after a quiet stretch of'),
          hint: T('每次对话或活动结束都会重新计时；它也可以自己决定下次什么时候醒。',
            'The clock restarts after every conversation or activity; it can also choose its own next wake.'),
        },
        h('div', { 'data-chara-choices': '' },
          PATIENCE_CHOICES.map(value => h('button', {
            key: value, type: 'button', 'data-chara-choice': '', 'aria-pressed': minutes === value ? 'true' : 'false',
            disabled: busy === 'patience', onClick: () => choose(value),
          }, minutesLabel(value))),
          h('span', { 'data-chara-custom': isPreset ? '' : 'active' },
            h('input', {
              type: 'number', min: 1, max: 10080, value: custom, 'aria-label': T('自定义分钟数', 'Custom minutes'),
              onChange: (e) => setCustom(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') choose(Number(custom)) },
              'data-chara-number': '',
            }),
            h('span', null, T('分钟', 'min')),
            Number(custom) !== minutes
              ? h(Button, { variant: 'primary', busy: busy === 'patience', onClick: () => choose(Number(custom)) }, T('设定', 'Set'))
              : null))),
        h(Row, {
          title: T('下次醒来', 'Next wake'),
          hint: on
            ? T(`${clock(life.nextWakeAt)} · 已经自己醒来 ${life.wakes} 次`, `${clock(life.nextWakeAt)} · has woken ${life.wakes} time(s)`)
            : T(`自由时间关着，它只在你找它时行动 · 已醒来 ${life.wakes} 次`, `Free time is off, so it acts only when you write · woke ${life.wakes} time(s)`),
        }),
        h(Note, { flash }))
    }

    // ---- settings: messaging apps ----

    const PLATFORM_STATE = {
      running: () => ({ dot: 'on', text: T('已连接', 'Connected') }),
      needs_login: () => ({ dot: 'wait', text: T('等待扫码登录', 'Waiting for a QR login') }),
      off: () => ({ dot: 'off', text: T('未开启', 'Off') }),
      error: () => ({ dot: 'error', text: T('出错', 'Error') }),
    }

    function PlatformStatus({ entry }) {
      if (!entry) return null
      const view = (PLATFORM_STATE[entry.state] || PLATFORM_STATE.off)()
      return h(Status, { state: view.dot }, view.text, entry.state === 'error' && entry.detail ? `：${entry.detail}` : '')
    }

    function Badge({ platform }) {
      const letter = { weixin: T('微', 'W'), telegram: 'T', qq: 'Q' }[platform]
      return h('span', { 'data-chara-badge': platform, 'aria-hidden': 'true' }, letter)
    }

    function Field({ label, hint, value, onChange, type, placeholder }) {
      return h('label', { 'data-chara-field': '' },
        h('span', { 'data-chara-field-label': '' }, label),
        h('input', {
          type: type || 'text', value, placeholder, autoComplete: 'off', spellCheck: false,
          onChange: (e) => onChange(e.target.value), 'data-chara-input': '',
        }),
        hint ? h('span', { 'data-chara-field-hint': '' }, hint) : null)
    }

    function WeixinRow({ entry, onChanged }) {
      const [qr, setQr] = useState(null) // { qrcode, svg }
      const [phase, setPhase] = useState('') // '', 'loading', 'wait', 'scaned', 'expired'
      const [busy, setBusy] = useState(false)
      const [flash, setFlash] = useFlash()
      useEffect(() => {
        if (!qr) return undefined
        let stopped = false
        const started = Date.now()
        const poll = async () => {
          while (!stopped && Date.now() - started < 5 * 60_000) {
            try {
              const result = await jpost('/gateway/weixin/status', { qrcode: qr.qrcode })
              if (stopped) return
              if (result.login === 'confirmed') {
                setQr(null)
                setPhase('')
                setFlash({ text: T('微信已登录。', 'WeChat is logged in.'), kind: 'ok' })
                onChanged(result)
                return
              }
              if (result.login === 'expired') {
                setQr(null)
                setPhase('expired')
                return
              }
              setPhase(result.login)
            } catch (e) {
              if (!stopped) { setFlash({ text: message(e), kind: 'error' }); setQr(null); setPhase('') }
              return
            }
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
          if (!stopped) { setQr(null); setPhase('expired') }
        }
        poll()
        return () => { stopped = true }
      }, [qr])
      const start = () => {
        setPhase('loading')
        jpost('/gateway/weixin/qr', {})
          .then((r) => { setQr({ qrcode: r.qrcode, svg: r.svg }); setPhase('wait') })
          .catch((e) => { setPhase(''); setFlash({ text: message(e), kind: 'error' }) })
      }
      const logout = () => {
        setBusy(true)
        jpost('/gateway/weixin/logout', {})
          .then(onChanged)
          .catch((e) => setFlash({ text: message(e), kind: 'error' }))
          .finally(() => setBusy(false))
      }
      const running = entry && entry.state === 'running'
      return h(Row, {
        lead: h(Badge, { platform: 'weixin' }),
        title: h('span', { 'data-chara-inline': '' }, T('微信', 'WeChat'), h(PlatformStatus, { entry })),
        hint: T('通过 ClawBot（iLink）登录。之后用这个微信给它发消息，它在同一个会话里回你。',
          'Logs in through ClawBot (iLink). Then message it from that WeChat; it answers in the same session.'),
        control: running
          ? h(Button, { variant: 'ghost', busy, onClick: logout }, T('退出登录', 'Log out'))
          : h(Button, { variant: 'primary', busy: phase === 'loading', disabled: Boolean(qr), onClick: start }, T('扫码登录', 'Log in with QR')),
      },
      qr
        ? h('div', { 'data-chara-qr': '' },
          h('img', { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`, alt: T('微信登录二维码', 'WeChat login QR code') }),
          h('div', null,
            h('p', { 'data-chara-qr-title': '' }, phase === 'scaned' ? T('已扫码，请在手机上确认', 'Scanned; confirm on your phone') : T('用手机微信扫一扫', 'Scan with WeChat on your phone')),
            h('p', { 'data-chara-row-hint': '' }, h(Spinner), ' ', T('二维码 5 分钟内有效。', 'The code is valid for 5 minutes.')),
            h(Button, { variant: 'ghost', onClick: () => { setQr(null); setPhase('') } }, T('取消', 'Cancel'))))
        : null,
      phase === 'expired' ? h(Note, { flash: { kind: 'warn', text: T('二维码过期了，再点一次「扫码登录」。', 'The QR code expired; press "Log in with QR" again.') } }) : null,
      h(Note, { flash }))
    }

    function MessagingPanel() {
      const [view, setView] = useState(null) // { config, status }
      const [draft, setDraft] = useState(null)
      const [busy, setBusy] = useState(false)
      const [flash, setFlash] = useFlash()
      const applied = (v) => { setView(v); setDraft(v.config) }
      useEffect(() => {
        jget('/gateway').then(applied).catch((e) => setFlash({ text: message(e), kind: 'error' }))
      }, [])
      if (!view || !draft) {
        return h('div', { 'data-chara-panel': '' },
          flash.text ? h(Note, { flash }) : h('p', { 'data-chara-loading': '' }, h(Spinner), T('正在读取…', 'Loading…')))
      }
      const entry = (platform) => view.status.platforms.find(p => p.platform === platform)
      const set = (platform, key) => (value) => setDraft({ ...draft, [platform]: { ...draft[platform], [key]: value } })
      const dirty = JSON.stringify(draft) !== JSON.stringify(view.config)
      const save = () => {
        setBusy(true)
        jpost('/gateway', draft)
          .then((v) => { applied(v); setFlash({ text: T('已保存并生效。', 'Saved and applied.'), kind: 'ok' }) })
          .catch((e) => setFlash({ text: message(e), kind: 'error' }))
          .finally(() => setBusy(false))
      }
      const platformRow = (platform, title, hint, fields) => h(Row, {
        lead: h(Badge, { platform }),
        title: h('span', { 'data-chara-inline': '' }, title, h(PlatformStatus, { entry: entry(platform) })),
        hint,
        control: h(Switch, { checked: draft[platform].enabled, onChange: set(platform, 'enabled'), label: title }),
      }, draft[platform].enabled ? h('div', { 'data-chara-fields': '' }, fields) : null)
      return h('div', { 'data-chara-panel': '' },
        h('p', { 'data-chara-intro': '' }, T(
          '在这些应用里也能找到它。消息都进它的同一个会话，回复发回原处；自由时间里它想找你，会用 chara_speak 发到你最近用的聊天。默认只有你本人能和它聊。',
          'Reach it from these apps too. Messages go into its one session and replies go back where they came from; in its free time it can reach you with chara_speak, at your latest chat. Only you can talk to it by default.')),
        h(WeixinRow, { entry: entry('weixin'), onChanged: applied }),
        platformRow('telegram', 'Telegram', T('用 @BotFather 建一个机器人。', 'Create a bot with @BotFather.'), [
          h(Field, { key: 'token', label: 'Bot token', type: 'password', value: draft.telegram.botToken, onChange: set('telegram', 'botToken'), placeholder: '123456:ABC…' }),
          h(Field, { key: 'owner', label: T('你的用户 ID', 'Your user id'), value: draft.telegram.ownerId, onChange: set('telegram', 'ownerId'), placeholder: '123456789', hint: T('数字 ID，可以问 @userinfobot。', 'Numeric; ask @userinfobot.') }),
        ]),
        platformRow('qq', 'QQ', T('通过 NapCat 或 Lagrange 的 OneBot 接口；QQ 在它们那边登录。', 'Through the OneBot interface of NapCat or Lagrange; log in to QQ there.'), [
          h(Field, { key: 'url', label: T('OneBot WebSocket 地址', 'OneBot WebSocket URL'), value: draft.qq.url, onChange: set('qq', 'url'), placeholder: 'ws://127.0.0.1:3001' }),
          h(Field, { key: 'token', label: 'Access token', type: 'password', value: draft.qq.accessToken, onChange: set('qq', 'accessToken'), placeholder: T('没有可留空', 'optional') }),
          h(Field, { key: 'peer', label: T('你的 QQ 号', 'Your QQ number'), value: draft.qq.peerId, onChange: set('qq', 'peerId') }),
        ]),
        h(Row, {
          title: T('另外允许谁', 'Also allowed'),
          hint: T('对方在该应用里的 ID，用逗号分隔。填「*」表示所有人；它有终端和文件权限，慎用。',
            'Their ids on that app, comma separated. "*" means anyone; it has a shell and files, so think twice.'),
        }, h('input', {
          value: draft.allowedSenders.join(', '), placeholder: T('只有你本人', 'only you'), spellCheck: false,
          onChange: (e) => setDraft({ ...draft, allowedSenders: e.target.value.split(/[\s,，]+/).filter(Boolean) }),
          'data-chara-input': '', 'aria-label': T('另外允许谁', 'Also allowed'),
        })),
        dirty
          ? h('div', { 'data-chara-savebar': '' },
            h('span', null, T('有未保存的修改', 'Unsaved changes')),
            h(Button, { variant: 'ghost', disabled: busy, onClick: () => setDraft(view.config) }, T('还原', 'Revert')),
            h(Button, { variant: 'primary', busy, onClick: save }, T('保存', 'Save')))
          : null,
        h(Note, { flash }))
    }

    // ---- settings: persona ----

    function PersonaPanel({ state }) {
      const [text, setText] = useState(state.soul)
      const [busy, setBusy] = useState(false)
      const [flash, setFlash] = useFlash()
      useEffect(() => { setText(state.soul) }, [state.soul])
      const dirty = text !== state.soul
      const save = () => {
        setBusy(true)
        jpost('/soul', { text })
          .then((s) => { publish(s); setFlash({ text: T('已保存，下一轮生效。', 'Saved; applies from the next turn.'), kind: 'ok' }) })
          .catch((e) => setFlash({ text: message(e), kind: 'error' }))
          .finally(() => setBusy(false))
      }
      return h('div', { 'data-chara-panel': '' },
        h('p', { 'data-chara-intro': '' }, T(
          '它是谁、怎么说话、守住什么。这份设定只有你能改，它自己改不了；改完从下一轮起生效。',
          'Who it is, how it talks, what it holds to. Only you can edit this; it cannot. Changes apply from the next turn.')),
        h('textarea', {
          value: text, rows: 18, spellCheck: false, onChange: (e) => setText(e.target.value),
          'data-chara-editor': '', 'aria-label': T('人格（soul.md）', 'Persona (soul.md)'),
        }),
        h('div', { 'data-chara-editor-foot': '' },
          h('span', { 'data-chara-row-hint': '' }, 'soul.md · ', T(`${[...text].length} 字`, `${[...text].length} characters`), dirty ? T(' · 未保存', ' · unsaved') : ''),
          h('span', { 'data-chara-spacer': '' }),
          dirty ? h(Button, { variant: 'ghost', disabled: busy, onClick: () => setText(state.soul) }, T('还原', 'Revert')) : null,
          h(Button, { variant: 'primary', busy, disabled: !dirty || text.trim() === '', onClick: save }, T('保存', 'Save'))),
        h(Note, { flash }))
    }

    // ---- settings: tasks & home ----

    function TasksAndHomePanel({ state }) {
      const active = state.tasks.active || []
      const done = state.tasks.done || []
      const [copied, setCopied] = useState(false)
      const copy = () => {
        navigator.clipboard.writeText(state.home).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }).catch(() => {})
      }
      return h('div', { 'data-chara-panel': '' },
        h('h4', { 'data-chara-subhead': '' }, T('在做的事', 'Working on'), h('span', { 'data-chara-count': '' }, active.length)),
        active.length
          ? h('ol', { 'data-chara-tasks': '' }, active.map(t => h('li', { key: t.id }, h('span', { 'data-chara-task-id': '' }, t.id), h('span', null, t.content))))
          : h('p', { 'data-chara-empty': '' }, T('现在没有在做的事。它会自己给自己记任务。', 'Nothing on its list right now. It keeps its own tasks.')),
        done.length
          ? h('details', { 'data-chara-done': '' },
            h('summary', null, T(`已完成 ${done.length} 件`, `${done.length} done`)),
            h('ol', { 'data-chara-tasks': 'done' }, done.slice().reverse().map(t => h('li', { key: t.id }, h('span', { 'data-chara-task-id': '' }, t.id), h('span', null, t.content)))))
          : null,
        h('h4', { 'data-chara-subhead': '' }, T('它的家', 'Its home')),
        h(Row, {
          title: T('家目录', 'Home folder'),
          hint: h('code', { 'data-chara-path': '' }, state.home),
          control: h(Button, { variant: 'ghost', icon: 'copy', onClick: copy }, copied ? T('已复制', 'Copied') : T('复制路径', 'Copy path')),
        }),
        h(Row, {
          title: T('里面有什么', "What's inside"),
          hint: T('site/ 是它的网站，diary/ 是日记，MEMORY.md 是长期记忆。都由它自己打理。',
            'site/ is its website, diary/ its diary, MEMORY.md its long-term memory. It tends them itself.'),
          control: h('a', { href: state.siteUrl, target: '_blank', rel: 'noopener noreferrer', 'data-chara-btn': 'outline' }, h(Icon, { name: 'open' }), T('打开网站', 'Open the website')),
        }))
    }

    // ---- settings section ----

    const TABS = [
      { id: 'rhythm', label: () => T('作息', 'Rhythm') },
      { id: 'messaging', label: () => T('消息', 'Messaging') },
      { id: 'persona', label: () => T('人格', 'Persona') },
      { id: 'home', label: () => T('任务与家', 'Tasks & home') },
    ]
    let lastTab = 'rhythm'

    function SettingsPanel() {
      const { state, error, loading, reload } = useChara()
      const [tab, setTab] = useState(lastTab)
      const [flash, setFlash] = useFlash()
      const choose = (id) => { lastTab = id; setTab(id) }
      if (!state) {
        return h('div', { 'data-chara-root': '' },
          loading ? h('p', { 'data-chara-loading': '' }, h(Spinner), T('正在读取…', 'Loading…')) : null,
          error ? h(Note, { flash: { text: error, kind: 'error' } }) : null,
          error ? h(Button, { onClick: reload }, T('重试', 'Retry')) : null)
      }
      const line = lifeLine(state.life)
      return h('div', { 'data-chara-root': '' },
        h('header', { 'data-chara-hero': '' },
          h(Avatar, { size: 56 }),
          h('div', { 'data-chara-hero-text': '' },
            h('h2', null, state.persona.name),
            h('p', null, state.persona.description),
            h(Status, { state: state.sessionId ? line.state : 'wait' },
              state.sessionId ? line.text : T('会话还没建好，DSH 刚启动时要等几秒', 'Its session is being set up (a few seconds after DSH starts)'))),
          h(WakeButton, { onFlash: setFlash })),
        h(Note, { flash }),
        h('div', { role: 'tablist', 'data-chara-tabs': '' },
          TABS.map(t => h('button', {
            key: t.id, type: 'button', role: 'tab', 'aria-selected': tab === t.id ? 'true' : 'false',
            onClick: () => choose(t.id), 'data-chara-tab': '',
          }, t.label()))),
        tab === 'rhythm' ? h(RhythmPanel, { state }) : null,
        tab === 'messaging' ? h(MessagingPanel) : null,
        tab === 'persona' ? h(PersonaPanel, { state }) : null,
        tab === 'home' ? h(TasksAndHomePanel, { state }) : null)
    }

    // ---- conversation view: the home ----

    function HomeView() {
      const { state, error, reload } = useChara()
      const [frameKey, setFrameKey] = useState(0)
      const [refreshing, setRefreshing] = useState(false)
      const [flash, setFlash] = useFlash()
      const refresh = () => {
        setRefreshing(true)
        reload().finally(() => { setFrameKey(k => k + 1); setRefreshing(false) })
      }
      if (!state) {
        return h('div', { 'data-chara-home': '' },
          h('p', { 'data-chara-loading': '' }, error ? null : h(Spinner), error || T('正在读取…', 'Loading…')))
      }
      const line = lifeLine(state.life)
      const active = state.tasks.active || []
      return h('div', { 'data-chara-home': '' },
        h('div', { 'data-chara-bar': '' },
          h(Avatar, { size: 28 }),
          h('strong', null, state.persona.name),
          h(Status, { state: line.state }, line.text),
          h('span', { 'data-chara-spacer': '' }),
          flash.text ? h('span', { 'data-chara-note': flash.kind, 'data-chara-inline-note': '' }, flash.text) : null,
          h(WakeButton, { variant: 'ghost', onFlash: setFlash }),
          h(Button, { variant: 'ghost', icon: 'refresh', busy: refreshing, onClick: refresh }, T('刷新', 'Refresh')),
          h('a', { 'data-chara-btn': 'ghost', href: state.siteUrl, target: '_blank', rel: 'noopener noreferrer' },
            h(Icon, { name: 'open' }), T('新窗口打开', 'Open in new window'))),
        active.length
          ? h('div', { 'data-chara-strip': '' },
            h('span', null, T('在做', 'Working on')),
            active.map(t => h('span', { key: t.id, 'data-chara-chip': '' }, t.content)))
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
[data-chara-root],[data-chara-home]{--chara-fill:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2))}
[data-chara-root]{display:flex;flex-direction:column;gap:14px;max-width:720px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
[data-chara-hero]{display:flex;align-items:center;gap:14px;padding:4px 0 2px}
[data-chara-hero-text]{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
[data-chara-hero] h2{margin:0;font-size:18px;line-height:26px;font-weight:600}
[data-chara-hero] p{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
[data-chara-avatar]{border-radius:50%;flex:none;object-fit:cover;background:var(--chara-fill);box-shadow:0 0 0 0.5px var(--dsw-alias-border-l3)}
[data-chara-status]{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
[data-chara-dot]{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary,var(--dsw-alias-label-tertiary))}
[data-chara-dot="on"]{background:var(--dsw-alias-state-success-primary)}
[data-chara-dot="wait"]{background:var(--dsw-alias-state-warn-primary)}
[data-chara-dot="error"]{background:var(--dsw-alias-state-error-primary)}
[data-chara-tabs]{display:flex;gap:2px;padding:2px;border-radius:calc(var(--dsw-radius-md,8px) + 2px);background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2));align-self:flex-start}
[data-chara-tab]{height:30px;padding:0 14px;border:0.5px solid transparent;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}
[data-chara-tab]:hover{color:var(--dsw-alias-label-primary)}
[data-chara-tab][aria-selected="true"]{background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary);font-weight:500}
[data-chara-panel]{display:flex;flex-direction:column}
[data-chara-intro]{margin:0 0 4px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
[data-chara-row]{padding:14px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2)}
[data-chara-row]:last-child{border-bottom:none}
[data-chara-row-main]{display:flex;align-items:center;gap:12px}
[data-chara-row-text]{flex:1;min-width:0}
[data-chara-row-title]{font-size:14px;line-height:22px;font-weight:500}
[data-chara-row-hint]{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
[data-chara-row-control]{flex:none;display:flex;align-items:center;gap:8px}
[data-chara-inline]{display:inline-flex;align-items:center;gap:8px}
[data-chara-spacer]{flex:1}
[data-chara-btn]{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:28px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer;text-decoration:none;white-space:nowrap}
[data-chara-btn]:disabled{opacity:.4;cursor:not-allowed}
[data-chara-btn="primary"]{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff)}
[data-chara-btn="primary"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}
[data-chara-btn="outline"]{box-shadow:inset 0 0 0 0.5px var(--dsw-alias-border-l3)}
[data-chara-btn="outline"]:hover:not(:disabled),[data-chara-btn="ghost"]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
[data-chara-btn="ghost"]:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
[data-chara-icon]{flex:none}
[data-chara-switch]{box-sizing:border-box;position:relative;flex:none;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}
[data-chara-switch][aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
[data-chara-switch]:disabled{cursor:default;opacity:.5}
[data-chara-thumb]{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb,#fff);transition:transform 120ms ease}
[data-chara-switch][aria-checked="true"] [data-chara-thumb]{transform:translateX(16px);background:var(--dsw-alias-label-primary-foreground,#fff)}
[data-chara-switch]:focus-visible,[data-chara-btn]:focus-visible,[data-chara-tab]:focus-visible,[data-chara-choice]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));outline-offset:2px}
[data-chara-choices]{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px}
[data-chara-choice]{height:28px;padding:0 12px;border:none;border-radius:999px;background:var(--chara-fill);color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
[data-chara-choice]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
[data-chara-choice][aria-pressed="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill,var(--dsw-alias-bg-layer-3));box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border,var(--dsw-alias-border-l3))}
[data-chara-custom]{display:inline-flex;align-items:center;gap:6px;margin-left:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}
[data-chara-number]{box-sizing:border-box;width:72px;height:28px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px}
[data-chara-custom="active"] [data-chara-number]{border-color:var(--dsw-alias-brand-primary)}
[data-chara-badge]{display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;border-radius:9px;color:#fff;font-size:14px;font-weight:600}
[data-chara-badge="weixin"]{background:#07c160}
[data-chara-badge="telegram"]{background:#2aabee}
[data-chara-badge="qq"]{background:#1e9bf0}
[data-chara-fields]{display:grid;gap:10px;margin:12px 0 0 44px;padding:12px;border-radius:var(--dsw-radius-md,8px);background:var(--chara-fill)}
[data-chara-field]{display:flex;flex-direction:column;gap:4px}
[data-chara-field-label]{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}
[data-chara-field-hint]{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
[data-chara-input]{box-sizing:border-box;width:100%;max-width:440px;height:32px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}
[data-chara-input]:focus,[data-chara-number]:focus,[data-chara-editor]:focus{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));outline:none}
[data-chara-input]::placeholder{color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-tertiary))}
[data-chara-row] > [data-chara-input]{margin-top:10px}
[data-chara-qr]{display:flex;align-items:center;gap:16px;margin:12px 0 0 44px;padding:14px;border-radius:var(--dsw-radius-md,8px);background:var(--chara-fill)}
[data-chara-qr] img{width:168px;height:168px;flex:none;padding:8px;border-radius:8px;background:#fff}
[data-chara-qr] p{margin:0 0 8px}
[data-chara-qr-title]{font-size:14px;font-weight:500}
[data-chara-savebar]{position:sticky;bottom:0;display:flex;align-items:center;gap:8px;margin-top:8px;padding:10px 12px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));box-shadow:0 0 0 0.5px var(--dsw-alias-border-l3),0 4px 16px rgba(0,0,0,.08);font-size:13px}
[data-chara-savebar] > span{flex:1;color:var(--dsw-alias-label-secondary)}
[data-chara-editor]{box-sizing:border-box;width:100%;min-height:340px;padding:12px 14px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:13px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;resize:vertical}
[data-chara-editor-foot]{display:flex;align-items:center;gap:8px;margin-top:10px}
[data-chara-editor-foot] [data-chara-row-hint]{margin:0}
[data-chara-subhead]{display:flex;align-items:center;gap:6px;margin:6px 0 8px;font-size:13px;line-height:20px;font-weight:600}
[data-chara-subhead]:not(:first-child){margin-top:22px}
[data-chara-count]{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--chara-fill);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;text-align:center;font-weight:500}
[data-chara-tasks]{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
[data-chara-tasks] li{display:flex;align-items:baseline;gap:10px;padding:8px 12px;border-radius:var(--dsw-radius-md,8px);background:var(--chara-fill);font-size:13px;line-height:20px}
[data-chara-tasks="done"] li{background:transparent;color:var(--dsw-alias-label-tertiary);padding:4px 12px}
[data-chara-task-id]{flex:none;font:11px/18px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-tertiary)}
[data-chara-done]{margin-top:8px}
[data-chara-done] summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
[data-chara-empty]{margin:0;padding:12px;border-radius:var(--dsw-radius-md,8px);background:var(--chara-fill);color:var(--dsw-alias-label-tertiary);font-size:13px}
[data-chara-path]{font:12px/18px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;color:var(--dsw-alias-label-secondary)}
[data-chara-note]{margin:6px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
[data-chara-note="ok"]{color:var(--dsw-alias-state-success-primary)}
[data-chara-note="warn"]{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}
[data-chara-note="info"]{color:var(--dsw-alias-label-secondary)}
[data-chara-inline-note]{margin:0}
[data-chara-loading]{display:flex;align-items:center;gap:8px;margin:0;padding:12px 0;font-size:13px;color:var(--dsw-alias-label-secondary)}
[data-chara-home]{display:flex;flex-direction:column;height:100%;min-height:480px;color:var(--dsw-alias-label-primary);font-size:14px}
[data-chara-home] > [data-chara-loading]{padding:16px}
[data-chara-bar]{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}
[data-chara-bar] strong{font-size:14px;font-weight:600;margin-right:2px}
[data-chara-strip]{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-label-tertiary)}
[data-chara-chip]{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;background:var(--chara-fill);color:var(--dsw-alias-label-secondary)}
[data-chara-frame]{flex:1;width:100%;border:0;background:#fff}
[data-chara-spin]{width:10px;height:10px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;flex:none;animation:chara-spin .8s linear infinite}
@keyframes chara-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){[data-chara-thumb]{transition:none}[data-chara-spin]{animation-duration:2s}}
@media (max-width:560px){[data-chara-hero]{flex-wrap:wrap}[data-chara-fields],[data-chara-qr]{margin-left:0}[data-chara-qr]{flex-direction:column;align-items:flex-start}[data-chara-bar]{flex-wrap:wrap}}
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
