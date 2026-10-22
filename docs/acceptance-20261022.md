# TSNotes × Obsidian 交付验收记录

当前源码：TSNotes 0.8.9 / TSNotes Bridge Peng 0.1.6；协议 1.0。

两仓库使用 `codex/obsidian-integration`，已将通过核心验收的实现合并至 main，并保留开发分支。没有 push、发布或修改 NotionImporter。配置凭据不进入本记录。

## 已完成的源码验证

- Node 24.22.0：0.8.8 的 `npm run check:local` 全链通过。0.8.9 的启动时机修复通过 typecheck、正式 check:obsidian、build、release-readiness、final-readiness 与最终真实烟测；按用户要求未再次重复全部旧链。
- 插件 `npm run typecheck`、`npm test`、`npm run build`、`git diff --check` 通过；14 个行为用例。
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
| 最新协议冷启动回执（0.8.7/0.1.5） | tab 1667287805 从创建窗口移动到 VideoPlay 1667287806；同 tab ID；28 秒定位回执成功 | 真实应用链路 |
| 最新热切换（0.8.7） | YouTube → Bilibili → 百度网盘 → YouTube，始终 tab 1667287805 / window 1667287806，无额外播放页 | 真实站点 + 媒体时间核对 |
| 阅读视图、实时预览 | 渲染链接 click、CodeMirror Cmd+mousedown 均被接管并等待定位回执成功 | 实际渲染 DOM 事件 |
| 独立窗口（0.1.6） | 修复跨 realm 的 instanceof 漏接；在真实 popout 的 Properties 点击成功 | 实际独立窗口 DOM 事件 |
| 显式刷新 | 可见预览确认后更新允许属性；UUID、用户 Status 保留，正文 SHA-256 完全相同 | 实际 popup UI + 真实 Vault；测试将 popup 的来源查询绑定到已知 VideoPlay tab |
| 复制时间戳 | 系统剪贴板包含 TSNotes Markdown 链接；pasteAttempted=false、notionWriteAttempted=false；正文哈希不变 | 真实复制命令与系统剪贴板 |
| 200 次连续播放定位 | 200 成功、0 失败，pending=0，无额外播放标签；Obsidian 强制 GC 后 usedSize 从 416736468 到 416755920 字节，增量 19452 字节（约 19 KiB） | 真实 WebSocket 工作量；堆数据仅代表 Obsidian 渲染进程 |
| 隐藏确认按钮（0.8.8） | 修复 button 样式覆盖 hidden 的问题；确认按钮 hidden=true 且 computed display=none | 最新构建实际 popup |
| 最终冷启动（0.8.9 / 0.1.6） | 提前至 document_start 捕获启动参数；对网站清理 URL 的情况核对 Chrome documentId 与原导航 URL；Properties 点击创建 tab 1667287820 并直接移至 VideoPlay 1667287821，35 秒定位成功 | 最终真实烟测 |
| 最新源码播放保护 | 冷/热播放共用队列，定位前后复核目标身份，恢复页面角色，排队过期不导航，关闭/禁用取消重试；冷启动反馈定位回执 | 正式自动化通过 |

测试为验证保留正文，在 YouTube 测试笔记中手动加入了一段 QA 正文与时间戳链接。该内容来自测试动作，新增 Obsidian 保存流程没有生成或改写正文。

当前保留测试数据包括 `TSNotes/` 和 `TSNotes QA Retained/Homebrew renamed.md`。不删除测试笔记或用户设置。

## 浏览器控制记录

Task Space：1，名称 TSNotes Obsidian integration。曾两次收到 Ego 的用户控制硬停止错误，均停止浏览器操作；用户分别明确授权恢复后才重新取得同一 Space。没有主动 handOff 或 finish。随后 Ego 返回 Space 1 不存在且列表为空；收到用户恢复授权后重新检查仍为空，已停止浏览器操作并请求是否允许唯一替代 Space。用户明确授权后创建唯一替代 Space 11，名称 TSNotes Obsidian integration recovery；实际 ownership=agent。原 Space 1 未主动 handOff/finish。

原 Space 的三站页面已记录在历史结果。替代 Space 11 最终保留 p1 扩展详情、p6 配对；p2/p3/p4/p5 随原生 Reload 关闭。最后实时 ownership=agent。测试播放页已关闭，恢复默认保存目标 Notion；Math Peng 配对保留，Obsidian 联动启用。

## 最新验收范围与未覆盖项

用户随后明确要求尽快收尾、停止长时间和极端测试，因此不再将原始完整压力测试矩阵作为合并前置条件。核心三站保存、实际 Playlist、身份复用、移动定位、播放、刷新和正文保护已验证；两端源码检查通过。

后续已按用户最新要求补完下方日常用例：两个真实 Vault 路由与断开、受控列表复用、少量批次取消/失败/仅重试和快速播放。列表 A/B 为 QA 受控清单，使用此前实际采集的视频 URL；本次未另找两个线上 YouTube Playlist 重复采集。没有完成 30 分钟受控闲置 A/B，也没有给出浏览器背景 JS 堆增量或整机不崩溃保证。CPU 单核 1 个百分点、JS 堆 10 MiB 的原工程目标没有被当作实测通过。

资源采样已停止；测试时关闭的插件与浏览器联动均已恢复。未批量禁用其他插件，未删除测试笔记。长时间采样不再继续，也不再重复已通过的检查。真实浏览器/Vault操作不符合 external-code-worker-peng 的委托边界，未为重复验收调用外部 Worker。

## 资源采样方法与边界

使用 scripts/sample-obsidian-resources.py 每 15 秒读取 ps 与 macOS 内存压力，按 Ego / Obsidian 进程汇总 CPU 与 RSS；不发调试请求维持 MV3。关闭联动基线的前 120 秒作为操作后预热排除；2026-10-22T02:14:06.884Z 已确认 disabled=true、连接数=0。按用户新要求中止后续长时间采样；现有短时数据不用于证明完整 CPU 阈值。RSS 不等同于保留 JS 堆；当前 19 KiB 结论仅限 Obsidian 渲染进程，不冒充整个浏览器或系统。

## 日常用例补测（2026-10-22）

按用户最新指示，只补正常使用场景，不重跑压力循环或长时间性能采样。浏览器仍为 Ego Space 11，扩展 0.8.9；插件仍为 0.1.6。实现代码及版本均未修改，没有重新调用 Worker 或重跑已通过的整套源码检查。

第二测试 Vault 使用用户指定的 `/Users/peng/Documents/GitHub-Peng/Obsidian AI Coding`，安装的是与仓库字节一致的现有运行产物。此前新建的 `TSNotes QA Secondary 20261022` 已禁用插件、关闭窗口、从 Obsidian 列表移除，并将完整文件夹移至系统废纸篓，原路径已不存在；可恢复，没有永久删除。

| 用例 | 实际结果 | 证据范围 |
| --- | --- | --- |
| 两个真实 Vault 保存同一视频 | AI Coding 创建独立 UUID；切回 Math Peng 命中原文档，created=false；两库 UUID 不同 | 实际配对界面切换 + 两套真实本机服务 + Vault 文件 |
| 目标库断开 | 临时禁用 AI Coding 的 Bridge 后，保存返回 destination=obsidian / success=false；未回退到 Math Peng 或 Notion；随后恢复插件 | 实际端口不可用场景 |
| 小批量部分失败 | 两项任务：一项成功、一项因人为创建的重复 UUID 测试副本而拒绝；成功项保留 | 真实扩展消息与 Vault；两条公开视频 URL 的 QA 清单 |
| 仅重试失败项 | 测试副本移入 Vault 废纸篓后，重试任务 total=1、processed=1、成功 1、失败 0 | 真实保存链路，没有重新处理成功项 |
| 六项任务取消 | 4 项完成，剩余 2 项停止；取消确认 success=true | 实际任务进度事件触发取消 API；未做大批量压力测试 |
| 重试绑定原 Vault | 切到 Math Peng 后重试被拒绝；切回 AI Coding 后只处理剩余 2 项，全部成功 | 实际 Vault 选择与重试接口 |
| 同视频加入多个列表 | 原视频 UUID `7c5baa1d-ed65-4d85-9812-c8a009881479` 保持不变，主文档数量 1，Playlist 归属 3 | 一个实际来源列表与两个 QA 列表的持久关系 |
| 快速连续播放 | 冷启动连续 3 次请求均完成；随后 8/18/28 秒三次热请求均完成，紧接着读取媒体时间为 28 秒；pending=0；全程只创建 tab 1667287826 / window 1667287827 | 真实两 Vault 在线连接与媒体时间 |
| 最终数据与设置 | Math Peng 仍为 98 篇；AI Coding 新增 10 篇记录、10 个不同 UUID，视频正文全部为空；Math QA 正文哈希不变 | 实际索引与文件检查 |

恢复原默认保存目标 Notion、选中 Math Peng，并保持联动启用；AI Coding 的配对和插件保留，可继续测试。测试播放窗口关闭后，扩展连接数为 0，两端 Vault 的 connected 均为 false。Space 11 保留 p1 扩展详情和 p6 配对页面，最后实时 ownership=agent；没有 handOff/finish。

本轮结果满足已选择的日常补测范围。未将短时观察、单一进程堆数据或没有崩溃当作整机稳定性保证。
