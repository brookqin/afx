#!/bin/sh
set -eu

repository="${AFX_REPOSITORY:-brookqin/afx}"
release_base="${AFX_RELEASE_BASE_URL:-https://github.com/${repository}/releases}"
version="${AFX_VERSION:-}"

if [ -z "$version" ]; then
  latest_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "${release_base}/latest")"
  version="${latest_url##*/}"
fi
case "$version" in
  v*) ;;
  *) version="v${version}" ;;
esac
if ! printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$'; then
  printf 'afx installer: invalid release version %s\n' "$version" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) target_os="darwin" ;;
  Linux) target_os="linux" ;;
  *)
    printf 'afx installer: unsupported operating system; install a release archive manually\n' >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) target_arch="amd64" ;;
  arm64 | aarch64) target_arch="arm64" ;;
  *)
    printf 'afx installer: unsupported architecture %s\n' "$(uname -m)" >&2
    exit 1
    ;;
esac

archive="afx_${version#v}_${target_os}_${target_arch}.tar.gz"
download_url="${release_base}/download/${version}"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/afx-install.XXXXXX")"
cleanup() {
  rm -rf "$temp_dir"
}
trap cleanup EXIT HUP INT TERM

curl -fsSL "${download_url}/${archive}" -o "${temp_dir}/${archive}"
curl -fsSL "${download_url}/checksums.txt" -o "${temp_dir}/checksums.txt"

expected="$(awk -v file="$archive" '$2 == file { print $1; exit }' "${temp_dir}/checksums.txt")"
if [ -z "$expected" ]; then
  printf 'afx installer: checksum for %s is missing\n' "$archive" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "${temp_dir}/${archive}" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "${temp_dir}/${archive}" | awk '{ print $1 }')"
else
  printf 'afx installer: sha256sum or shasum is required\n' >&2
  exit 1
fi
if [ "$actual" != "$expected" ]; then
  printf 'afx installer: checksum verification failed for %s\n' "$archive" >&2
  exit 1
fi

tar -xzf "${temp_dir}/${archive}" -C "$temp_dir" afx
if [ ! -f "${temp_dir}/afx" ]; then
  printf 'afx installer: release archive does not contain afx\n' >&2
  exit 1
fi

if [ -n "${AFX_INSTALL_DIR:-}" ]; then
  install_dir="$AFX_INSTALL_DIR"
elif [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
  install_dir="/usr/local/bin"
else
  if [ -z "${HOME:-}" ]; then
    printf 'afx installer: HOME is unavailable; set AFX_INSTALL_DIR\n' >&2
    exit 1
  fi
  install_dir="${HOME}/.local/bin"
fi
case "$install_dir" in
  "" | "/")
    printf 'afx installer: refusing unsafe install directory %s\n' "$install_dir" >&2
    exit 1
    ;;
esac

mkdir -p "$install_dir"
if [ ! -w "$install_dir" ]; then
  printf 'afx installer: %s is not writable; set AFX_INSTALL_DIR to a writable directory\n' "$install_dir" >&2
  exit 1
fi
install -m 0755 "${temp_dir}/afx" "${install_dir}/afx"
"${install_dir}/afx" version >&2
printf '%s\n' "${install_dir}/afx"
