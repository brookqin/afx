# Agent File Exchange Service
## 基于 Cloudflare Workers、D1 与 R2 的临时文件发送与接收服务实现方案

> 文档状态：可直接用于实现  
> 目标读者：对本项目完全没有上下文的软件工程 Agent 或开发者  
> 最后更新：2026-08-01  
> 推荐实现语言：服务端 TypeScript；CLI Go

---

## 1. 项目概述

本项目要实现一个部署在 Cloudflare 上的轻量文件交换服务，主要供自动化 Agent 使用。

系统不是网盘，也不提供用户注册、登录或图形化管理后台。系统使用 API Key 识别调用方，并把每一个普通 API Key 视为独立租户。

系统提供两类核心能力：

1. **发送文件**
   - Agent 或 CLI 上传文件。
   - 系统生成临时公开下载链接。
   - 链接支持有效期、最大下载次数和阅后即焚。
   - 普通 API Key 只能管理自己上传或接收到的文件。

2. **接收文件**
   - Agent 创建一个临时、一次性上传链接。
   - 外部用户打开网页，通过该链接上传一个文件。
   - 上传链接在有效期内只允许一次成功上传。
   - 上传完成后，文件归属于创建该链接的 API Key。
   - Agent 可轮询状态并下载收到的文件。

部署时还要设置一个 **Root API Key**。Root API Key 拥有全局管理权限，可创建和吊销普通 API Key、查看全量文件、全量上传邀请、全量审计记录和统计信息。

---

## 2. 明确不做的功能

首版不实现以下功能：

- 用户注册、密码登录、OAuth 或 SSO。
- 图形化管理后台。
- 文件夹和目录树。
- 文件在线编辑。
- 文件版本管理。
- 多文件一次性接收。
- 公共文件搜索。
- 文件永久存储承诺。
- CDN 长时间缓存。
- 病毒扫描引擎。
- Webhook 通知。
- WebSocket 实时通知。
- 断点续传和大文件分片上传。
- 自定义下载页面。
- 公开上传者身份识别。

这些功能可以后续扩展，但不得阻塞首版实现。

---

## 3. 设计原则

### 3.1 最小权限

- 普通 API Key 只能访问属于自己的资源。
- Root API Key 只用于管理，不用于日常上传。
- 公开下载链接只授予下载单个文件的能力。
- 公开上传链接只授予向单个接收邀请上传一次文件的能力。

### 3.2 租户隔离

所有普通 API 查询必须自动附加：

```sql
owner_key_id = authenticated_key_id
```

禁止依赖客户端传入 `owner_key_id`。

普通 API 与 Root API 使用不同路由，不允许通过查询参数切换为全局权限。

正确：

```text
/api/files
/api/inboxes
/api/root/files
/api/root/inboxes
```

禁止：

```text
/api/files?all=true
```

### 3.3 元数据与文件本体分离

- D1 保存 API Key、文件元数据、状态、统计和审计。
- R2 保存文件二进制内容。
- R2 Object Key 不包含用户原始文件名。
- 原始文件名只保存在 D1。

### 3.4 Capability Token

公开下载链接和公开上传链接使用高熵随机 Token。

数据库只保存 Token 的 HMAC-SHA-256 摘要，不保存明文 Token。明文 Token 只在创建时返回给调用方。

### 3.5 明确并发语义

系统必须处理：

- 最后一次下载额度被多个请求同时争抢。
- 阅后即焚文件被多个请求同时访问。
- 一次性上传链接被多个请求同时提交。
- 上传过程中客户端断开。
- D1 元数据和 R2 对象暂时不一致。

首版通过 D1 条件更新实现原子状态竞争，不引入 Durable Objects。后续如出现热点并发或复杂状态协调，再按资源引入 Durable Objects。

---

## 4. 技术栈

### 4.1 服务端

- Cloudflare Workers
- TypeScript
- Hono
- Zod
- Hono JSX
- Cloudflare D1
- Cloudflare R2
- Wrangler
- Vitest
- `@cloudflare/vitest-pool-workers`

### 4.2 CLI

- Go
- Cobra
- `net/http`
- `encoding/json`
- `github.com/pelletier/go-toml/v2` 或标准 JSON 配置

### 4.3 页面

只实现服务端渲染页面：

- Hono JSX
- 原生 CSS
- 少量原生 JavaScript
- 不使用 Vue、React SPA、Nuxt 或单独 Pages 项目

### 4.4 数据访问

推荐：

- 手写 SQL Migration
- 手写 Repository
- D1 Prepared Statements
- Zod 校验输入和输出

可以使用 Drizzle 生成 Schema 或 Migration，但关键状态变更必须保留为清晰可审计的手写 SQL。

---

## 5. 系统架构

```text
                         Root API Key
                              │
                              ▼
                    ┌────────────────────┐
                    │ Cloudflare Worker  │
                    │ API/页面/签名/状态机│
                    └───────┬────────────┘
                            │
             ┌──────────────┼─────────────────┐
             │              │                 │
             ▼              ▼                 ▼
       Cloudflare D1   R2 S3 签名凭据    Worker Secrets
       元数据与状态      仅用于短期签名      Root Key / Pepper

浏览器 / CLI ───── presigned PUT（文件正文）─────▶ Cloudflare R2

普通 API Key A
├── 自己主动分享的文件
├── 自己创建的接收链接
├── 通过自己接收链接收到的文件
└── 自己的审计和统计

普通 API Key B
└── 不能读取或管理 A 的任何资源

Root API Key
└── 可读取和管理全部租户资源
```

---

## 6. 名词定义

### API Key

普通调用凭据。每一个 API Key 是一个独立租户。

### Root API Key

部署时设置的最高权限凭据，不存储在 D1。它可以管理所有普通 API Key 和全局资源。

### File

存储在系统中的一个文件。来源可能是：

- `agent_upload`：由 API Key 主动上传并分享。
- `inbox_upload`：由外部用户通过一次性上传链接上传。

### Public Download Token

公开下载链接中的随机 Token。

### Inbox

一次性文件接收邀请。由普通 API Key 创建。

### Public Upload Token

公开接收链接中的随机 Token。

### Burn After Read

阅后即焚。第一个成功获得下载权的请求使文件立即进入不可再次公开下载的状态。

### Upload Lease

一次性上传链接进入上传状态后的临时租约，用于避免并发提交并支持异常恢复。

---

## 7. 身份认证与权限

## 7.1 普通 API Key 格式

格式：

```text
afx_<key_id>_<secret>
```

示例：

```text
afx_01K3ABCDE1234567890ABCDE_XeNFBq8cuWnD1vKkY7fQf2...
```

组成：

- `afx_`：固定前缀。
- `key_id`：公开 ID，用于数据库定位。
- `secret`：至少 32 字节随机数据的 Base64URL 编码。

数据库保存：

- `id`
- `secret_hash`
- `secret_prefix`
- `status`
- `scopes`
- 配额和策略

数据库不保存完整明文 API Key。

## 7.2 普通 API Key Hash

使用：

```text
HMAC-SHA-256(API_KEY_PEPPER, secret)
```

其中 `API_KEY_PEPPER` 是 Worker Secret。

认证流程：

1. 读取 `Authorization: Bearer <api-key>`。
2. 解析前缀、`key_id` 和 `secret`。
3. 根据 `key_id` 查询 D1。
4. 检查状态是否为 `active`。
5. 使用 Pepper 对传入 Secret 计算 HMAC。
6. 使用固定时间比较校验摘要。
7. 检查 Scope。
8. 更新 `last_used_at`，可异步或限频更新。

## 7.3 Root API Key

Root API Key 通过 Worker Secret 配置：

```text
ROOT_API_KEY_HASH
ROOT_API_KEY_PEPPER
```

推荐部署时保存 Root Key 的 HMAC 摘要，而不是明文。

Root Key 格式可使用：

```text
afx_root_<secret>
```

Root Key 仅可访问 `/api/root/*`。

普通 API Key 访问 Root 路由时必须返回 `403 root_privilege_required`。

Root Key 访问普通租户路由时，建议也返回 `403`，防止日常误用。

## 7.4 Scope

普通 API Key 支持以下 Scope：

```text
files:upload
files:list
files:read
files:delete
inboxes:create
inboxes:list
inboxes:read
inboxes:delete
audit:read
stats:read
```

首版创建普通 Key 时可默认授予全部普通 Scope，但数据库和中间件必须支持 Scope 校验。

## 7.5 API Key 状态

```text
active
disabled
revoked
```

含义：

- `active`：正常使用。
- `disabled`：临时停用，可恢复。
- `revoked`：永久吊销，不应恢复。

---

## 8. Token 生成与存储

下载 Token 和上传 Token 均使用：

- 32 字节安全随机数。
- Base64URL 无填充编码。
- 数据库只保存 HMAC-SHA-256 摘要。

推荐 Worker Secret：

```text
TOKEN_HASH_PEPPER
```

Token Hash：

```text
HMAC-SHA-256(TOKEN_HASH_PEPPER, token)
```

禁止：

- 使用自增 ID 作为公开链接。
- 使用短 UUID。
- 使用文件 ID 直接作为公开 Token。
- 把 Token 明文存入审计表。
- 在日志中记录完整 Token。
- 把 API Key 或 Token 放入查询参数。

---

## 9. 数据模型

以下 SQL 使用 SQLite/D1 语法。

## 9.1 `api_keys`

```sql
CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,

    secret_hash TEXT NOT NULL,
    secret_prefix TEXT NOT NULL,

    scopes_json TEXT NOT NULL DEFAULT '[]',

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled', 'revoked')),

    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'root',
    last_used_at INTEGER,
    disabled_at INTEGER,
    revoked_at INTEGER,

    max_file_size_bytes INTEGER NOT NULL,
    max_storage_bytes INTEGER,
    max_active_files INTEGER,

    default_expire_seconds INTEGER NOT NULL,
    max_expire_seconds INTEGER NOT NULL,

    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_api_keys_status
ON api_keys(status);

CREATE INDEX idx_api_keys_created_at
ON api_keys(created_at DESC);
```

## 9.2 `files`

```sql
CREATE TABLE files (
    id TEXT PRIMARY KEY,

    owner_key_id TEXT NOT NULL,
    source TEXT NOT NULL
        CHECK (source IN ('agent_upload', 'inbox_upload')),

    object_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type TEXT,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT,

    public_token_hash TEXT UNIQUE,

    status TEXT NOT NULL
        CHECK (
            status IN (
                'uploading',
                'ready',
                'consumed',
                'expired',
                'deleted',
                'failed'
            )
        ),

    created_at INTEGER NOT NULL,
    ready_at INTEGER,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    expired_at INTEGER,
    deleted_at INTEGER,

    max_downloads INTEGER,
    download_count INTEGER NOT NULL DEFAULT 0,
    failed_download_count INTEGER NOT NULL DEFAULT 0,
    burn_after_read INTEGER NOT NULL DEFAULT 0
        CHECK (burn_after_read IN (0, 1)),

    first_download_at INTEGER,
    last_download_at INTEGER,
    bytes_served INTEGER NOT NULL DEFAULT 0,

    inbox_id TEXT,

    failure_code TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',

    FOREIGN KEY(owner_key_id) REFERENCES api_keys(id),
    FOREIGN KEY(inbox_id) REFERENCES upload_inboxes(id)
);

CREATE INDEX idx_files_owner_created
ON files(owner_key_id, created_at DESC);

CREATE INDEX idx_files_owner_status
ON files(owner_key_id, status);

CREATE INDEX idx_files_expires
ON files(expires_at);

CREATE INDEX idx_files_source
ON files(source);

CREATE INDEX idx_files_inbox
ON files(inbox_id);
```

说明：

- `public_token_hash` 对接收文件可为空，除非 Agent 后续为它创建公开下载分享。
- `max_downloads` 为 `NULL` 表示不限制次数。
- `burn_after_read = 1` 时，业务上等价于一次成功公开下载，但保留独立字段便于审计和显示。
- 私有 API 下载不增加公开 `download_count`。

## 9.3 `upload_inboxes`

```sql
CREATE TABLE upload_inboxes (
    id TEXT PRIMARY KEY,

    owner_key_id TEXT NOT NULL,
    public_token_hash TEXT NOT NULL UNIQUE,

    title TEXT,
    description TEXT,

    status TEXT NOT NULL
        CHECK (
            status IN (
                'open',
                'uploading',
                'completed',
                'expired',
                'revoked'
            )
        ),

    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    completed_at INTEGER,
    revoked_at INTEGER,

    max_file_size_bytes INTEGER NOT NULL,
    allowed_extensions_json TEXT NOT NULL DEFAULT '[]',
    allowed_content_types_json TEXT NOT NULL DEFAULT '[]',
    expected_filename TEXT,

    upload_lease_id TEXT,
    upload_lease_started_at INTEGER,
    upload_lease_until INTEGER,

    received_file_id TEXT,

    metadata_json TEXT NOT NULL DEFAULT '{}',

    FOREIGN KEY(owner_key_id) REFERENCES api_keys(id),
    FOREIGN KEY(received_file_id) REFERENCES files(id)
);

CREATE INDEX idx_inboxes_owner_created
ON upload_inboxes(owner_key_id, created_at DESC);

CREATE INDEX idx_inboxes_owner_status
ON upload_inboxes(owner_key_id, status);

CREATE INDEX idx_inboxes_expires
ON upload_inboxes(expires_at);
```

## 9.4 `audit_events`

```sql
CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    owner_key_id TEXT,

    actor_type TEXT NOT NULL
        CHECK (
            actor_type IN (
                'root_key',
                'api_key',
                'public_download',
                'public_upload',
                'system'
            )
        ),

    actor_id TEXT,

    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,

    result TEXT NOT NULL
        CHECK (result IN ('success', 'denied', 'failed')),

    request_id TEXT,
    ip_hash TEXT,
    user_agent TEXT,

    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_audit_owner_created
ON audit_events(owner_key_id, created_at DESC);

CREATE INDEX idx_audit_action_created
ON audit_events(action, created_at DESC);

CREATE INDEX idx_audit_resource
ON audit_events(resource_type, resource_id, created_at DESC);

CREATE INDEX idx_audit_request
ON audit_events(request_id);
```

## 9.5 可选 `daily_stats`

首版可以直接查询聚合审计和文件表。如果数据量增大，再加入日统计表：

```sql
CREATE TABLE daily_stats (
    stat_date TEXT NOT NULL,
    owner_key_id TEXT,
    metric TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY(stat_date, owner_key_id, metric)
);
```

---

## 10. R2 Object Key 规则

推荐：

```text
objects/<owner-key-id>/<yyyy>/<mm>/<file-id>
```

示例：

```text
objects/01K3KEYABC/2026/08/01K3FILEXYZ
```

要求：

- 不包含原始文件名。
- 不包含公开 Token。
- 不包含 API Key Secret。
- 不依赖客户端输入。
- 由服务端生成。

---

## 11. 文件状态机

```text
uploading
   │
   ├── 上传成功 ───────────────► ready
   │
   └── 上传失败 ───────────────► failed

ready
   │
   ├── 阅后即焚首次领取 ───────► consumed
   ├── 达到最大下载次数 ───────► consumed
   ├── 到期 ───────────────────► expired
   └── 主动删除 ───────────────► deleted

consumed
   └── 异步删除 R2 对象

expired
   └── 异步删除 R2 对象

deleted
   └── R2 对象应不存在
```

约束：

- `ready` 才能公开下载。
- `consumed` 不允许再次公开下载。
- `expired` 不允许下载。
- `deleted` 不允许下载。
- `failed` 只供所有者和 Root 查看。
- 私有所有者下载收到的文件不受公开下载次数限制，但仍受文件是否存在和是否已被删除限制。

---

## 12. 接收邀请状态机

```text
open
  │
  ├── 获得上传租约 ───────────► uploading
  ├── 到期 ───────────────────► expired
  └── 主动撤销 ───────────────► revoked

uploading
  │
  ├── 上传成功 ───────────────► completed
  ├── 上传失败并释放租约 ─────► open
  ├── 租约过期后重新领取 ─────► uploading
  └── 到期 ───────────────────► expired

completed
  └── 永久拒绝第二次上传
```

一次性语义是“只允许一次成功上传”，不是“只允许一次提交尝试”。

上传失败、网络断开或租约过期后，在邀请仍未过期时允许重试。

---

## 13. HTTP 路由

## 13.1 公共路由

```text
GET  /
GET  /healthz

GET  /d/:token
GET  /u/:token
POST /u/:token/initiate
POST /u/:token/complete
```

含义：

- `/`：简洁说明页，可选。
- `/healthz`：健康检查。
- `/d/:token`：公开下载。
- `/u/:token`：显示一次性上传页面。
- `/u/:token/initiate`：声明文件元数据、原子领取上传租约并签发 R2 暂存 PUT URL。
- `/u/:token/complete`：校验暂存对象并以 CopyObject 发布到最终 Key。

## 13.2 普通 API Key 路由

```text
POST   /api/files
POST   /api/files/:id/complete
GET    /api/files
GET    /api/files/:id
GET    /api/files/:id/content
DELETE /api/files/:id
GET    /api/files/:id/stats

POST   /api/inboxes
GET    /api/inboxes
GET    /api/inboxes/:id
GET    /api/inboxes/:id/file
DELETE /api/inboxes/:id

GET    /api/audit
GET    /api/stats
```

## 13.3 Root 路由

```text
POST   /api/root/keys
GET    /api/root/keys
GET    /api/root/keys/:id
PATCH  /api/root/keys/:id
DELETE /api/root/keys/:id

GET    /api/root/files
GET    /api/root/files/:id
GET    /api/root/files/:id/content
DELETE /api/root/files/:id

GET    /api/root/inboxes
GET    /api/root/inboxes/:id
DELETE /api/root/inboxes/:id

GET    /api/root/audit
GET    /api/root/stats
```

---

## 14. 统一 API 响应

成功：

```json
{
  "ok": true,
  "data": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "file_expired",
    "message": "The shared file has expired.",
    "details": {}
  },
  "request_id": "01K3REQ..."
}
```

要求：

- `code` 稳定，供 CLI 和 Agent 判断。
- `message` 面向人类。
- `details` 可选。
- 所有错误包含 `request_id`。
- 不向客户端暴露 SQL、堆栈、R2 Object Key 或 Secret。

---

## 15. 上传并分享文件

## 15.1 请求

```http
POST /api/files
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

```json
{
  "filename": "report.pdf",
  "size_bytes": 183427,
  "content_type": "application/pdf",
  "expires_in": 86400,
  "max_downloads": 3,
  "burn_after_read": false
}
```

规则：

- 未传 `expires_in` 时使用 API Key 的默认值。
- `expires_in` 不得超过该 Key 的 `max_expire_seconds`。
- 文件不得超过 `max_file_size_bytes`。
- `burn_after_read=true` 时，系统应强制 `max_downloads=1`，或拒绝冲突参数。
- 文件名必须清理为 basename。
- `size_bytes` 是声明值，完成时必须以 R2 HEAD 的对象大小复核。
- 原始 MIME 不可信，只作为元数据与 presigned PUT 的签名 Header。
- 公共下载时默认使用 `application/octet-stream`。

## 15.2 直传处理流程

1. 认证普通 API Key。
2. 校验 Scope `files:upload`。
3. 校验声明的文件名、大小、配额和过期策略。
4. 生成：
   - `file_id`
   - `public_download_token`
   - `public_token_hash`
   - `object_key`
5. 在 D1 创建 `files` 记录，状态 `uploading`，记录 `upload_expires_at`。
6. Worker 使用仅限目标 Bucket 的 R2 S3 凭据签发短期 presigned PUT URL。
7. 客户端使用返回的 Method 和 Headers 将文件正文直接 PUT 到 R2。
8. 客户端调用 `POST /api/files/:id/complete`。
9. Worker 对暂存对象执行 HEAD，确认对象存在且大小与声明完全一致。
10. Worker 发起 R2 S3 CopyObject，在存储侧复制到独立的最终 Key；旧 PUT URL 无法覆盖最终对象。
11. 更新文件为 `ready`，写入审计并返回公开下载链接。

Worker 不读取、不代理、不缓冲文件正文。浏览器直传必须配置严格的 R2 CORS Origin 白名单。

失败时：

- 未完成会话在签名 URL 过期后由 Cron 标记为 `failed` 并清理对象。
- HEAD 大小不一致时拒绝发布并删除暂存对象，客户端可在会话有效期内重试。
- 写入失败审计。

## 15.3 响应

```json
{
  "ok": true,
  "data": {
    "id": "01K3FILE...",
    "status": "uploading",
    "upload_url": "https://<account>.r2.cloudflarestorage.com/...?X-Amz-...",
    "upload_method": "PUT",
    "upload_headers": {"content-type": "application/pdf"},
    "upload_expires_at": "2026-08-01T08:15:00Z",
    "complete_url": "https://files.example.com/api/files/01K3FILE.../complete",
    "download_url": "https://files.example.com/d/<token>",
    "expires_at": "2026-08-02T08:00:00Z",
    "id": "01K3FILE..."
  }
}
```

---

## 16. 公开下载

## 16.1 下载次数定义

系统无法可靠确认客户端是否完整保存了全部字节。

因此必须采用以下定义：

> 一个请求成功获得公开下载权，并准备返回 HTTP 200 文件响应，即计为一次下载。

即使网络中途断开，该次下载仍已计数。

## 16.2 普通下载次数限制

使用单条条件更新争抢下载额度。

示例 SQL：

```sql
UPDATE files
SET
    download_count = download_count + 1,
    first_download_at = COALESCE(first_download_at, ?),
    last_download_at = ?
WHERE public_token_hash = ?
  AND status = 'ready'
  AND expires_at > ?
  AND burn_after_read = 0
  AND (
      max_downloads IS NULL
      OR download_count < max_downloads
  )
RETURNING *;
```

若没有返回记录，服务需要再查询一次以确定原因：

- Token 不存在。
- 文件已过期。
- 文件已删除。
- 下载次数耗尽。
- 文件未就绪。

不得先查询再更新，否则会产生并发竞争。

## 16.3 阅后即焚

SQL：

```sql
UPDATE files
SET
    status = 'consumed',
    consumed_at = ?,
    download_count = download_count + 1,
    first_download_at = COALESCE(first_download_at, ?),
    last_download_at = ?
WHERE public_token_hash = ?
  AND status = 'ready'
  AND expires_at > ?
  AND burn_after_read = 1
RETURNING *;
```

第一个成功更新的请求获得下载权。后续请求无法匹配 `status = 'ready'`。

文件流开始返回后，使用 `ctx.executionCtx.waitUntil()` 异步删除 R2 对象。

若传输中断，文件仍视为已消耗。这是有意设计。

## 16.4 下载次数耗尽

当非阅后即焚文件的最后一次额度被领取后，可以：

- 保持状态 `ready`，后续依靠 `download_count >= max_downloads` 拒绝；或
- 将状态更新为 `consumed`。

推荐在同一次 SQL 中根据剩余次数设置为 `consumed`，但实现复杂度较高。首版可保持 `ready`，接口展示时计算有效状态。

清理任务可将下载次数耗尽的文件转为 `consumed` 并删除 R2 对象。

## 16.5 文件响应头

```http
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="fallback.bin"; filename*=UTF-8''...
X-Content-Type-Options: nosniff
Cache-Control: private, no-store
Referrer-Policy: no-referrer
```

禁止默认 Inline 返回 HTML、SVG、XML 或 JavaScript。

## 16.6 公共错误页面

浏览器请求返回简洁 HTML，API 风格请求可根据 `Accept: application/json` 返回 JSON。

状态码：

| 情况 | HTTP |
|---|---:|
| Token 格式非法 | 400 |
| 不存在 | 404 |
| 已过期 | 410 |
| 下载次数耗尽 | 410 |
| 已阅后即焚 | 410 |
| 上传未完成 | 409 |
| R2 对象缺失 | 404 或 500 |
| 内部错误 | 500 |

为降低资源枚举信息泄露，也可以将不存在、过期、耗尽统一为：

```text
404 File not found or no longer available
```

首版建议公开页面统一文案，但 API Key 私有接口返回精确状态。

---

## 17. 私有文件下载

普通 API Key 可以下载属于自己的文件：

```text
GET /api/files/:id/content
```

规则：

- 必须匹配 `owner_key_id`。
- 不消耗公开下载次数。
- 不触发阅后即焚。
- 文件处于 `deleted` 时拒绝。
- 对于 `consumed` 或 `expired` 文件，如果 R2 对象尚未清理，是否允许所有者下载需要明确。

推荐安全语义：

- `ready`：允许。
- `expired`：拒绝。
- `consumed`：拒绝。
- `deleted`：拒绝。
- `failed`：拒绝。

接收到的文件默认应有独立保留期，Agent 必须及时下载。

Root 私有下载遵循相同文件状态规则，除非显式实现“取证读取”能力。首版不实现绕过状态。

---

## 18. 创建一次性接收链接

## 18.1 请求

```http
POST /api/inboxes
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

请求体：

```json
{
  "expires_in": 3600,
  "max_file_size_bytes": 104857600,
  "title": "请上传诊断日志",
  "description": "请上传 ZIP 或日志文件",
  "allowed_extensions": [".zip", ".log"],
  "allowed_content_types": [
    "application/zip",
    "text/plain"
  ],
  "expected_filename": null
}
```

规则：

- 必须验证 `inboxes:create` Scope。
- 到期时间不得超过 API Key 策略。
- `max_file_size_bytes` 不得超过 API Key 最大文件大小。
- `title` 和 `description` 需要长度限制并在 HTML 中转义。
- 扩展名和 MIME 过滤只属于辅助校验，不是安全边界。
- 上传后的文件始终强制附件下载。

## 18.2 创建流程

1. 生成 `inbox_id`。
2. 生成 32 字节随机公开上传 Token。
3. 保存 Token HMAC。
4. 创建状态为 `open` 的记录。
5. 写审计 `inbox.created`。
6. 返回明文上传 URL。

响应：

```json
{
  "ok": true,
  "data": {
    "id": "01K3INBOX...",
    "upload_url": "https://files.example.com/u/<token>",
    "expires_at": "2026-08-01T10:00:00Z",
    "status": "open"
  }
}
```

---

## 19. 公共上传页面

路由：

```text
GET /u/:token
```

页面展示：

- 邀请标题。
- 邀请描述。
- 最大文件大小。
- 允许的扩展名提示。
- 到期时间。
- 文件选择控件。
- 上传按钮。
- 上传进度。
- 上传成功提示。
- 中文/英文切换。

页面不得展示：

- API Key 名称。
- owner_key_id。
- Agent 身份。
- 内部文件 ID。
- R2 Object Key。
- 其他文件信息。
- Root 或租户管理入口。

页面状态：

| Inbox 状态 | 页面 |
|---|---|
| open | 显示上传表单 |
| uploading | 显示已有上传正在进行 |
| completed | 显示链接已使用 |
| expired | 显示链接已过期 |
| revoked | 显示链接已失效 |

---

## 20. 一次性上传并发控制

## 20.1 领取上传租约

生成：

- `lease_id`
- `lease_until = now + lease_duration`

推荐租约时长：

```text
10 分钟
```

原子 SQL：

```sql
UPDATE upload_inboxes
SET
    status = 'uploading',
    upload_lease_id = ?,
    upload_lease_started_at = ?,
    upload_lease_until = ?
WHERE public_token_hash = ?
  AND expires_at > ?
  AND (
      status = 'open'
      OR (
          status = 'uploading'
          AND upload_lease_until < ?
      )
  )
RETURNING *;
```

只有成功返回记录的请求获得上传权。

## 20.2 上传流程

1. 校验 Token 格式并计算 Hash。
2. 领取上传租约。
3. 校验声明的文件大小、文件名、扩展名和 MIME 提示。
4. 创建 `files` 记录，状态为 `uploading`：
   - `owner_key_id = inbox.owner_key_id`
   - `source = inbox_upload`
   - `inbox_id = inbox.id`
5. 返回暂存 Key 的短期 presigned PUT URL 和独立 `upload_id`，浏览器直接把文件正文 PUT 到 R2。
6. 浏览器调用 `/u/:token/complete`；Worker 校验 Token、Lease、`upload_id` 并 HEAD R2 对象。
7. HEAD 确认对象存在且大小一致后，用 R2 CopyObject 提升到独立最终 Key。
8. 将文件状态更新为 `ready`。
9. 原子完成 Inbox：

```sql
UPDATE upload_inboxes
SET
    status = 'completed',
    completed_at = ?,
    received_file_id = ?,
    upload_lease_id = NULL,
    upload_lease_started_at = NULL,
    upload_lease_until = NULL
WHERE id = ?
  AND status = 'uploading'
  AND upload_lease_id = ?;
```

10. 写审计：
   - `inbox.upload_completed`
   - `file.upload_completed`
11. 返回成功页面。

## 20.3 上传失败

若直传或确认失败：

1. 在仍持有当前 Lease 时可重新发起；新租约会使旧 `uploading` 文件失效。
2. HEAD 大小不一致或完成阶段丢失 Lease 时，将文件更新为 `failed` 并删除 R2 对象。
3. 未确认的会话等 presigned URL 过期后由 Cron 标记并清理，避免“先删后被旧 URL 重传”。
4. 仅当当前 Lease ID 仍匹配时释放租约：

```sql
UPDATE upload_inboxes
SET
    status = 'open',
    upload_lease_id = NULL,
    upload_lease_started_at = NULL,
    upload_lease_until = NULL
WHERE id = ?
  AND status = 'uploading'
  AND upload_lease_id = ?
  AND expires_at > ?;
```

若邀请已经过期，则更新为 `expired`。

## 20.4 一次成功上传

当 `status = completed` 后，任何新的提交均返回：

```text
410 upload_link_already_used
```

不得允许覆盖或替换已收到文件。

---

## 21. Agent 获取收到的文件

## 21.1 查询 Inbox

```text
GET /api/inboxes/:id
```

响应：

```json
{
  "ok": true,
  "data": {
    "id": "01K3INBOX...",
    "status": "completed",
    "expires_at": "2026-08-01T10:00:00Z",
    "file": {
      "id": "01K3FILE...",
      "filename": "logs.zip",
      "size_bytes": 2817344,
      "content_type": "application/zip",
      "created_at": "2026-08-01T09:15:00Z"
    }
  }
}
```

## 21.2 下载收到文件

```text
GET /api/inboxes/:id/file
```

等价于受租户认证保护的私有文件下载。

校验：

- Inbox 属于当前 API Key。
- Inbox 状态为 `completed`。
- `received_file_id` 存在。
- File 属于当前 API Key。
- File 的 `inbox_id` 与 Inbox 一致。
- R2 对象存在。

## 21.3 轮询策略

首版 Agent 使用普通轮询：

- 初始间隔 2 秒。
- 逐步增加到 10 秒。
- 增加少量随机抖动。
- 到达用户指定超时后停止。
- 如果 Inbox 已过期、撤销或完成，应立即停止轮询。

不实现 Webhook 和长轮询。

---

## 22. 文件列表

## 22.1 普通租户

```text
GET /api/files
```

查询参数：

```text
cursor
limit
status
source
created_from
created_to
```

要求：

- 强制 `owner_key_id = authenticated_key_id`。
- 默认按 `created_at DESC, id DESC`。
- 使用游标分页，避免深 OFFSET。
- `limit` 默认 50，最大 200。

返回字段不得包含：

- `object_key`
- `public_token_hash`
- API Key Secret
- 原始 IP

## 22.2 Root

```text
GET /api/root/files
```

额外支持：

```text
owner_key_id
filename
```

Root 返回也不应默认返回 `object_key` 和 Token Hash。仅在专用诊断接口中提供内部字段。

---

## 23. API Key 管理

## 23.1 创建 Key

```text
POST /api/root/keys
```

请求：

```json
{
  "name": "codex-agent",
  "scopes": [
    "files:upload",
    "files:list",
    "files:read",
    "files:delete",
    "inboxes:create",
    "inboxes:list",
    "inboxes:read",
    "inboxes:delete",
    "audit:read",
    "stats:read"
  ],
  "max_file_size_bytes": 104857600,
  "default_expire_seconds": 86400,
  "max_expire_seconds": 604800
}
```

响应只在创建时返回完整 API Key：

```json
{
  "ok": true,
  "data": {
    "id": "01K3KEY...",
    "name": "codex-agent",
    "api_key": "afx_01K3KEY..._<secret>",
    "secret_prefix": "XeNFBq8c",
    "created_at": "2026-08-01T08:00:00Z"
  }
}
```

之后无法再次读取完整 Key。

## 23.2 禁用和恢复

```text
PATCH /api/root/keys/:id
```

请求：

```json
{
  "status": "disabled"
}
```

恢复只允许：

```text
disabled -> active
```

禁止：

```text
revoked -> active
```

## 23.3 吊销

```text
DELETE /api/root/keys/:id
```

请求：

```json
{
  "resource_policy": "keep"
}
```

支持：

```text
keep
revoke_inboxes
revoke_all
delete_all
```

语义：

- `keep`
  - 只吊销 API Key。
  - 已有公开下载链接和接收链接保持原状态。

- `revoke_inboxes`
  - 吊销 API Key。
  - 将所有未完成 Inbox 更新为 `revoked`。
  - 已有公开下载链接保持。

- `revoke_all`
  - 吊销 API Key。
  - 未完成 Inbox 失效。
  - 所有 `ready` 文件更新为 `deleted` 或 `consumed`。
  - 异步删除 R2 文件。
  - 保留元数据和审计。

- `delete_all`
  - 吊销 API Key。
  - 删除所有 R2 对象。
  - 元数据采用软删除，不执行物理 DELETE。
  - 审计记录永久保留或按全局策略清理。

默认使用 `keep`，避免误删。

---

## 24. 删除文件

普通 API：

```text
DELETE /api/files/:id
```

流程：

1. 校验所有权。
2. 将状态原子更新为 `deleted`。
3. 设置 `deleted_at`。
4. 异步删除 R2 对象。
5. 写审计。

重复删除应幂等返回成功。

D1 元数据默认保留，用于审计和统计。

---

## 25. 过期与清理

## 25.1 逻辑过期

每次访问文件或 Inbox 时，首先检查 `expires_at`。

过期资源立即拒绝访问，不依赖物理清理是否已经完成。

## 25.2 定时清理

使用 Workers Cron Trigger，例如每小时执行一次。

任务：

1. 将到期的 `ready` 文件更新为 `expired`。
2. 将到期的 `open` 或 `uploading` Inbox 更新为 `expired`。
3. 删除对应 R2 对象。
4. 清理已 `consumed`、`expired`、`deleted` 的残留 R2 对象。
5. 清理超时 `uploading` 文件。
6. 写入系统审计或清理指标。

必须分页处理，每次限制批量数量，避免单次 Cron 超时。

## 25.3 R2 Lifecycle

可配置 R2 Lifecycle 作为兜底，但它不能代替 D1 的精确逻辑过期。

建议：

- D1 决定资源是否可访问。
- Cron 负责常规物理删除。
- R2 Lifecycle 负责异常残留兜底。

---

## 26. 审计

建议事件：

```text
api_key.created
api_key.disabled
api_key.enabled
api_key.revoked

file.upload_started
file.upload_completed
file.upload_failed
file.download_authorized
file.download_denied
file.private_downloaded
file.expired
file.deleted
file.cleanup_failed

inbox.created
inbox.upload_claimed
inbox.upload_completed
inbox.upload_failed
inbox.upload_denied
inbox.expired
inbox.revoked

auth.failed
root.auth_failed
rate_limit.denied
```

审计要求：

- 不记录完整 API Key。
- 不记录完整公开 Token。
- 不记录文件正文。
- Metadata 必须做字段白名单。
- 用户代理限制长度。
- IP 建议使用日轮换盐做 HMAC，避免长期保存原始 IP。
- 每个请求生成 `request_id`。

IP Hash：

```text
HMAC-SHA-256(IP_DAILY_SALT, ip)
```

日轮换 Salt 可由固定 Secret 和 UTC 日期派生。

---

## 27. 统计

## 27.1 文件级统计

```json
{
  "download_count": 2,
  "max_downloads": 5,
  "failed_download_count": 3,
  "first_download_at": "...",
  "last_download_at": "...",
  "bytes_served": 367828,
  "status": "ready"
}
```

注意：`bytes_served` 难以精确确认客户端实际收到的字节。首版可记录被授权响应的文件大小累计值，并命名为：

```text
authorized_bytes
```

避免误称实际流量。

## 27.2 租户统计

- 文件总数。
- 活跃文件数。
- 已过期文件数。
- 当前存储字节数。
- 主动上传数。
- Inbox 接收文件数。
- 创建 Inbox 数。
- 完成 Inbox 数。
- 公开下载授权次数。
- 失败下载次数。

## 27.3 Root 全局统计

在租户统计基础上增加：

- API Key 数量和状态。
- 按 API Key 的资源使用。
- 全局存储量。
- 最近失败和异常。
- 清理失败数。

首版可以实时聚合。数据量增大后再维护 `daily_stats`。

---

## 28. 安全要求

## 28.1 文件名

必须：

- 取 basename。
- 去除 NUL。
- 去除控制字符。
- 限制 UTF-8 字节长度。
- 不允许用于 R2 Object Key。
- 生成安全 `Content-Disposition`。

## 28.2 MIME

客户端 MIME 不可信。

下载默认：

```text
application/octet-stream
Content-Disposition: attachment
X-Content-Type-Options: nosniff
```

## 28.3 HTML 转义

Inbox 的标题、描述、文件名必须通过 JSX 自动转义或显式安全转义。

禁止拼接未经转义的 HTML。

## 28.4 上传限制

必须同时实施：

- API Key 最大文件大小。
- Inbox 最大文件大小。
- initiate 阶段声明大小预检查。
- complete 阶段 R2 HEAD 实际对象大小复核。
- 短期 presigned URL 和 Inbox 租约。
- 扩展名与 MIME 辅助白名单。
- 单次只允许一个文件。
- 文件名长度限制。
- 标题和描述长度限制。
- JSON 元数据请求体在解析前按流限制为 64 KiB。

## 28.5 速率限制

至少按以下维度限频：

- 普通 API Key。
- Root API Key。
- 公开上传 Token。
- 公开下载 IP Hash。
- 认证失败 IP Hash。

可先使用 Cloudflare Rate Limiting Rules；如需应用内实现，可维护轻量计数，但不要使用 D1 作为高频每请求限流器。

## 28.6 CORS

普通 API 和 Root API 默认不开放任意源 CORS。R2 Bucket 只允许实际站点 Origin 使用 `PUT`，
允许 `Content-Type`，不得使用通配 Origin；presigned URL 不能替代 CORS 策略。

CLI 不受浏览器 CORS 限制。

## 28.7 CSRF

普通 API 使用 Bearer Token，不依赖 Cookie，因此无传统 Cookie CSRF。

公开上传依赖 URL Token，表单提交应验证：

- Token。
- 同源。
- 可选 Origin。
- 上传租约。

## 28.8 日志脱敏

日志中对以下内容脱敏：

- Authorization。
- API Key。
- 下载 Token。
- 上传 Token。
- 文件正文。
- Root Secret。
- Pepper。
- 完整原始 IP。

## 28.9 SSRF

首版无 Webhook 和远程 URL 抓取，因此不得实现“通过 URL 上传文件”。

只接受客户端向签名 R2 Object Key 直接上传的文件，不接受远程 URL 抓取。

---

## 29. 页面设计

只需要三个模板：

### 上传页面

用于 `/u/:token`：

- 简洁卡片。
- 标题和说明。
- 文件选择。
- 上传进度。
- 上传状态。
- 仅包含语言切换，不包含业务导航栏。
- 无账户入口。

### 成功页面

```text
文件上传成功，可以关闭此页面。
```

### 错误页面

覆盖：

- 链接不存在。
- 链接已过期。
- 链接已使用。
- 文件过大。
- 类型不允许。
- 上传失败。
- 下载资源不可用。

页面首版支持英文 `en` 和简体中文 `zh-CN`，语言资源分别存放，组件内不得内嵌双份文案。
语言选择优先使用 `?lang=`，其次解析带权重的 `Accept-Language`，最终回退到 `zh-CN`。
机器可读 JSON 错误码与响应结构不做本地化。

---

## 30. CLI 设计

二进制名称建议：

```text
afx
```

CLI 界面与人类可读输出保持英文，不随 Worker 页面 locale 切换。

## 30.1 配置

环境变量：

```text
AFX_ENDPOINT
AFX_API_KEY
AFX_ROOT_API_KEY
```

配置文件：

```text
~/.config/afx/config.toml
```

优先级：

```text
命令行参数 > 环境变量 > 配置文件
```

普通 Key 和 Root Key 建议使用不同 Profile。

## 30.2 命令

### 上传分享

```bash
afx upload report.pdf
afx upload report.pdf --expires 24h
afx upload report.pdf --downloads 3
afx upload report.pdf --burn
afx upload report.pdf --json
```

### 文件管理

```bash
afx files list
afx files info <file-id>
afx files download <file-id> --output .
afx files delete <file-id>
afx files stats <file-id>
```

### 创建接收链接

```bash
afx inbox create --expires 1h
afx inbox create \
  --title "请上传日志" \
  --description "ZIP 或 LOG 文件" \
  --accept ".zip,.log" \
  --max-size 100MiB
```

### 查询和接收

```bash
afx inbox list
afx inbox info <inbox-id>
afx inbox wait <inbox-id> --timeout 1h
afx inbox receive <inbox-id> --output .
afx inbox wait <inbox-id> --download --output .
afx inbox revoke <inbox-id>
```

### Root 管理

```bash
afx admin keys create codex-agent
afx admin keys list
afx admin keys disable <key-id>
afx admin keys enable <key-id>
afx admin keys revoke <key-id> --resource-policy keep

afx admin files list
afx admin inboxes list
afx admin audit list
afx admin stats
```

## 30.3 JSON 输出

所有命令支持 `--json`。

成功：

```json
{
  "ok": true,
  "data": {}
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "inbox_expired",
    "message": "The upload link has expired."
  }
}
```

JSON 模式下：

- 正常日志写 stderr。
- JSON 写 stdout。
- 不输出进度条到 stdout。
- 失败返回非零退出码。

## 30.4 退出码

建议：

```text
0  成功
1  通用错误
2  参数错误
3  认证错误
4  权限不足
5  资源不存在
6  资源过期或已消费
7  网络错误
8  服务端错误
9  超时
```

---

## 31. Agent Skill

按标准 Skill 目录提供 `skills/agent-file-exchange/`：

- `SKILL.md` 的 frontmatter description 覆盖安装、发送、接收、等待、下载、撤销和清理触发语义。
- 正文只使用 CLI `--json` 契约，按 `ok` / `error.code` / `request_id` 处理结果。
- 创建 Inbox 后保留私有 `data.id`，只向用户返回 `data.upload_url`；下载后校验并返回 `data.path`。
- 下载使用新建空目录，避免覆盖同名文件；取消流程显式调用 `inbox revoke` 或 `files delete`。
- `scripts/install-cli.sh` 自动下载 macOS/Linux Release，校验 `checksums.txt` 后安装，不自动使用 sudo。
- `agents/openai.yaml` 提供 UI 元数据；Skill 目录名与 frontmatter name 一致。
- API Key、Capability URL、presigned URL、Root Key 和内部 Object Key 均不得写入日志或源码。

---

## 32. Worker 项目结构

```text
agent-file-exchange/
├── worker/
│   ├── src/
│   │   ├── index.ts
│   │   ├── env.ts
│   │   ├── errors.ts
│   │   ├── middleware/
│   │   │   ├── request-id.ts
│   │   │   ├── tenant-auth.ts
│   │   │   ├── root-auth.ts
│   │   │   ├── scope.ts
│   │   │   └── error-handler.ts
│   │   ├── routes/
│   │   │   ├── public-download.ts
│   │   │   ├── public-upload.ts
│   │   │   ├── tenant-files.ts
│   │   │   ├── tenant-inboxes.ts
│   │   │   ├── tenant-audit.ts
│   │   │   ├── tenant-stats.ts
│   │   │   ├── root-keys.ts
│   │   │   ├── root-files.ts
│   │   │   ├── root-inboxes.ts
│   │   │   ├── root-audit.ts
│   │   │   └── root-stats.ts
│   │   ├── repositories/
│   │   │   ├── api-key-repository.ts
│   │   │   ├── file-repository.ts
│   │   │   ├── inbox-repository.ts
│   │   │   └── audit-repository.ts
│   │   ├── services/
│   │   │   ├── auth-service.ts
│   │   │   ├── file-service.ts
│   │   │   ├── inbox-service.ts
│   │   │   ├── cleanup-service.ts
│   │   │   └── stats-service.ts
│   │   ├── security/
│   │   │   ├── token.ts
│   │   │   ├── hmac.ts
│   │   │   ├── constant-time.ts
│   │   │   ├── filename.ts
│   │   │   └── content-disposition.ts
│   │   ├── pages/
│   │   │   ├── layout.tsx
│   │   │   ├── upload-page.tsx
│   │   │   ├── success-page.tsx
│   │   │   └── error-page.tsx
│   │   └── schemas/
│   │       ├── file.ts
│   │       ├── inbox.ts
│   │       └── root.ts
│   ├── migrations/
│   │   └── 0001_initial.sql
│   ├── test/
│   ├── package.json
│   ├── tsconfig.json
│   └── wrangler.jsonc
├── cli/
│   ├── cmd/
│   │   └── version.go
│   ├── internal/
│   │   ├── api/
│   │   ├── buildinfo/
│   │   ├── config/
│   │   └── output/
│   ├── main.go
│   └── go.mod
├── skills/
│   └── agent-file-exchange/
│       ├── agents/openai.yaml
│       ├── scripts/install-cli.sh
│       └── SKILL.md
├── .github/workflows/
│   └── release-cli.yml
├── docs/
│   ├── API.md
│   ├── SECURITY.md
│   └── OPERATIONS.md
├── Makefile
└── README.md
```

---

## 33. Wrangler 配置示例

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "agent-file-exchange",
  "main": "src/index.ts",
  "compatibility_date": "2025-09-06",

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "agent-file-exchange",
      "database_id": "<D1_DATABASE_ID>",
      "migrations_dir": "migrations"
    }
  ],

  "r2_buckets": [
    {
      "binding": "FILES",
      "bucket_name": "agent-file-exchange"
    }
  ],

  "triggers": {
    "crons": ["0 * * * *"]
  },

  "vars": {
    "PUBLIC_BASE_URL": "https://files.example.com",
    "DEFAULT_MAX_FILE_SIZE_BYTES": "104857600",
    "DIRECT_UPLOAD_EXPIRES_SECONDS": "900",
    "R2_ACCOUNT_ID": "<CLOUDFLARE_ACCOUNT_ID>",
    "R2_BUCKET_NAME": "agent-file-exchange"
  },

  "secrets": {
    "required": [
      "ROOT_API_KEY_HASH",
      "ROOT_API_KEY_PEPPER",
      "API_KEY_PEPPER",
      "TOKEN_HASH_PEPPER",
      "IP_HASH_PEPPER",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY"
    ]
  }
}
```

部署时应根据当前 Wrangler Schema 校验字段。

---

## 34. 环境绑定类型

```ts
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;

  PUBLIC_BASE_URL: string;
  DEFAULT_MAX_FILE_SIZE_BYTES: string;
  DIRECT_UPLOAD_EXPIRES_SECONDS: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;

  ROOT_API_KEY_HASH: string;
  ROOT_API_KEY_PEPPER: string;
  API_KEY_PEPPER: string;
  TOKEN_HASH_PEPPER: string;
  IP_HASH_PEPPER: string;
}
```

---

## 35. 错误代码

建议至少实现：

```text
invalid_request
invalid_json
request_too_large
invalid_token
invalid_api_key
api_key_disabled
api_key_revoked
root_privilege_required
scope_denied

file_not_found
file_not_ready
file_expired
file_consumed
file_deleted
file_too_large
file_type_not_allowed
file_upload_failed
upload_not_complete
upload_session_expired
uploaded_object_mismatch
file_storage_missing
download_limit_reached

inbox_not_found
inbox_expired
inbox_revoked
inbox_already_used
inbox_upload_in_progress
inbox_upload_failed
inbox_lease_lost

quota_exceeded
rate_limited
internal_error
```

---

## 36. 测试要求

## 36.1 单元测试

- API Key 解析。
- HMAC Hash。
- 固定时间比较。
- Token 生成。
- 文件名清理。
- Content-Disposition。
- Scope 判断。
- 状态转换。
- 日期和过期判断。
- CLI 配置优先级。
- CLI JSON 输出。

## 36.2 集成测试

必须覆盖：

### 认证与租户隔离

- Key A 不能查看 Key B 文件。
- Key A 不能查看 Key B Inbox。
- Key A 不能删除 Key B 文件。
- 普通 Key 不能调用 Root API。
- Root Key 不能被 D1 普通 Key 记录冒充。
- 吊销 Key 立即失效。

### 上传分享

- 正常上传。
- 空文件。
- 文件超过限制。
- 非法文件名。
- R2 写入失败。
- D1 更新失败后的清理。
- 上传成功后公开下载。

### 下载次数

- 无限制下载。
- 最大下载 1 次。
- 最大下载 N 次。
- 最后一次额度并发争抢。
- 下载次数耗尽。
- 私有下载不增加公开计数。

### 阅后即焚

- 首次请求成功。
- 第二次请求失败。
- 两个并发请求只有一个获得下载权。
- 首次请求传输中断后仍不可再次下载。
- R2 删除失败时状态仍保持 consumed。

### 接收链接

- 创建正常 Inbox。
- 未过期页面可访问。
- 过期页面拒绝。
- 一次上传成功。
- 第二次上传拒绝。
- 两个并发上传只有一个获得租约。
- 上传失败释放租约。
- 过期租约可重新领取。
- 旧 Lease ID 不能完成新租约。
- 接收到的文件归属于正确 API Key。
- Agent 可下载收到文件。

### 清理

- 到期文件状态更新。
- R2 对象删除。
- 删除失败可重试。
- 过期 Inbox 更新。
- 残留 uploading 状态恢复或失败。

### 安全

- 路径穿越文件名。
- HTML 注入标题。
- Header 注入文件名。
- Token 枚举。
- 日志不泄露 Token 和 Key。
- 错误响应不泄露 SQL 和堆栈。

## 36.3 CLI 测试

使用 `httptest.Server`：

- 上传命令。
- 创建 Inbox。
- Wait 超时。
- Wait 完成并下载。
- 认证失败。
- JSON 输出。
- 非零退出码。
- 文件写入临时路径。
- 目标文件冲突策略。

---

## 37. 实现顺序

### 阶段 1：基础项目

1. 创建 Workers + Hono 项目。
2. 创建 D1 和 R2 Binding。
3. 建立 Migration。
4. 定义统一错误和响应。
5. 实现 Request ID。
6. 实现 HMAC、Token 和 API Key 解析。

### 阶段 2：Root 与普通认证

1. Root Secret 验证。
2. Root 创建普通 Key。
3. 普通 Key 中间件。
4. Scope 中间件。
5. 吊销和禁用 Key。
6. 完成租户隔离测试。

### 阶段 3：发送文件

1. 创建文件元数据。
2. 签发短期 R2 PUT URL。
3. 客户端直传、HEAD 确认与存储侧 CopyObject 发布。
4. 公开下载。
5. 私有下载。
6. 文件列表和删除。
7. 下载统计。
8. 上传超时和失败补偿。

### 阶段 4：下载限制

1. 条件更新领取下载权。
2. 最大下载次数。
3. 阅后即焚。
4. 并发测试。
5. 异步 R2 删除。

### 阶段 5：接收文件

1. 创建 Inbox。
2. 公共上传页面。
3. 上传租约。
4. 浏览器直传并完成 Inbox。
5. 失败释放租约。
6. Agent 查询和下载。
7. 并发测试。

### 阶段 6：审计、统计和清理

1. 审计事件。
2. 租户统计。
3. Root 全局统计。
4. Cron 清理。
5. R2 Lifecycle 兜底。
6. 运维文档。

### 阶段 7：CLI 与 Skill

1. Go CLI 配置。
2. Upload。
3. Files。
4. Inbox create/wait/receive。
5. Root admin。
6. JSON 模式。
7. Skill 文档。

---

## 38. 验收标准

项目完成必须满足：

- 可按运维手册显式应用 D1 Migration 并通过 Wrangler 部署 Worker。
- D1 Migration 可重复、可追踪。
- Root Key 通过部署 Secret 配置。
- Root 能创建普通 API Key。
- 普通 API Key 之间文件完全隔离。
- Agent 可上传文件并得到临时下载 URL。
- 上传文件正文不经过 Worker，完成前必须通过 R2 HEAD 大小校验并提升到独立最终 Key。
- 下载链接支持到期。
- 下载链接支持最大下载次数。
- 阅后即焚并发时最多一个请求成功。
- Agent 可创建一次性上传链接。
- 上传链接有效期内只允许一次成功上传。
- 上传失败后在邀请未过期时可重试。
- Agent 能查询并下载收到的文件。
- Root 能查看全量文件、Inbox、审计和统计。
- Root 能禁用和吊销 API Key。
- 所有 CLI 命令支持 JSON。
- Skill 能指导无上下文 Agent 正确调用 CLI。
- 日志和错误响应不泄露 Secret、Token 或文件正文。
- 所有核心并发场景有自动化测试。

---

## 39. 后续扩展

可选后续能力：

- Durable Objects：热点文件和更复杂状态协调。
- Webhook：Inbox 完成通知。
- Cloudflare Queues：审计、清理、Webhook 重试。
- Turnstile：公开上传防滥用。
- 病毒扫描。
- 文件端到端加密。
- 多文件 Inbox。
- 下载密码。
- 自定义品牌页面。
- 分片 presigned Multipart Upload 与断点续传。
- 管理后台。

扩展时不得破坏：

- 租户隔离。
- Capability Token 模型。
- Root 与普通路由分离。
- 一次性上传状态机。
- 下载授权原子性。
- 审计不可泄密原则。

---

## 40. 官方参考资料

实现前应核对 Cloudflare 最新官方文档：

- Workers  
  https://developers.cloudflare.com/workers/

- Hono on Workers  
  https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/

- D1  
  https://developers.cloudflare.com/d1/

- D1 Worker API  
  https://developers.cloudflare.com/d1/worker-api/d1-database/

- D1 and Hono  
  https://developers.cloudflare.com/d1/examples/d1-and-hono/

- R2 Workers API  
  https://developers.cloudflare.com/r2/api/workers/

- R2 upload objects  
  https://developers.cloudflare.com/r2/objects/upload-objects/

- R2 presigned URLs
  https://developers.cloudflare.com/r2/api/s3/presigned-urls/

- R2 CORS
  https://developers.cloudflare.com/r2/buckets/cors/

- Workers Secrets  
  https://developers.cloudflare.com/workers/configuration/secrets/

- Wrangler  
  https://developers.cloudflare.com/workers/wrangler/

---

## 41. 给实现 Agent 的最终指令

你正在实现的是一个多租户、API Key 驱动的临时文件交换服务，不是网盘。

请严格遵守以下优先级：

1. 租户隔离不能出错。
2. Root 权限和普通权限必须分路由。
3. 下载次数和阅后即焚必须通过原子条件更新实现。
4. 一次性上传必须使用带租约的状态机。
5. 文件正文只存 R2，元数据只存 D1。
6. 公开 Token 和 API Key Secret 不得明文存库。
7. 错误、日志和审计不得泄露敏感值。
8. 页面保持极简，不引入 SPA。
9. CLI 必须稳定支持 JSON，便于 Agent 调用。
10. 先完成文档定义的首版，不自行扩展范围。

遇到未明确的实现细节时，优先选择：

- 更少组件。
- 更明确的状态。
- 更严格的权限。
- 可测试的并发语义。
- 可补偿的 D1/R2 操作。
- 对 Agent 稳定的机器可读接口。
