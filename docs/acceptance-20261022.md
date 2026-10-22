# TSNotes × Obsidian 验收记录（进行中）

当前源码：TSNotes 0.8.7 / TSNotes Bridge Peng 0.1.5；协议 1.0。

两仓库开发分支均为 `codex/obsidian-integration`。main 尚未合并，没有 push、发布或修改 NotionImporter。配置凭据不进入本记录。

## 已完成的源码验证

- Node 24.22.0：TSNotes `npm run check:local` 全链通过，包含新加入的启动 URL、Obsidian 集成和冷唤醒检查。
- 插件 `npm run typecheck`、`npm test`、`npm run build`、`git diff --check` 通过；13 个行为用例。
- 1,000 条合成索引记录、500 项列表、最多 3 个并发、200 次连接开闭、取消、绑定原 Vault 重试、重复 UUID、Bilibili 分 P、身份冲突、预览变更和关系文件丢失均有自动化覆盖。
- 新增协议没有正文写入、任意文件操作、eval 或删除接口。
- 原 Notion 正式检查链保持通过；外部 save-to-notion 显式保留 Notion 目标。未对真实 Notion 页面执行写入测试。

## 真实环境与已观察结果

测试 Vault：Math Peng；Obsidian 1.14.4。仅部署运行产物，部署前备份，data.json 保留。Ego 扩展实际 ID：`nagociaencjilbfmecokdpclndofiihl`，实际加载路径为 TSNotes/dist；按批原生 Reload。

| 动作 | 实际结果 | 范围 |
| --- | --- | --- |
| 原生应用 URL 打开探针 | 落入安装该 TSNotes 实例的同一 Ego Profile | 已核实 |
| YouTube 首次保存 | 创建 Title、Creator、Duration、URL-TSNotes、身份字段；正文为空 | 真实网页按钮 |
| 百度网盘保存 | 中文和空格路径成功；创建 Playlist 索引和视频 Markdown；File ID 为文本 | 真实网页按钮 |
| Bilibili 保存 | 普通视频、第 1 / 2 分 P 分别保存，第 1 / 2 分 P UUID 不同 | 真实网页按钮 |
| YouTube 改名、移出初始目录后重复保存 | 定位原 UUID，人工 Title、Status 与测试正文保留 | 真实 Vault 与网页按钮 |
| Properties 冷启动（0.8.0 阶段） | 实际视频创建 tab ID 与最终 popup VideoPlay tab ID 一致，无被丢弃中转页；10 秒定位成功 | 真实应用链路 |
| Properties data-href 点击 | Obsidian 事件被插件接管，未进入默认浏览器中转路径 | 实际渲染 DOM |
| 阅读视图链接 | 实际链接点击被接管；仍需最终版本统一定位回归 | 部分通过 |
| 关闭受管理 VideoPlay | 连接数立即归零，心跳计数停止增加 | 真实扩展诊断 |
| 真正闲置后的普通窗口冷启动（0.8.1） | 失败：后台首帧消息在异步初始化期间丢失 | 已保留问题并修复源码 |
| 同步消息启动门禁（0.8.3） | 真正 service worker Inactive 后一次冷点击成功；新建 tab 1667287750 最终移入单独 normal 窗口 1667287751，未认领原普通窗口 | 真实冷唤醒通过 |
| 百度网盘实际 Playlist 批量 | 14 项完成，0 失败，Videos 与关系 JSON 保留 14 项 | 真实网页按钮 |
| Bilibili 实际 Playlist 批量 | 44 项完成，0 失败；已有第 1、2 分 P UUID 不变 | 真实网页按钮 |
| YouTube 实际 Playlist 批量 | MIT 课程 35 项完成，0 失败 | 真实网页按钮 |
| 批量后 Vault | 98 篇记录、98 个不同 UUID；除人工 QA 内容外正文均为空 | 实际 Vault 元数据及文件 |
| 跨站热切换（0.8.4/0.8.5） | 发现导航后角色标记失效与旧媒体提前响应；另观察到 Bilibili 网络异常和本地网络权限提示 | 已修复源码，0.8.7 真实回归待完成 |
| 最新源码播放保护 | 冷/热播放共用队列，定位前后复核目标身份，恢复页面角色，排队过期不导航，关闭/禁用取消重试；冷启动反馈定位回执 | 正式自动化通过 |

测试为验证保留正文，在 YouTube 测试笔记中手动加入了一段 QA 正文与时间戳链接。该内容来自测试动作，新增 Obsidian 保存流程没有生成或改写正文。

当前保留测试数据包括 `TSNotes/` 和 `TSNotes QA Retained/Homebrew renamed.md`。不删除测试笔记或用户设置。

## 浏览器控制记录

Task Space：1，名称 TSNotes Obsidian integration。曾两次收到 Ego 的用户控制硬停止错误，均停止浏览器操作；用户分别明确授权恢复后才重新取得同一 Space。没有主动 handOff 或 finish。随后 Ego 返回 Space 1 不存在且列表为空；收到用户恢复授权后重新检查仍为空，已停止浏览器操作并请求是否允许唯一替代 Space。

保留页面：扩展详情、Obsidian 配对、YouTube 示例、百度网盘列表/播放页、Bilibili 多 P 测试页。最终交付前必须重新记录页面标签和实时 ownership。

## 尚未完成的验收门禁

- 0.8.7 / 0.1.5 最终构建的冷启动回执、热切换与快速连续点击真实回归。
- 三站批量保存已实测通过；部分失败/取消/仅重试及 YouTube 跨列表复用仍需最终真实回归（自动化已覆盖）。
- 最终版本跨站热切换、Properties/阅读/实时预览/独立窗口与复制不写正文回归。
- 多 Vault 的真实路由验证（自动化已覆盖）；关闭重开后定位。
- 30 分钟静置、受控 A/B CPU 增量及固定工作量后保留 JS 堆增量。工程目标仍为单核 1 个百分点、10 MiB，没有因尚未测量而放宽。

上述门禁通过前保持开发分支，不合并 main。不能把构建通过、原生 Reload 或没有崩溃当作完整验收。
