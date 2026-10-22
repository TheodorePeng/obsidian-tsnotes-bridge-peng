# 本机桥接协议 1.0

HTTP `POST http://127.0.0.1:<device-port>/v1`；`Authorization: Bearer <device-secret>`。仅接受已配对 `chrome-extension://<id>` Origin。首次有效密钥请求绑定 Origin。请求最多 1 MiB，幂等缓存最多 512 条及 2 MiB，按请求 ID 与内容摘要检测冲突。批量逐项发送，不发送全部笔记正文。

```json
{"protocolVersion":"1.0","requestId":"sample-request-1","action":"ensure","payload":{"open":true,"record":{"site":"youtube","mode":"normal_video","record":{"dedupeKey":"yt:v:abcdefghijk","fields":{"title":"Example video","videoId":"abcdefghijk","url":"https://www.youtube.com/watch?v=abcdefghijk","dedupeUrl":"https://www.youtube.com/watch?v=abcdefghijk","urlTsnotes":"https://www.youtube.com/watch?v=abcdefghijk&type=TSNotes"}}}}}
```

成功响应：`{success:true, requestId, result}`。业务拒绝：`{success:false, reasonCode}`。ensure 的 result 包括 documentId、path、created、written、opened 和可选 openError，打开失败与写入成功分别返回。

| action | payload | 功能 |
| --- | --- | --- |
| ensure | record, open | 创建或定位；仅基础属性和目录关系 |
| find | record | 查找文档身份及当前相对路径 |
| refresh | record, apply, expected | apply=false 返回变化；apply=true 要求 expected.documentId 与 expected.changes 完全匹配当前预览 |
| open | documentId | 按 UUID 打开已有笔记 |
| consume-launch | ticket, url | 校验并消费 30 秒单次票据，必须匹配原 URL |
| launch-result | ticket, url, success, reason | 只接受已消费且未过期票据的单次定位回执；Obsidian 区分连接成功与定位失败 |
| status | 空对象 | 当前 Vault 身份及 VideoPlay 连接状态 |

record 使用三站现有 resolveAndPrepare 的输出，含 site、mode、record.dedupeKey、record.fields、可选 parent.dedupeKey/fields。辅助适配器字段允许缺省，不制造空属性。

WebSocket `ws://127.0.0.1:<port>/v1/events` 验证同一 Origin；首帧必须为 `{type:"auth",secret:"<device-secret>"}`，3 秒内未认证关闭。成功返回 `{type:"ready"}`。浏览器仅在已确认 VideoPlay 存在时连接；每 20 秒发送 ping，服务回复 pong。只有配对源可以发送播放：`{type:"play",requestId,url,expiresAt}`，请求在 19 秒后过期，排队超时不再导航；扩展回复 `{type:"play-result",requestId,result}`。

冷启动标记 `__tsnotes_vault` 和 `__tsnotes_ticket` 仅用于一次实际视频 URL 打开。标记按原始 query 字节添加、移除，不重新编码业务参数。长期密钥不进入 URL。保留最终标签 ID，不走旧来源页关闭分支。票据无效不认领该页面。

禁止通用正文写入、文件读写、脚本执行、删除和任意路径接口。相同 TSNotesID 冲突、来源身份歧义、损坏 YAML、关系文件损坏或丢失均停止受影响操作。机器密钥与端口只在 Application Support 和浏览器本地 storage，Vault 设置只有稳定的非敏感 Vault ID、目录与字段配置。
