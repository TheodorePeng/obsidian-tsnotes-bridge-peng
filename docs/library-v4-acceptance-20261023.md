# Library v4 验收记录

实施于 2026-10-23 至 2026-10-24。Bridge 0.1.16；TSNotes 0.8.14、NotionImporter 0.4.0 保持原版本及源代码。分支 codex/obsidian-integration；未提交、合并、推送或发布。

## 正式检查

Node 24：npm run typecheck、npm test（73/73）、npm run build、git diff --check 均通过。

新增回归包括时长解析和公式、废弃映射阻止、身份级隐藏、主/独立窗口、受保护引用、过期确认、目录/图片/关系/正文/UUID 保留、自定义 Base 保留、资源编辑保护、完整回滚、中断恢复、未保存编辑、重复身份、目标冲突、损坏日志、文件新增、完成后设置修改，以及原生缩短内链后的重复保存。

Worker 的实际隔离运行仅涉及时长工具和测试，超时后以终止失败状态结束，没有验证证据；未应用其结果。Codex 完成全部实现与验证。失败工作区保留在 external-code-worker-peng 的 20261023-201955-tsnotes-duration-helpers-b0b70f57 记录中。

## 迁移与保护

用户明确确认摘要 f138ddd1e067df8a7015aac75e9ca15c26492840074adec103b68ec227a614ab，并授权仅更新 TSNotes QA Retained/Library layout 20261022/Playlist.md 的共享 Base 内链。

任务：5d76865e-85c1-4c13-b812-6d7a9d83130b，最终 phase=complete，4 个目录移动、112 项受控内容处理。TSNotes 根目录只保留 Videos.base、Playlists.base、Library。

迁移审计：128 个文件移动；102 篇主记录属性精简；98 篇视频正文逐字节一致；5 篇资源身份保留；15 张既有图片、4 份关系 JSON 逐字节一致；1 篇用户编辑过的资源继续保留旧生成基线，不会被自动覆盖。三个 Base 的原有 views 配置完整保留。仅一篇获授权的目录外 QA 笔记发生引用更新。

36 个历史 Title 与文件名不同、1 处时长差异已记录原值和备份。Title、Duration Seconds、Parent Path 不再由 Obsidian 新建/刷新流程生成；清理范围内已删除。Vault 其他笔记仍使用的 title、Duration Seconds 保留；Parent Path 无剩余使用及类型登记，不涉及全 Vault 批量删除。

原生移动曾将带外围空格的图片嵌入缩写成短文件名，等价校验暂停了资源目录步骤。新增空格兼容回归后，从同一日志核对全部内容并恢复，没有重复移动已完成目录。

重复保存实测发现原生短 Playlist 链接与完整路径被字符串合并成两条。已改为根据 Playlist IDs 生成单一受控链接；真实按钮再次保存后，主笔记只有 1 个 Playlist ID 和 1 条归属链接。

## 界面与原生类型

示例笔记原有 22 项属性，迁移删去 3 项后保留 19 项；日常显示 7 项，其余技术字段隐藏。已验证主窗口、独立窗口，以及临时显示/恢复隐藏；源码可查看完整数据，其他笔记和 Pretty Properties 全局名单未修改。

通过 Obsidian 原生菜单把 Created time、Imported time、Updated time 设置为 Date & time。没有调用私有属性类型 API，也没有剥离 Z 或修改原始 UTC 时刻。现有列表、数字及 ID 文本由原生值类型正确显示。原生 CLI 的 datetime 输入不接受 Z/毫秒，因此未用它转换时间，改用只设置类型的原生菜单。

Base 标题采用 file.asLink(file.basename)，不显示整个存储路径。原生表格中已核对实际标题。共享 Base 嵌入吉他 Playlist 后显示 14 个成员；原有排序配置保留，可按 List order 选择课程顺序。

用临时诊断 Base 在 Obsidian 原生查询中验证 26:04 → 1564。该诊断文件校验未被修改后已移至 Obsidian Trash，不留在正式库中。

## 有限真实浏览器验收

Ego Lite 0.6.0.16；TSNotes/NotionImporter 均通过原生扩展详情核实 ID、版本及各自仓库 dist 加载路径。本轮未改这两个扩展，无额外 Reload。未触及真实 Notion 数据。

- 浏览器真实 Save to Obsidian 按钮：定位迁移后的原视频 UUID/路径，在专用窗口打开，主笔记正文保留；不重建文件，不恢复废弃属性或旧目录。
- NotionImporter 字幕重复导入：completed / skipped / opened=true，结果路径为 Library/Resources。
- AI 笔记重复导入：正确跳过已存在资源；另完成一次预览后确认更新，completed / updated / opened=true。14 张图片均使用新目录本地引用。预览文字未改变；一张图下载编码改变，已直接查看旧图和新图，内容相同。旧资源先备份，不删除旧图片。
- 初次元数据读取和一次字幕提取遇到页面响应超时；保持源视频页面激活后，字幕完整流程成功。未修改 NotionImporter 的页面超时策略。
- 在独立 Obsidian 窗口实际点击 URL-TSNotes：浏览器回执 located、windowReady=true、instanceMismatch=false，WebSocket 恢复在线。百度页面处于暂停状态，回执 playback_requires_user_gesture，需要用户点播放；没有将其虚报为已自动播放。

最终保留 Ego Space 5：TSNotes Library v4 acceptance。p1 为百度视频，p2 为 NotionImporter 页面，最后实时 ownership=agent。没有 handOff/finish。旧 Space 消失后按会话授权创建替代；Ego 提示有可用更新，未执行升级。Tabbit 未验收。

本轮未重新跑三站完整采集、压力、长时间空闲或系统重启测试；这些不作为本轮通过结论。新资源首次创建主要由正式服务测试覆盖，真实图片流程通过既有 AI 资源的受保护更新验证。

## 备份与恢复

持久备份目录：

`/Users/peng/Library/Application Support/TSNotes Bridge Peng/library-v4/ff382f3f-1bf4-4463-a5e2-c1ffb098b241/5d76865e-85c1-4c13-b812-6d7a9d83130b/`

其中 preview.json / preview.md 为清单，journal.json 为日志，files 为按 SHA-256 保存的内容备份，audit.json 为迁移审计；runtime-before 包含旧插件、data.json、类型配置及部署前校验，deployment-final.json 记录最终安装产物身份。data.json 与部署前一致，配对及浏览器绑定未替换。

AI 更新另由既有 resource-imports/<Vault UUID>/backups 保存旧资源。标题显示表达式的定向修正备份为同 Vault library-v4 目录下 title-display-backup.json。

回滚遇到后续设置、原生类型或文件修改会停止，不能强行恢复覆盖新工作。迁移后的类型设置和正常保存属于后续有效操作，需要基于现状复核回滚清单。应用未执行全量重启，只做定向插件重载。

错误缓冲存在 Advanced Canvas / Style Settings / Hover Editor 的历史 adoptedStyleSheets 跨文档异常，堆栈未指向 Bridge；不声称全局控制台无错误。
