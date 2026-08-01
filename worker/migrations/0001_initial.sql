-- 0001_initial.sql — Agent File Exchange 初始 Schema
-- 元数据与状态存 D1;文件二进制存 R2;Token/Key 只保存 HMAC 摘要。

CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,

    secret_hash TEXT NOT NULL,
    secret_prefix TEXT NOT NULL,

    scopes_json TEXT NOT NULL DEFAULT '[]',

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled', 'revoked')),

    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'root',
    last_used_at INTEGER,
    disabled_at INTEGER,
    revoked_at INTEGER,

    max_file_size_bytes INTEGER NOT NULL,
    max_storage_bytes INTEGER,
    max_active_files INTEGER,

    default_expire_seconds INTEGER NOT NULL,
    max_expire_seconds INTEGER NOT NULL,

    metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_api_keys_status
ON api_keys(status);

CREATE INDEX idx_api_keys_created_at
ON api_keys(created_at DESC);

CREATE TABLE files (
    id TEXT PRIMARY KEY,

    owner_key_id TEXT NOT NULL,
    source TEXT NOT NULL
        CHECK (source IN ('agent_upload', 'inbox_upload')),

    object_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type TEXT,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT,

    public_token_hash TEXT UNIQUE,

    status TEXT NOT NULL
        CHECK (
            status IN (
                'uploading',
                'ready',
                'consumed',
                'expired',
                'deleted',
                'failed'
            )
        ),

    created_at INTEGER NOT NULL,
    ready_at INTEGER,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    expired_at INTEGER,
    deleted_at INTEGER,

    max_downloads INTEGER,
    download_count INTEGER NOT NULL DEFAULT 0,
    failed_download_count INTEGER NOT NULL DEFAULT 0,
    burn_after_read INTEGER NOT NULL DEFAULT 0
        CHECK (burn_after_read IN (0, 1)),

    first_download_at INTEGER,
    last_download_at INTEGER,
    bytes_served INTEGER NOT NULL DEFAULT 0,

    inbox_id TEXT,

    failure_code TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    upload_expires_at INTEGER,
    r2_deleted_at INTEGER,
    upload_object_deleted_at INTEGER,

    FOREIGN KEY(owner_key_id) REFERENCES api_keys(id),
    FOREIGN KEY(inbox_id) REFERENCES upload_inboxes(id)
);

CREATE INDEX idx_files_owner_created
ON files(owner_key_id, created_at DESC);

CREATE INDEX idx_files_owner_status
ON files(owner_key_id, status);

CREATE INDEX idx_files_expires
ON files(expires_at);

CREATE INDEX idx_files_source
ON files(source);

CREATE INDEX idx_files_inbox
ON files(inbox_id);

CREATE INDEX idx_files_upload_expires
ON files(status, upload_expires_at);

CREATE INDEX idx_files_r2_cleanup
ON files(status, r2_deleted_at);

CREATE INDEX idx_files_upload_object_cleanup
ON files(upload_object_deleted_at, upload_expires_at);

CREATE TABLE upload_inboxes (
    id TEXT PRIMARY KEY,

    owner_key_id TEXT NOT NULL,
    public_token_hash TEXT NOT NULL UNIQUE,

    title TEXT,
    description TEXT,

    status TEXT NOT NULL
        CHECK (
            status IN (
                'open',
                'uploading',
                'completed',
                'expired',
                'revoked'
            )
        ),

    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    completed_at INTEGER,
    revoked_at INTEGER,

    max_file_size_bytes INTEGER NOT NULL,
    allowed_extensions_json TEXT NOT NULL DEFAULT '[]',
    allowed_content_types_json TEXT NOT NULL DEFAULT '[]',
    expected_filename TEXT,

    upload_lease_id TEXT,
    upload_lease_started_at INTEGER,
    upload_lease_until INTEGER,

    received_file_id TEXT,

    metadata_json TEXT NOT NULL DEFAULT '{}',

    FOREIGN KEY(owner_key_id) REFERENCES api_keys(id),
    FOREIGN KEY(received_file_id) REFERENCES files(id)
);

CREATE INDEX idx_inboxes_owner_created
ON upload_inboxes(owner_key_id, created_at DESC);

CREATE INDEX idx_inboxes_owner_status
ON upload_inboxes(owner_key_id, status);

CREATE INDEX idx_inboxes_expires
ON upload_inboxes(expires_at);

CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    owner_key_id TEXT,

    actor_type TEXT NOT NULL
        CHECK (
            actor_type IN (
                'root_key',
                'api_key',
                'public_download',
                'public_upload',
                'system'
            )
        ),

    actor_id TEXT,

    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,

    result TEXT NOT NULL
        CHECK (result IN ('success', 'denied', 'failed')),

    request_id TEXT,
    ip_hash TEXT,
    user_agent TEXT,

    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_audit_owner_created
ON audit_events(owner_key_id, created_at DESC);

CREATE INDEX idx_audit_action_created
ON audit_events(action, created_at DESC);

CREATE INDEX idx_audit_resource
ON audit_events(resource_type, resource_id, created_at DESC);

CREATE INDEX idx_audit_request
ON audit_events(request_id);
