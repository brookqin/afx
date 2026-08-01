/** Zod Schema:Inbox 创建请求(§18.1)。 */

import { z } from 'zod';

export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 2000;

export const createInboxSchema = z
  .object({
    expires_in: z.number().int().positive().max(7 * 86400).optional(),
    max_file_size_bytes: z.number().int().positive().optional(),
    title: z.string().trim().max(MAX_TITLE_LENGTH).nullable().optional(),
    description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
    allowed_extensions: z.array(z.string().regex(/^\.[A-Za-z0-9]{1,16}$/)).max(50).optional(),
    allowed_content_types: z.array(z.string().trim().max(200).regex(/^[\x20-\x7e]+$/)).max(50).optional(),
    expected_filename: z.string().trim().max(255).nullable().optional(),
  })
  .strict();

export type CreateInboxBody = z.infer<typeof createInboxSchema>;
