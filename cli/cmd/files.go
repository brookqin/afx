package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"afx/internal/api"
	"afx/internal/output"
)

var filesCmd = &cobra.Command{
	Use:   "files",
	Short: "Manage files",
}

var filesListCmd = &cobra.Command{
	Use:   "list",
	Short: "List files",
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(false)
		if err != nil {
			return err
		}
		query := url.Values{}
		if filesStatus != "" {
			query.Set("status", filesStatus)
		}
		if filesLimit > 0 {
			query.Set("limit", fmt.Sprintf("%d", filesLimit))
		}
		data, err := client.DoJSON(context.Background(), "GET", "/api/files", query, nil)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string {
			return listText(v, "files", func(m map[string]any) string {
				return fmt.Sprintf("%s  %-12s %10v bytes  %s", m["id"], m["status"], m["size_bytes"], m["filename"])
			})
		})
		return nil
	},
}

var filesInfoCmd = &cobra.Command{
	Use:   "info <file-id>",
	Short: "Show file details",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(false)
		if err != nil {
			return err
		}
		data, err := client.DoJSON(context.Background(), "GET", "/api/files/"+args[0], nil, nil)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string { return prettyJSON(v) })
		return nil
	},
}

var filesDownloadCmd = &cobra.Command{
	Use:   "download <file-id>",
	Short: "Download a file",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(false)
		if err != nil {
			return err
		}
		dest, size, err := downloadTo(context.Background(), client, "/api/files/"+args[0]+"/content", filesOutput, args[0])
		if err != nil {
			return err
		}
		output.OK(map[string]any{"path": dest, "size_bytes": size}, func(v any) string {
			m := v.(map[string]any)
			return fmt.Sprintf("Downloaded to %s (%v bytes)", m["path"], m["size_bytes"])
		})
		return nil
	},
}

var filesDeleteCmd = &cobra.Command{
	Use:   "delete <file-id>",
	Short: "Delete a file",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(false)
		if err != nil {
			return err
		}
		data, err := client.DoJSON(context.Background(), "DELETE", "/api/files/"+args[0], nil, nil)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string { return "File deleted" })
		return nil
	},
}

var filesStatsCmd = &cobra.Command{
	Use:   "stats <file-id>",
	Short: "Show file download statistics",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(false)
		if err != nil {
			return err
		}
		data, err := client.DoJSON(context.Background(), "GET", "/api/files/"+args[0]+"/stats", nil, nil)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string { return prettyJSON(v) })
		return nil
	},
}

var (
	filesStatus string
	filesLimit  int
	filesOutput string
)

func init() {
	filesListCmd.Flags().StringVar(&filesStatus, "status", "", "filter by status")
	filesListCmd.Flags().IntVar(&filesLimit, "limit", 50, "items per page (maximum 200)")
	filesDownloadCmd.Flags().StringVar(&filesOutput, "output", ".", "destination directory or file path")

	filesCmd.AddCommand(filesListCmd, filesInfoCmd, filesDownloadCmd, filesDeleteCmd, filesStatsCmd)
}

// listText 生成列表文本。
func listText(v any, key string, lineFn func(map[string]any) string) string {
	m, ok := v.(map[string]any)
	if !ok {
		return prettyJSON(v)
	}
	items, _ := m[key].([]any)
	if len(items) == 0 {
		return "No records"
	}
	var out string
	for _, it := range items {
		im, _ := it.(map[string]any)
		if im != nil {
			out += lineFn(im) + "\n"
		}
	}
	return out
}

func prettyJSON(v any) string {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(raw)
}

// resolveDest 决定下载保存路径。output 为目录时使用服务端文件名。
func resolveDest(output string, filename string, fallback string) string {
	if info, err := os.Stat(output); err == nil && info.IsDir() {
		name := filename
		if name == "" || name == "file.bin" {
			name = fallback
		}
		return filepath.Join(output, filepath.Base(name))
	}
	return output
}

// downloadTo 将响应流直接写入同目录临时文件，成功后原子替换目标，失败不留下半文件。
func downloadTo(ctx context.Context, client *api.Client, path, output, fallback string) (string, int64, error) {
	body, filename, _, err := client.DownloadStream(ctx, path)
	if err != nil {
		return "", 0, err
	}
	defer body.Close()
	dest := resolveDest(output, filename, fallback)
	dir := filepath.Dir(dest)
	tmp, err := os.CreateTemp(dir, ".afx-download-*.part")
	if err != nil {
		return "", 0, err
	}
	tmpPath := tmp.Name()
	committed := false
	defer func() {
		_ = tmp.Close()
		if !committed {
			_ = os.Remove(tmpPath)
		}
	}()
	if err := tmp.Chmod(0o644); err != nil {
		return "", 0, err
	}
	n, err := io.Copy(tmp, body)
	if err != nil {
		return "", 0, err
	}
	if err := tmp.Close(); err != nil {
		return "", 0, err
	}
	if err := os.Rename(tmpPath, dest); err != nil {
		return "", 0, err
	}
	committed = true
	return dest, n, nil
}
