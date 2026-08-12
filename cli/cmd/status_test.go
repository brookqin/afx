package cmd

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"afx/internal/config"
)

func TestCollectStatusWithoutAPIKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		fmt.Fprint(w, `{"ok":true,"status":"ok","time":"now"}`)
	}))
	defer srv.Close()

	oldPath := config.ConfigPath
	config.ConfigPath = func() string { return filepath.Join(t.TempDir(), "missing.toml") }
	t.Cleanup(func() { config.ConfigPath = oldPath })
	t.Setenv("AFX_ENDPOINT", srv.URL)
	t.Setenv("AFX_API_KEY", "")
	flagEndpoint, flagAPIKey = "", ""

	data, err := collectStatus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if data["state"] != "unconfigured" {
		t.Fatalf("data = %#v", data)
	}
	cfg := data["config"].(map[string]any)
	if cfg["config_file"] == "" {
		t.Fatalf("config = %#v", cfg)
	}
	if _, exists := cfg["config_file_legacy"]; exists {
		t.Fatal("status config must not contain legacy fields")
	}
}

func TestCollectStatusValidatesKeyWithoutExposingIt(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/status" || r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Fatalf("request = %s, auth configured = %v", r.URL.Path, r.Header.Get("Authorization") != "")
		}
		fmt.Fprint(w, `{"ok":true,"data":{"authenticated":true,"key":{"name":"skill","scopes":[]}}}`)
	}))
	defer srv.Close()

	oldPath := config.ConfigPath
	config.ConfigPath = func() string { return filepath.Join(t.TempDir(), "missing.toml") }
	t.Cleanup(func() { config.ConfigPath = oldPath })
	t.Setenv("AFX_ENDPOINT", srv.URL)
	t.Setenv("AFX_API_KEY", "test-secret")
	flagEndpoint, flagAPIKey = "", ""

	data, err := collectStatus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if data["state"] != "ready" {
		t.Fatalf("data = %#v", data)
	}
	if strings.Contains(fmt.Sprintf("%v", data), "test-secret") {
		t.Fatal("status exposed API key")
	}
	cfg := data["config"].(map[string]any)
	if _, exists := cfg["api_key"]; exists {
		t.Fatal("status config must not contain API key")
	}
}

func TestStatusTextReportsConfigCreationPath(t *testing.T) {
	text := statusText(map[string]any{
		"state": "unconfigured",
		"config": map[string]any{
			"endpoint":        "https://files.example.com",
			"endpoint_source": "environment",
			"config_file":     "/platform/dev.qiankun.afx/config.toml",
		},
	})
	if !strings.Contains(text, "/platform/dev.qiankun.afx/config.toml") {
		t.Fatalf("text = %q", text)
	}
}
