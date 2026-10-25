# Changelog

## Unreleased

- 删掉「理想」：DSH 版里只有它自己选择的任务。`aspiration.md` 不再生成，也不再读；
  已有的文件会被保留但不再使用。The aspiration is gone from the DSH version.
- 界面重做，跟 DSH 自己的控件一致：设置页顶部是头像和状态，下面分作息、消息、
  人格、任务与家四页；开关、按钮、状态点、分隔线都用 DSH 的设计令牌，深浅色都对。
  小窝顶栏同步更新；大肥鱼的初始网站换了新样式。The UI follows DSH's own look.
- 消息网关（移植自 OpenCharaAgent）：在微信（ClawBot / iLink，设置里扫码登录）、
  Telegram、QQ（NapCat / Lagrange 的 OneBot）上都能找到大肥鱼。所有应用共用它
  的那一个会话，回复发回原处；新工具 `chara_speak` 让它主动找你；默认只认你本人，
  陌生人每天一次婉拒。设置 → 大肥鱼 → 消息网关。
  Messaging gateway (ported from OpenCharaAgent): WeChat, Telegram and QQ into
  the chara's one session, `chara_speak` to reach you, owner-only by default.
- 头像换成社区鲸鱼娘（裁自 xiaoweigen/deepseek-dafeiyu-assets 的 Q 版设定图，
  CC BY-NC-SA 4.0，仅限非商业使用），署名链和上游许可见
  `personas/dafeiyu/ART-LICENSE.md`；代码仍是 Apache-2.0。
  The avatar is now the community whale-girl (CC BY-NC-SA 4.0, non-commercial).
- 头像由 `persona.json` 的 `avatar` 声明（PNG / SVG / JPEG / WebP），
  API 改为 `GET /api/chara/avatar`。

## 0.1.0 — 2026-10-25

第一版：大肥鱼住进 DSH。First release: 大肥鱼 moves into DSH.

- 「大肥鱼」agent preset（基于 DSH 0.2.1-rc.2 的标准 preset：人格换成 soul.md，
  去掉 plan 模式和 `ask_user_question`）；首次启动自动建好置顶的大肥鱼会话和
  「大肥鱼的家」工作区，重启后沿用；Web 端把空白会话改成默认 preset 时会被纠正。
- 人格 `soul.md` 与理想 `aspiration.md`：用户拥有，下一轮生效，大肥鱼改不了。
- 任务：`chara_task`（新建 / 修改 / 完成 / 删除 / 列出，最多 12 条，完成即封存）。
- 自由时间：DSH 定时任务驱动的作息（默认 60 分钟），`chara_rest` 让它自己定下次
  醒来的时间，可开关，可「现在叫醒它」，重启后保留下一次醒来。
- 家：个人网站 `site/`、日记 `diary/`、长期记忆 `MEMORY.md`；「大肥鱼的小窝」
  标签页用沙箱 iframe 浏览网站（只读、带 CSP、路径每次启动都变）。
- 设置 → 大肥鱼：自由时间、空闲时长、叫醒、人格和理想编辑、任务、家目录。
- 测试：单元测试（`npm test`）和真实 DSH 上的端到端测试（`npm run e2e`），
  端到端测试使用脚本化的 mock 模型。
