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

大肥鱼的头像 `personas/dafeiyu/avatar.png` 是社区鲸鱼娘形象，裁自
xiaoweigen/deepseek-dafeiyu-assets 的设定图，按 **CC BY-NC-SA 4.0** 授权，
**仅限非商业使用**。完整署名链（上善无形、ZipZipPipe、YunYueSama、
xiaoweigen）、修改记录和 YunYueSama 上游许可全文见
[`personas/dafeiyu/ART-LICENSE.md`](personas/dafeiyu/ART-LICENSE.md)。
这张图的许可只覆盖它自己，本仓库的代码和其他内容仍是 Apache-2.0。

想要会动的形象，可以另外安装 QCYTSN/dsh-dafeiyu：它运行时用的是来自
PC2005-cloud/dsh-pet 的素材，并能自动感知大肥鱼的回合。

The 大肥鱼 avatar, `personas/dafeiyu/avatar.png`, is the community whale-girl
character, cropped from xiaoweigen/deepseek-dafeiyu-assets and licensed
**CC BY-NC-SA 4.0, non-commercial use only**. The full attribution chain
(上善无形, ZipZipPipe, YunYueSama, xiaoweigen), the modification record and
YunYueSama's upstream license text are in
[`personas/dafeiyu/ART-LICENSE.md`](personas/dafeiyu/ART-LICENSE.md). That
license covers this image only; the code and everything else here remain
Apache-2.0.

## 来源 · Provenance

- 人格文本（`personas/dafeiyu/soul.md`、`aspiration.md`）、网站初始内容和插件代码都为本项目原创；头像见上。
- 设计（理想 → 任务 → todo 三层目标、patience / rest 作息、个人网站模块、
  中立的生活规则）移植自 OpenChara/OpenCharaAgent（Apache-2.0），只改写成
  DSH 插件的形态，没有搬运它的 harness。
- 消息网关（`src/gateway/`：微信 iLink、Telegram、QQ OneBot 适配器，访问控制、
  分段、静音过滤和中继）由 OpenCharaAgent 的 `chara/messaging/` 与
  `chara/server/messaging_host.py` 改写成 JavaScript，接到 DSH 的会话 API 上。
- 插件的结构（bundle patch、agent preset、client 注入）遵循 DSH 0.2.1-rc.2 的
  公开插件约定。不引入任何 `@deepseek-ai/*` 包，DSH 的服务全部通过 Cordis
  上下文获得。

- The persona text, the website seed and the plugin code are original to this
  project; for the avatar, see above.
- The design (the aspiration → task → todo goal model, the patience/rest rhythm,
  the personal-website module, the neutral life rules) is ported from
  OpenChara/OpenCharaAgent (Apache-2.0), reshaped as a DSH plugin, without
  porting its harness.
- The messaging gateway (`src/gateway/`: the WeChat iLink, Telegram and QQ
  OneBot adapters, access control, splitting, the silence filter and the relay)
  is OpenCharaAgent's `chara/messaging/` and `chara/server/messaging_host.py`
  rewritten in JavaScript on top of DSH's session API.
- The plugin follows DSH 0.2.1-rc.2's public plugin conventions and imports no
  `@deepseek-ai/*` package; every DSH service comes through the Cordis context.

## 第三方代码 · Third-party code

`src/vendor/qrcode-generator.mjs`：qrcode-generator 2.0.4（`dist/qrcode.mjs`，
原样收录），用来在本机生成微信登录二维码，不经过任何第三方二维码服务。
"QR Code" 是 DENSO WAVE INCORPORATED 的注册商标。

`src/vendor/qrcode-generator.mjs` is qrcode-generator 2.0.4 (`dist/qrcode.mjs`,
unmodified), used to draw the WeChat login QR code locally, without any
third-party QR image service. "QR Code" is a registered trademark of DENSO WAVE
INCORPORATED.

```
QR Code Generator for JavaScript
Copyright (c) 2009 Kazuhiko Arase
URL: http://www.d-project.com/
Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php

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
