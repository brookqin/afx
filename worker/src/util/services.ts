/** 服务容器:每个请求构建一次,存入 Hono 上下文。 */

import type { Context } from 'hono';
import type { Env } from '../env';
import { AuthService } from '../services/auth-service';
import { AuditService } from '../services/audit-service';
import { CleanupService } from '../services/cleanup-service';
import { FileService } from '../services/file-service';
import { InboxService } from '../services/inbox-service';
import { StatsService } from '../services/stats-service';

export interface Services {
  env: Env;
  auth: AuthService;
  audit: AuditService;
  files: FileService;
  inboxes: InboxService;
  cleanup: CleanupService;
  stats: StatsService;
}

const SERVICE_KEY = 'services';

export function buildServices(env: Env): Services {
  const audit = new AuditService(env);
  return {
    env,
    auth: new AuthService(env),
    audit,
    files: new FileService(env, audit),
    inboxes: new InboxService(env, audit),
    cleanup: new CleanupService(env, audit),
    stats: new StatsService(env),
  };
}

export function setServices(c: Context, s: Services): void {
  c.set(SERVICE_KEY, s);
}

export function services(c: Context): Services {
  return c.get(SERVICE_KEY) as Services;
}
