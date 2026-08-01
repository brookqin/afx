// Package output 统一 CLI 输出与退出码(§30.3 / §30.4)。
package output

import (
	"encoding/json"
	"fmt"
	"os"

	"afx/internal/api"
)

// 退出码(§30.4)
const (
	ExitOK       = 0
	ExitGeneral  = 1
	ExitArgs     = 2
	ExitAuth     = 3
	ExitPerm     = 4
	ExitNotFound = 5
	ExitGone     = 6
	ExitNetwork  = 7
	ExitServer   = 8
	ExitTimeout  = 9
)

// JSONOut 控制是否输出 JSON。非 JSON 模式下正常日志写 stderr,进度不写 stdout。
var JSONOut bool

func SetJSON(v bool) { JSONOut = v }

// OK 输出成功(JSON 模式:{ok:true,data} / 文本模式:打印摘要)。
func OK(data any, textFn func(any) string) {
	if JSONOut {
		raw, err := json.Marshal(map[string]any{"ok": true, "data": data})
		if err != nil {
			fmt.Fprintln(os.Stderr, "output error:", err)
			os.Exit(ExitGeneral)
		}
		fmt.Println(string(raw))
		return
	}
	if textFn != nil {
		fmt.Fprintln(os.Stdout, textFn(data))
	}
}

// Fail 输出失败并退出。根据错误类型映射退出码(§30.4)。
func Fail(err error) {
	if JSONOut {
		info := errorInfo(err)
		raw, marshalErr := json.Marshal(map[string]any{
			"ok":         false,
			"error":      info,
			"request_id": info["request_id"],
		})
		if marshalErr != nil {
			raw = []byte(fmt.Sprintf(`{"ok":false,"error":{"code":"internal_error","message":"%s"}}`, marshalErr))
		}
		fmt.Fprintln(os.Stdout, string(raw))
	} else {
		fmt.Fprintln(os.Stderr, "afx:", err)
	}
	os.Exit(exitCode(err))
}

// Log 非 JSON 模式下的信息日志(stderr)。
func Log(format string, args ...any) {
	if JSONOut {
		return
	}
	fmt.Fprintf(os.Stderr, format+"\n", args...)
}

func errorInfo(err error) map[string]any {
	info := map[string]any{}
	switch e := err.(type) {
	case *api.APIError:
		info["code"] = e.Info.Code
		info["message"] = e.Info.Message
		if len(e.Info.Details) > 0 {
			info["details"] = e.Info.Details
		}
		if e.Info.RequestID != "" {
			info["request_id"] = e.Info.RequestID
		}
	case *api.NetworkError:
		info["code"] = "network_error"
		info["message"] = e.Error()
	case *api.TimeoutError:
		info["code"] = "timeout"
		info["message"] = e.Error()
	case *api.ServerError:
		info["code"] = "server_error"
		info["message"] = e.Error()
	default:
		info["code"] = "cli_error"
		info["message"] = err.Error()
	}
	return info
}

// ExitCodeFor 根据错误类型映射退出码(§30.4)。供测试与 Fail 使用。
func ExitCodeFor(err error) int {
	switch e := err.(type) {
	case *api.APIError:
		switch e.Info.Code {
		case "invalid_api_key":
			return ExitAuth
		case "root_privilege_required", "scope_denied", "api_key_disabled", "api_key_revoked":
			return ExitPerm
		case "file_not_found", "inbox_not_found", "file_storage_missing":
			return ExitNotFound
		case "file_expired", "file_consumed", "file_deleted", "download_limit_reached",
			"inbox_expired", "inbox_revoked", "inbox_already_used":
			return ExitGone
		case "file_not_ready", "inbox_upload_in_progress", "inbox_lease_lost":
			return ExitGeneral
		default:
			return ExitGeneral
		}
	case *api.TimeoutError:
		return ExitTimeout
	case *api.NetworkError:
		return ExitNetwork
	case *api.ServerError:
		return ExitServer
	default:
		return ExitGeneral
	}
}

func exitCode(err error) int {
	return ExitCodeFor(err)
}
