/** Zod Schema:文件/Inbox 列表查询参数。 */

import { z } from 'zod';

const FILTER_STATUS = ['uploading', 'ready', 'consumed', 'expired', 'deleted', 'failed'] as const;
const FILTER_SOURCE = ['agent_upload', 'inbox_upload'] as const;
const INBOX_STATUS = ['open', 'uploading', 'completed', 'expired', 'revoked'] as const;

export const fileListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(FILTER_STATUS).optional(),
  source: z.enum(FILTER_SOURCE).optional(),
  created_from: z.coerce.number().int().optional(),
  created_to: z.coerce.number().int().optional(),
  owner_key_id: z.string().optional(),
  filename: z.string().max(255).optional(),
});

export type FileListQuery = z.infer<typeof fileListQuerySchema>;

export const inboxListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(INBOX_STATUS).optional(),
});

export type InboxListQuery = z.infer<typeof inboxListQuerySchema>;

export const auditListQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().max(100).optional(),
  resource_type: z.string().max(50).optional(),
  resource_id: z.string().max(100).optional(),
});

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export const keyListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type KeyListQuery = z.infer<typeof keyListQuerySchema>;
