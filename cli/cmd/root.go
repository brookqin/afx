// Package cmd 定义 afx 命令行。
package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"afx/internal/api"
	"afx/internal/config"
	"afx/internal/output"
)

var (
	flagJSON     bool
	flagEndpoint string
	flagAPIKey   string
	flagRootKey  string
)

var rootCmd = &cobra.Command{
	Use:   "afx",
	Short: "Agent File Exchange CLI",
	Long: `afx - CLI for temporary file exchange.

Upload and share files, create one-time inbox links, wait for received files,
and perform Root administration.
Configuration precedence: flags > environment variables > ~/.config/afx/config.toml.`,
	SilenceUsage:      true,
	SilenceErrors:     true,
	CompletionOptions: cobra.CompletionOptions{DisableDefaultCmd: true},
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		output.SetJSON(flagJSON)
		return nil
	},
}

// Execute 入口。
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		output.Fail(err)
	}
	os.Exit(output.ExitOK)
}

func init() {
	rootCmd.PersistentFlags().BoolVar(&flagJSON, "json", false, "emit JSON (logs go to stderr)")
	rootCmd.PersistentFlags().StringVar(&flagEndpoint, "endpoint", "", "server endpoint; overrides AFX_ENDPOINT")
	rootCmd.PersistentFlags().StringVar(&flagAPIKey, "api-key", "", "API key; overrides AFX_API_KEY")
	rootCmd.PersistentFlags().StringVar(&flagRootKey, "root-key", "", "Root API key; overrides AFX_ROOT_API_KEY")
	rootCmd.AddCommand(uploadCmd)
	rootCmd.AddCommand(filesCmd)
	rootCmd.AddCommand(inboxCmd)
	rootCmd.AddCommand(adminCmd)
	rootCmd.AddCommand(versionCmd)
}

// resolveConfig 组装配置与客户端。root 为 true 时使用 Root Key。
func resolveConfig(useRoot bool) (*api.Client, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	if flagEndpoint != "" {
		cfg.Endpoint = flagEndpoint
	}
	key := cfg.APIKey
	if useRoot {
		key = cfg.RootAPIKey
	}
	if flagAPIKey != "" && !useRoot {
		key = flagAPIKey
	}
	if flagRootKey != "" && useRoot {
		key = flagRootKey
	}
	if key == "" {
		if useRoot {
			return nil, fmt.Errorf("Root API key is not configured (set AFX_ROOT_API_KEY or --root-key)")
		}
		return nil, fmt.Errorf("API key is not configured (set AFX_API_KEY or --api-key)")
	}
	return api.New(cfg.Endpoint, key), nil
}
