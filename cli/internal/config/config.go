// Package config 处理 CLI 配置优先级(§30.1):
// 命令行参数 > 环境变量 > 配置文件(~/.config/afx/config.toml)
package config

import (
	"os"
	"path/filepath"

	"github.com/pelletier/go-toml/v2"
)

const DefaultEndpoint = "http://localhost:8787"

type Config struct {
	Endpoint   string `toml:"endpoint"`
	APIKey     string `toml:"api_key"`
	RootAPIKey string `toml:"root_api_key"`
}

// ConfigPath 返回配置文件路径(变量便于测试覆盖)。
var ConfigPath = func() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".config", "afx", "config.toml")
}

// Load 从配置文件 + 环境变量加载配置。
func Load() (*Config, error) {
	cfg := &Config{Endpoint: DefaultEndpoint}

	// 1. 配置文件
	if path := ConfigPath(); path != "" {
		if data, err := os.ReadFile(path); err == nil {
			if err := toml.Unmarshal(data, cfg); err != nil {
				return nil, err
			}
		}
	}

	// 2. 环境变量
	if v := os.Getenv("AFX_ENDPOINT"); v != "" {
		cfg.Endpoint = v
	}
	if v := os.Getenv("AFX_API_KEY"); v != "" {
		cfg.APIKey = v
	}
	if v := os.Getenv("AFX_ROOT_API_KEY"); v != "" {
		cfg.RootAPIKey = v
	}
	return cfg, nil
}
