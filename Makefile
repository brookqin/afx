.PHONY: build test test-worker test-cli typecheck migrate deploy worker-dev

CLI_VERSION ?= dev
CLI_COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || printf unknown)
CLI_BUILD_DATE ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
CLI_LDFLAGS = -X afx/internal/buildinfo.Version=$(CLI_VERSION) -X afx/internal/buildinfo.Commit=$(CLI_COMMIT) -X afx/internal/buildinfo.Date=$(CLI_BUILD_DATE)

# CLI 构建
build:
	cd cli && go build -trimpath -ldflags "$(CLI_LDFLAGS)" -o afx .

# 全部测试
test: test-worker test-cli

# Worker 测试(Vitest,workers pool)
test-worker:
	cd worker && npm test

# CLI 测试
test-cli:
	cd cli && go test ./...

# 类型检查
typecheck:
	cd worker && npm run typecheck

# 显式应用远端 D1 Migration（wrangler deploy 不会自动执行）
migrate:
	cd worker && npx wrangler d1 migrations apply agent-file-exchange --remote

# 先迁移再部署 Worker
deploy: migrate
	cd worker && npx wrangler deploy

# 本地开发
worker-dev:
	cd worker && npm run dev
