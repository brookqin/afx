/**
 * 统一错误模型。code 稳定,供 CLI / Agent 判断;message 面向人类;
 * details 可选。错误响应一律附带 request_id,见 error-handler 中间件。
 *
 * 错误码清单见设计文档 §35。
 */

export interface ErrorDetails {
  [key: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details: ErrorDetails = {},
    public readonly logMessage?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/* ---- 通用 ---- */
export const invalidRequest = (message = 'Invalid request.', details: ErrorDetails = {}) =>
  new ApiError('invalid_request', 400, message, details);

export const invalidJson = (message = 'Invalid JSON body.', details: ErrorDetails = {}) =>
  new ApiError('invalid_json', 400, message, details);

export const requestTooLarge = (message = 'JSON request body is too large.', details: ErrorDetails = {}) =>
  new ApiError('request_too_large', 413, message, details);

export const invalidToken = (message = 'Invalid token.', details: ErrorDetails = {}) =>
  new ApiError('invalid_token', 400, message, details);

export const internalError = (message = 'Internal server error.', logMessage?: string) =>
  new ApiError('internal_error', 500, message, {}, logMessage);

/* ---- 认证 ---- */
export const invalidApiKey = (message = 'Invalid API key.', details: ErrorDetails = {}) =>
  new ApiError('invalid_api_key', 401, message, details);

export const apiKeyDisabled = (message = 'API key is disabled.', details: ErrorDetails = {}) =>
  new ApiError('api_key_disabled', 403, message, details);

export const apiKeyRevoked = (message = 'API key has been revoked.', details: ErrorDetails = {}) =>
  new ApiError('api_key_revoked', 403, message, details);

export const rootPrivilegeRequired = (message = 'Root privilege required.') =>
  new ApiError('root_privilege_required', 403, message);

export const scopeDenied = (message = 'Scope denied.', details: ErrorDetails = {}) =>
  new ApiError('scope_denied', 403, message, details);

/* ---- 文件 ---- */
export const fileNotFound = (message = 'File not found or no longer available.', details: ErrorDetails = {}) =>
  new ApiError('file_not_found', 404, message, details);

export const fileNotReady = (message = 'File upload is not complete yet.', details: ErrorDetails = {}) =>
  new ApiError('file_not_ready', 409, message, details);

export const fileExpired = (message = 'The shared file has expired.', details: ErrorDetails = {}) =>
  new ApiError('file_expired', 410, message, details);

export const fileConsumed = (message = 'The file has already been consumed.', details: ErrorDetails = {}) =>
  new ApiError('file_consumed', 410, message, details);

export const fileDeleted = (message = 'The file has been deleted.', details: ErrorDetails = {}) =>
  new ApiError('file_deleted', 410, message, details);

export const fileTooLarge = (message = 'File is too large.', details: ErrorDetails = {}) =>
  new ApiError('file_too_large', 413, message, details);

export const fileTypeNotAllowed = (message = 'File type is not allowed.', details: ErrorDetails = {}) =>
  new ApiError('file_type_not_allowed', 415, message, details);

export const fileUploadFailed = (message = 'File upload failed.', details: ErrorDetails = {}) =>
  new ApiError('file_upload_failed', 500, message, details);

export const uploadNotComplete = (message = 'The direct upload has not completed.', details: ErrorDetails = {}) =>
  new ApiError('upload_not_complete', 409, message, details);

export const uploadSessionExpired = (message = 'The direct upload session has expired.', details: ErrorDetails = {}) =>
  new ApiError('upload_session_expired', 410, message, details);

export const uploadedObjectMismatch = (message = 'The uploaded object does not match the declared metadata.', details: ErrorDetails = {}) =>
  new ApiError('uploaded_object_mismatch', 409, message, details);

export const fileStorageMissing = (message = 'File storage object is missing.', details: ErrorDetails = {}) =>
  new ApiError('file_storage_missing', 404, message, details);

export const downloadLimitReached = (message = 'Download limit reached.', details: ErrorDetails = {}) =>
  new ApiError('download_limit_reached', 410, message, details);

/* ---- Inbox ---- */
export const inboxNotFound = (message = 'Upload link not found or no longer available.', details: ErrorDetails = {}) =>
  new ApiError('inbox_not_found', 404, message, details);

export const inboxExpired = (message = 'The upload link has expired.', details: ErrorDetails = {}) =>
  new ApiError('inbox_expired', 410, message, details);

export const inboxRevoked = (message = 'The upload link has been revoked.', details: ErrorDetails = {}) =>
  new ApiError('inbox_revoked', 410, message, details);

export const inboxAlreadyUsed = (message = 'This upload link has already been used.', details: ErrorDetails = {}) =>
  new ApiError('inbox_already_used', 410, message, details);

export const inboxUploadInProgress = (message = 'An upload for this link is already in progress.', details: ErrorDetails = {}) =>
  new ApiError('inbox_upload_in_progress', 409, message, details);

export const inboxUploadFailed = (message = 'Upload to this link failed.', details: ErrorDetails = {}) =>
  new ApiError('inbox_upload_failed', 500, message, details);

export const inboxLeaseLost = (message = 'Upload lease lost.', details: ErrorDetails = {}) =>
  new ApiError('inbox_lease_lost', 409, message, details);

/* ---- 其他 ---- */
export const quotaExceeded = (message = 'Quota exceeded.', details: ErrorDetails = {}) =>
  new ApiError('quota_exceeded', 429, message, details);

export const rateLimited = (message = 'Rate limited.', details: ErrorDetails = {}) =>
  new ApiError('rate_limited', 429, message, details);

export const notFound = (message = 'Not found.') => new ApiError('not_found', 404, message);
