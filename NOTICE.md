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

本仓库**不包含**任何社区「大肥鱼」形象素材。

- `personas/dafeiyu/avatar.svg`（以及复制到 `site/` 的那份）是为本项目原创的
  简笔鲸鱼，不仿照任何商标图形，随本项目以 Apache-2.0 发布。
- 社区里流传的「大肥鱼」帧动画素材权利不清。QCYTSN/dsh-dafeiyu 已经把它们
  归档到 `legacy/`，并注明不受其 MIT 代码许可覆盖，所以我们不使用它们。
- 想要动态形象，可以另外安装 QCYTSN/dsh-dafeiyu。它现在运行时用的是来自
  PC2005-cloud/dsh-pet 的 MIT 素材，并且能自动感知大肥鱼的回合。

This repository bundles **no** community 「大肥鱼」 artwork. The avatar is an
original line-art whale drawn for this project (Apache-2.0). The community
frame sets have unclear rights, and QCYTSN/dsh-dafeiyu itself has archived them
as not covered by its MIT code license, so they are not used here. For an
animated companion, install QCYTSN/dsh-dafeiyu separately: its runtime frames
come from PC2005-cloud/dsh-pet under MIT, and it follows 大肥鱼's turns on its
own.

## 来源 · Provenance

- 人格文本（`personas/dafeiyu/*.md`）、网站初始内容和插件代码都为本项目原创。
- 设计（理想 → 任务 → todo 三层目标、patience / rest 作息、个人网站模块、
  中立的生活规则）移植自 OpenChara/OpenCharaAgent（Apache-2.0），只改写成
  DSH 插件的形态，没有搬运它的 harness。
- 插件的结构（bundle patch、agent preset、client 注入）遵循 DSH 0.2.1-rc.2 的
  公开插件约定。不引入任何 `@deepseek-ai/*` 包，DSH 的服务全部通过 Cordis
  上下文获得。

- The persona text, the website seed and the plugin code are original to this
  project.
- The design (the aspiration → task → todo goal model, the patience/rest rhythm,
  the personal-website module, the neutral life rules) is ported from
  OpenChara/OpenCharaAgent (Apache-2.0), reshaped as a DSH plugin, without
  porting its harness.
- The plugin follows DSH 0.2.1-rc.2's public plugin conventions and imports no
  `@deepseek-ai/*` package; every DSH service comes through the Cordis context.
