# VideoPlay 时间链接功能验收 — 2026-10-22

交付版本：TSNotes 0.8.10 / TSNotes Bridge Peng 0.1.9 / 协议能力 1.1，HTTP 保留 1.0。两仓库继续 codex/obsidian-integration；原 0.1.8 未提交改动保留，没有创建提交、分支、checkpoint、push、发布或合并。用户选择本次由 Codex 直接实施；未调用 Worker。

## 正式检查

浏览器在 Node 24.22.0 执行 npm run check:local，通过类型、lint、行为/契约、构建与 readiness 检查。新增快照、格式和本地实例身份测试接入 check:obsidian（属于 check:local）；最后新增身份/错误会话断言后重新运行对应正式测试组通过。Obsidian npm run typecheck、npm test（22 项）、npm run build 与两仓库 git diff --check 通过。协议文件两仓库一致。

## 实际环境和方法

只使用 Ego Lite，扩展 ID nagociaencjilbfmecokdpclndofiihl，实际加载目录为 TSNotes/dist。同一 Task Space 2：TSNotes正文链接修复验收。原生 Reload 一次后配对页面显示 0.8.10，执行新增身份消息并显示客户端 e6a30199，确认新构建行为。原 p2 随 Reload 关闭，按其记录入口恢复为 p3；没有另建 Space。

插件仅复制 main.js / manifest.json 到 Math Peng、Obsidian AI Coding；两库 data.json 字节均与部署前一致。两库设备设置增加 Ego → 本地实例绑定。Math Peng 原启动目标 Tabbit，本轮为测试显式切到 Ego；AI Coding 保持 Ego。两端不读取默认浏览器作为路由选择。未更改浏览器 saveDestination=obsidian 或已选保存 Vault=Math Peng。没有新建 Vault。

| 动作 | 预期 | 实际与证据 |
| --- | --- | --- |
| YouTube 暂停 35 秒执行复制命令 | 时间标签、规范顺序、只有剪贴板改变 | 实际 Obsidian command 返回执行，系统剪贴板为 [00:35](https://www.youtube.com/watch?v=-F2W0BsuLxU&t=35s&type=TSNotes) 加空格；CUA Cmd+V 粘贴到明确命名的测试笔记 |
| 有中文选区执行插入命令 | 原文字保留，链接位于选区末尾，光标在链接后 | 选区“保留选中文字”完整保留；一次编辑器事务，光标 ch=79；剪贴板不变 |
| 原生 Cmd+Z 一次 | 仅撤销本次插入 | 编辑器文本严格等于插入前快照，原选区恢复 |
| 主窗口实时预览、独立窗口 | 两处都可插入并一次撤销 | 独立窗口 ownerDocument 与主窗口不同，插入成功；editor.undo 一次恢复严格相同文本；主窗口为 Live Preview |
| 实际请求期间移动光标 | 取消写入 | editor_changed，正文严格不变，pending=0 |
| 两个 Vault 获取同一浏览器 | 不依赖浏览器保存目标 Vault | 浏览器始终选 Math Peng 保存；AI Coding 获取同一 YouTube 35 秒链接成功 |
| 点击生成的链接 | 直接控制现有 VideoPlay | 阅读视图原生点击成功；实时预览原生点击，媒体 seeked=35.024813，新增标签数 0 |
| Bilibili 获取 | 保留视频身份和业务参数，规范时间与标记 | 真实 BV1xx411c7mD 暂停 35 秒，返回 00:35 / t=35s&type=TSNotes |
| 百度网盘获取 | 暂停零秒有效，35 秒有效 | 实际页面 readyState=4，先获取 00:00，再获取 00:35，末尾 type=TSNotes；未在交付记录输出私人路径 |
| 获取操作无副作用 | 不抢焦点、不创建播放标签、不暂停播放 | YouTube 受控暂停 35 秒前后保持 paused=true/time=35；Chrome 最后聚焦窗口 ID 不变；三站获取阶段新增标签数 0。站点切换是单独的 play 操作 |
| VideoPlay 关闭后的复制 | 明确离线，不启动窗口、不改剪贴板 | browser_disconnected，pending=0，连接数=0；系统剪贴板字节相同，新增标签数 0 |
| 旧正文链接冷启动 | 绑定实例接管同一个实际视频标签 | 在原 Homebrew 示例中原生点击旧顺序链接；只创建 tab 1667288201，最终同 ID 置于 VideoPlay window 1667288202，launch=1、connections=2、pending=0。原文档哈希不变 |
| 插件重新加载 | 本机绑定持久、恢复连接和命令 | 两库第二次定向 Reload 后保留同一 clientId；Math Peng 再次获取 00:35；两库 connected=true |

错误客户端、错误/旧 session、目标切换、超时、迟到结果、断连不回退，以及 YAML、只读、多光标、输入法组合、编辑或切换文件等由正式自动化覆盖。真实浏览器未伪装两个新客户端，也未做压力循环和长时间静置。Notion 未执行真实写入；既有 Notion 保存/自动粘贴契约由源码检查覆盖。

## 保留数据与恢复

新增一篇测试笔记：Math Peng/TSNotes QA Retained/Time link commands 20261022.md。内容为明确 QA 标题、原中文文本与一个手动粘贴的 YouTube 时间链接；插入测试内容均已撤销。原 Homebrew renamed.md 全文 SHA-256 与验收前相同。没有删除既有文件，AI Coding 未新增笔记。测试独立窗口已关闭。

部署前运行产物、data.json 与设备设置备份：/var/folders/wf/223yfjfj2vz2ncc59zhzr2240000gn/T/tsnotes-time-link-019-g_xleyk1。设备设置包含密钥，仅本机 0700 临时目录保留，勿上传或提交。运行产物与源构建逐字节相同。恢复插件时只还原 main.js/manifest.json 并定向 Reload；不要直接覆盖 data.json 或设备绑定。浏览器旧代码可从本分支既有基线 98eb7b6 恢复构建，勿 reset 当前工作区。

保留 Ego p1 扩展详情、p3 配对页面，以及最终受管理 VideoPlay（tab 1667288201，暂停于 35 秒）。最后实时 Space ownership=agent；未 handOff/finish。Tabbit 未测试：用户需要更新该实例至 0.8.10，打开 VideoPlay，在目标 Vault 选择 Tabbit 并按配对页客户端标识保存绑定后自行验收。

Math Peng 的 Advanced Canvas 在打开独立窗口时记录 adoptedStyleSheets 跨 Document 错误；独立窗口插入与撤销实际成功，未禁用该插件。AI Coding 存在 Iconic 的既有 has 错误；不是本功能调用栈，未改动第三方插件。没有观察到 TSNotes Bridge 自身错误。此结果不等于系统负载或所有浏览器的稳定性保证。
