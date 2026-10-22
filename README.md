# TSNotes × Obsidian

版本：浏览器扩展 0.8.7 / TSNotes Bridge Peng 0.1.5 / 协议 1.0。桌面 macOS；首轮验收环境 ego lite。

## 安装和配对

1. 构建独立插件仓库，复制 `main.js` 与 `manifest.json` 到目标 Vault 的 `.obsidian/plugins/tsnotes-bridge-peng/`，启用 TSNotes Bridge Peng。
2. 在 Obsidian 插件设置中选择启动浏览器，点击“复制配对信息”。
3. 在 TSNotes 弹出页点击“配对 Obsidian Vault”，粘贴并配对。不要公开或分享这段信息。
4. 在弹出页选择 Obsidian 和目标 Vault。默认仍为 Notion，直到主动切换。所有站点按钮会更新保存目标。

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

Properties、阅读视图、实时预览与弹出窗口中的 TSNotes 链接由插件接管。VideoPlay 存在时通过本机连接直接定位；不存在时通过已配对浏览器打开实际视频标签，并接管同一 tab ID 为最终 VideoPlay。正常窗口和 popup 都需要独立容器，不能认领用户原窗口。

启动票据仅存活 30 秒、消费一次；浏览器返回定位回执，连接成功不等同于媒体定位成功。热切换仅控制已确认的同一标签页，导航完成后恢复角色标记并核对媒体时间；排队超过 19 秒的请求停止执行。临时标记不会写入属性或复制链接。百度路径按原字节添加和移除启动标记，保护 `%2B`、空格及中文。

只有确认的 VideoPlay 存在时才保持 WebSocket，每 20 秒保活。关闭后释放连接、心跳和待执行播放。保存与查询按操作触发，不进行周期性全库扫描或页面采集。时间戳仍只复制剪贴板，Obsidian 目标禁用原自动粘贴路径。

不包含字幕、AI 总结、正文导入或其占位文档；这些交给 NotionImporter 单独开发。

## 恢复与回滚

保留关系 JSON、笔记 YAML 和两端配对设置。重复 UUID 或 YAML 错误先修复来源文件，不通过重建笔记绕过。创建成功但打开失败可直接再次定位，不需要重建。

开发在两端 `codex/obsidian-integration` 分支，main 保留基线。只在完整验收后合并。部署脚本备份原运行产物并保留 data.json；回滚恢复明确版本的构建产物，再原生 Reload 扩展、定向 Reload Obsidian 插件。不删除笔记、关系数据或用户设置。不包含 push、Release、BRAT 或商店发布。
