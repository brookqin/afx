/** Zod Schema:Root API Key 管理请求(§23)。 */

import { z } from 'zod';
import { SCOPES } from '../services/auth-service';

export const KEY_STATUSES = ['active', 'disabled', 'revoked'] as const;
export const RESOURCE_POLICIES = ['keep', 'revoke_inboxes', 'revoke_all', 'delete_all'] as const;

/** PATCH 只允许禁用/恢复;吊销必须走 DELETE(带 resource_policy),防止绕过资源策略。 */
export const PATCH_KEY_STATUSES = ['active', 'disabled'] as const;

export const createKeySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    scopes: z.array(z.enum(SCOPES)).optional(),
    max_file_size_bytes: z.number().int().positive().optional(),
    max_storage_bytes: z.number().int().positive().nullable().optional(),
    max_active_files: z.number().int().positive().nullable().optional(),
    default_expire_seconds: z.number().int().positive().max(7 * 86400).optional(),
    max_expire_seconds: z.number().int().positive().max(30 * 86400).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type CreateKeyBody = z.infer<typeof createKeySchema>;

export const patchKeySchema = z
  .object({
    status: z.enum(PATCH_KEY_STATUSES).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    max_file_size_bytes: z.number().int().positive().optional(),
    max_storage_bytes: z.number().int().positive().nullable().optional(),
    max_active_files: z.number().int().positive().nullable().optional(),
    default_expire_seconds: z.number().int().positive().max(7 * 86400).optional(),
    max_expire_seconds: z.number().int().positive().max(30 * 86400).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });

export type PatchKeyBody = z.infer<typeof patchKeySchema>;

export const deleteKeySchema = z
  .object({
    resource_policy: z.enum(RESOURCE_POLICIES).default('keep'),
  })
  .strict();

export type DeleteKeyBody = z.infer<typeof deleteKeySchema>;
