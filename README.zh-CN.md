# Agent File Exchange

[English README](README.md)

![Agent File Exchange Social Preview](docs/assets/social-preview.png)

Agent File Exchange（AFX）是一个面向自动化 Agent 的临时文件交换服务。它运行在 Cloudflare Workers 上，使用 D1 保存元数据、R2 保存文件本体，并提供英文 Go CLI。

## 功能

- 发送文件并生成临时公开下载链接，支持有效期、最大下载次数和阅后即焚。
- 创建一次性接收链接，交给用户或外部系统上传文件，Agent 可轮询并下载结果。
- 文件正文直接上传 R2：Worker 签发短期暂存 URL，校验对象后通过 CopyObject 发布到不可变的最终 Key。
- 普通 API Key 之间按租户隔离，Root API Key 用于全局管理。
- 公开 Capability Token 只保存 HMAC 摘要，审计记录不写入敏感信息。
- 公开网页支持英文和简体中文，且不同语言使用独立资源文件。

## 架构

```text
afx CLI / Agent ── 元数据 API ──> Cloudflare Worker ──> D1
       │                                      │
       └── 签名 PUT ─────────────────────────> R2 暂存对象
                                              │ 校验 + CopyObject
                                              └────────> R2 最终对象

公开访问者 ── Capability URL ────────────────> 下载页或一次性接收页
```

Worker 不代理上传文件正文。签名 URL 只能写暂存 Key；完成接口校验大小和元数据后才复制到最终 Key，因此旧上传 URL 无法覆盖已经发布的文件。

## 目录结构

```text
worker/   Cloudflare Worker（TypeScript、Hono、D1、R2）
cli/      afx CLI（Go、Cobra，界面保持英文）
skill/    Agent Skill 说明
docs/     API、安全、运维文档与图片资源
design/   实现计划与设计决策
```

## 快速开始

### 1. 准备 Cloudflare 资源

先离线生成 Root API Key 和 HMAC Hash。下面的 Pepper 必须与后续配置的 `ROOT_API_KEY_PEPPER` 一致：

```bash
node -e "const c=require('crypto');const s=c.randomBytes(32).toString('base64url');console.log('ROOT_KEY=afx_root_'+s);console.log('ROOT_API_KEY_HASH='+c.createHmac('sha256','<你的ROOT_API_KEY_PEPPER>').update(s).digest('hex'))"
```

然后创建 D1 和 R2、配置 `worker/wrangler.jsonc`、写入 Secrets、应用初始化结构并部署：

```bash
cd worker
npm install
npx wrangler d1 create agent-file-exchange
npx wrangler r2 bucket create agent-file-exchange

# 填写 D1 database_id、R2 账号/桶信息和 PUBLIC_BASE_URL。
# 将 r2-cors.example.json 中的示例域名替换为 PUBLIC_BASE_URL。
npx wrangler secret put ROOT_API_KEY_HASH
npx wrangler secret put ROOT_API_KEY_PEPPER
npx wrangler secret put API_KEY_PEPPER
npx wrangler secret put TOKEN_HASH_PEPPER
npx wrangler secret put IP_HASH_PEPPER
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler r2 bucket cors set agent-file-exchange --file r2-cors.example.json
npx wrangler d1 migrations apply agent-file-exchange --remote
npx wrangler deploy
```

本项目尚未发布部署，因此 `worker/migrations/0001_initial.sql` 是新数据库的唯一结构来源，不保留增量 `ALTER TABLE` migration。

### 2. 构建和使用 CLI

```bash
make build
export AFX_ENDPOINT=https://files.example.com
export AFX_API_KEY=afx_...
export AFX_ROOT_API_KEY=afx_root_...

./cli/afx upload report.pdf --expires 24h --json
./cli/afx inbox create --expires 1h --title "Upload logs" --json
./cli/afx inbox wait <inbox-id> --timeout 1h --download --output . --json
```

运行 `./cli/afx --help` 查看完整英文命令说明。

### 3. 本地开发与测试

```bash
make test
make typecheck
make build
```

本地开发 Worker 时，请先配置本地 D1/R2 Binding，再运行 `make worker-dev`。

## 国际化

Worker 公开网页支持英文（`en`）和简体中文（`zh-CN`），语言选择顺序如下：

1. `?lang=en` 或 `?lang=zh-CN`
2. 带权重的 `Accept-Language` 请求头
3. 默认简体中文

语言资源分别位于 `worker/src/locales/en.ts` 和 `worker/src/locales/zh-CN.ts`。API 错误码与 JSON 响应结构保持稳定，不随语言变化。CLI 按要求保持纯英文。

## 安全模型

- 公开链接使用 32 字节高熵 Capability Token，D1 只保存 HMAC-SHA-256 摘要。
- D1 条件更新原子执行下载计数、阅后即焚和一次性上传租约。
- R2 Object Key 不包含原始文件名。
- 直传 URL 有较短有效期，并且不能写最终对象 Key。
- 审计记录不包含完整 Token、API Key、Secret 或文件正文；客户端 IP 使用按日轮换盐的 HMAC 做伪匿名化。

生产使用前请阅读[安全说明](docs/SECURITY.md)。

## 文档

- [API 参考](docs/API.md)
- [安全说明](docs/SECURITY.md)
- [运维手册](docs/OPERATIONS.md)
- [Agent Skill](skill/SKILL.md)
- [实现计划](design/agent-file-exchange-implementation-plan.md)

## 开源协议

本项目使用 [MIT License](LICENSE)。
