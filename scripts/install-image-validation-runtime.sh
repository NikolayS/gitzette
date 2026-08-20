#!/usr/bin/env bash
if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "install-image-validation-runtime.sh must be executed by path, not sourced or piped to Bash" >&2
  if [[ -n "${BASH_SOURCE[0]:-}" ]]; then return 1; fi
  exit 1
fi
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-false}" == true ]] && {
  [[ -n "${APT_ROOT+x}" ]] || [[ -n "${APT_SKIP_INSTALL+x}" ]]
}; then
  echo "apt runtime test hooks are forbidden in GitHub Actions" >&2
  exit 1
fi

apt_root="${APT_ROOT:-/etc/apt}"
apt_source_list="$(mktemp)"
apt_source_copy="$(mktemp)"
trap 'rm -f "$apt_source_list" "$apt_source_copy"' EXIT
sudo find "$apt_root" -type f \( -name 'apt-mirrors.txt' -o -name 'sources.list' -o -name '*.sources' -o -name '*.list' \) -print0 |
  tee "$apt_source_list" >/dev/null
mapfile -d '' -t apt_sources <"$apt_source_list"
if [[ "${#apt_sources[@]}" -eq 0 ]]; then
  echo "no apt source files found" >&2
  exit 1
fi
for apt_source in "${apt_sources[@]}"; do
  sudo sed -Ei 's#https?://([a-z0-9.-]*\.)?azure\.archive\.ubuntu\.com/ubuntu#https://archive.ubuntu.com/ubuntu#g' "$apt_source"
  sudo cp -- "$apt_source" "$apt_source_copy"
  if grep -Eq 'https?://([a-z0-9.-]*\.)?azure\.archive\.ubuntu\.com/ubuntu' "$apt_source_copy"; then
    echo "Azure Ubuntu mirror rewrite did not take effect in $apt_source" >&2
    exit 1
  else
    grep_status=$?
    if [[ "$grep_status" -ne 1 ]]; then
      echo "Azure Ubuntu mirror verification could not read $apt_source" >&2
      exit "$grep_status"
    fi
  fi
done

if [[ "${APT_SKIP_INSTALL:-false}" != true ]]; then
  sudo apt-get update
  sudo apt-get install -y \
    imagemagick=8:6.9.12.98+dfsg1-5.2build2 \
    imagemagick-6.q16=8:6.9.12.98+dfsg1-5.2build2
  sudo install -o root -g root -m 0644 runner/imagemagick/policy.xml /etc/ImageMagick-6/policy.xml
fi
