# 共享 Base 归位与 Vault 说明文档

本轮由 Codex Only 实施，未调用外部 Worker；沿用 `codex/obsidian-integration`，保留全部既有未提交改动。浏览器代码、桥接协议和播放行为未修改。

## 已交付

- 插件 0.1.12：新建 Playlist 的嵌入路径为 `<root>/<playlists>/_records/Playlist Videos.base`。
- 同目录首次初始化创建 README.md，说明总览、主笔记、身份、成员关系、共享 Base 的 this 上下文、顺序、属性编辑及目录维护。说明没有 TSNotes 身份，不进入 Playlist 总览；已有说明不覆盖。
- 旧 Vault 若尚未移动共享 Base，且新路径缺失，初始化明确提示先用 Obsidian 移动原文件，避免新默认文件掩盖原有自定义视图。

## Math Peng 实际操作

原文件 `TSNotes/_data/views/Playlist Videos.base` 已通过 Obsidian 原生 FileManager 移至 `TSNotes/Playlists/_records/Playlist Videos.base`。三个正式 Playlist 及 `TSNotes QA Retained/Library layout 20261022/Playlist.md` 共四处引用已更新为完整新路径。原生重命名先将引用自动简化为文件名；确认仅此差异后，统一为完整路径，保留其他内容。

移动前备份 108 个文件，位置为 `~/Library/Application Support/TSNotes Bridge Peng/deployment-backups/shared-base-20261023-ph5b5nan/`；含旧运行产物、配置、全部相关视频/Playlist、Base、关系 JSON 和测试引用笔记。备份内容权限 0600，根目录 0700。baseline.json 和 verification.json 记录操作范围及校验结果；不改写上一轮迁移日志。

最终核对：共享 Base 字节与原文件相同；四篇笔记仅引用路径变化；其他视频、Playlist Properties、关系 JSON、已有总览及 data.json 不变，unexpectedChanges=[]。原文件不存在；旧 `_data/views` 空目录保留，未调用会触发第三方 Enhanced Canvas 文件夹异常的清理操作。`_data/playlists` 仍保存正式关系数据。

## 检查与部署

- Node 24：typecheck、32 项测试、build、git diff --check 通过。新增覆盖新嵌入路径、可配置目录、README 创建及保留用户补充、旧 Base 保护。
- 仅 Math Peng 部署 0.1.12 的 main.js / manifest.json，安装字节与源码产物一致，data.json 保持不变；Obsidian AI Coding 未更新。
- 两次 targeted reload 后，Base 和 README 哈希保持一致，旧路径未再生成文件。实际运行版本 0.1.12，正式 Playlist 数仍为 3，README 未进入记录索引。
- 元数据解析到新 Base 的引用为 5（四篇原有笔记及新增 README 导航），旧 Base 引用为 0。
- README 在原生阅读视图打开，正确渲染 7 个标题、3 个代码块；说明文档保留在界面中。没有浏览器操作或新增视频记录。
- dev:errors 保留以前的 Enhanced Canvas 及 Advanced Canvas 异常，不将其当成本轮错误；未修改或禁用其他插件。

本轮未提交、合并、推送或发布；未重跑与这次路径和文档变更无关的浏览器压力测试。
