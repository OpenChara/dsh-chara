# NOTICE

dsh-chara
Copyright 2026 OpenChara contributors
Licensed under the Apache License, Version 2.0 (see LICENSE).

## 非官方 · Unofficial

本项目是社区同人插件，与 DeepSeek（深度求索）无关联，也未获其认可或背书。
"DeepSeek"、"DeepSeek Harness"、"DSH" 及相关名称和标识归其各自权利人所有，
本项目只在描述兼容性时提及它们。

This is a community fan plugin. It is not affiliated with, approved or endorsed
by DeepSeek. "DeepSeek", "DeepSeek Harness", "DSH" and related names and marks
belong to their respective owners and are mentioned only to describe
compatibility.

## 美术素材 · Artwork

大肥鱼的头像用的是 DeepSeek 官方的鲸鱼标志，来源是 DeepSeek Harness 的 MIT 开源代码：

- 鲸鱼轮廓是 DSH 仓库 `packages/client/ui-primitives/src/FishLogo.tsx` 里公开导出的
  `FISH_LOGO_PATH`（已发布的 `@deepseek-ai/dsh-web-frontend` 中也有），
  Copyright (c) 2026 DeepSeek，以 MIT 许可发布，许可全文见下。
  `personas/dafeiyu/avatar.svg`（以及复制到 `site/` 的那份）只在它外面加了一个
  浅色圆底，并按品牌蓝 `#4d6bfe` 上色。
- 鲸鱼标志同时是 DeepSeek 的品牌标识，MIT 许可不包含商标授权。我们按
  DSH 的《品牌素材使用规范》使用它：只用来表示「住在 DSH 里的大肥鱼」，并
  始终注明本项目非官方、未获 DeepSeek 背书。若 DeepSeek 提出异议，我们会换掉它。
- 社区的二次元「大肥鱼 / 鲸鱼娘」形象（例如 xiaoweigen/deepseek-dafeiyu-assets、
  dsh-dafeiyu 归档的 BigFish 帧）多为 CC BY-NC-SA 或权利不清，不可商用，
  本仓库不使用。
- 想要会动的形象，可以另外安装 QCYTSN/dsh-dafeiyu：它运行时用的是来自
  PC2005-cloud/dsh-pet 的 MIT 素材，并能自动感知大肥鱼的回合。

The 大肥鱼 avatar uses DeepSeek's official whale mark as published in DeepSeek
Harness's MIT-licensed source: the outline is `FISH_LOGO_PATH`, exported from
`packages/client/ui-primitives/src/FishLogo.tsx` (and shipped in the published
`@deepseek-ai/dsh-web-frontend`), Copyright (c) 2026 DeepSeek, under the MIT
License reproduced below. `personas/dafeiyu/avatar.svg` only adds a light round
backdrop and the brand blue `#4d6bfe`. The whale is also DeepSeek's brand mark,
and the MIT License grants no trademark rights: we use it under DSH's brand
guidelines, only to say "the 大肥鱼 who lives in DSH", always labelled as an
unofficial project without DeepSeek's endorsement, and we will replace it if
DeepSeek objects. Community anime-style 大肥鱼 / whale-girl artwork (mostly
CC BY-NC-SA, or of unclear rights) is not used. For an animated companion,
install QCYTSN/dsh-dafeiyu separately (its runtime frames come from
PC2005-cloud/dsh-pet under MIT).

### DeepSeek Harness — MIT License

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 来源 · Provenance

- 人格文本（`personas/dafeiyu/*.md`）、网站初始内容和插件代码都为本项目原创；头像见上。
- 设计（理想 → 任务 → todo 三层目标、patience / rest 作息、个人网站模块、
  中立的生活规则）移植自 OpenChara/OpenCharaAgent（Apache-2.0），只改写成
  DSH 插件的形态，没有搬运它的 harness。
- 插件的结构（bundle patch、agent preset、client 注入）遵循 DSH 0.2.1-rc.2 的
  公开插件约定。不引入任何 `@deepseek-ai/*` 包，DSH 的服务全部通过 Cordis
  上下文获得。

- The persona text, the website seed and the plugin code are original to this
  project; for the avatar, see above.
- The design (the aspiration → task → todo goal model, the patience/rest rhythm,
  the personal-website module, the neutral life rules) is ported from
  OpenChara/OpenCharaAgent (Apache-2.0), reshaped as a DSH plugin, without
  porting its harness.
- The plugin follows DSH 0.2.1-rc.2's public plugin conventions and imports no
  `@deepseek-ai/*` package; every DSH service comes through the Cordis context.
