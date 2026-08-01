// Package output 测试:退出码映射与 JSON 输出(§36.3)。
package output

import (
	"testing"

	"afx/internal/api"
)

func TestExitCodeFor(t *testing.T) {
	cases := []struct {
		err  error
		want int
	}{
		{&api.APIError{Info: api.ErrorInfo{Code: "invalid_api_key"}}, ExitAuth},
		{&api.APIError{Info: api.ErrorInfo{Code: "scope_denied"}}, ExitPerm},
		{&api.APIError{Info: api.ErrorInfo{Code: "api_key_disabled"}}, ExitPerm},
		{&api.APIError{Info: api.ErrorInfo{Code: "file_not_found"}}, ExitNotFound},
		{&api.APIError{Info: api.ErrorInfo{Code: "inbox_not_found"}}, ExitNotFound},
		{&api.APIError{Info: api.ErrorInfo{Code: "file_expired"}}, ExitGone},
		{&api.APIError{Info: api.ErrorInfo{Code: "file_consumed"}}, ExitGone},
		{&api.APIError{Info: api.ErrorInfo{Code: "inbox_already_used"}}, ExitGone},
		{&api.APIError{Info: api.ErrorInfo{Code: "inbox_upload_in_progress"}}, ExitGeneral},
		{&api.NetworkError{}, ExitNetwork},
		{&api.TimeoutError{}, ExitTimeout},
		{&api.ServerError{}, ExitServer},
		{&errGeneric{}, ExitGeneral},
	}
	for _, c := range cases {
		if got := ExitCodeFor(c.err); got != c.want {
			t.Errorf("ExitCodeFor(%v) = %d, want %d", c.err, got, c.want)
		}
	}
}

type errGeneric struct{}

func (e *errGeneric) Error() string { return "generic" }

func TestAPIErrorString(t *testing.T) {
	e := &api.APIError{Info: api.ErrorInfo{Code: "file_expired", Message: "The file has expired.", RequestID: "R1"}}
	s := e.Error()
	if s != "file_expired: The file has expired. (request_id=R1)" {
		t.Errorf("error string = %q", s)
	}
}
