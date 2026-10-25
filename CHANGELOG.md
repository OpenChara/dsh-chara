# Changelog

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
