// Package buildinfo exposes CLI build metadata injected with Go linker flags.
package buildinfo

var (
	Version = "dev"
	Commit  = "unknown"
	Date    = "unknown"
)

// Info is the stable machine-readable version payload.
type Info struct {
	Version string `json:"version"`
	Commit  string `json:"commit"`
	BuiltAt string `json:"built_at"`
}

func Current() Info {
	return Info{Version: Version, Commit: Commit, BuiltAt: Date}
}
