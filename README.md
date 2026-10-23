# TSNotes × Obsidian

版本：浏览器扩展 0.8.12 / TSNotes Bridge Peng 0.1.12 / 桥接能力 1.1（HTTP 兼容 1.0）。桌面 macOS；首轮验收环境 ego lite。

## 安装和配对

1. 构建独立插件仓库，复制 `main.js` 与 `manifest.json` 到目标 Vault 的 `.obsidian/plugins/tsnotes-bridge-peng/`，启用 TSNotes Bridge Peng。
2. 在 Obsidian 插件设置中选择启动浏览器，点击“复制配对信息”。
3. 在 TSNotes 弹出页点击“配对 Obsidian Vault”，粘贴并配对。不要公开或分享这段信息。
4. 在目标浏览器打开 VideoPlay；在 Obsidian 设置选择该浏览器，再选择与配对页面短标识一致的在线客户端，点击保存绑定。每个 Vault 独立设置；更换扩展实例需要重新绑定，不自动改用其他客户端。
5. 在弹出页选择 Obsidian 和目标 Vault。默认仍为 Notion，直到主动切换。所有站点按钮会更新保存目标。

每个 Vault 独立配对，最多 8 个。配对页可以关闭联动，立即释放连接与重试定时器。目标 Vault 必须打开；连接失败不会转存其他 Vault 或 Notion。更换 Profile 或浏览器后重新配对。机器端口和密钥保存在用户 Application Support 的 TSNotes Bridge Peng 目录，扩展副本单独保存在本地 storage；不进入 Vault、配置导出或 Git。

## 保存和刷新

- “Save to Obsidian”创建视频记录并打开它；视频正文为空。
- 重复保存仅定位；新发现的有效身份别名与 Playlist 归属可以补充。
- “刷新视频资料”先展示待更新 Properties，再确认。预览绑定 Vault、文档身份和确切变化；目标或资料变化后需要重新预览。
- Playlist 批量入口与当前视频保存分开。批量最多 3 个请求并发，逐项提交、部分成功不回滚。页面任务面板提供取消和仅重试未完成项。重试绑定原 Vault；扩展重启会释放临时任务历史。
- 原外部 `save-to-notion` 命令显式保留 Notion 目标，供现有调用方继续使用。

## 文件、身份和 Properties

初始位置为 `TSNotes/Videos/` 或 `TSNotes/Playlists/<列表名>/`。同名时使用短 UUID 后缀，已有文件不覆盖。更改设置只影响后续创建，不搬迁或重命名历史文件。

同一 Vault 的可播放视频只有一篇主记录。YouTube 使用视频 ID；Bilibili 使用 CID 和 BV/分 P 交叉校验；百度网盘优先使用文件 ID、Object Key，路径与 MD5 只作为辅助资料，不能当作永久身份。歧义和重复 UUID 会阻止受影响操作。

| 字段 | 用途 |
| --- | --- |
| TSNotesID | 创建后不变的文档 UUID |
| Record Type / Site | video 或 playlist；来源站点 |
| DedupeKey | 首次来源 Key，之后不更换 |
| DedupeAliases | 后续有效来源 Key |
| DedupeURL | 辅助查重 URL，不能单独无条件合并 |
| Source Identities | 用于可靠来源交叉匹配的身份列表 |
| URL-TSNotes / Link | VideoPlay 入口 / 原站入口 |
| Title / Creator | 视频标题 / 作者；作者不写入主题标签 |
| Duration / Duration Seconds | 可读时长 / 数字秒数 |
| Cover URL / Created time | 封面链接 / 首次创建时间 |
| Video ID / CID / AID / Part | 按来源提供的文本 ID |
| File ID / Object Key / File MD5 / File Path / Parent Path | 百度网盘身份与恢复资料，ID 为文本 |
| Playlist IDs / Playlists | 视频的列表文档身份及内部链接 |
| Playlist ID / Videos / Total Videos / Source Total Videos | 列表来源身份、有序链接、本地已保存数、来源总数 |
| Relations Path | 列表关系数据的固定相对路径 |

可选字段及刷新策略在插件设置中配置。未知属性、用户状态、标签、备注和视频正文保留。字段改名不自动迁移历史笔记。核心字段不能用自定义映射覆盖，不应手工删除或复制 UUID。

列表成员数据在 `TSNotes/_data/playlists/<列表文档 UUID>.json` 中，必须随 Vault 备份。该文件不是缓存；丢失或损坏时停止更新成员关系，不清空已有成员。网站视频删除或 Playlist 缩减不会删除本地笔记。

## 播放与资源

Properties、阅读视图、实时预览与弹出窗口中的 TSNotes 链接由插件接管。已连接时直接控制已绑定实例；未连接或 1.5 秒未确认接收时，通过设置的浏览器打开视频链接。浏览器独立创建或复用受管理 VideoPlay，核对目标后关闭本次来源页；来源本身是最终受管理播放页时保留它。普通用户窗口不会被任意识别为 VideoPlay。

1.2 使用临时操作标识关联播放与回执，本地播放不以票据或 HTTP 成功为前提。接收、窗口就绪、定位与联动连接分别反馈；结果未知时不会自动重复开窗。临时标记不写入属性或复制链接；按原始 query 字节处理，保护百度路径中的 `%2B`、空格和中文。旧协议票据保留兼容。

只有确认的 VideoPlay 存在时才保持 WebSocket，每 20 秒保活。关闭后释放连接、心跳和待执行播放。保存与查询按操作触发，不进行周期性全库扫描或页面采集。浏览器原时间戳入口保留既有复制及自动粘贴开关；Obsidian 保存目标不触发 Notion 自动粘贴，本次播放恢复也不写入笔记。

不包含字幕、AI 总结、正文导入或其占位文档；这些交给 NotionImporter 单独开发。

## 获取和插入 VideoPlay 时间链接

在命令面板搜索以下两个命令，可自行设置快捷键，默认不占用快捷键：

- **Copy current VideoPlay timestamp link**：可在阅读视图执行；只更新剪贴板，失败保留原内容。
- **Insert current VideoPlay timestamp link**：在任意可编辑 Markdown 笔记中执行。光标处插入；有选区时保留选中文字并在末尾插入；一次撤销移除本次插入。不会修改剪贴板。

输出如 `[00:35](https://www.youtube.com/watch?v=-F2W0BsuLxU&t=35s&type=TSNotes) `，小时格式为 HH:MM:SS。受管参数规范化后 `type=TSNotes` 位于最后；保留百度路径原编码，目的地址含括号时使用 `<URL>`。

获取只读取已确认的 VideoPlay，不抢焦点、不暂停、不打开窗口；未打开 VideoPlay 时提示重试。暂停和零秒有效；加载中、广告及不能可靠生成链接的直播返回错误。采样向下取整到秒，8 秒超时，不自动重试。每个 Vault 同时只允许一个获取请求。

发起请求的 Vault 使用其本机绑定的浏览器实例，浏览器“保存目标 Vault”选择不参与路由。两个浏览器在线不会互相覆盖；目标离线不会使用另一浏览器或系统默认浏览器。切换浏览器会取消旧请求。更新后第一次使用，请完成上方显式实例绑定。

插入期间若编辑、移动光标、切换笔记或窗口、切换浏览器、断开或卸载插件，本次插入取消。Properties、只读、阅读视图、多光标和输入法组合输入不能插入。只有主动执行此本地编辑命令才写正文；Save to Obsidian 和本机 HTTP 接口仍不提供正文写入能力。

## 恢复与回滚

保留关系 JSON、笔记 YAML 和两端配对设置。重复 UUID 或 YAML 错误先修复来源文件，不通过重建笔记绕过。创建成功但打开失败可直接再次定位，不需要重建。

两端保留 `main` 与 `codex/obsidian-integration`，原基线可从 Git 历史恢复。用户已要求缩减长时间和极端测试，交付以源码检查和核心真实链路验收为准；未覆盖项目见验收记录。部署脚本备份原运行产物并保留 data.json；回滚恢复明确版本的构建产物，再原生 Reload 扩展、定向 Reload Obsidian 插件。不删除笔记、关系数据或用户设置。不包含 push、Release、BRAT 或商店发布。

## 视频页面保存目标菜单（0.8.12）

YouTube、Bilibili 和百度网盘的保存入口采用分区按钮：`保存图标 · Vault 名称 | ▾`。左侧保存当前视频；箭头打开菜单；选中 Notion 或已配对 Vault 只切换目标，不立即保存。`Manage Obsidian vaults…` 打开原配对页面。Playlist 入口沿用同一目标。

目标在本浏览器全局记忆，页面、弹出页和配对页同步。切回 Notion 会保留上次 Vault。未配对或已移除的 Vault 不会转存其他目标；关闭联动时仍可选 Notion，但不能选择 Vault。长名称省略显示，悬停查看完整名称；同名 Vault 追加短 ID。

点击保存后，单视频或整批任务固定使用当时目标，包括异步采集、请求去重和失败重试；其他页面切换目标不会改变任务去向。保存中本页两个按钮区域禁用，完成后恢复最新选择。旧设置页保存不会覆盖最新目标。此选择只决定记录写入位置，与 Obsidian 绑定的播放浏览器无关。

菜单支持 Tab、方向键、Enter／Space 和 Escape；点击外部、滚动、调整窗口或导航会关闭菜单。展开和切换目标不加载视频采集器，不查询网站资料或 Notion 数据库，也不探测所有 Vault 是否在线。

## 统一视频库与原生 Bases（0.1.11）

所有新视频主笔记统一创建于 `<root>/<videos>/_records`；Playlist 索引创建于 `<root>/<playlists>/_records`。同一可播放视频跨 Playlist 继续共用主笔记。Videos.base 以身份而非物理目录聚合 Vault 内 TSNotes 视频，提供 All videos、Standalone、By site、Gallery。Playlists.base 聚合 Playlist 索引。默认隐藏技术字段，播放列保留 TSNotes 链接。

新 Playlist 索引嵌入 `<root>/<playlists>/_records/Playlist Videos.base`。共享视图以嵌入笔记的 TSNotesID 筛选 Playlist IDs，并按现有 Videos 有序链接计算 List order；此列是已保存成员之间的排序，不是来源编号。共享文件直接打开时不显示无上下文的视频。视频正文不由创建、重复保存或初始化修改。

首次初始化只创建缺失的 Base，已有文件及用户调整保持原样。视图需要 Obsidian 1.9+ 并启用核心 Bases；插件不代为启用。Base 的 New 不会运行 TSNotes 采集器，不生成有效的视频身份。

新增命令：Open video library、Open playlist library、Preview video library migration、Resume video library migration、Roll back video library migration、Review library views。设置页也提供总览、迁移预览和模板检查入口。模板更新默认只选中缺失视图；替换既有视图须显式选择，应用前备份和核对校验值。

迁移不会自动执行。预览列出旧/新路径、冲突、全部校验和备份范围。确认当前摘要后才开始；新请求在维护期间明确拒绝。只移动保存根目录内的已登记记录，目录外的记录保持原位；原生链接更新可能影响的外部笔记会一并预览、备份。保持 UUID、视频身份、来源关系 JSON 和个人内容。旧空文件夹在核对后放入 Obsidian Trash；包含附件或其他内容的目录不动。

预览和恢复日志保存于本机 Application Support/TSNotes Bridge Peng/migrations/<Vault ID>，目录权限 0700、文件 0600，不通过 HTTP 暴露。日志包含文件原文、校验值及步骤记录，应保留用于恢复。常规中断可从已确认步骤继续；某一步未写入完成确认时禁止自动猜测，须检查备份和现场。恢复/回滚遇到新编辑、目标占用、新外部引用或损坏备份会停止，不覆盖新内容。回滚不删除正常使用中新建的笔记。

## 共享 Base 与使用说明（0.1.12）

共享 Playlist Videos.base 与 README.md 现在位于 Playlist 的 _records 目录。README 说明整体文件结构、this 上下文筛选、成员关系、排序与修改边界；普通初始化仅创建缺失说明，保留用户补充。它没有 TSNotes 身份，不会进入 Playlist 总览。

升级已有 Vault 时，先备份，再用 Obsidian 原生文件管理将旧 `<root>/_data/views/Playlist Videos.base` 移到新位置，并核对现有嵌入引用，再加载新版本。原视图设置原样保留。若仅发现旧文件而新路径缺失，初始化会提示先移动，避免另建一份默认视图掩盖旧设置。`_data/playlists` 的正式关系 JSON 仍需保留。


## 断连保底播放（0.1.13，配套 TSNotes 0.8.13）

点击有效 TSNotes 链接时，在线优先直接控制；断连时在设置的浏览器本地接管播放，接管成功后清理来源标签。配对、启动回执及实时联动失败不阻断浏览器本地播放，连接另行有限重试。重启不要求重新配对。

命令 **Show recent playback results** 查看不含私人 URL 的本机结果；**Reconnect VideoPlay bridge** 触发新一轮重连。其他 Profile 本地播放不会改绑，采样仍严格使用原实例。协议细节见 [协议](docs/protocol-v1.md)。

## 视频笔记打开方式（0.1.14）

在插件设置中选择“视频笔记打开方式”：

- **专用独立窗口（默认）**：每个 Vault 复用一个 TSNotes 专用窗口，不同文件使用不同标签；同一文件重复打开时激活已有标签，保留编辑状态。
- **主窗口新标签页**：只在主窗口中新开或复用同一文件的标签，保留其他标签。

两种模式分别查找目标位置，不会把其他普通窗口认领成专用窗口，也不会移动或关闭已有笔记。切换设置只影响之后的操作。批量导入不逐条打开标签，库视图命令保持原行为。

专用窗口关闭后，下次保存会重建；插件重载后通过设备本地布局身份恢复。应用重启时，仅当 Obsidian 恢复了对应窗口布局才复用，否则创建新窗口。窗口大小、位置和标签顺序交给 Obsidian 管理。

打开方式保存在 Vault 插件设置的 `recordOpenMode` 字段；旧配置缺少字段时默认 `window`。专用窗口身份独立保存于设备 Application Support 的 `<Vault UUID>.presentation.json`，不写入笔记，也不包含配对密钥。损坏身份文件会在替换前保留 `.corrupt-*` 副本。

如果记录保存成功但窗口打开失败，结果会分别报告；重试不会重新创建视频主笔记。公开工作区 API 返回的位置异常时停止打开，避免替换其他笔记。
