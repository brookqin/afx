.PHONY: build test test-worker test-cli typecheck migrate deploy worker-dev

# CLI 构建
build:
	cd cli && go build -o afx .

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
