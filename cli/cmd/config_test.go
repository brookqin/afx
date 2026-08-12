package cmd

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"afx/internal/config"
)

const testTenantAPIKey = "afx_01J5ZD7A2F0000000000000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

func usePersistentConfigPath(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "dev.qiankun.afx", "config.toml")
	oldPath := config.ConfigPath
	config.ConfigPath = func() string { return path }
	t.Cleanup(func() { config.ConfigPath = oldPath })
	return path
}

func TestSetPersistentConfigCreatesAndUpdates(t *testing.T) {
	path := usePersistentConfigPath(t)
	data, err := setPersistentConfig("https://files.example.com/", true, true, strings.NewReader(testTenantAPIKey+"\n"))
	if err != nil {
		t.Fatal(err)
	}
	if data["path"] != path || data["created"] != true || data["endpoint"] != "https://files.example.com" || data["api_key_configured"] != true {
		t.Fatalf("data = %#v", data)
	}
	if !reflect.DeepEqual(data["updated_fields"], []string{"endpoint", "api_key"}) {
		t.Fatalf("fields = %#v", data["updated_fields"])
	}

	data, err = setPersistentConfig("https://new.example.com", true, false, strings.NewReader(""))
	if err != nil {
		t.Fatal(err)
	}
	if data["created"] != false || data["endpoint"] != "https://new.example.com" || data["api_key_configured"] != true {
		t.Fatalf("data = %#v", data)
	}
	cfg, exists, err := config.LoadPersistent()
	if err != nil {
		t.Fatal(err)
	}
	if !exists || cfg.APIKey != testTenantAPIKey {
		t.Fatalf("cfg = %+v, exists = %v", cfg, exists)
	}
}

func TestSetPersistentConfigRequiresEndpointOnCreate(t *testing.T) {
	usePersistentConfigPath(t)
	if _, err := setPersistentConfig("", false, true, strings.NewReader(testTenantAPIKey)); err == nil {
		t.Fatal("expected missing endpoint error")
	}
}

func TestSetPersistentConfigRejectsStoredRootKey(t *testing.T) {
	usePersistentConfigPath(t)
	if _, _, err := config.SavePersistent(&config.Config{
		Endpoint:   "https://files.example.com",
		RootAPIKey: "afx_root_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := setPersistentConfig("https://new.example.com", true, false, strings.NewReader("")); err == nil {
		t.Fatal("expected stored Root key rejection")
	}
}

func TestReadTenantAPIKeyAcceptsAdminJSON(t *testing.T) {
	raw, err := json.Marshal(map[string]any{
		"ok":   true,
		"data": map[string]any{"id": "K1", "api_key": testTenantAPIKey, "name": "mbp2025"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := readTenantAPIKey(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	if got != testTenantAPIKey {
		t.Fatal("API key mismatch")
	}
}

func TestReadTenantAPIKeyRejectsRootAndFailedJSON(t *testing.T) {
	for _, value := range []string{
		"afx_root_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		`{"ok":false,"error":{"code":"denied"}}`,
		"afx_invalid",
	} {
		if _, err := readTenantAPIKey(strings.NewReader(value)); err == nil {
			t.Fatalf("accepted %q", value)
		}
	}
}

func TestSetPersistentConfigDoesNotExposeKeyInData(t *testing.T) {
	usePersistentConfigPath(t)
	data, err := setPersistentConfig("https://files.example.com", true, true, strings.NewReader(testTenantAPIKey))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), testTenantAPIKey) {
		t.Fatal("configuration result exposed API key")
	}
}

func TestNormalizeEndpoint(t *testing.T) {
	for _, value := range []string{"files.example.com", "ftp://files.example.com", "https://user@files.example.com", "https://files.example.com?q=1"} {
		if _, err := normalizeEndpoint(value); err == nil {
			t.Fatalf("accepted %q", value)
		}
	}
	got, err := normalizeEndpoint(" https://files.example.com/base/ ")
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://files.example.com/base" {
		t.Fatalf("got %q", got)
	}
}
