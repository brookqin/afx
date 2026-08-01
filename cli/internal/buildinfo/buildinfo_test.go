package buildinfo

import "testing"

func TestCurrent(t *testing.T) {
	originalVersion, originalCommit, originalDate := Version, Commit, Date
	t.Cleanup(func() { Version, Commit, Date = originalVersion, originalCommit, originalDate })
	Version, Commit, Date = "v1.2.3", "abc123", "2026-08-01T00:00:00Z"

	got := Current()
	if got.Version != Version || got.Commit != Commit || got.BuiltAt != Date {
		t.Fatalf("Current() = %#v", got)
	}
}
