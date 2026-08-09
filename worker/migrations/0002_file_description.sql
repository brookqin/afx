-- 文件上传者可附带公开展示的限长描述；长度由 API Schema 统一校验。
ALTER TABLE files ADD COLUMN description TEXT;
