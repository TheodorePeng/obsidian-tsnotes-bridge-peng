# 本机桥接协议 1.2（HTTP 兼容 1.0、1.1）

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

旧冷启动标记 `__tsnotes_vault` 和 `__tsnotes_ticket` 继续解析；1.2 不再以票据有效为本地公开视频播放前提。旧票据 HTTP 接口保留兼容，但新入口使用下述操作标记。

禁止通用正文写入、文件读写、脚本执行、删除和任意路径接口。相同 TSNotesID 冲突、来源身份歧义、损坏 YAML、关系文件损坏或丢失均停止受影响操作。机器密钥与端口只在 Application Support 和浏览器本地 storage，Vault 设置只有稳定的非敏感 Vault ID、目录与字段配置。

## 1.1 客户端路由与时间链接

HTTP 路径不变，元数据操作继续接受 protocolVersion 1.0 和 1.1。无正文写入操作。

WebSocket 首帧使用 `{type:"auth", secret, protocolVersion:"1.1", clientId, clientName, sessionId, capabilities:["play","capture-link"]}`。clientId 为该浏览器本地稳定 UUID，不进入配置导出；sessionId 为本次播放连接身份。服务端按 clientId 保存连接，最多 8 个，重复在线 ID 拒绝。旧认证可连接但不自动成为新命令目标；新功能要求更新并显式绑定。

每个 Vault 的 Application Support 设置保存 browserBundle → clientId 绑定。目标未绑定、离线或缺少能力分别返回 browser_not_bound、browser_disconnected、browser_update_required。保存目标 Vault 下拉菜单不影响播放/采样路由。浏览器切换、断开和卸载取消待处理请求。

- 采样请求：`{type:"capture-link",requestId,sessionId,expiresAt}`，8 秒过期，不自动重试。
- 回执：`{type:"capture-link-result",requestId,sessionId,result}`。
- 成功 result：`{success:true,url,seconds,sampledAt,sessionId,playbackIdentity}`；失败 `{success:false,reasonCode}`。
- 服务端核对请求、连接对象、播放 session、目标绑定及回执类型。另一客户端、旧 session、超时或迟到回执不能完成请求。
- 现有 play 请求/回执增加 sessionId，由服务端先选择绑定客户端，20 秒等待、19 秒执行期限保持不变。
- consume-launch / launch-result 额外提供 clientId；30 秒票据关联目标 clientId 与 browserBundle，切换目标即失效。

采样仅从受管理 VideoPlay 读取 URL/媒体时间，并核对 tab/window/角色和 documentId，期间导航则拒绝。暂停与 0 秒有效；广告、加载中及不可靠直播返回错误。URL 保留业务 query 原编码，删除旧受管参数与启动标记后，追加唯一 `t=<整数>s&type=TSNotes`（fragment 前）。Obsidian 自行验证允许站点、时间、标记、采样新鲜度，并生成时间标签，不接受任意正文。

本地插入命令通过 Obsidian 编辑器单次事务写入，校验发起时的文件、编辑器、文本、选区和目标 epoch；不增加远程文本/路径接口。复制和插入均不调用浏览器原复制/Notion 自动粘贴流程。

## 1.2 断连播放与独立恢复

现代认证接受 1.1、1.2，ready 返回 1.2；新增能力 `playback-v2`。新扩展遇到旧服务端 ready 1.1 时，以原 clientId 降级重新认证一次，保留旧 Vault 的播放／采样能力；不会匿名接管或改绑。HTTP 路径、密钥、Origin 验证保持原状；支持版本 1.0、1.1、1.2。

- play 请求可带 operationId。1.2 客户端立即回 `{type:"play-accepted",requestId,operationId,sessionId}`；Obsidian 最多等 1.5 秒，未确认只打开一次 URL 保底。已经接收的任务不因实时连接中断而取消或自动重开。
- 新 URL 临时参数 `__tsnotes_open=<base64url JSON>`：`{v:2,operationId,vaultId,expectedClientId?}`。它只是关联信息，不能认证、读写 Vault 或修改绑定。持久链接和采样输出不包含此参数。无效临时信息退为普通 TSNotes 链接；旧票据失效不阻断有效视频本地播放。
- 所有入口使用同一浏览器播放协调器。接管限时 15 秒，媒体定位限时 30 秒；VideoPlay 身份确认后才清理本次明确记录的来源页。最终播放页和已导航到其他地址的来源页保留。每个实例内相同操作 ID 去重，连续新操作取代旧定位，不跨 Profile 管理窗口。
- 新认证 HTTP 操作 `report-playback` 的 payload 为 `{operationId,clientId,phase,reasonCode?,windowReady?}`。phase 为 received / window-ready / located / failed。只能报告目标仍有效且未过期的已登记操作；阶段不可倒退，不能覆盖终态。其他已配对实例可报告本地播放并标记不匹配，不能改绑或成为采样目标。
- 操作关联保留 120 秒，诊断仅保留最近 20 次的时间、操作 ID、站点、阶段、错误代码及实例短标识。未知结果记录为 unconfirmed，不冒充播放失败。位置成功与暂停状态分开反馈。设备诊断保存在 Application Support／浏览器本地 storage，不含完整视频 URL、私人路径、密钥或笔记正文。
- VideoPlay 存在时才连接，每个 Vault 最多一条；断线依次等 1、2、4、8、16 秒后停止该轮。新播放或显式重连可开始另一有限轮；健康连接不重复替换。关闭最后一个播放窗口／禁用联动时释放心跳与重试计时器。

复制／插入时间链接仍严格使用已绑定实例，不走 URL 保底、不读取其他 Profile；Notion、记录保存与原来的编辑保护契约保持不变。
