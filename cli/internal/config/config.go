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

// Sources records where non-secret configuration values were resolved from.
type Sources struct {
	ConfigFilePresent bool
	Endpoint          string
	APIKey            string
	RootAPIKey        string
}

// ConfigPath 返回配置文件路径(变量便于测试覆盖)。
var ConfigPath = func() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".config", "afx", "config.toml")
}

// LoadWithSources 从配置文件 + 环境变量加载配置并记录来源。
func LoadWithSources() (*Config, Sources, error) {
	cfg := &Config{Endpoint: DefaultEndpoint}
	sources := Sources{Endpoint: "default", APIKey: "none", RootAPIKey: "none"}

	// 1. 配置文件
	if path := ConfigPath(); path != "" {
		if data, err := os.ReadFile(path); err == nil {
			sources.ConfigFilePresent = true
			fileCfg := &Config{}
			if err := toml.Unmarshal(data, fileCfg); err != nil {
				return nil, Sources{}, err
			}
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

// Load preserves the original configuration-only API.
func Load() (*Config, error) {
	cfg, _, err := LoadWithSources()
	return cfg, err
}
