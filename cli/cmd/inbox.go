package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"afx/internal/api"
	"afx/internal/output"
)

var inboxCmd = &cobra.Command{
	Use:   "inbox",
	Short: "Manage one-time inbox links",
}

var inboxCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a one-time inbox link",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(false)
		if err != nil {
			return err
		}
		body := map[string]any{}
		if inboxExpires != "" {
			d, err := time.ParseDuration(inboxExpires)
			if err != nil {
				return fmt.Errorf("invalid --expires: %w", err)
			}
			body["expires_in"] = int64(d.Seconds())
		}
		if inboxTitle != "" {
			body["title"] = inboxTitle
		}
		if inboxDescription != "" {
			body["description"] = inboxDescription
		}
		if inboxAccept != "" {
			exts := []string{}
			for _, e := range strings.Split(inboxAccept, ",") {
				e = strings.TrimSpace(e)
				if e != "" {
					if !strings.HasPrefix(e, ".") {
						e = "." + e
					}
					exts = append(exts, e)
				}
			}
			body["allowed_extensions"] = exts
		}
		if inboxMaxSize != "" {
			n, err := parseSize(inboxMaxSize)
			if err != nil {
				return fmt.Errorf("invalid --max-size: %w", err)
			}
			body["max_file_size_bytes"] = n
		}

		data, err := client.DoJSON(context.Background(), "POST", "/api/inboxes", nil, body)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string {
			m := v.(map[string]any)
			return fmt.Sprintf("Inbox link created:\n  ID:         %v\n  Upload URL: %v\n  Expires at: %v",
				m["id"], m["upload_url"], m["expires_at"])
		})
		return nil
	},
}

var inboxListCmd = &cobra.Command{
	Use:   "list",
	Short: "List inbox links",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(false)
		if err != nil {
			return err
		}
		query := url.Values{}
		if inboxStatusFilter != "" {
			query.Set("status", inboxStatusFilter)
		}
		data, err := client.DoJSON(context.Background(), "GET", "/api/inboxes", query, nil)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string {
			return listText(v, "inboxes", func(m map[string]any) string {
				title, _ := m["title"].(string)
				return fmt.Sprintf("%s  %-10s  %v  %s", m["id"], m["status"], m["expires_at"], title)
			})
		})
		return nil
	},
}

var inboxInfoCmd = &cobra.Command{
	Use:   "info <inbox-id>",
	Short: "Show inbox details",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(false)
		if err != nil {
			return err
		}
		data, err := client.DoJSON(context.Background(), "GET", "/api/inboxes/"+args[0], nil, nil)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string { return prettyJSON(v) })
		return nil
	},
}

var inboxWaitCmd = &cobra.Command{
	Use:   "wait <inbox-id>",
	Short: "Wait for an inbox upload and optionally download it",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(false)
		if err != nil {
			return err
		}
		timeout := 24 * time.Hour
		if inboxTimeout != "" {
			d, err := time.ParseDuration(inboxTimeout)
			if err != nil {
				return fmt.Errorf("invalid --timeout: %w", err)
			}
			timeout = d
		}

		interval := 2 * time.Second
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()

		for {
			data, err := client.DoJSON(ctx, "GET", "/api/inboxes/"+args[0], nil, nil)
			if err != nil {
				return err
			}
			m, _ := data.(map[string]any)
			status, _ := m["status"].(string)

			switch status {
			case "completed":
				output.Log("File received; wait complete")
				if inboxDownload {
					dest, size, err := downloadTo(ctx, client, "/api/inboxes/"+args[0]+"/file", inboxOutput, args[0])
					if err != nil {
						return err
					}
					output.OK(map[string]any{"status": "completed", "path": dest, "size_bytes": size}, func(v any) string {
						return fmt.Sprintf("Downloaded to %s", v.(map[string]any)["path"])
					})
					return nil
				}
				output.OK(data, func(v any) string { return prettyJSON(v) })
				return nil
			case "expired":
				return &api.APIError{Info: api.ErrorInfo{Code: "inbox_expired", Message: "Inbox link has expired"}}
			case "revoked":
				return &api.APIError{Info: api.ErrorInfo{Code: "inbox_revoked", Message: "Inbox link has been revoked"}}
			}

			// 初始 2s,逐步增加到 10s,加少量随机抖动(§21.3)
			wait := interval + time.Duration(rand.Int63n(int64(interval/4)+1))
			output.Log("Waiting for receipt (status=%s; retrying in %v)", status, wait)
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return &api.TimeoutError{Err: ctx.Err()}
			}
			if interval < 10*time.Second {
				interval += time.Second
			}
		}
	},
}

var inboxReceiveCmd = &cobra.Command{
	Use:   "receive <inbox-id>",
	Short: "Download the received file",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(false)
		if err != nil {
			return err
		}
		dest, size, err := downloadTo(context.Background(), client, "/api/inboxes/"+args[0]+"/file", inboxOutput, args[0])
		if err != nil {
			return err
		}
		output.OK(map[string]any{"path": dest, "size_bytes": size}, func(v any) string {
			return fmt.Sprintf("Downloaded to %s", v.(map[string]any)["path"])
		})
		return nil
	},
}

var inboxRevokeCmd = &cobra.Command{
	Use:   "revoke <inbox-id>",
	Short: "Revoke an inbox link",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(false)
		if err != nil {
			return err
		}
		data, err := client.DoJSON(context.Background(), "DELETE", "/api/inboxes/"+args[0], nil, nil)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string { return "Inbox link revoked" })
		return nil
	},
}

var (
	inboxExpires      string
	inboxTitle        string
	inboxDescription  string
	inboxAccept       string
	inboxMaxSize      string
	inboxStatusFilter string
	inboxTimeout      string
	inboxDownload     bool
	inboxOutput       string
)

func init() {
	inboxCreateCmd.Flags().StringVar(&inboxExpires, "expires", "", "lifetime, for example 1h or 24h")
	inboxCreateCmd.Flags().StringVar(&inboxTitle, "title", "", "invitation title")
	inboxCreateCmd.Flags().StringVar(&inboxDescription, "description", "", "invitation description")
	inboxCreateCmd.Flags().StringVar(&inboxAccept, "accept", "", "allowed extensions, comma-separated, for example .zip,.log")
	inboxCreateCmd.Flags().StringVar(&inboxMaxSize, "max-size", "", "maximum file size, for example 100MiB or 10MB")
	inboxListCmd.Flags().StringVar(&inboxStatusFilter, "status", "", "filter by status")
	inboxWaitCmd.Flags().StringVar(&inboxTimeout, "timeout", "", "wait timeout, for example 1h (default 24h)")
	inboxWaitCmd.Flags().BoolVar(&inboxDownload, "download", false, "download automatically after receipt")
	inboxWaitCmd.Flags().StringVar(&inboxOutput, "output", ".", "destination directory or file path")
	inboxReceiveCmd.Flags().StringVar(&inboxOutput, "output", ".", "destination directory or file path")

	inboxCmd.AddCommand(inboxCreateCmd, inboxListCmd, inboxInfoCmd, inboxWaitCmd, inboxReceiveCmd, inboxRevokeCmd)
}

// parseSize 解析 100MiB / 10MB / 500KB / 1024 等大小。
func parseSize(s string) (int64, error) {
	s = strings.TrimSpace(strings.ToUpper(s))
	mult := int64(1)
	for _, suffix := range []struct {
		sfx string
		mul int64
	}{
		{"GIB", 1 << 30}, {"GB", 1000 * 1000 * 1000},
		{"MIB", 1 << 20}, {"MB", 1000 * 1000},
		{"KIB", 1 << 10}, {"KB", 1000},
		{"B", 1},
	} {
		if strings.HasSuffix(s, suffix.sfx) {
			s = strings.TrimSuffix(s, suffix.sfx)
			mult = suffix.mul
			break
		}
	}
	var n float64
	if _, err := fmt.Sscanf(s, "%g", &n); err != nil {
		return 0, fmt.Errorf("cannot parse size %q", s)
	}
	return int64(n * float64(mult)), nil
}

var _ = json.Marshal
var _ = filepath.Base
