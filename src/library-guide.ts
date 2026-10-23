interface GuidePaths {
  root: string; videos: string; playlists: string;
  videoBase: string; playlistBase: string; membersBase: string;
}

export function libraryGuideContent(paths: GuidePaths): string {
  const { root, videos, playlists, videoBase, playlistBase, membersBase } = paths;
  const videoFolder = videoBase.slice(root.length + 1, videoBase.lastIndexOf("/"));
  const playlistFolder = playlistBase.slice(root.length + 1, playlistBase.lastIndexOf("/"));
  const fence = "```";
  return `# TSNotes 视频库使用说明

这份说明和共享的 Playlist Videos.base 放在一起，便于以后查阅和修改。它不是 Playlist 记录，不会出现在 Playlist 总览中。你可以补充自己的说明，插件只在文件缺失时创建它，不会在保存视频或重新加载时覆盖已有内容。

## 日常从哪里开始

- 视频总览：[[${videoBase}]]，浏览 Vault 中的全部 TSNotes 视频。
- Playlist 总览：[[${playlistBase}]]，点击某个课程或列表，进入它的索引笔记。
- 共享视图：[[${membersBase}]]，集中设置每个 Playlist 内的表格样式。直接打开没有数据是正常的，原因见下文。

## 文件结构与职责

${fence}
${root}/
├── ${videoFolder}/
│   ├── Videos.base              视频总览
│   └── _records/                每个视频的唯一主笔记
├── ${playlistFolder}/
│   ├── Playlists.base           Playlist 总览
│   └── _records/
│       ├── README.md           当前说明文档
│       ├── Playlist Videos.base 共享视图规则
│       └── 各个 Playlist.md     身份、成员链接、个人说明和视图嵌入
└── _data/
    └── playlists/
        └── UUID.json           插件维护的列表成员和来源顺序
${fence}

上面的目录树中，视频实际存放于 ${videos}，Playlist 索引实际存放于 ${playlists}。同一视频加入多个 Playlist 时，仍然只保留一篇主笔记，不会在每个列表下复制视频文件。

Markdown 保存 Properties 和你的正文；Base 保存筛选、计算列和展示样式。表格里的一行通常对应真实的 Markdown 文件，Base 本身没有再保存一套视频资料。

## 为什么共享 Base 单独打开为空，嵌入后却能显示内容

在某个 Playlist 索引笔记的正文中嵌入：

${fence}
![[${membersBase}]]
${fence}

这里使用了 Obsidian 原生的上下文规则：

| 写法 | 含义 |
| --- | --- |
| note | 正在接受筛选的某篇视频笔记 |
| file | 正在接受筛选的那个文件 |
| this | 共享 Base 当前所在的上下文；嵌入时，就是承载它的 Playlist 笔记 |

共享 Base 主要执行以下判断（这是语法说明，不需要粘进笔记的 Properties）：

${fence}
note["Record Type"] == "video"
this["Record Type"] == "playlist"
list(note["Playlist IDs"]).contains(this.TSNotesID)
${fence}

含义是：显示所有“属于当前这个 Playlist”的视频。比如课程 A 的 TSNotesID 是 A，那么视频的 Playlist IDs 包含 A，就会出现在课程 A 中。若同时包含 A、B，它也会出现在课程 B 中，实际仍是同一篇视频笔记。这里的 A、B 只是便于理解的代称，实际字段使用插件生成的 UUID。

直接打开 Playlist Videos.base 时，this 指向 Base 文件自身；它没有 Playlist 的身份，筛选条件不成立，所以表格为空。在普通 Daily Note 中嵌入也不会自动变成某个课程，不能靠伪造或复制 TSNotesID 来指定列表。侧边栏中的 Base 还有跟随主区域活动文件的上下文规则。

共享文件是实时引用，不是每个 Playlist 各复制一份模板。因此，修改它的列、排序和显示方式，会影响所有引用它的 Playlist。

## 成员关系与顺序怎么保存

| 数据 | 作用 |
| --- | --- |
| TSNotesID | 一篇记录的稳定 UUID；改名或移动后继续识别原记录 |
| DedupeKey / DedupeAliases / DedupeURL | 根据视频网站身份查重，避免重复建笔记 |
| Record Type | 区分 video 和 playlist |
| 视频的 Playlist IDs | 所属 Playlist 的 UUID 列表，是共享 Base 筛选成员的依据 |
| 视频的 Playlists | 指向 Playlist 索引的内部链接，方便点击 |
| Playlist 的 Videos | 按顺序列出已保存成员的内部链接 |
| Playlist 的 Relations Path | 对应 _data/playlists 中的关系文件路径 |
| _data/playlists/UUID.json | 插件维护的成员身份、来源身份和来源序号 |

Base 显示时读取 Markdown 的 Properties；插件保存时维护 JSON 关系和对应的 Properties、内链。不要只手动改其中一处来增删成员，否则会与插件维护的数据不一致。维护成员时优先使用 TSNotes 的保存或列表导入入口。

List order 公式在当前 Playlist 的 Videos 链接中查找当前视频，得出 1、2、3 等位置。这是已保存成员之间的相对顺序，不一定等于网站上的原始编号。需要按课程顺序显示时，在共享 Base 的排序菜单中选择 List order 升序。公式存在但排序为空时，并不保证按这一列排列。

## 后续可以如何修改

| 需求 | 建议操作 |
| --- | --- |
| 改列宽、列顺序、排序、分组 | 在 Base 原生界面中调整 |
| 改表头文字 | 改列的显示名称，通常不必重命名底层 Property |
| 改所有 Playlist 的样式 | 修改当前目录的共享 Playlist Videos.base |
| 只有某个 Playlist 用不同样式 | 复制共享 Base，再让那个 Playlist 引用副本；副本仍需保留 this 身份筛选 |
| 改正文、备注或个人状态 | 正常编辑 Markdown 或真实属性列 |
| 改作者、时长等数据 | 打开笔记修改原始 Properties；公式列是计算展示，不是原始数据输入框 |
| 改名或移动视频、Playlist 索引 | 使用 Obsidian 文件管理操作，保留 UUID；总览按身份筛选，不局限于 _records 目录 |

Base 的 New 按钮只会创建普通文件，不会采集网站资料或生成完整 TSNotes 身份。新视频和 Playlist 仍从浏览器的 TSNotes 保存入口创建。Save to Obsidian 默认创建资料记录，重复保存以定位为主；不会替你写视频正文。你主动执行 Insert current VideoPlay timestamp link 命令时，才会向当前编辑器插入时间链接。

播放列取自 URL-TSNotes，点击后交给 TSNotes Bridge 控制该 Vault 绑定的浏览器 VideoPlay。浏览器中的“保存目标 Vault”和“从哪个 Vault 发起播放”是两个独立概念；视图筛选本身无需浏览器连接，也不会主动采集网站内容。

## 哪些文件应保留

- 当前共享 Base 及各 Playlist 中的嵌入引用需要保持对应。不要直接删除共享文件，否则成员表格无法显示。
- _data/playlists 是正式关系数据，不是缓存。请随 Vault 一起备份，不要删除整个 _data。
- 旧版本的 _data/views 在共享 Base 移出、且没有其他内容和引用后可以删除空目录；这不代表同级的 _data/playlists 可以删除。
- 不要手工更换 TSNotesID、复制一套相同 UUID，或随意修改查重与成员身份字段。
- 根目录、视频或 Playlist 保存目录改动会影响以后新建位置，不会自动搬迁所有已有笔记。改变目录布局或再次移动共享 Base 时，应同时处理插件配置、生成模板和现有引用。
- 插件普通初始化只补建缺失的视图和本说明，保留用户的修改。Review library views 是显式模板更新入口，执行前查看预览。

如果 Base 不显示内容，先确认核心 Bases 插件已启用（需要 Obsidian 1.9+）；再检查是在 Playlist 索引里查看、该笔记的 Record Type 与 TSNotesID 完整、视频的 Playlist IDs 包含该 UUID，最后检查 Base 筛选和嵌入路径。

官方语法与 this 上下文说明：https://help.obsidian.md/bases/syntax
`;
}
