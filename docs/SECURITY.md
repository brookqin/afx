# 安全说明

本服务面向自动化 Agent 的临时文件交换,安全模型围绕 Capability Token、租户隔离与最小权限构建。

## 信任边界

| 组件 | 信任等级 | 说明 |
|---|---|---|
| 公开下载 Token | 读能力 | 只授予下载单个文件的能力 |
| 公开上传 Token | 写能力 | 只授予向单个接收邀请上传一次文件的能力 |
| 普通 API Key | 租户凭据 | 只能访问属于自己的资源 |
| Root API Key | 管理凭据 | 只用于管理,不用于日常上传 |

## 凭据存储

- 数据库**只保存摘要**,不保存明文:
  - API Key secret:`HMAC-SHA-256(API_KEY_PEPPER, secret)`
  - 下载/上传 Token:`HMAC-SHA-256(TOKEN_HASH_PEPPER, token)`
  - Root Key:部署时通过 `ROOT_API_KEY_HASH` / `ROOT_API_KEY_PEPPER` 两个 Secret 配置
- 完整 API Key 只在创建时返回一次。
- 明文 Token 只在创建时返回调用方;日志、审计、错误响应中一律不出现。

## 租户隔离

- 所有普通 API 查询强制附加 `owner_key_id = authenticated_key_id`,不信任客户端传入的租户参数。
- 普通 API 与 Root API 使用不同路由(`/api/*` vs `/api/root/*`),不存在 `?all=true` 之类的切换开关。
- Root Key 访问普通租户路由返回 401;普通 Key 访问 Root 路由返回 401。

## 并发语义

- 下载次数与阅后即焚通过 **D1 条件更新 + RETURNING** 原子领取,禁止先查后改。
- 阅后即焚:首个获得下载权的请求独占;即使传输中断,文件仍视为已消耗。
- 一次性上传:原子领取短期直传租约;成功上传经 R2 HEAD 校验和存储侧 CopyObject 发布后 Inbox 永久 `completed`;失败可重试;
  租约过期可被重新领取;旧 Lease ID 无法完成新上传。

## 输入防护

- 文件名:取 basename、去除 NUL/控制字符、限制 255 字节、不用于 R2 Object Key。
- MIME:客户端 MIME 不可信,下载一律 `application/octet-stream` + `attachment` + `nosniff`。
- HTML:标题/描述/文件名经 JSX 自动转义。
- JSON 请求体统一限制为 64 KiB，并在解析前按流计数，不能用 chunked 请求绕过。
- 上传限制:Worker 在签发 URL 前校验声明大小,完成时用 R2 HEAD 复核实际大小；同时实施 API Key/Inbox
  上限、扩展名/MIME 辅助白名单、单文件、文件名与标题长度限制。
- R2 签名 PUT URL 最长 1 小时、默认 15 分钟,限定单个随机 Object Key 与 Content-Type；它本身是短期 bearer capability。
- PUT URL 只指向暂存 Key；HEAD 校验后由 Worker 发起 R2 存储侧 CopyObject 到最终 Key。即使旧 URL 在到期前被重复使用，也不能覆盖 ready 文件。
- 不允许通过 URL 拉取远程文件(无 SSRF 面)。

## 审计脱敏

- 不记录完整 API Key、Token、文件正文。
- 审计 metadata 字段白名单过滤。
- IP 使用日轮换盐做 HMAC:`HMAC-SHA-256(HMAC(IP_HASH_PEPPER, UTC日期), ip)`,不长期保存原始 IP。
- 用户代理限长 512。

## 公开页面

- 上传页面不展示 API Key 名称、owner_key_id、Agent 身份、内部文件 ID、R2 Object Key。
- 公开错误页统一文案,避免资源枚举;机器客户端可通过 `Accept: application/json` 获取精确错误码。

## 速率限制

首版依赖 Cloudflare Rate Limiting Rules。建议至少配置:

- 普通 API Key(按 Key)
- Root API Key
- 公开上传 Token
- 公开下载 IP
- 认证失败 IP

不要在 D1 上实现高频每请求限流。

## 已知取舍(首版)

- 文件正文由浏览器/CLI 使用 presigned PUT 直传 R2,Worker 不读取或缓冲文件正文。
- 发布阶段使用 R2 S3 CopyObject，不将暂存对象下载到 Worker；过期暂存 Key 由 Cron 幂等清理。
- 浏览器直传依赖严格的 R2 CORS allowlist；不要使用 `AllowedOrigins: ["*"]`。
- 不提供 Webhook / WebSocket 通知,Agent 使用普通轮询(2s -> 10s 退避)。
- R2 Lifecycle 作为异常残留的兜底清理。
