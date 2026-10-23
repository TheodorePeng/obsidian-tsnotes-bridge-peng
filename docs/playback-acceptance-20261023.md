# 断连保底播放验收 · 2026-10-23

## 交付状态

- TSNotes 0.8.13，Math Peng 的 TSNotes Bridge Peng 0.1.13；桥接能力 1.2。
- 两仓库继续 codex/obsidian-integration，保留所有既有未提交改动；没有提交、合并、推送、发布或增加分支。
- Codex Only 实施。本轮没有调用外部 Worker。
- 所有入口进入同一播放协调层。在线确认最多等 1.5 秒；URL 保底和在线请求共享操作 ID。浏览器本地播放不依赖实时连接、HTTP 或旧票据验证。关闭来源前验证目标身份和来源导航；已改去其他地址的标签不会关闭。
- 接管限时 15 秒，媒体定位限时 30 秒；连接按 1/2/4/8/16 秒退避后停止。新播放／显式重连可开始下一有限轮，无播放窗口时没有桥接心跳。旧关闭／重试回调不能删除替代连接。
- 新增本机最近结果和重连入口；失败页面／播放页提供重试定位。诊断最多 20 项，不含完整 URL、百度路径、密钥或正文。未知结果与明确失败分开；暂停与定位成功分开。

## 自动化验证

| 项目 | 结果 |
| --- | --- |
| TSNotes Node 24：npm run check:local | 通过，包含新 playback-v2 行为测试；未放宽资源检查阈值 |
| Bridge：npm run typecheck / npm test / npm run build | 通过，34/34 测试 |
| 两仓库 git diff --check | 通过 |
| 两端协议 JSON／临时 URL helper | 字节同步 |
| Skill 变更 | YAML frontmatter 解析、引用路径检查、git diff --check 通过；Python quick_validate 因缺 PyYAML 未运行成功 |

新增行为用例覆盖：原始 URL 编码、过期票据与 HTTP 不可达、禁用桥接后的本地播放、同操作双入口去重、来源导航保护、已管理页复用、操作取代、会话结果恢复验证、有限重试、旧回调隔离、1.1 握手降级、认证报告、错误客户端／旧会话、接收后断线、丢失接收确认、其他实例不改绑、隐私字段清洗及目标切换。

## 有限真实运行结果

验收浏览器为 Ego Lite，未将结果标记为 Tabbit。Obsidian 通过 CLI 向 Math Peng 实际插件 play 入口发起请求，使用已有视频链接；本轮没有重新做编辑器逐模式点击验收。三站页面、播放器、窗口与桥接使用真实运行环境。

| 动作 | 预期 | 实际证据 |
| --- | --- | --- |
| 无 VideoPlay，Obsidian 发起 YouTube 00:35 | 本地开窗、定位、自动恢复 | 操作 86695e98… 两端均 located，随后 Math Peng connected=true |
| 在线跳转 YouTube 00:45 | 不经 URL 来源入口，复用窗口 | 操作 2d0b4d0b… located，管理标签保持 1667288541 |
| 关闭联动后的 YouTube 00:55 | 本地播放继续 | 操作 3df708aa… located；该步禁用与点击接近，不单独用它证明严格断线保底 |
| Bilibili 已有链接 | 正确站点和媒体定位 | 操作 fd1d9335… 两端 located，实际播放器 readyState=4 |
| 明确确认 Math Peng disconnected 后，发起百度网盘链接 | 不等待连接，本地接管并清理来源 | 操作 4dfe3c4b… 两端 located；来源 1667288545 已关闭，播放标签仍为 1667288541，连接计数为 0；播放器暂停，正确报告 playback_requires_user_gesture |
| 恢复联动，原有旧 Vault 兼容 | 不改变客户端绑定 | 最终 Math Peng 0.1.13 和 Obsidian AI Coding 0.1.11 都 connected=true，浏览器共两条连接；AI Coding 插件未部署升级 |
| 最终构建后 YouTube 00:15 | 新运行版本仍复用原窗口 | 操作 8bc73a2d… 两端 located，管理标签仍为 1667288541 |
| 最近播放结果命令 | 本地结果、重连按钮、无私人 URL | 实际弹窗可见，包含 located 和重新连接，内容不含 https://；已关闭测试弹窗 |

Ego 原生详情确认扩展 ID nagociaencjilbfmecokdpclndofiihl，加载路径为本项目 dist。每次完成批次后原生 Reload；重开被 Reload 关闭的配对页，并刷新本轮受管理播放页恢复内容运行时。最终后台脚本的浏览器读取 SHA-256 与磁盘相同：dda214ac8cc0daaf7ecb68da5f11c509557cab0a64aa39996e5d6314d95e85e0。

本轮 Task Space：3，TSNotes disconnected playback QA。最后实时 ownership=agent。保留 p1 扩展详情、p4 配对页，以及本轮创建／复用的 VideoPlay。没有 handOff 或 finish。没有扩展保活轮询或长时间压力测试。

## 数据、备份与范围

- Math Peng 部署只复制 main.js 和 manifest.json，data.json 校验保持一致；浏览器配对列表、稳定 clientId 和 tsnpSettings 与测试前逐项一致。测试禁用开关已恢复 enabled=true，临时监听器已移除。
- 未创建或改写视频／Playlist 笔记正文、Properties 或 Base；未写真实 Notion，未改 NotionImporter。播放会产生浏览器正常的播放状态和新增设备本地诊断。
- Obsidian 运行产物／设置备份：/var/folders/wf/223yfjfj2vz2ncc59zhzr2240000gn/T/tsnotes-bridge-backup-4LLKHZ。
- 浏览器本机设置及本轮构建产物备份：/var/folders/wf/223yfjfj2vz2ncc59zhzr2240000gn/T/tsnotes-playback-runtime-3hfEdc。该构建备份是 0.8.13 的较早本轮构建，不冒充 0.8.12 回滚包；目录只对当前用户可读。
- 回滚插件可在校验目标仍为本轮产物后恢复备份 main.js／manifest.json，再定向 reload；不默认恢复或覆盖 data.json。浏览器回退需使用明确的旧版构建，本轮未创建旧版 0.8.12 回滚包。

## 未做真实验收的场景

- Tabbit：留给用户，不冒充 Ego 已证明。
- 浏览器完全退出后的首次启动、系统重启及两个应用的全部启动顺序组合：未为测试关闭用户整个浏览器；自动化验证恢复和无连接路径不能替代该实测。
- 真实第二 Profile：没有创建 Profile；不匹配报告、不改绑与严格采样路由以协议测试覆盖。
- 站点网络慢加载到超时、窗口创建失败、自动播放受限的全部组合：实际观察到暂停状态；其他失败及来源保留以测试覆盖。没有用注入真实故障扩大测试。
- 旧 Properties／阅读／实时预览／独立窗口的逐模式点击：本轮未逐项重做，链接解析和编辑保护回归测试通过。

## Skill 规则调整

按本次用户明确要求，ego-browser-testing-peng 及 extension-reload 引用已允许：实时列表为空或原 Space 确认消失时，自动创建一个命名替代 Space，无需询问。存在的 Space 被用户接管／失去控制时仍停止，不能借新建 Space 绕过用户接管。此为持久 Skill 变更，不是仅对本轮临时放行。
