// Package api 封装与 Worker 的 HTTP 交互与统一错误解析(§14 / §30.3)。
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type ErrorInfo struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	Details   map[string]any `json:"details,omitempty"`
	RequestID string         `json:"request_id"`
}

// APIError 实现 error 接口。
type APIError struct {
	Info ErrorInfo
}

func (e *APIError) Error() string {
	if e.Info.RequestID != "" {
		return fmt.Sprintf("%s: %s (request_id=%s)", e.Info.Code, e.Info.Message, e.Info.RequestID)
	}
	return fmt.Sprintf("%s: %s", e.Info.Code, e.Info.Message)
}

type Client struct {
	BaseURL   string
	APIKey    string
	Timeout   time.Duration
	HTTP      *http.Client
	UserAgent string
}

func New(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL:   strings.TrimRight(baseURL, "/"),
		APIKey:    apiKey,
		HTTP:      &http.Client{},
		UserAgent: "afx-cli/0.1",
	}
}

// Health checks the unauthenticated service health endpoint.
func (c *Client) Health(ctx context.Context) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/healthz", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.UserAgent)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, &TimeoutError{Err: err}
		}
		return nil, &NetworkError{Err: err}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, &NetworkError{Err: err}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &ServerError{Status: resp.StatusCode, Body: truncate(string(raw), 500)}
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil || data["ok"] != true {
		return nil, fmt.Errorf("invalid health response")
	}
	return data, nil
}

// DoJSON 发起 JSON 请求并解析统一响应。返回 data 字段(可能为 null)。
func (c *Client) DoJSON(ctx context.Context, method, path string, query url.Values, body any) (any, error) {
	var bodyReader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(raw)
	}

	fullURL := c.BaseURL + path
	if len(query) > 0 {
		fullURL += "?" + query.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, method, fullURL, bodyReader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.UserAgent)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, &TimeoutError{Err: err}
		}
		return nil, &NetworkError{Err: err}
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, &NetworkError{Err: err}
	}
	return c.parseEnvelope(resp.StatusCode, raw)
}

// UploadFile 创建上传会话、直传 R2、再向 Worker 确认。文件正文不经过 Worker。
func (c *Client) UploadFile(ctx context.Context, filePath string, query url.Values) (any, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		return nil, err
	}
	body := map[string]any{
		"filename":     filepath.Base(filePath),
		"size_bytes":   info.Size(),
		"content_type": "application/octet-stream",
	}
	if value := query.Get("expires_in"); value != "" {
		var n int64
		if _, err := fmt.Sscan(value, &n); err != nil {
			return nil, err
		}
		body["expires_in"] = n
	}
	if value := query.Get("max_downloads"); value != "" {
		var n int64
		if _, err := fmt.Sscan(value, &n); err != nil {
			return nil, err
		}
		body["max_downloads"] = n
	}
	if value := query.Get("burn_after_read"); value == "true" || value == "1" {
		body["burn_after_read"] = true
	}
	if value := query.Get("description"); value != "" {
		body["description"] = value
	}

	initData, err := c.DoJSON(ctx, "POST", "/api/files", nil, body)
	if err != nil {
		return nil, err
	}
	session, ok := initData.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid upload session response")
	}
	uploadURL, _ := session["upload_url"].(string)
	method, _ := session["upload_method"].(string)
	id, _ := session["id"].(string)
	if uploadURL == "" || id == "" {
		return nil, fmt.Errorf("invalid upload session response")
	}
	if method == "" {
		method = "PUT"
	}
	headers := map[string]string{}
	if raw, ok := session["upload_headers"].(map[string]any); ok {
		for name, value := range raw {
			if s, ok := value.(string); ok {
				headers[name] = s
			}
		}
	}
	if err := c.DirectPutFile(ctx, method, uploadURL, headers, filePath); err != nil {
		return nil, err
	}

	complete, err := c.DoJSON(ctx, "POST", "/api/files/"+id+"/complete", nil, map[string]any{})
	if err != nil {
		return nil, err
	}
	result := map[string]any{
		"id": id, "url": session["download_url"], "size_bytes": info.Size(),
		"expires_at": session["expires_at"], "status": "ready", "file": complete,
	}
	return result, nil
}

// DirectPutFile streams a local file to a presigned R2 URL without API credentials.
func (c *Client) DirectPutFile(ctx context.Context, method, uploadURL string, headers map[string]string, filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, uploadURL, file)
	if err != nil {
		return err
	}
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	req.ContentLength = info.Size()
	req.Header.Set("User-Agent", c.UserAgent)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return &TimeoutError{Err: err}
		}
		return &NetworkError{Err: err}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return &ServerError{Status: resp.StatusCode, Body: truncate(string(raw), 500)}
	}
	return nil
}

// DownloadStream 返回响应流、Content-Disposition 文件名和声明大小。调用方必须关闭流。
func (c *Client) DownloadStream(ctx context.Context, path string) (io.ReadCloser, string, int64, error) {
	fullURL := c.BaseURL + path
	req, err := http.NewRequestWithContext(ctx, "GET", fullURL, nil)
	if err != nil {
		return nil, "", 0, err
	}
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.UserAgent)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, "", 0, &TimeoutError{Err: err}
		}
		return nil, "", 0, &NetworkError{Err: err}
	}

	if resp.StatusCode >= 400 {
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if _, apiErr := c.parseEnvelope(resp.StatusCode, raw); apiErr != nil {
			return nil, "", 0, apiErr
		}
		return nil, "", 0, &ServerError{Status: resp.StatusCode, Body: truncate(string(raw), 500)}
	}
	filename := parseContentDisposition(resp.Header.Get("Content-Disposition"))
	return resp.Body, filename, resp.ContentLength, nil
}

// Download 保留给库调用方；CLI 命令使用 DownloadStream，避免大文件整体驻留内存。
func (c *Client) Download(ctx context.Context, path string) ([]byte, string, error) {
	body, filename, _, err := c.DownloadStream(ctx, path)
	if err != nil {
		return nil, "", err
	}
	defer body.Close()
	raw, err := io.ReadAll(body)
	if err != nil {
		return nil, "", &NetworkError{Err: err}
	}
	return raw, filename, nil
}

// parseEnvelope 解析统一 JSON 响应,返回 data 字段。
func (c *Client) parseEnvelope(status int, raw []byte) (any, error) {
	var envelope struct {
		OK        bool       `json:"ok"`
		Data      any        `json:"data"`
		Error     *ErrorInfo `json:"error"`
		RequestID string     `json:"request_id"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		if status >= 500 {
			return nil, &ServerError{Status: status, Body: truncate(string(raw), 500)}
		}
		return nil, fmt.Errorf("unexpected response (status %d): %s", status, truncate(string(raw), 500))
	}
	if status >= 400 || !envelope.OK {
		info := envelope.Error
		if info == nil {
			info = &ErrorInfo{Code: "http_error", Message: fmt.Sprintf("HTTP %d", status)}
		}
		if info.RequestID == "" {
			info.RequestID = envelope.RequestID
		}
		return nil, &APIError{Info: *info}
	}
	return envelope.Data, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func parseContentDisposition(cd string) string {
	for _, part := range strings.Split(cd, ";") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "filename*=UTF-8''") {
			v := strings.TrimPrefix(part, "filename*=UTF-8''")
			if dec, err := url.QueryUnescape(v); err == nil {
				return dec
			}
			return v
		}
		if strings.HasPrefix(part, "filename=") {
			v := strings.TrimPrefix(part, "filename=")
			v = strings.Trim(v, `"`)
			return v
		}
	}
	return ""
}

// NetworkError 网络错误(退出码 7)。
type NetworkError struct{ Err error }

func (e *NetworkError) Error() string { return "network error: " + e.Err.Error() }

// TimeoutError 超时(退出码 9)。
type TimeoutError struct{ Err error }

func (e *TimeoutError) Error() string { return "timeout: " + e.Err.Error() }

// ServerError 服务端 5xx(退出码 8)。
type ServerError struct {
	Status int
	Body   string
}

func (e *ServerError) Error() string {
	return fmt.Sprintf("server error (HTTP %d): %s", e.Status, e.Body)
}
