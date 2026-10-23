# 资源导入与库入口整理：2026-10-23 验收记录

## 交付范围与版本

- TSNotes **0.8.14**；NotionImporter **0.4.0**；TSNotes Bridge Peng **0.1.15**。
- 三仓库均使用 `codex/obsidian-integration`。未提交、合并、推送或发布；保留原有改动及 NotionImporter 的 `.codegraph/`。
- 原 Notion 保存／导入保留。NotionImporter 的目标独立记忆，配对密钥由 TSNotes 保管。
- 新增独立资源文档、主笔记链接 Properties、增量资源索引、分块校验、默认跳过、更新预览／确认、本地编辑保护、取消和逐项结果。
- 主视频正文没有成为远程写入接口；没有字幕内嵌主文档、AI 模型调用或 NotionImporter 的跨视频批量采集。

## 正式检查

| 项目 | 结果 |
| --- | --- |
| TSNotes（Node 24） | `npm run check:local`、`git diff --check` 通过；保留原资源上限与检查阈值 |
| Bridge（Node 24） | typecheck、58 项测试、build、diff check 通过 |
| NotionImporter（Node 24） | typecheck、234 项测试（46 个文件）、build、diff check 通过 |

新增测试已接入各仓库正式链，涉及认证 HTTP 入口、跨扩展授权／目标固定、站点时间链接、资源幂等／更新冲突／补链、迁移冲突与旧入口保护、原生内链改写和异步页面准备。

NotionImporter 构建仍有既有 Vite/CRX 插件 MAIN-world HMR 和 rollupOptions 警告；生产 build 成功。原 Notion 代码走自动化／mock 契约回归，本轮未写入真实 Notion。

## 已确认的库入口迁移

用户批准摘要：`42bf985f42b44f1051342dfee2d03f14a23ea98ee2878267c560921790a5bd23`。

| 原位置 | 新位置 |
| --- | --- |
| TSNotes/Videos/Videos.base | TSNotes/Videos.base |
| TSNotes/Playlists/Playlists.base | TSNotes/Playlists.base |
| TSNotes/Playlists/_records/README.md | TSNotes/_data/README.md |

两个 Base 的原始 SHA-256 保持不变；README 保留原文并补充标记的 v3 布局说明。没有移动视频或 Playlist 主记录。三份入口重载后没有在旧位置再生。

首轮原生 rename 在移动 Base 后自动缩短 README 内链，导致程序把预期内链更新误判成源文件变化；它停止于两份 Base 已移动、README 未移动。随后逐项核实 Base 原始哈希和 README 的仅两处原生内链差异，按原确认范围完成 README 移动。源码改为先移 README，并加入回归测试。未忽略未知变化或覆盖用户内容。

迁移备份与日志：

- `~/Library/Application Support/TSNotes Bridge Peng/layout-migrations/ff382f3f-1bf4-4463-a5e2-c1ffb098b241/d756fabf-1c56-499a-8df8-62b47d74912c/journal.json`（原三份文件备份、已完成前两步）
- 同目录操作 `71a9f9ba-b8d4-4998-b430-c384b2fd2b01`（剩余 README 完成记录）。

这是经逐文件核对的恢复；入口迁移尚无独立的一键恢复／回滚 UI。遇到新编辑、路径冲突必须停止，参见 `resource-import.md`。

## 实际浏览器与 Vault 结果

真实环境：Ego Lite 默认已有 Profile、Math Peng。测试 Space 1 消失后，遵守控制停止；用户明确恢复后，实时列表为空，按既有自动替代授权创建 **Space 2：TSNotes resource import QA**。未新建 Vault 或 Profile。

扩展 ID／加载目录经原生 details 核实：

- TSNotes `nagociaencjilbfmecokdpclndofiihl`，TSNotes/dist。
- NotionImporter `dcloaoebgjobeijfdkfmiokchnnnfldb`，NotionImporter/dist。

每个完整构建批次均在原生扩展管理页 Reload；运行证据包括新增授权接口、Vault 列表、Manage Vault 控件和实际资源写入，非仅 manifest 版本。用户明确授权后才在 TSNotes 自身 bridge 页面批准该 NotionImporter 实例。Space 更换后授权和独立目标仍持久保留。

| 动作 | 预期 | 实际／证据 |
| --- | --- | --- |
| 首次授权、读取 Vault 列表 | 真实发送方获准，列表不含密钥 | 成功；返回 Math Peng 与既有 Obsidian AI Coding |
| 选择 Math Peng | 不修改 TSNotes 保存选择或 Notion 设置 | 独立配置生效；原 `bain_settings` 及升级前各存储项比较一致 |
| YouTube Homebrew 字幕 | 独立 Markdown、主笔记入口、重复跳过 | 成功写入；再次采集为 skipped |
| 百度当前视频全部导入 | 字幕＋AI 文档＋本地图 | 成功：字幕 1,339 行／670 个时间入口；AI 364 行／16 个时间入口；14 张本地图片存在且文件名 SHA 校验通过 |
| 百度重复导入 | 两类 skipped，不覆盖正文 | 两项均 skipped |
| 百度更新预览与确认 | 确认前不提交、确认后受控更新 | awaiting-confirmation；原文／新文均 9,210 字符，内容相同；随后正式确认返回 completed / updated / opened:true，资源正文哈希再次校验通过 |
| Bilibili 当前数学视频 | 有字幕时导入，没有时明确失败 | 源接口返回 0 条字幕；未导入，不标记该站真实成功 |
| VideoPlay 未连接时资源操作 | 无 WS 前置依赖 | Vault 运行时 `bridge.connected === false`；资源查询、跳过和编辑保护仍成功 |
| 写入成功后展示主笔记 | 沿用展示管理器 | 实际任务返回 opened:true；原窗口策略由既有自动化回归覆盖，未重跑完整窗口验收 |

实际导入经真实网站采集和两个扩展后台及认证 HTTP 链路。部分操作由扩展页面发送正式后台命令指定已观察的视频 tab ID；未把它们描述为物理工具栏弹窗点击验收。页面内目标选择器曾进行真实选择；工具栏布局仍建议用户日常确认。

### 资源保护与受控测试

明确标为 `TSNotes Resource QA Synthetic 20261023` 的主记录／两份资源用于真实传输测试，包含一张 68 字节 PNG fixture。它不代表真实网站采集成功。验证：创建、图片校验、预览＋确认更新、重复跳过、资源改名后查找、主笔记个人正文保持、手动修改资源后返回 `resource_body_locally_modified`。

原生 rename 可把受控内链改为短路径，首次出现两条等价入口。已通过 MetadataCache 解析目的文件后去重，保留个人其他链接；自动化及实际 Vault 修复后同一资源只有一条入口。

YouTube 查重命中了旧 `TSNotes QA Retained/Homebrew renamed.md`。核对后仅撤回本次新增的 Subtitles 入口，逐次比较正文未变；未移动、删除或重建 QA 目录，也未清理其原有内容。导入的 YouTube 资源保留，其返回主记录链接仍有效；该入口未为了测试再次补回。

另一次 Bilibili 页面自动换片导致新建了一篇无正文记录；保留并明确标为 `TSNotes Import QA Bilibili - 微分方程大观`，没有删除数据。该记录未成功导入字幕。

## 数据保护与备份

- 初始 TSNotes 范围 106 个文件已做逐文件 SHA 基线；既有关系 JSON 与全部 Base 哈希保持一致，没有旧文件缺失。
- 既有 TSNotes 范围内的修改限百度主笔记新增资源链接 Properties；该笔记正文仍为空。新增资源及图片、两篇具名 QA 主记录保留。
- 主记录／资源 UUID 未因刷新或改名而改变。
- 插件部署只替换 main.js、manifest.json 和构建存在的 styles.css，`data.json` 前后哈希一致。
- 初始运行产物／设置备份：`/var/folders/wf/223yfjfj2vz2ncc59zhzr2240000gn/T/tsnotes-bridge-backup-En4hMA`。
- 最终部署前备份：同一临时目录下 `tsnotes-resource-accepted-backup-mypikbcb`。
- 扩展本地配置初始私有备份：`/tmp/tsnotes-resource-browser-backup-j4yCq8`；不要将其凭据内容提交 Git 或分享。
- 本地恢复资料：`Application Support/TSNotes Bridge Peng/resource-imports/<Vault ID>` 的暂存及 backups；正式 Markdown、assets、关系 JSON 随 Vault 备份。

回滚先核实当前文件仍为本轮输出再恢复产物；不得用恢复配置覆盖用户新设置。资源更新旧文档已独立备份。不要通过删除个人资源、改 UUID 或移除 Body Hash 绕过冲突。

## Worker、边界与待确认

按用户要求调用过一次隔离 Worker，仅委托一份测试文件。该运行终止于安全／契约失败；已审阅报告、结构化结果及差异，未采用任何 Worker 改动，保留隔离工作区与证据。后续由 Codex 完成。无自动 checkpoint、stash、reset、clean 或提交。

仍未完成的真实场景：Bilibili 有可用字幕的视频成功导入、跨 Vault 实际资源写入、完整工具栏物理点击、资源时间入口的实际播放回归与 Tabbit 验收。三站格式／目标固定／多 Vault 隔离已有自动化覆盖，不替代这些真实结果。未重复压力、长静置或三站全量回归。

Ego 提示有可用更新，本轮未升级浏览器。


## 最终状态

- 最后运行版本：TSNotes 0.8.14、NotionImporter 0.4.0、Math Peng Bridge 0.1.15。
- 最终保留 **Space 2**，最后一次实时观察为 **agent**；页面 p1 为百度测试源，p2 为 TSNotes bridge，p3 为 NotionImporter 扩展页。未主动 handOff/finish。
- 百度真实更新已完成；资源改名／本地编辑保护和主笔记正文保护已在最终 Bridge 运行产物复验。
- TSNotes 根目录最终审计：既有文件无缺失，原 Base 与关系 JSON 哈希一致；既有范围内 1 篇百度主笔记增加资源入口，新增 24 个文件（资源、图片和具名测试记录）。旧 QA 入口属性已撤回，不再以该目录继续测试。
- 最终构建部署后未再修改业务源码；后续改动仅交付说明。保留全部备份与测试资料。

控制台限制：Obsidian 的 dev:console 未附加调试器；已有 ResizeObserver 循环提示未归因为本插件。本轮以定向重载、实际请求结果、文件及身份／正文校验为运行证据，没有声称完整控制台无错误。
