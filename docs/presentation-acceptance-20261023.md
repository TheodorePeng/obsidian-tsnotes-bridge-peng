# 笔记打开方式与专用窗口 · 2026-10-23

## 版本与范围

Obsidian Bridge 0.1.14，Math Peng 已部署；浏览器扩展保持 0.8.13，协议保持 1.2。继续 codex/obsidian-integration，保留已有未提交改动；本轮 Codex 直接实施，没有提交、合并、推送或发布。其他 Vault 插件运行产物未替换。

打开入口集中到 RecordPresentation；设置为 window / tab，默认 window。窗口身份采用公共 getLayout/getLeafById/getContainer 联合核对，不认领普通独立窗口。创建标签使用公开 API，打开文件前校验容器和空白状态；匹配已有标签时只 reveal，不重新加载文件。队列按 Vault 串行化，合并同文件同模式的进行中请求。

设备身份保存于 Application Support/TSNotes Bridge Peng/<Vault UUID>.presentation.json；只包含版本与 windowLayoutId。窗口关闭只使内存引用失效，持久身份供布局恢复核对；卸载不关闭用户窗口。损坏设备文件先备份，再原子写入新身份。

## 检查结果

Node 24 环境的 npm run typecheck、npm test、npm run build、git diff --check 全部通过，最终 49/49 测试通过。新增 15 项覆盖模式、容器保护、窗口和标签复用、恢复、并发、失败、文件保护、原生初始化时序和关闭后的空窗口引用；原有记录、链接、播放和服务端测试继续通过。

真实运行补充了两个自动化中容易遗漏的细节：遍历回调必须不返回真值，避免原生遍历提前结束；销毁后的窗口 win 引用可能为 null。弹出窗口文档归属还可能异步完成，因此使用操作内最多 5 秒的等待，不创建常驻轮询。

开发中一次测试夹具失败后，曾误重载上一份构建；已改为检查、构建和部署串行执行。最终部署产物与源码构建逐字节一致，以下最终运行结果均在最终构建上复核。

## 有限真实验收

使用原 Math Peng；测试直接打开已有文件，没有新建 Vault 或视频笔记：

- TSNotes QA Retained/Homebrew renamed.md
- TSNotes/Videos/_records/Lec 38   MIT 18.01 Single Variable Calculus, Fall 2007.md

| 动作 | 实际结果 |
| --- | --- |
| 打开 A、B，再打开 A | 一个专用窗口、两个标签；原主窗口内容保留，A 未重复开标签 |
| 设置界面选择主窗口新标签页 | 实际设置控件可见并保存；A 在主窗口新开，再次打开复用同一标签 |
| 设置切回专用窗口 | 复用已有专用窗口，主窗口中的 A 保留 |
| 关闭本轮专用窗口再打开 | 从旧 ID 007f41e4bc8dfc45 重建为 4ff8df9cde0a5d1b；原普通独立窗口仍保留 |
| 最终构建再次打开 A、B、A | 专用窗口仍有两个标签；总浮动窗口数为 2，其中一个是用户原有普通窗口 |
| 最终构建后定向插件重载 | 恢复 ID 4ff8df9cde0a5d1b，窗口 ID 集合和标签数量不变 |
| Ego Lite 点击一次页面 Save 按钮 | 目标明确为 Math Peng；提示“Obsidian · Math Peng · 已保存视频记录”，笔记在专用窗口打开 |
| 专用窗口中点击正文 TSNotes 链接 | 使用真实渲染 DOM 的 click，操作 ec69a3c1… 两端回报 located |
| 专用窗口中点击 Property 链接 | 使用实际 metadata-link-inner 控件的 click，操作 f41a33b7… 回报 located |

链接验收使用 Obsidian CLI 对真实渲染元素触发 click，没有使用物理鼠标手势。没有真实 Notion 写入，没有重跑三站完整链或压力测试。

两篇验收文档的 SHA-256 与测试前一致，未修改正文、Properties 或 UUID；没有改写 Playlist 关系或 Base。插件设置与首次部署前相比仅新增 recordOpenMode=window；配对字段、其他配置保留。改变的是工作区布局、设备展示身份和正常播放诊断。

## 部署与恢复

只部署 main.js / manifest.json，通过 Obsidian CLI 定向 reload；部署脚本保留 data.json，并在存在时备份设备展示文件。最终安装产物逐字节匹配构建。

- 本轮开始时 0.1.13 原始产物／设置备份：/var/folders/wf/223yfjfj2vz2ncc59zhzr2240000gn/T/tsnotes-bridge-backup-VhQqXf
- 最终部署前的运行产物／设置／展示身份备份：/var/folders/wf/223yfjfj2vz2ncc59zhzr2240000gn/T/tsnotes-bridge-backup-tmILaP
- 验收文件哈希基线：/var/folders/wf/223yfjfj2vz2ncc59zhzr2240000gn/T/tsnotes-window-qa-l3fzr915/baseline.json

回退时先校验目标仍为本轮产物，再恢复明确版本的 main.js / manifest.json 并定向 reload。不自动覆盖当前 data.json、不改写工作区布局、不关闭用户窗口。旧版本忽略新增展示配置即可。

## 保留状态与限制

- 最终保留 TSNotes 专用窗口及两个验收文件标签、主窗口测试增加的 A 标签；用户原普通窗口未关闭。设置恢复为默认 window。
- Ego Space 5，TSNotes note window QA；保留 p1 YouTube 验收页和 p2 配对页。没有 handOff 或 finish；交付前实时观察 ownership=agent，Space 和页面保持打开。
- 没有为了验收退出整个 Obsidian。应用完全重启恢复以新工作区布局恢复自动化用例覆盖，真实应用重启未实测。
- Tabbit 未测试。
- 现有 Advanced Canvas 在原生弹出窗口事件中仍报 adoptedStyleSheets 跨文档错误；此前已有同类日志，本轮未修改或禁用该插件。实际窗口显示、切换和 TSNotes 链接定位已通过，不能据此宣称该第三方错误已解决。
