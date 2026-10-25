# Library v4 与精简属性（Bridge 0.1.16）

## 文件布局

TSNotes 根目录保留 Videos.base、Playlists.base、Library。Library 下集中保存 Videos/_records、Playlists/_records、Resources、_data；README 位于 Library/_data，Playlist Videos.base 仍在 Playlist 索引旁。根目录设置的含义不变，Library 是固定内部层级。

视频和 Playlist 通过 TSNotesID、来源身份和查重字段定位。资源通过 ResourceID、TSNotes Parent ID、资源类型和语言定位。移动不改变身份；总览按身份筛选，不按文件夹限定范围。共享 Playlist Base 的 this 指向嵌入它的 Playlist，用 Playlist IDs 和有序 Videos 链接显示成员与顺序。

_data/playlists 是正式成员关系数据，需随 Vault 备份，不能当缓存删除。Resources 只在实际导入时创建，主笔记正文仍留给个人笔记。NotionImporter 获取服务器决定的资源目录，无需更改配对或保存目标。

## 属性

- 不再写入 Title、Duration Seconds、Parent Path；旧映射不能重新启用它们。文件名作为标题，浏览器来源标题仍用于首次命名。
- Duration 保存 MM:SS 或 HH:MM:SS，缺失时可由输入的数值秒数格式化。Base 的 DurationSeconds 仅计算、不写回、不默认显示。
- Created time 保留原始时刻；UTC 的 Z 不移除。所有 ID 均为文本，避免精度损失。
- 简洁属性显示默认开启，只隐藏有效 TSNotes 记录或资源笔记中的技术字段及空日常字段。未知个人属性继续显示，不改变 Pretty Properties 的全局名单。
- Toggle technical properties for current note 临时显示当前视图的完整属性。切换笔记会重置临时显示；源码模式可查看原 YAML。
- 原生属性类型通过 Obsidian 原生属性管理界面或 CLI property:set 的 type 设置并核实。类型按名称作用于 Vault；迁移预览列出同名冲突，冲突字段不自动转换。插件不调用私有类型管理器。

建议类型：Created time、Imported time、Updated time 为 Date & time；Published、Uploaded 为 Date；关系、别名、来源身份为 List；Total Videos、Source Total Videos 为 Number；ID、URL、Duration 为 Text。

## 迁移

命令 Preview Library and property migration 或设置中的迁移预览生成完整本机清单。清单列出文件路径、校验值、属性原值、标题/时长差异、外部引用、类型审计与冲突。只有确认同一个摘要且文件状态未变化，才执行迁移。

默认阻止更新 TSNotes QA Retained 的引用。若此目录引用了共享 Base，必须明确勾选列出的具体笔记，只授权更新内链；不会移动或清理 QA 目录。未授权时不执行迁移。

执行前拒绝未保存编辑、未完成的资源上传、重复身份、目标冲突、无效 YAML、损坏关系与自定义 Base 中未解决的废弃属性引用。写入期间暂停记录和资源任务；普通保存及资源导入在旧布局下会提示迁移，不创建另一套文件。

目录移动使用 Obsidian 原生文件管理接口。原生链接缩写和 YAML 格式调整仅在目标和内容语义一致时接受。技术属性清理只作用于本次目录内的受管理记录；目录外 Title 等属性保留。已有 Base 只修改所需公式，保留视图、筛选、排序、列宽及其他自定义；README 新说明附带折叠保留的旧说明。

资源生成基线：只有迁移前正文仍匹配 Imported Body Hash，才可为已核实的链接改写更新基线；用户修改过的正文保留旧基线，后续更新继续拒绝覆盖。

## 备份、恢复与回滚

设备本地目录：Application Support/TSNotes Bridge Peng/library-v4/<Vault UUID>/<任务 UUID>/。

- preview.json / preview.md：确认清单。
- files/<SHA-256>：不可变内容备份，含二进制图片以及各个已核实阶段的内容。
- journal.json：路径、阶段、预期校验值及未完成步骤。

Resume Library migration 恢复任务。中断发生在原生移动后时，核对旧/新位置、所有受影响文件和内链语义后才接受该步骤；不靠旧 tab ID、文件名或人工猜测推进。

Roll back Library migration 在确认后恢复目录和原始内容。任何后续修改、目标路径冲突、损坏备份或新引用都会停止，不覆盖新内容。原生属性类型变更属于后续独立操作；变更后回滚若发现 types.json 已变化也会停止，需先审核，不自动恢复全 Vault 类型。

新建期间发生错误时，记录写入与打开结果仍分别报告。迁移不修改播放协议、Notion 保存、字幕采集、时间链接命令或专用窗口复用。
