# GOAL — dsh-chara v0.1：让大肥鱼住进 DSH

> 写于 2026-10-25，作为 v0.1 的目标与验收标准。做完一条勾一条；勾掉的每一条都必须在云端用真实的 DSH 跑过，不靠推断。

## 一句话

装上 `dsh-chara`、重启 DSH 之后，DSH 里就有一个「大肥鱼」会话，它像 OpenCharaAgent 里的 chara 一样活着：有稳定的人格、自己的理想和任务、到点自己醒来做事、维护自己的家（网站和日记），你随时可以在 DSH 里点开它的家看看。

## 设计原则

1. **DSH 是主体，我们是寄生上去的补丁。** 能用 DSH 原生机制的一律用原生机制，不搬 OpenCharaAgent 的 harness：
   - 大肥鱼 = 一个 **agent preset**（DSH 原生的「模式」），由插件的 bundle patch 插入；
   - 人格：preset 里用 `dsh-chara/agent` 顶替 `dsh-persona` 行，在本会话范围内遮蔽 `deployment:persona-prefix` 段，内容来自用户可编辑的 `soul.md`；
   - 文件、终端、联网、技能、定时任务（`tool-schedule`）、`/goal`、压缩，全部沿用 DSH 标准 preset 的组件。
2. **只补 DSH 没有的：** 稳定人格文件、理想 + 任务、自主生命循环、家（网站 + 日记）以及在 DSH 里浏览它的入口。
3. **回合在 DSH 进程内跑。** 自主唤醒是 DSH 定时任务服务（`ctx.schedule`）投递给大肥鱼会话的一条一次性定时消息，不起单独的 headless 进程。这样别的插件（例如 `dsh-dafeiyu` 桌宠，它监听 `session/event`）能自动看到大肥鱼在忙，不需要任何额外对接。
4. **中立与尊重**（继承 OpenCharaAgent）：给大肥鱼的引导是"怎么用工具、怎么用空闲时间"的建议，不是命令；人格由用户拥有。
5. **不做静默降级。** 做不到的事给出可见的错误或日志，不假装成功。

## 验收标准（v0.1）

- [x] **A1 安装：** `dsh plugin --profile web add <本仓库>` 后重启，启动日志无插件报错，模式列表里出现「大肥鱼」。
- [x] **A2 大肥鱼会话：** 首次启动时自动建好一个标题为「大肥鱼」的会话（preset = 大肥鱼，工作目录 = 大肥鱼的家），之后重启不重复创建。
- [x] **A3 人格：**
  - 大肥鱼会话的系统提示词以 `soul.md` 为身份；
  - 用户改了 `soul.md`，下一轮生效；
  - 其他会话（标准模式等）完全不受影响。
- [x] **A4 理想与任务：**
  - 理想：用户拥有，大肥鱼只读，写在家里的文件中；
  - 任务：大肥鱼自己的长期事务，可以新建、修改、完成，完成即封存；
  - 两者每轮渲染进上下文。
- [x] **A5 自主生命循环：**
  - 自主开着时，大肥鱼空闲满 `patience` 后自动醒来跑一轮（这一轮以 schedule 来源进入会话）；
  - 它可以用 `rest` 自己决定下次什么时候醒；
  - 用户正在对话时不打断；关掉自主就停；
  - 这些回合在 DSH 里能看到，`dsh-dafeiyu` 也能感知到。
- [x] **A6 家：**
  - 家目录里有网站脚手架（`site/index.html`）和日记（`diary/`），大肥鱼用 DSH 的文件工具维护；
  - 大肥鱼会话里有一个「小窝」标签页，用沙箱 iframe 浏览它的网站；
  - 提供页面的 HTTP 路由只读、限定在家目录、CSP 加固（禁止发请求、禁止提交表单）。
- [x] **A7 设置页：** 设置里有「大肥鱼」一页，内容包括：
  - 自主开关、`patience`；
  - 查看/编辑人格与理想；
  - 显示家目录在哪。
- [x] **A8 测试：**
  - `node --test` 单元测试全绿；
  - 云端端到端脚本：用隔离的 `DSH_HOME` 安装插件，启动 web profile，用 DSH 自带的回放模型（或本地 mock 模型）驱动一轮自主唤醒，截图验证 A2/A3/A5/A6。

## 范围外（v0.1 不做）

- 生图、读图（DeepSeek 已原生读图；生图要配 key。`soul.md` 里写明：需要时自己向用户要）。
- 搬运 OpenCharaAgent 的 harness。
- 跨会话记忆（类似 Codex memory）：先进 roadmap，评估社区记忆插件后再决定是自建还是接入。
- 自定义新人格和人格管理：先进 roadmap，先把大肥鱼做好。
- QQ / 微信等网关、浏览器自动化：优先接社区已有插件，进 roadmap。

## 美术素材立场

查证结果（2026-10-25 修订）：

- **DeepSeek 官方的鲸鱼标志**：DeepSeek Harness 仓库以 MIT 开源，Copyright (c) 2026 DeepSeek。鲸鱼轮廓 `FISH_LOGO_PATH` 在 `ui-primitives/src/FishLogo.tsx` 里公开导出，已发布的 `@deepseek-ai/dsh-web-frontend` 也带着它。版权上可以用，但它也是商标，MIT 不授权商标，要按 DSH 的《品牌素材使用规范》来：不让人误以为是官方出品或官方背书。
- **社区二次元「大肥鱼 / 鲸鱼娘」**：xiaoweigen/deepseek-dafeiyu-assets、「鲸鱼娘·明月」等是 CC BY-NC-SA，不能商用；dsh-dafeiyu 早期的 BigFish 帧已归档，注明不在 MIT 范围内。
- **`PC2005-cloud/dsh-pet` 的「鲸尾女仆」动画**：MIT，dsh-dafeiyu 现在用的就是它。

因此：

- 头像用官方鲸鱼标志：MIT 路径 + 浅色圆底 + 品牌蓝，NOTICE.md 里附上 MIT 全文和商标说明；
- 不打包社区的二次元素材；
- 动态形象交给用户另装的 `dsh-dafeiyu`（MIT 素材），两者通过 `session/event` 天然联动。

本插件是非官方的同人项目，与 DeepSeek 无关联，也未获其背书。

## 验收记录（2026-10-25，DSH 0.2.1-rc.2，云端 Linux，web profile）

模型都用 `scripts/e2e/mock-llm.mjs` 这个脚本化 mock：它走 DSH 自带的 pi-ai 适配器，DSH 跑的是真实的回合，所以能断言模型实际收到的内容。端到端脚本 `npm run e2e` 每次跑 45 项检查，下面标「e2e」的条目由它覆盖；最后一次运行 45/45 通过。

- **A1**
  - e2e：`--dump-config` 里有 `chara` 行和 `preset-chara-dafeiyu` 行；两次启动的输出都没有 error / warn。
  - 截图：设置 → Agent 预设 →「自定义」下面有「大肥鱼」。
- **A2**
  - e2e：会话标题是「大肥鱼」，会话头里 `agentPreset` = `dafeiyu`，`cwd` 指向大肥鱼的家，已置顶，所在工作区叫「大肥鱼的家」；重启后仍是同一个会话。
  - 手测：Web 端会把空白会话改成默认 preset，插件会把它改回来，并做了三种情况的回归。
    - 旧的、已被锁定的会话：自动换一个新会话；
    - 正常启动；
    - 竞态：8 ms 内纠正。
- **A3**
  - e2e：系统提示词里有 soul，没有 coding 人设；改完 soul 后的下一轮就带上了改动。
  - 手测：
    - 新开的标准模式会话仍是 coding 人设，没有 soul、生活规则和 `chara_*` 工具，`ask_user_question` 还在；
    - 大肥鱼试图写 `../soul/soul.md`，被 DSH 沙箱拒绝。
- **A4**
  - e2e：首次醒来时调了 `chara_task add`，`tasks.json` 里有这条任务；运行时上下文里带着理想。
  - 单元测试：12 条上限、完成即封存、渲染。
- **A5**
  - e2e：
    - 首次醒来由 DSH 的定时任务投递；
    - `chara_rest(90)` 把下次醒来定在 90 分钟后，之后恢复 patience（60 分钟）；
    - 关掉自由时间后没有待醒任务，打开后又有，patience 45 分钟生效；
    - `/wake` 能按需叫醒；
    - 重启后保留同一个待醒任务，不会多醒一次。
  - 单元测试：每轮结束重新计时，所以聊天时不会被打断。
  - 回放：用 QCYTSN/dsh-dafeiyu 自己的 `CompanionReducer` 回放真实的大肥鱼会话，产生了 THINKING、WORKING 和 SUCCESS 信号。
- **A6**
  - e2e：
    - 网站带 `sandbox allow-scripts` 和 `connect-src 'none'` 的 CSP；
    - `%2e%2e` 路径穿越返回 404；
    - 错误的 token 拿不到内容；
    - 大肥鱼在自由时间里用 read → write 重写了 `site/index.html`，网站随即更新。
  - 截图：「大肥鱼的小窝」标签页（`docs/home.png`）。
- **A7**
  - 截图：设置 → 大肥鱼（`docs/settings.png`）。
  - e2e 走同一套 API，检查了：
    - 没登录返回 401；
    - 跨源 POST 被拒且没有改动任何东西；
    - 空人格被拒；
    - 人格保存成功。
- **A8**
  - `npm test`：40 项通过；
  - `npm run e2e`：45/45；
  - CI（`.github/workflows/ci.yml`）在 Node 22 和 24 上跑语法检查、清单检查和单元测试。

**没验证的：** DSH 桌面版（它的 profile 由 Electron 应用管理，云端跑不起来）；真实 DeepSeek 模型上的长期运行表现。
