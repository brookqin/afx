package cmd

import (
	"fmt"

	"github.com/spf13/cobra"

	"afx/internal/buildinfo"
	"afx/internal/output"
)

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Show CLI version information",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		info := buildinfo.Current()
		output.OK(info, func(value any) string {
			v := value.(buildinfo.Info)
			return fmt.Sprintf("afx %s\ncommit: %s\nbuilt: %s", v.Version, v.Commit, v.BuiltAt)
		})
		return nil
	},
}
