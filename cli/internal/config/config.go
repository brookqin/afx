// Package config 处理 CLI 配置优先级(§30.1):
// 命令行参数 > 环境变量 > 用户配置目录中的 dev.qiankun.afx/config.toml。
package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/pelletier/go-toml/v2"
)

const DefaultEndpoint = "http://localhost:8787"

type Config struct {
	Endpoint   string `toml:"endpoint,omitempty"`
	APIKey     string `toml:"api_key,omitempty"`
	RootAPIKey string `toml:"root_api_key,omitempty"`
}

// Sources records where non-secret configuration values were resolved from.
type Sources struct {
	ConfigFilePresent bool
	ConfigFile        string
	Endpoint          string
	APIKey            string
	RootAPIKey        string
}

var userConfigDir = os.UserConfigDir

// ConfigPath 返回当前平台的规范配置文件路径(变量便于测试覆盖)。
var ConfigPath = func() string {
	dir, err := userConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "dev.qiankun.afx", "config.toml")
}

// LoadWithSources 从配置文件 + 环境变量加载配置并记录来源。
func LoadWithSources() (*Config, Sources, error) {
	cfg := &Config{Endpoint: DefaultEndpoint}
	sources := Sources{
		ConfigFile: ConfigPath(),
		Endpoint:   "default",
		APIKey:     "none",
		RootAPIKey: "none",
	}

	// 1. 配置文件
	if sources.ConfigFile != "" {
		fileCfg, present, err := loadFile(sources.ConfigFile)
		if err != nil {
			return nil, Sources{}, err
		}
		if present {
			sources.ConfigFilePresent = true
			if fileCfg.Endpoint != "" {
				cfg.Endpoint = fileCfg.Endpoint
				sources.Endpoint = "config_file"
			}
			if fileCfg.APIKey != "" {
				cfg.APIKey = fileCfg.APIKey
				sources.APIKey = "config_file"
			}
			if fileCfg.RootAPIKey != "" {
				cfg.RootAPIKey = fileCfg.RootAPIKey
				sources.RootAPIKey = "config_file"
			}
		}
	}

	// 2. 环境变量
	if v := os.Getenv("AFX_ENDPOINT"); v != "" {
		cfg.Endpoint = v
		sources.Endpoint = "environment"
	}
	if v := os.Getenv("AFX_API_KEY"); v != "" {
		cfg.APIKey = v
		sources.APIKey = "environment"
	}
	if v := os.Getenv("AFX_ROOT_API_KEY"); v != "" {
		cfg.RootAPIKey = v
		sources.RootAPIKey = "environment"
	}
	return cfg, sources, nil
}

// LoadPersistent reads only the persistent file, without environment overrides.
func LoadPersistent() (*Config, bool, error) {
	path := ConfigPath()
	if path == "" {
		return nil, false, fmt.Errorf("user configuration directory is unavailable")
	}
	return loadFile(path)
}

// SavePersistent atomically creates or replaces the persistent configuration.
func SavePersistent(cfg *Config) (string, bool, error) {
	path := ConfigPath()
	if path == "" {
		return "", false, fmt.Errorf("user configuration directory is unavailable")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", false, fmt.Errorf("create config directory %q: %w", dir, err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return "", false, fmt.Errorf("secure config directory %q: %w", dir, err)
	}

	created := true
	if info, err := os.Lstat(path); err == nil {
		created = false
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return "", false, fmt.Errorf("config path %q is not a regular file", path)
		}
	} else if !os.IsNotExist(err) {
		return "", false, fmt.Errorf("inspect config %q: %w", path, err)
	}

	raw, err := toml.Marshal(cfg)
	if err != nil {
		return "", false, fmt.Errorf("encode config: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".config-*.tmp")
	if err != nil {
		return "", false, fmt.Errorf("create temporary config: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return "", false, fmt.Errorf("secure temporary config: %w", err)
	}
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return "", false, fmt.Errorf("write temporary config: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return "", false, fmt.Errorf("sync temporary config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", false, fmt.Errorf("close temporary config: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return "", false, fmt.Errorf("replace config %q: %w", path, err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return "", false, fmt.Errorf("secure config %q: %w", path, err)
	}
	return path, created, nil
}

func loadFile(path string) (*Config, bool, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &Config{}, false, nil
		}
		return nil, false, fmt.Errorf("read config %q: %w", path, err)
	}
	cfg := &Config{}
	if err := toml.Unmarshal(data, cfg); err != nil {
		return nil, false, fmt.Errorf("parse config %q: %w", path, err)
	}
	return cfg, true, nil
}

// Load preserves the original configuration-only API.
func Load() (*Config, error) {
	cfg, _, err := LoadWithSources()
	return cfg, err
}
