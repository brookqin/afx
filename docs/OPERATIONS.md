# 运维手册

## 部署

### 前置条件

- Node.js >= 20,npm
- Cloudflare 账号(Workers、D1、R2)
- Wrangler 4

### 步骤

```bash
cd worker
npm install

# 1. 创建资源
npx wrangler d1 create agent-file-exchange        # 记下 database_id
npx wrangler r2 bucket create agent-file-exchange

# 2. 编辑 wrangler.jsonc:填入 database_id、bucket 名称、PUBLIC_BASE_URL

# 3. 离线生成 Root Key/Hash；使用准备写入 ROOT_API_KEY_PEPPER 的同一值
node -e "
const c = require('crypto');
const s = c.randomBytes(32).toString('base64url');
console.log('Root Key(保存一次): afx_root_' + s);
console.log('ROOT_API_KEY_HASH = ' + c.createHmac('sha256', '<ROOT_API_KEY_PEPPER 的值>').update(s).digest('hex'));
"

# 生成后立即按 README.zh-CN.md 的跨平台约定保存 Root Key：
# - 密码管理器中的恢复副本
# - 系统凭据库中的操作副本
# Cloudflare 只有 Hash，无法恢复明文；Git 忽略的明文文件也不是安全存储。

# 4. 配置 Secrets(全部必填，ROOT_API_KEY_HASH 使用上一步结果)
npx wrangler secret put ROOT_API_KEY_HASH
npx wrangler secret put ROOT_API_KEY_PEPPER
npx wrangler secret put API_KEY_PEPPER
npx wrangler secret put TOKEN_HASH_PEPPER
npx wrangler secret put IP_HASH_PEPPER
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY

# 5. 配置浏览器直传 CORS；先把示例域名改成实际 PUBLIC_BASE_URL
npx wrangler r2 bucket cors set agent-file-exchange --file r2-cors.example.json

# 6. 显式应用远端 Migration；wrangler deploy 不会代替此步骤
npx wrangler d1 migrations apply agent-file-exchange --remote

# 7. 部署 Worker
npx wrangler deploy
```

### 环境变量(Vars)

| 变量 | 默认 | 说明 |
|---|---|---|
| `PUBLIC_BASE_URL` | - | 公开链接的基址 |
| `DEFAULT_MAX_FILE_SIZE_BYTES` | 104857600 | 默认最大文件大小 |
| `DIRECT_UPLOAD_EXPIRES_SECONDS` | 900 | R2 直传 URL 有效期,限制为 60–3600 秒 |
| `R2_ACCOUNT_ID` | - | Cloudflare Account ID |
| `R2_BUCKET_NAME` | agent-file-exchange | S3 API 使用的 R2 Bucket 名称 |

`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` 是仅授予该 Bucket Object Read & Write 的 R2 S3
凭据，只作为 Worker Secret 保存。浏览器和 CLI 只能拿到短期 presigned URL。

## Cron 清理

Worker 配置了每小时 Cron Trigger(`0 * * * *`),执行:

1. 到期 `ready` 文件 -> `expired`
2. 到期 `open`/`uploading` Inbox -> `expired`
3. 下载次数耗尽的文件 -> `consumed`
4. 超时 `uploading` 文件 -> `failed`
5. 直传 URL 过期后删除暂存对象并记录独立清理标记
6. 删除 `consumed`/`expired`/`deleted`/安全过期的 `failed` 最终对象,并在 D1 标记物理清理完成

清理为分批执行,单次最多 200 条,最多 50 轮,避免超时。

## 密钥轮换

- 轮换 `API_KEY_PEPPER` 会使所有普通 Key 摘要失效(需要重新创建 Key)。
- 轮换 `TOKEN_HASH_PEPPER` 会使所有公开链接失效。
- 轮换 `IP_HASH_PEPPER` 只影响 IP 哈希,不影响业务。
- 变更任何 Pepper 前请先评估存量资源影响。

## 监控与排障

- 健康检查:`GET /healthz`
- CLI 配置与普通 Key 校验:`afx status --json`（认证探针为 `GET /api/status`，不要求业务 Scope）
- 审计:`GET /api/root/audit`(结果含 `failed`/`denied` 事件)
- 全局统计:`GET /api/root/stats`
- 日志:Worker 日志中 `request_id` 与审计 `request_id` 对应,便于排查。
- 常见问题:
  - `invalid_api_key` 401:检查 Key 状态(active)、是否吊销、Pepper 是否轮换。
  - 公开下载 410:文件已过期/消费/删除,检查 `expires_at` 与状态。
  - Inbox 上传 409 `inbox_upload_in_progress`:已有上传进行中,等待租约过期或完成。

## CLI 发布

- 推送符合 `v<major>.<minor>.<patch>`（可带预发布后缀）的 Tag 会触发 `.github/workflows/release-cli.yml`。
- Workflow 先运行 CLI 测试，再交叉编译 Linux、macOS、Windows 的 amd64/arm64 产物。
- Release 压缩包内包含 `afx`、`LICENSE`、`README.md`，并同时发布 `checksums.txt`。
- 版本、Commit 与构建时间通过 Go linker flags 注入，可用 `afx version` 或 `afx --json version` 核对。
- Release 发布使用仓库 `GITHUB_TOKEN` 和最小的 `contents: write` 权限，不需要额外 Token。

## 数据保留

- D1 元数据与审计默认永久保留(软删除)。
- R2 对象由 Cron + R2 Lifecycle 清理。
- 如需全局清理,在 Root 审计中按 `owner_key_id` 定位后使用 `resource_policy=delete_all` 吊销对应 Key。

## 备份

- D1:`npx wrangler d1 export agent-file-exchange --remote --output backup.sql`
- 该备份包含摘要(无明文密钥),属于敏感数据,妥善保管。
