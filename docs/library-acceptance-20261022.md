# 紧凑保存按钮与统一视频库：实施及验收记录

配套版本：TSNotes 0.8.12 / TSNotes Bridge Peng 0.1.11；桥接能力保持 1.1。两仓库继续使用 `codex/obsidian-integration`，保留既有未提交改动；未提交、合并、推送或发布。

## 已实现

- 三站共用保存控件改为 14px bookmark-plus SVG、简短目标名称和 24px 下拉区；完整目标保留在 tooltip、无障碍名称及结果提示。保存时替换旋转图标，保持目标标签。Notion、任务固定目标与 Vault 路由不变。
- 新视频集中创建于 Videos/_records，新 Playlist 索引创建于 Playlists/_records。索引首次创建时嵌入共享 Base；重复保存不重写正文。
- 三个原生 Base：视频总览（四种视图）、Playlist 总览、按嵌入笔记身份及有序 Videos 链接展示成员的共享视图。范围依据身份而非目录；初始化只创建缺失文件，保留已有 Base。
- 本地迁移预览、精确摘要确认、私有备份及步骤日志、维护期间保存阻止、恢复与回滚；原生文件移动、受控关系修复和空目录 Trash。未知中间步骤、后续编辑、重复身份或损坏备份均停止自动操作。

## 正式检查

- TSNotes：Node 24.22.0，`npm run check:local` 全链及 `git diff --check` 通过。正式链包含目标菜单与既有 Notion 契约回归；没有真实 Notion 写入。
- Obsidian：`npm run typecheck`、31 项测试、`npm run build`、`git diff --check` 通过。迁移、恢复、回滚、用户正文保留、目录外引用范围、损坏备份与自定义 Base 保留由行为测试验证。
- 浏览器轻量外壳构建预算保持原阈值；未放宽性能检查。

## 真实环境

| 动作 | 观察结果及边界 |
| --- | --- |
| Ego 原生 Reload / 运行版本核实 | 扩展 ID nagociaencjilbfmecokdpclndofiihl，加载 TSNotes/dist；运行 0.8.12，出现新的紧凑控件 |
| YouTube 紧凑按钮 | Math Peng + SVG + 箭头，实测整体约 125px；完整提示为 Save to Obsidian · Math Peng |
| 菜单展开 | 显示 Notion、两个 Vault 及管理入口；菜单在视口范围内 |
| 菜单选项操作 | 自动化点击未完成，选项在点击前消失；没有确认配置变更。不将此情况定为已修复或完整菜单通过 |
| Math Peng 视频总览 | 原生 Base 正常聚合现有记录 |
| Playlist 共享视图 | 明确命名的 QA Playlist 在阅读视图中显示 B、A 两条视频，List order 为 1、2，与 Videos 链接顺序一致 |
| 两 Vault 部署 | 0.1.11 运行产物与源码字节一致；只复制 main.js、manifest.json，data.json 校验值不变；均已 targeted reload |
| 数据保护 | Math Peng 的原 95 篇视频及 3 篇 Playlist 与先前预览 SHA-256 一致，尚未移动或修改 |

Math Peng 本轮新增三篇测试记录及一份关系 JSON，位于 `TSNotes QA Retained/Library layout 20261022/`。它们与真实资料独立，保留供复核。两个 Vault 均已创建缺失的三份 Base。Math Peng Videos.base 经原生应用规范化后与模板文本不同，普通保存和重新加载均保留该文件。

最终部署备份：`~/Library/Application Support/TSNotes Bridge Peng/deployment-backups/compact-library-20261022-205340/`，包含两个 Vault 的旧运行产物及配置快照。迁移备份仅在确认后执行时产生；预览不是已完成迁移的证明。

Math Peng 重载后未捕获错误。Obsidian AI Coding 的错误记录含既有 Iconic 插件异常（20:26:32，updateUnsyncedFiles）；未归因为本插件，也未更改或禁用该插件。

## 迁移预览与待确认项

清单 ID：3edc4fad-8551-4f65-aefa-d9c8ed67fdca。

摘要：`221b96293b5aefa9656bbe45325ed3a7b967a111380ac5cc994063b605c31b99`。

预览列出 95 篇视频及 3 篇 Playlist，共 98 次移动；无身份或文件名冲突，无受影响的目录外笔记。清单保存在本机 Application Support/TSNotes Bridge Peng/migrations/ff382f3f-1bf4-4463-a5e2-c1ffb098b241/，文件名为该清单 ID 加 `.preview.md` / `.preview.json`。

### 用户确认后的实际迁移（2026-10-22）

用户已明确确认上述清单及摘要。执行前 203 个路径校验值全部匹配，配置相同，受影响编辑器没有未保存内容。通过已安装插件的维护入口执行，迁移日志最终为 complete、98/98、pending=null。

- 实际目标目录包含 95 篇视频和 3 篇 Playlist，原路径均已移除；98 个 UUID 与身份索引定位一致。
- 逐篇比较迁移前备份：95 篇视频正文完全相同；除受管 Videos / Playlists 内链外的全部基础 Properties 保持一致；三篇 Playlist 保留原正文并加入固定 Base 嵌入。
- 三份关系 JSON、三份 Base、插件配置共 7 个受保护文件字节未变。三个 Playlist 的成员数、关系成员数及已解析新路径链接数分别一致为 35、14、44；有序链接与关系文件顺序一致。
- 三个旧 Playlist 目录经确认完全为空后由原生 Trash 操作移除。备份日志包含 105 个原有文件的完整内容，目录 0700、文件 0600；另有同 ID 的 `.verification.json`，problems=[]。维护状态已释放。
- 真实 MIT Playlist 的阅读视图显示共享 Base、35 results；可见错误区域隐藏且无错误文本。未点击播放入口，也未据此宣称浏览器播放已验收。

迁移核对后的最终检查发现 Playlists.base 已被原生界面保存为 YAML，并将视图中的 note 属性引用规范化为简写；解析并规范化后，与备份的筛选、公式、视图设置完全等价，已保留现状。记录本身无后续变化。由于该 Base 的字节与迁移完成时不同，现有回滚机制会按设计先停止并要求核对这次后续变更，不会覆盖它。

清理空目录触发 Enhanced Canvas 第三方插件的三个异步异常：其 trashFile 包装器将 TFolder 当作 TFile，向 escapeRegExp 传入不存在的 basename。源码定位于该插件 main.js:1614 / 1673；原生 Trash 仍正常执行，迁移及逐项完整性核对通过。未修改、禁用该插件或忽略数据校验失败。

恢复日志：`~/Library/Application Support/TSNotes Bridge Peng/migrations/ff382f3f-1bf4-4463-a5e2-c1ffb098b241/3edc4fad-8551-4f65-aefa-d9c8ed67fdca.journal.json`。可通过插件回滚命令核对后恢复；之后如有新修改或路径冲突，自动回滚会停止，避免覆盖新内容。

## 浏览器控制与未验证范围

本轮唯一替代 Space：3，TSNotes compact library QA。最后有效页面包括 p1 扩展详情、p3 配对页、p4 YouTube Homebrew；未主动 handOff 或 finish。随后实时 `listTaskSpaces()` 返回空列表，Space 3 不再存在；按技能停止所有浏览器操作，未另建 Space。历史 agent ownership 不代表当前仍有控制权，当前页面保留状态无法确认。

剩余真实验收：菜单选项切换及键盘路径、Bilibili/百度网盘新控件、Base 播放入口和迁移后播放核对。真实迁移及成员、内链核对已按上述记录完成。Tabbit 仍由用户测试。本轮未做压力测试，也未将源码检查或无崩溃等同于这些真实场景通过。
