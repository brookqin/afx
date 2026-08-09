package cmd

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/spf13/cobra"

	"afx/internal/output"
)

var uploadCmd = &cobra.Command{
	Use:   "upload <path>",
	Short: "Upload a file and create a temporary public download URL",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		client, err := resolveConfig(false)
		if err != nil {
			return err
		}
		if uploadBurn && uploadDownloads > 1 {
			return fmt.Errorf("--burn conflicts with --downloads>1: burn-after-read requires max_downloads=1")
		}
		query := url.Values{}
		if uploadExpires != "" {
			d, err := time.ParseDuration(uploadExpires)
			if err != nil {
				return fmt.Errorf("invalid --expires: %w", err)
			}
			query.Set("expires_in", fmt.Sprintf("%d", int64(d.Seconds())))
		}
		if uploadDownloads > 0 {
			query.Set("max_downloads", fmt.Sprintf("%d", uploadDownloads))
		}
		if uploadBurn {
			query.Set("burn_after_read", "true")
		}
		if uploadDescription != "" {
			query.Set("description", uploadDescription)
		}

		data, err := client.UploadFile(context.Background(), args[0], query)
		if err != nil {
			return err
		}
		output.OK(data, func(v any) string {
			m := v.(map[string]any)
			return fmt.Sprintf("File uploaded:\n  ID:           %v\n  Download URL: %v\n  Size:         %v bytes\n  Expires at:   %v",
				m["id"], m["url"], m["size_bytes"], m["expires_at"])
		})
		return nil
	},
}

var (
	uploadExpires     string
	uploadDownloads   int
	uploadBurn        bool
	uploadDescription string
)

func init() {
	uploadCmd.Flags().StringVar(&uploadExpires, "expires", "", "lifetime, for example 24h or 1h30m")
	uploadCmd.Flags().IntVar(&uploadDownloads, "downloads", 0, "maximum downloads (0 means unlimited)")
	uploadCmd.Flags().BoolVar(&uploadBurn, "burn", false, "burn after reading (forces max_downloads=1)")
	uploadCmd.Flags().StringVar(&uploadDescription, "description", "", "file description (maximum 2000 characters)")
}
