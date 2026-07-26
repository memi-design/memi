#!/usr/bin/env sh
# Mémoire installer — downloads a standalone binary + sidecar assets.
# No Node, no npm, no admin rights required.
#
# Usage:
#   curl -fsSL https://memoire.cv/install.sh | sh
#   curl -fsSL https://memoire.cv/install.sh | sh -s -- --version v1.2.3
#   curl -fsSL https://memoire.cv/install.sh | sh -s -- --dir ~/bin/memoire
#   curl -fsSL https://memoire.cv/install.sh | sh -s -- --no-path    # skip rc edit
#   curl -fsSL https://memoire.cv/install.sh | sh -s -- --no-verify  # skip checksum

set -eu

REPO="sarveshsea/memi"
INSTALL_DIR="${HOME}/.memoire"
VERSION="latest"
PATCH_PATH=1
VERIFY=1

while [ $# -gt 0 ]; do
  case "$1" in
    --version)    VERSION="$2"; shift 2 ;;
    --dir)        INSTALL_DIR="$2"; shift 2 ;;
    --no-path)    PATCH_PATH=0; shift ;;
    --no-verify)  VERIFY=0; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

uname_s=$(uname -s)
uname_m=$(uname -m)

case "${uname_s}-${uname_m}" in
  Darwin-arm64)            target="darwin-arm64" ;;
  Darwin-x86_64)           target="darwin-x64" ;;
  Linux-x86_64)            target="linux-x64" ;;
  Linux-aarch64|Linux-arm64)
    echo "error: linux-arm64 not yet published." >&2
    echo "  Try:  docker run --rm -it ghcr.io/sarveshsea/memi --help" >&2
    exit 1 ;;
  *)
    echo "error: unsupported platform ${uname_s}-${uname_m}" >&2
    echo "  Supported: Darwin-arm64, Darwin-x86_64, Linux-x86_64" >&2
    exit 1 ;;
esac

if [ "${VERSION}" = "latest" ]; then
  base="https://github.com/${REPO}/releases/latest/download"
else
  base="https://github.com/${REPO}/releases/download/${VERSION}"
fi

archive="memi-${target}.tar.gz"
url="${base}/${archive}"
sums_url="${base}/SHA256SUMS.txt"
archive_sums_url="${base}/${archive}.sha256"

tmp=$(mktemp -d)
trap 'rm -rf "${tmp}"' EXIT

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --progress-bar "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget --show-progress -O "$2" "$1"
  else
    echo "error: need curl or wget" >&2
    exit 1
  fi
}

echo "-> Downloading ${archive}"
fetch "${url}" "${tmp}/${archive}"

if [ "${VERIFY}" -eq 1 ]; then
  if command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1; then
    checksum_source=""
    if fetch "${sums_url}" "${tmp}/SHA256SUMS.txt" 2>/dev/null; then
      checksum_source="SHA256SUMS.txt"
    elif fetch "${archive_sums_url}" "${tmp}/SHA256SUMS.txt" 2>/dev/null; then
      checksum_source="${archive}.sha256"
    fi

    if [ -n "${checksum_source}" ]; then
      if command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum "${tmp}/${archive}" | awk '{print $1}')
      else
        actual=$(shasum -a 256 "${tmp}/${archive}" | awk '{print $1}')
      fi
      expected=$(grep "${archive}$" "${tmp}/SHA256SUMS.txt" | awk '{print $1}' | head -n1)
      if [ -z "${expected}" ]; then
        echo "error: no checksum found for ${archive} in ${checksum_source}" >&2
        echo "  Re-run with --no-verify only if you trust the release source." >&2
        exit 1
      elif [ "${actual}" != "${expected}" ]; then
        echo "error: sha256 mismatch" >&2
        echo "  expected: ${expected}" >&2
        echo "  actual:   ${actual}" >&2
        exit 1
      else
        echo "✓ sha256 verified (${checksum_source})"
      fi
    else
      echo "error: checksum metadata unavailable" >&2
      echo "  Tried: ${sums_url}" >&2
      echo "         ${archive_sums_url}" >&2
      echo "  Re-run with --no-verify only if you trust the release source." >&2
      exit 1
    fi
  fi
fi

echo "-> Extracting to ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
archive_root="memi-${target}"
entries_file="${tmp}/archive.entries"
tar -tzf "${tmp}/${archive}" > "${entries_file}"
if [ ! -s "${entries_file}" ]; then
  echo "error: unsafe archive entry: archive is empty" >&2
  exit 1
fi
if ! awk -v root="${archive_root}" '
  BEGIN { bad = 0 }
  {
    entry = $0
    trimmed = entry
    sub(/\/+$/, "", trimmed)
    if (entry ~ /^\// || entry ~ /\\/ || entry ~ /(^|\/)\.\.(\/|$)/) {
      print "error: unsafe archive entry: " entry > "/dev/stderr"
      bad = 1
    } else if (trimmed != root && index(trimmed, root "/") != 1) {
      print "error: unexpected archive root: " entry > "/dev/stderr"
      bad = 1
    }
  }
  END { exit bad }
' "${entries_file}"; then
  exit 1
fi
if tar -tvzf "${tmp}/${archive}" | awk 'substr($1, 1, 1) ~ /[lh]/ { found = 1 } END { exit !found }'; then
  echo "error: unsafe archive entry: links are not allowed" >&2
  exit 1
fi
tar -xzf "${tmp}/${archive}" -C "${tmp}"
rm -rf "${INSTALL_DIR}/app"
mv "${tmp}/memi-${target}" "${INSTALL_DIR}/app"

mkdir -p "${INSTALL_DIR}/bin"
ln -sf "${INSTALL_DIR}/app/memi" "${INSTALL_DIR}/bin/memi"
chmod +x "${INSTALL_DIR}/app/memi"

# Detect shell rc and patch PATH idempotently
PATH_LINE="export PATH=\"${INSTALL_DIR}/bin:\$PATH\""
MARKER="# added by memoire installer"

patch_rc() {
  rc="$1"
  [ -f "${rc}" ] || touch "${rc}"
  if ! grep -qs "${MARKER}" "${rc}"; then
    {
      printf '\n%s\n' "${MARKER}"
      printf '%s\n' "${PATH_LINE}"
    } >> "${rc}"
    echo "✓ patched ${rc}"
  fi
}

if [ "${PATCH_PATH}" -eq 1 ]; then
  current_shell=$(basename "${SHELL:-}")
  case "${current_shell}" in
    zsh)  patch_rc "${HOME}/.zshrc" ;;
    bash) patch_rc "${HOME}/.bashrc"; [ -f "${HOME}/.bash_profile" ] && patch_rc "${HOME}/.bash_profile" || true ;;
    fish)
      mkdir -p "${HOME}/.config/fish/conf.d"
      fish_rc="${HOME}/.config/fish/conf.d/memoire.fish"
      if [ ! -f "${fish_rc}" ]; then
        printf '%s\nset -gx PATH %s/bin $PATH\n' "${MARKER}" "${INSTALL_DIR}" > "${fish_rc}"
        echo "✓ wrote ${fish_rc}"
      fi ;;
    *) patch_rc "${HOME}/.profile" ;;
  esac
fi

echo ""
echo "✓ Installed memi ${VERSION} to ${INSTALL_DIR}/bin/memi"
echo ""
if [ "${PATCH_PATH}" -eq 1 ]; then
  echo "  Open a new terminal, or run:"
  echo "      ${PATH_LINE}"
  echo ""
  echo "  Then:  memi connect"
else
  echo "  Add to your shell profile:"
  echo "      ${PATH_LINE}"
fi
