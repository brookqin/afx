# API 参考

统一响应格式(§14):

```json
{ "ok": true, "data": {} }
```

失败:

```json
{
  "ok": false,
  "error": { "code": "file_expired", "message": "The shared file has expired.", "details": {} },
  "request_id": "01K3REQ..."
}
```

认证:`Authorization: Bearer <API_KEY>`。

## 公共路由

| 路由 | 说明 |
|---|---|
| `GET /` | 说明页 |
| `GET /healthz` | 健康检查 |
| `GET /d/:token` | 公开下载(浏览器返回文件;`Accept: application/json` 时错误返回 JSON) |
| `GET /u/:token` | 一次性上传页面 |
| `POST /u/:token/initiate` | 声明文件元数据并领取一次性 R2 直传会话 |
| `POST /u/:token/complete` | R2 PUT 完成后确认上传 |

`GET /`、`GET /u/:token` 与浏览器 HTML 错误页支持 `en` 和 `zh-CN`。语言选择优先级为
`?lang=`、带权重的 `Accept-Language`、默认 `zh-CN`；响应返回 `Content-Language` 与
`Vary: Accept-Language`。JSON API 的错误码与响应结构不随语言变化。

## 普通 API Key 路由(`/api`)

### 文件

| 路由 | 说明 |
|---|---|
| `POST /api/files` | 创建 R2 直传会话(JSON 元数据) |
| `POST /api/files/:id/complete` | 直传完成后 HEAD 校验，并以 R2 CopyObject 从暂存 Key 发布到最终 Key |
| `GET /api/files` | 列表。参数 `cursor`、`limit`(默认 50,最大 200)、`status`、`source`、`created_from`、`created_to` |
| `GET /api/files/:id` | 详情 |
| `GET /api/files/:id/content` | 私有下载(仅 `ready` 状态,不消耗公开次数) |
| `DELETE /api/files/:id` | 删除(幂等) |
| `GET /api/files/:id/stats` | 下载统计 |

创建上传会话:

```json
{
  "ok": true,
  "data": {
    "id": "01K3FILE...",
    "status": "uploading",
    "upload_url": "https://<account>.r2.cloudflarestorage.com/...?X-Amz-Signature=...",
    "upload_method": "PUT",
    "upload_headers": { "Content-Type": "application/pdf" },
    "upload_expires_at": "2026-08-01T08:15:00Z",
    "complete_url": "https://files.example.com/api/files/01K3FILE.../complete",
    "download_url": "https://files.example.com/d/<token>",
    "expires_at": "2026-08-02T08:00:00Z"
  }
}
```

请求 JSON：`filename`、`size_bytes`、`content_type`，可选 `expires_in`、`max_downloads`、
`burn_after_read`。客户端必须严格使用返回的 method/headers PUT 文件正文，随后调用 complete；在
complete 成功前公开下载返回 `file_not_ready`。

presigned URL 在有效期内可重复 PUT，因此 `upload_url` 只对应暂存 Key；完成接口不会直接发布该 Key，
而是让 R2 在存储侧复制到最终 Key。旧 URL 无法改写已发布文件。

公开 Inbox 直传采用相同协议。initiate 返回 `file_id`、`upload_id`、`upload_url`、
`upload_method`、`upload_headers`；complete 请求 JSON 为 `file_id` 与 `upload_id`。

### 接收链接

| 路由 | 说明 |
|---|---|
| `POST /api/inboxes` | 创建。JSON:`expires_in`、`max_file_size_bytes`、`title`、`description`、`allowed_extensions`、`allowed_content_types`、`expected_filename` |
| `GET /api/inboxes` | 列表。参数 `cursor`、`limit`、`status` |
| `GET /api/inboxes/:id` | 详情;`completed` 时含 `file` 摘要 |
| `GET /api/inboxes/:id/file` | 下载收到的文件(仅 `completed`) |
| `DELETE /api/inboxes/:id` | 撤销 |

创建响应:

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

### 审计与统计

| 路由 | 说明 |
|---|---|
| `GET /api/audit` | 租户审计。参数 `cursor`、`limit`、`action`、`resource_type`、`resource_id` |
| `GET /api/stats` | 租户统计 |

## Root 路由(`/api/root`,使用 Root API Key)

| 路由 | 说明 |
|---|---|
| `POST /api/root/keys` | 创建 Key。JSON:`name`、`scopes`、`max_file_size_bytes` 等;响应仅此一次返回完整 `api_key` |
| `GET /api/root/keys` | 列表 |
| `GET /api/root/keys/:id` | 详情 |
| `PATCH /api/root/keys/:id` | 修改;`status`: `disabled` / `active`(revoked 不可恢复) |
| `DELETE /api/root/keys/:id` | 吊销。JSON `resource_policy`: `keep`(默认)/ `revoke_inboxes` / `revoke_all` / `delete_all` |
| `GET /api/root/files` | 全量文件。额外支持 `owner_key_id`、`filename` |
| `GET /api/root/files/:id` | 详情 |
| `GET /api/root/files/:id/content` | 下载(遵循文件状态规则) |
| `DELETE /api/root/files/:id` | 删除 |
| `GET /api/root/inboxes` | 全量接收链接 |
| `GET /api/root/inboxes/:id` | 详情 |
| `DELETE /api/root/inboxes/:id` | 撤销 |
| `GET /api/root/audit` | 全量审计 |
| `GET /api/root/stats` | 全局统计 |

## 错误码(节选)

| 错误码 | HTTP | 说明 |
|---|---|---|
| `invalid_request` / `invalid_json` / `invalid_token` | 400 | 请求或 Token 非法 |
| `invalid_api_key` | 401 | Key 无效 |
| `api_key_disabled` / `api_key_revoked` / `scope_denied` / `root_privilege_required` | 403 | 权限不足 |
| `file_not_found` / `inbox_not_found` / `file_storage_missing` | 404 | 不存在 |
| `file_not_ready` | 409 | 文件未就绪 |
| `upload_not_complete` / `uploaded_object_mismatch` | 409 | R2 对象不存在或与声明元数据不符 |
| `inbox_upload_in_progress` / `inbox_lease_lost` | 409 | 上传冲突 |
| `file_expired` / `file_consumed` / `file_deleted` / `download_limit_reached` / `inbox_expired` / `inbox_revoked` / `inbox_already_used` | 410 | 资源过期或已消费 |
| `upload_session_expired` | 410 | 直传会话已过期 |
| `file_too_large` / `request_too_large` | 413 | 文件声明或 JSON 请求体过大 |
| `file_type_not_allowed` | 415 | 类型不允许 |
| `internal_error` | 500 | 内部错误 |
| `quota_exceeded` / `rate_limited` | 429 | 配额/限流 |

## 下载响应头

```http
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="fallback.bin"; filename*=UTF-8''...
X-Content-Type-Options: nosniff
Cache-Control: private, no-store
Referrer-Policy: no-referrer
```
