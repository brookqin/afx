/**
 * API 序列化:不返回 object_key / public_token_hash / secret(§22.1)。
 * bytes_served 对外命名为 authorized_bytes(§27.1)。
 */

import type { FileRow } from '../repositories/file-repository';
import type { InboxRow } from '../repositories/inbox-repository';
import type { ApiKeyRow } from '../repositories/api-key-repository';
import { toIso } from './time';

export function fileToApi(f: FileRow): Record<string, unknown> {
  return {
    id: f.id,
    source: f.source,
    filename: f.original_name,
    description: f.description,
    content_type: f.content_type,
    size_bytes: f.size_bytes,
    sha256: f.sha256,
    status: f.status,
    created_at: toIso(f.created_at),
    ready_at: toIso(f.ready_at),
    expires_at: toIso(f.expires_at),
    consumed_at: toIso(f.consumed_at),
    expired_at: toIso(f.expired_at),
    deleted_at: toIso(f.deleted_at),
    max_downloads: f.max_downloads,
    download_count: f.download_count,
    burn_after_read: f.burn_after_read === 1,
    first_download_at: toIso(f.first_download_at),
    last_download_at: toIso(f.last_download_at),
    authorized_bytes: f.bytes_served,
    inbox_id: f.inbox_id,
    failure_code: f.failure_code,
  };
}

export function fileStatsToApi(f: FileRow): Record<string, unknown> {
  return {
    download_count: f.download_count,
    max_downloads: f.max_downloads,
    failed_download_count: f.failed_download_count,
    first_download_at: toIso(f.first_download_at),
    last_download_at: toIso(f.last_download_at),
    authorized_bytes: f.bytes_served,
    status: f.status,
  };
}

function parseJsonList(s: string): string[] {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(s: string): Record<string, unknown> {
  try {
    const value = JSON.parse(s || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function inboxToApi(i: InboxRow): Record<string, unknown> {
  return {
    id: i.id,
    status: i.status,
    title: i.title,
    description: i.description,
    created_at: toIso(i.created_at),
    expires_at: toIso(i.expires_at),
    completed_at: toIso(i.completed_at),
    revoked_at: toIso(i.revoked_at),
    max_file_size_bytes: i.max_file_size_bytes,
    allowed_extensions: parseJsonList(i.allowed_extensions_json),
    allowed_content_types: parseJsonList(i.allowed_content_types_json),
    expected_filename: i.expected_filename,
    received_file_id: i.received_file_id,
  };
}

export function apiKeyToApi(k: ApiKeyRow): Record<string, unknown> {
  return {
    id: k.id,
    name: k.name,
    secret_prefix: k.secret_prefix,
    status: k.status,
    scopes: parseJsonList(k.scopes_json),
    created_at: toIso(k.created_at),
    created_by: k.created_by,
    last_used_at: toIso(k.last_used_at),
    disabled_at: toIso(k.disabled_at),
    revoked_at: toIso(k.revoked_at),
    max_file_size_bytes: k.max_file_size_bytes,
    max_storage_bytes: k.max_storage_bytes,
    max_active_files: k.max_active_files,
    default_expire_seconds: k.default_expire_seconds,
    max_expire_seconds: k.max_expire_seconds,
    metadata: parseJsonObject(k.metadata_json),
  };
}
