package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/spf13/cobra"

	"afx/internal/config"
	"afx/internal/output"
)

const maxAPIKeyInputBytes = 64 << 10

var tenantAPIKeyPattern = regexp.MustCompile(`^afx_[0-9A-HJKMNP-TV-Z]{26}_[A-Za-z0-9_-]{43}$`)

var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Create or update persistent CLI configuration",
}

var configSetCmd = &cobra.Command{
	Use:   "set",
	Short: "Create or update endpoint and API key configuration",
	Long: `Create or update persistent endpoint and tenant API key configuration.

Use --api-key-stdin for key material. The inherited --api-key and --root-key
flags are deliberately rejected by this command.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		endpointSet := cmd.Flags().Changed("endpoint") || cmd.InheritedFlags().Changed("endpoint")
		if !endpointSet && !configAPIKeyStdin {
			return fmt.Errorf("provide --endpoint, --api-key-stdin, or both")
		}
		if flagAPIKey != "" {
			return fmt.Errorf("--api-key is not accepted by config set; pipe the key to --api-key-stdin")
		}
		if flagRootKey != "" {
			return fmt.Errorf("Root API keys cannot be stored by config set")
		}
		data, err := setPersistentConfig(flagEndpoint, endpointSet, configAPIKeyStdin, os.Stdin)
		if err != nil {
			return err
		}
		output.OK(data, func(value any) string {
			m := value.(map[string]any)
			action := "updated"
			if m["created"] == true {
				action = "created"
			}
			return fmt.Sprintf("Configuration %s:\n  Path: %v\n  Endpoint: %v\n  API key configured: %v",
				action, m["path"], m["endpoint"], m["api_key_configured"])
		})
		return nil
	},
}

var configAPIKeyStdin bool

func init() {
	configSetCmd.Flags().BoolVar(&configAPIKeyStdin, "api-key-stdin", false, "read a tenant API key or admin-create JSON envelope from stdin")
	configCmd.AddCommand(configSetCmd)
}

func setPersistentConfig(endpoint string, endpointSet, apiKeyStdin bool, input io.Reader) (map[string]any, error) {
	cfg, exists, err := config.LoadPersistent()
	if err != nil {
		return nil, err
	}
	if cfg.RootAPIKey != "" {
		return nil, fmt.Errorf("persistent config contains root_api_key; remove it before using config set")
	}
	if (!exists || cfg.Endpoint == "") && !endpointSet {
		return nil, fmt.Errorf("persistent endpoint is not configured; --endpoint is required")
	}
	fields := []string{}
	if endpointSet {
		cfg.Endpoint, err = normalizeEndpoint(endpoint)
		if err != nil {
			return nil, err
		}
		fields = append(fields, "endpoint")
	}
	if apiKeyStdin {
		cfg.APIKey, err = readTenantAPIKey(input)
		if err != nil {
			return nil, err
		}
		fields = append(fields, "api_key")
	}
	path, created, err := config.SavePersistent(cfg)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"path":               path,
		"created":            created,
		"updated_fields":     fields,
		"endpoint":           cfg.Endpoint,
		"api_key_configured": cfg.APIKey != "",
	}, nil
}

func normalizeEndpoint(value string) (string, error) {
	value = strings.TrimRight(strings.TrimSpace(value), "/")
	u, err := url.Parse(value)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("invalid --endpoint: use an http or https base URL without credentials, query, or fragment")
	}
	return value, nil
}

func readTenantAPIKey(input io.Reader) (string, error) {
	raw, err := io.ReadAll(io.LimitReader(input, maxAPIKeyInputBytes+1))
	if err != nil {
		return "", fmt.Errorf("read API key from stdin: %w", err)
	}
	if len(raw) > maxAPIKeyInputBytes {
		return "", fmt.Errorf("API key input exceeds %d bytes", maxAPIKeyInputBytes)
	}
	value := strings.TrimSpace(string(raw))
	if strings.HasPrefix(value, "{") {
		var envelope struct {
			OK   bool `json:"ok"`
			Data struct {
				APIKey string `json:"api_key"`
			} `json:"data"`
		}
		if err := json.Unmarshal(raw, &envelope); err != nil {
			return "", fmt.Errorf("parse API key JSON from stdin: %w", err)
		}
		if !envelope.OK || envelope.Data.APIKey == "" {
			return "", fmt.Errorf("stdin JSON is not a successful API key creation response")
		}
		value = envelope.Data.APIKey
	}
	if !tenantAPIKeyPattern.MatchString(value) {
		return "", fmt.Errorf("stdin does not contain a valid tenant API key")
	}
	return value, nil
}
