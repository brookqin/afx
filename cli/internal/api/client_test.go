// Package api 测试:httptest.Server 模拟服务端(§36.3)。
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv
}

func envelope(t *testing.T, status int, data any) string {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"ok": status < 400, "data": data})
	return string(raw)
}

func TestUploadFile(t *testing.T) {
	srv := testServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/files":
			if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
				t.Errorf("auth = %s", got)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["filename"] != "test.txt" || body["size_bytes"] != float64(5) || body["expires_in"] != float64(3600) {
				t.Errorf("init body = %#v", body)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(201)
			fmt.Fprint(w, envelope(t, 201, map[string]any{
				"id": "F1", "upload_url": "http://" + r.Host + "/direct/r2", "upload_method": "PUT",
				"upload_headers": map[string]any{"Content-Type": "application/octet-stream"},
				"download_url":   "http://x/d/tok", "expires_at": "2026-08-02T00:00:00Z",
			}))
		case r.Method == "PUT" && r.URL.Path == "/direct/r2":
			if r.Header.Get("Authorization") != "" {
				t.Error("direct PUT leaked API authorization")
			}
			content, _ := io.ReadAll(r.Body)
			if string(content) != "hello" {
				t.Errorf("content = %q", content)
			}
			w.WriteHeader(200)
		case r.Method == "POST" && r.URL.Path == "/api/files/F1/complete":
			fmt.Fprint(w, envelope(t, 200, map[string]any{"file": map[string]any{"id": "F1", "status": "ready"}}))
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	})

	tmp := filepath.Join(t.TempDir(), "test.txt")
	if err := os.WriteFile(tmp, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	client := New(srv.URL, "test-key")
	q := url.Values{"expires_in": {"3600"}}
	data, err := client.UploadFile(context.Background(), tmp, q)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	m := data.(map[string]any)
	if m["id"] != "F1" || m["url"] != "http://x/d/tok" {
		t.Errorf("data = %v", m)
	}
}

func TestDoJSONErrorMapping(t *testing.T) {
	srv := testServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(401)
		fmt.Fprint(w, `{"ok":false,"error":{"code":"invalid_api_key","message":"Invalid API key."},"request_id":"R1"}`)
	})

	client := New(srv.URL, "bad")
	_, err := client.DoJSON(context.Background(), "GET", "/api/files", nil, nil)
	apiErr, ok := err.(*APIError)
	if !ok {
		t.Fatalf("expected *APIError, got %T", err)
	}
	if apiErr.Info.Code != "invalid_api_key" || apiErr.Info.RequestID != "R1" {
		t.Errorf("info = %+v", apiErr.Info)
	}
	if !strings.Contains(apiErr.Error(), "invalid_api_key") {
		t.Errorf("error string = %s", apiErr.Error())
	}
}

func TestDoJSONNotFound(t *testing.T) {
	srv := testServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(404)
		fmt.Fprint(w, `{"ok":false,"error":{"code":"file_not_found","message":"File not found."},"request_id":"R2"}`)
	})
	client := New(srv.URL, "k")
	_, err := client.DoJSON(context.Background(), "GET", "/api/files/x", nil, nil)
	apiErr, ok := err.(*APIError)
	if !ok || apiErr.Info.Code != "file_not_found" {
		t.Fatalf("err = %v", err)
	}
}

func TestDownload(t *testing.T) {
	srv := testServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Disposition", `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`)
		w.Write([]byte("PDFDATA"))
	})
	client := New(srv.URL, "k")
	content, filename, err := client.Download(context.Background(), "/api/files/F1/content")
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "PDFDATA" {
		t.Errorf("content = %q", content)
	}
	if filename != "report.pdf" {
		t.Errorf("filename = %q", filename)
	}
}

func TestDownloadAuthFailure(t *testing.T) {
	srv := testServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(401)
		fmt.Fprint(w, `{"ok":false,"error":{"code":"invalid_api_key","message":"bad"}}`)
	})
	client := New(srv.URL, "bad")
	_, _, err := client.Download(context.Background(), "/api/files/F1/content")
	if _, ok := err.(*APIError); !ok {
		t.Fatalf("expected APIError, got %v", err)
	}
}

func TestDownloadServerError(t *testing.T) {
	srv := testServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte("boom"))
	})
	client := New(srv.URL, "k")
	_, _, err := client.Download(context.Background(), "/api/files/F1/content")
	if _, ok := err.(*ServerError); !ok {
		t.Fatalf("expected ServerError, got %v", err)
	}
}

func TestDirectUploadFileStreaming(t *testing.T) {
	// 验证 CLI 只把元数据发给 Worker,文件正文直接 PUT 到上传 URL。
	srv := testServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/files":
			fmt.Fprint(w, envelope(t, 201, map[string]any{
				"id": "F2", "upload_url": "http://" + r.Host + "/put", "upload_method": "PUT",
				"upload_headers": map[string]any{}, "download_url": "http://x/d/t", "expires_at": "x",
			}))
		case r.Method == "PUT" && r.URL.Path == "/put":
			content, _ := io.ReadAll(r.Body)
			if string(content) != "x" {
				t.Errorf("content = %q", content)
			}
		case r.Method == "POST" && r.URL.Path == "/api/files/F2/complete":
			fmt.Fprint(w, envelope(t, 200, map[string]any{"file": map[string]any{"id": "F2"}}))
		default:
			w.WriteHeader(404)
		}
	})

	tmp := filepath.Join(t.TempDir(), "a.bin")
	if err := os.WriteFile(tmp, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	client := New(srv.URL, "k")
	if _, err := client.UploadFile(context.Background(), tmp, nil); err != nil {
		t.Fatal(err)
	}
}

func TestParseContentDisposition(t *testing.T) {
	cases := map[string]string{
		`attachment; filename="a.txt"; filename*=UTF-8''a.txt`: "a.txt",
		`attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf`:  "报告.pdf",
		`attachment; filename="fallback.bin"`:                  "fallback.bin",
		"":                                                     "",
	}
	for cd, want := range cases {
		if got := parseContentDisposition(cd); got != want {
			t.Errorf("parseContentDisposition(%q) = %q, want %q", cd, got, want)
		}
	}
}
