// Package config 测试:配置优先级(§36.1)。
package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadPrecedence(t *testing.T) {
	home := t.TempDir()
	cfgDir := filepath.Join(home, ".config", "afx")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	cfgPath := filepath.Join(cfgDir, "config.toml")
	if err := os.WriteFile(cfgPath, []byte(`
endpoint = "http://file.example.com"
api_key = "file-key"
root_api_key = "file-root"
`), 0o644); err != nil {
		t.Fatal(err)
	}

	t.Setenv("HOME", home)
	// 指向测试目录
	ConfigPath = func() string { return cfgPath }
	defer func() { ConfigPath = func() string { return filepath.Join(home, ".config", "afx", "config.toml") } }()

	t.Run("defaults and file", func(t *testing.T) {
		cfg, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Endpoint != "http://file.example.com" || cfg.APIKey != "file-key" || cfg.RootAPIKey != "file-root" {
			t.Errorf("cfg = %+v", cfg)
		}
	})

	t.Run("env overrides file", func(t *testing.T) {
		t.Setenv("AFX_ENDPOINT", "http://env.example.com")
		t.Setenv("AFX_API_KEY", "env-key")
		cfg, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Endpoint != "http://env.example.com" || cfg.APIKey != "env-key" {
			t.Errorf("cfg = %+v", cfg)
		}
		if cfg.RootAPIKey != "file-root" {
			t.Errorf("root should stay from file, got %q", cfg.RootAPIKey)
		}
	})
}

func TestLoadMissingFileUsesDefaults(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	ConfigPath = func() string { return filepath.Join(home, ".config", "afx", "config.toml") }
	defer func() { ConfigPath = func() string { return "" } }()
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Endpoint != DefaultEndpoint {
		t.Errorf("endpoint = %q", cfg.Endpoint)
	}
}

func TestLoadWithSources(t *testing.T) {
	home := t.TempDir()
	cfgPath := filepath.Join(home, "config.toml")
	if err := os.WriteFile(cfgPath, []byte("endpoint = \"http://file.example.com\"\napi_key = \"file-key\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ConfigPath = func() string { return cfgPath }
	defer func() { ConfigPath = func() string { return "" } }()

	t.Setenv("AFX_ENDPOINT", "http://env.example.com")
	t.Setenv("AFX_API_KEY", "")
	t.Setenv("AFX_ROOT_API_KEY", "")
	cfg, sources, err := LoadWithSources()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Endpoint != "http://env.example.com" || sources.Endpoint != "environment" {
		t.Fatalf("endpoint = %q, source = %q", cfg.Endpoint, sources.Endpoint)
	}
	if cfg.APIKey != "file-key" || sources.APIKey != "config_file" {
		t.Fatalf("api key source = %q", sources.APIKey)
	}
	if !sources.ConfigFilePresent || sources.RootAPIKey != "none" {
		t.Fatalf("sources = %+v", sources)
	}
}
