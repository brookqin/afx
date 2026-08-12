// Package config 测试:配置优先级(§36.1)。
package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func useConfigPath(t *testing.T, path string) {
	t.Helper()
	oldPath := ConfigPath
	ConfigPath = func() string { return path }
	t.Cleanup(func() { ConfigPath = oldPath })
}

func TestConfigPathUsesUserConfigDir(t *testing.T) {
	oldUserConfigDir := userConfigDir
	userConfigDir = func() (string, error) { return filepath.Join("platform", "config"), nil }
	t.Cleanup(func() { userConfigDir = oldUserConfigDir })

	want := filepath.Join("platform", "config", "dev.qiankun.afx", "config.toml")
	if got := ConfigPath(); got != want {
		t.Fatalf("ConfigPath() = %q, want %q", got, want)
	}
}

func TestLoadPrecedence(t *testing.T) {
	home := t.TempDir()
	cfgDir := filepath.Join(home, "dev.qiankun.afx")
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

	useConfigPath(t, cfgPath)

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
	cfgPath := filepath.Join(home, "dev.qiankun.afx", "config.toml")
	useConfigPath(t, cfgPath)
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
	useConfigPath(t, cfgPath)

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
	if !sources.ConfigFilePresent || sources.ConfigFile != cfgPath || sources.RootAPIKey != "none" {
		t.Fatalf("sources = %+v", sources)
	}
}

func TestLoadIgnoresOldConfigPath(t *testing.T) {
	dir := t.TempDir()
	currentPath := filepath.Join(dir, "dev.qiankun.afx", "config.toml")
	oldPath := filepath.Join(dir, "afx", "config.toml")
	if err := os.MkdirAll(filepath.Dir(oldPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oldPath, []byte("endpoint = \"http://old.example.com\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	useConfigPath(t, currentPath)

	cfg, sources, err := LoadWithSources()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Endpoint != DefaultEndpoint || sources.ConfigFilePresent || sources.ConfigFile != currentPath {
		t.Fatalf("cfg = %+v, sources = %+v", cfg, sources)
	}
}

func TestLoadReportsInvalidConfigPath(t *testing.T) {
	dir := t.TempDir()
	currentPath := filepath.Join(dir, "dev.qiankun.afx")
	if err := os.MkdirAll(currentPath, 0o700); err != nil {
		t.Fatal(err)
	}
	useConfigPath(t, currentPath)

	if _, _, err := LoadWithSources(); err == nil {
		t.Fatal("expected current config path error")
	}
}

func TestSavePersistentCreatesAndUpdatesSecureFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dev.qiankun.afx", "config.toml")
	useConfigPath(t, path)

	gotPath, created, err := SavePersistent(&Config{Endpoint: "https://one.example.com", APIKey: "first"})
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != path || !created {
		t.Fatalf("path = %q, created = %v", gotPath, created)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("file mode = %o", info.Mode().Perm())
	}
	dirInfo, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if dirInfo.Mode().Perm() != 0o700 {
		t.Fatalf("directory mode = %o", dirInfo.Mode().Perm())
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "root_api_key") {
		t.Fatal("empty Root key was serialized")
	}

	_, created, err = SavePersistent(&Config{Endpoint: "https://two.example.com", APIKey: "second"})
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Fatal("update reported creation")
	}
	cfg, exists, err := LoadPersistent()
	if err != nil {
		t.Fatal(err)
	}
	if !exists || cfg.Endpoint != "https://two.example.com" || cfg.APIKey != "second" {
		t.Fatalf("cfg = %+v, exists = %v", cfg, exists)
	}
}

func TestSavePersistentRejectsSymlink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target.toml")
	if err := os.WriteFile(target, []byte("endpoint = \"https://safe.example.com\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "dev.qiankun.afx", "config.toml")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, path); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	useConfigPath(t, path)

	if _, _, err := SavePersistent(&Config{Endpoint: "https://evil.example.com"}); err == nil {
		t.Fatal("expected symlink rejection")
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "evil") {
		t.Fatal("symlink target was modified")
	}
}
