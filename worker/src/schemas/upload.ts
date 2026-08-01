import { z } from 'zod';

const filename = z.string().trim().min(1).max(255);
const contentType = z.string().trim().max(200).regex(/^[\x20-\x7e]*$/).nullable().optional();
const sizeBytes = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const initiateFileUploadSchema = z
  .object({
    filename,
    size_bytes: sizeBytes,
    content_type: contentType,
    expires_in: z.number().int().positive().optional(),
    max_downloads: z.number().int().positive().nullable().optional(),
    burn_after_read: z.boolean().optional().default(false),
  })
  .strict()
  .refine((v) => !v.burn_after_read || v.max_downloads == null || v.max_downloads === 1, {
    message: 'burn_after_read requires max_downloads=1 or null.',
  });

export const initiateInboxUploadSchema = z
  .object({
    filename,
    size_bytes: sizeBytes,
    content_type: contentType,
  })
  .strict();

export const completeInboxUploadSchema = z
  .object({
    file_id: z.string().min(1).max(100),
    upload_id: z.string().min(1).max(100),
  })
  .strict();
