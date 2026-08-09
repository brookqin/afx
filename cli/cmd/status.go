package cmd

import (
	"context"
	"fmt"
	"time"

	"github.com/spf13/cobra"

	"afx/internal/api"
	"afx/internal/buildinfo"
	"afx/internal/config"
	"afx/internal/output"
)

const displayConfigPath = "~/.config/afx/config.toml"

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Check configuration, service connectivity, and API key validity",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		data, err := collectStatus(ctx)
		if err != nil {
			return err
		}
		output.OK(data, statusText)
		return nil
	},
}

func collectStatus(ctx context.Context) (map[string]any, error) {
	cfg, sources, err := config.LoadWithSources()
	if err != nil {
		return nil, err
	}
	if flagEndpoint != "" {
		cfg.Endpoint = flagEndpoint
		sources.Endpoint = "flag"
	}
	if flagAPIKey != "" {
		cfg.APIKey = flagAPIKey
		sources.APIKey = "flag"
	}

	data := map[string]any{
		"cli": buildinfo.Current(),
		"config": map[string]any{
			"endpoint":            cfg.Endpoint,
			"endpoint_source":     sources.Endpoint,
			"config_file":         displayConfigPath,
			"config_file_present": sources.ConfigFilePresent,
			"api_key_configured":  cfg.APIKey != "",
			"api_key_source":      sources.APIKey,
		},
	}
	client := api.New(cfg.Endpoint, cfg.APIKey)
	if cfg.APIKey == "" {
		health, err := client.Health(ctx)
		if err != nil {
			return nil, err
		}
		data["state"] = "unconfigured"
		data["server"] = map[string]any{"reachable": true, "status": health["status"], "time": health["time"]}
		data["authentication"] = map[string]any{"valid": nil}
		return data, nil
	}

	remote, err := client.DoJSON(ctx, "GET", "/api/status", nil, nil)
	if err != nil {
		return nil, err
	}
	data["state"] = "ready"
	data["server"] = map[string]any{"reachable": true}
	data["authentication"] = map[string]any{"valid": true}
	data["remote"] = remote
	return data, nil
}

func statusText(value any) string {
	data, _ := value.(map[string]any)
	cfg, _ := data["config"].(map[string]any)
	if data["state"] == "ready" {
		return fmt.Sprintf("Ready\nEndpoint: %v (%v)\nAPI key: valid (%v)", cfg["endpoint"], cfg["endpoint_source"], cfg["api_key_source"])
	}
	return fmt.Sprintf("Service reachable, but no API key is configured\nEndpoint: %v (%v)\nConfigure AFX_API_KEY or %s", cfg["endpoint"], cfg["endpoint_source"], displayConfigPath)
}
