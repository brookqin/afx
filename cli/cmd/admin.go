package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/spf13/cobra"

	"afx/internal/output"
)

var adminCmd = &cobra.Command{
	Use:   "admin",
	Short: "Root administration (requires a Root API key)",
}

var adminKeysCmd = &cobra.Command{
	Use:   "keys",
	Short: "Manage API keys",
}

var adminKeysCreateCmd = &cobra.Command{
	Use:   "create <name>",
	Short: "Create an API key (the full key is returned once)",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(true)
		if err != nil {
			return err
		}
		body := map[string]any{"name": args[0]}
		if adminScopes != "" {
			body["scopes"] = splitCSV(adminScopes)
		}
		if adminMaxSize != "" {
			n, err := parseSize(adminMaxSize)
			if err != nil {
				return fmt.Errorf("invalid --max-size: %w", err)
			}
			body["max_file_size_bytes"] = n
		}
		data, err := client.DoJSON(context.Background(), "POST", "/api/root/keys", nil, body)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string {
			m := v.(map[string]any)
			return fmt.Sprintf("API key created (save it now; it will not be shown again):\n  ID:      %v\n  API Key: %v\n  Name:    %v",
				m["id"], m["api_key"], m["name"])
		})
		return nil
	},
}

var adminKeysListCmd = &cobra.Command{
	Use:   "list",
	Short: "List API keys",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(true)
		if err != nil {
			return err
		}
		data, err := client.DoJSON(context.Background(), "GET", "/api/root/keys", nil, nil)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string {
			return listText(v, "keys", func(m map[string]any) string {
				return fmt.Sprintf("%s  %-9s  %-8s  %v", m["id"], m["status"], m["secret_prefix"], m["name"])
			})
		})
		return nil
	},
}

var adminKeysDisableCmd = &cobra.Command{
	Use:   "disable <key-id>",
	Short: "Disable an API key",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		return patchKeyStatus(args[0], "disabled")
	},
}

var adminKeysEnableCmd = &cobra.Command{
	Use:   "enable <key-id>",
	Short: "Enable an API key",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		return patchKeyStatus(args[0], "active")
	},
}

var adminKeysRevokeCmd = &cobra.Command{
	Use:   "revoke <key-id>",
	Short: "Revoke an API key",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(true)
		if err != nil {
			return err
		}
		data, err := client.DoJSON(context.Background(), "DELETE", "/api/root/keys/"+args[0], nil,
			map[string]any{"resource_policy": adminResourcePolicy})
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string { return "API key revoked" })
		return nil
	},
}

func patchKeyStatus(id, status string) error {
	client, err := resolveConfig(true)
	if err != nil {
		return err
	}
	data, err := client.DoJSON(context.Background(), "PATCH", "/api/root/keys/"+id, nil,
		map[string]any{"status": status})
	if err != nil {
		return err
	}
	output.OK(data, func(v any) string { return fmt.Sprintf("API key %s status changed to %s", id, status) })
	return nil
}

var adminFilesListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all files",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(true)
		if err != nil {
			return err
		}
		query := url.Values{}
		if adminOwner != "" {
			query.Set("owner_key_id", adminOwner)
		}
		if adminStatus != "" {
			query.Set("status", adminStatus)
		}
		data, err := client.DoJSON(context.Background(), "GET", "/api/root/files", query, nil)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string {
			return listText(v, "files", func(m map[string]any) string {
				return fmt.Sprintf("%s  %-9s  %-9s %10v bytes  %s", m["id"], m["status"], m["source"], m["size_bytes"], m["filename"])
			})
		})
		return nil
	},
}

var adminInboxesListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all inbox links",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(true)
		if err != nil {
			return err
		}
		data, err := client.DoJSON(context.Background(), "GET", "/api/root/inboxes", nil, nil)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string {
			return listText(v, "inboxes", func(m map[string]any) string {
				return fmt.Sprintf("%s  %-10s  %v", m["id"], m["status"], m["expires_at"])
			})
		})
		return nil
	},
}

var adminAuditListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all audit events",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(true)
		if err != nil {
			return err
		}
		query := url.Values{}
		if adminAction != "" {
			query.Set("action", adminAction)
		}
		data, err := client.DoJSON(context.Background(), "GET", "/api/root/audit", query, nil)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string {
			return listText(v, "events", func(m map[string]any) string {
				return fmt.Sprintf("#%v  %-28s  %-9s  %v", m["id"], m["action"], m["result"], m["created_at"])
			})
		})
		return nil
	},
}

var adminStatsCmd = &cobra.Command{
	Use:   "stats",
	Short: "Show global statistics",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(true)
		if err != nil {
			return err
		}
		data, err := client.DoJSON(context.Background(), "GET", "/api/root/stats", nil, nil)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string {
			raw, _ := jsonMarshalIndent(v)
			return string(raw)
		})
		return nil
	},
}

var (
	adminScopes         string
	adminMaxSize        string
	adminResourcePolicy string
	adminOwner          string
	adminStatus         string
	adminAction         string
)

func init() {
	adminKeysCreateCmd.Flags().StringVar(&adminScopes, "scopes", "", "comma-separated scopes (all by default)")
	adminKeysCreateCmd.Flags().StringVar(&adminMaxSize, "max-size", "", "maximum file size, for example 100MiB")
	adminKeysRevokeCmd.Flags().StringVar(&adminResourcePolicy, "resource-policy", "keep", "keep / revoke_inboxes / revoke_all / delete_all")
	adminFilesListCmd.Flags().StringVar(&adminOwner, "owner", "", "filter by tenant")
	adminFilesListCmd.Flags().StringVar(&adminStatus, "status", "", "filter by status")
	adminAuditListCmd.Flags().StringVar(&adminAction, "action", "", "filter by action")

	adminKeysCmd.AddCommand(adminKeysCreateCmd, adminKeysListCmd, adminKeysDisableCmd, adminKeysEnableCmd, adminKeysRevokeCmd)

	adminFilesCmd := &cobra.Command{Use: "files", Short: "Manage all files"}
	adminFilesCmd.AddCommand(adminFilesListCmd)
	adminInboxesCmd := &cobra.Command{Use: "inboxes", Short: "Manage all inbox links"}
	adminInboxesCmd.AddCommand(adminInboxesListCmd)
	adminAuditCmd := &cobra.Command{Use: "audit", Short: "Audit all tenants"}
	adminAuditCmd.AddCommand(adminAuditListCmd)

	adminCmd.AddCommand(adminKeysCmd, adminFilesCmd, adminInboxesCmd, adminAuditCmd, adminStatsCmd)
}

func splitCSV(s string) []string {
	out := []string{}
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func jsonMarshalIndent(v any) ([]byte, error) {
	return json.MarshalIndent(v, "", "  ")
}
