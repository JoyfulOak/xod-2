#!/usr/bin/env bash
set -euo pipefail

arch="${1:-}"
if [[ "$arch" != "x64" ]]; then
  echo "usage: $0 <x64>" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
project_dir="$repo_root/packages/xod-client-electron"
output_dir="$repo_root/dist/windows-x64"
source_cli="$repo_root/arduino-cli-binaries/windows-x64/arduino-cli.exe"
target_cli="$project_dir/arduino-cli.exe"

if [[ ! -f "$source_cli" ]]; then
  echo "missing arduino-cli binary: $source_cli" >&2
  exit 1
fi

cp "$source_cli" "$target_cli"

mkdir -p "$output_dir"

"$repo_root/node_modules/.bin/electron-builder" \
  --projectDir "$project_dir" \
  --publish never \
  --config.win.artifactName='${productName}-${version}-windows-${arch}.${ext}' \
  --win \
  --x64 \
  --config.directories.output="$output_dir"

# Ensure latest.yml references the actual installer filename present in dist.
latest_yml="$output_dir/latest.yml"
if [[ -f "$latest_yml" ]]; then
  expected_exe_name="$(sed -n 's/^path: //p' "$latest_yml" | head -n 1)"
  if [[ -n "$expected_exe_name" ]]; then
    expected_exe_path="$output_dir/$expected_exe_name"
    if [[ ! -f "$expected_exe_path" ]]; then
      built_exe_path="$(find "$output_dir" -maxdepth 1 -type f -name '*.exe' | head -n 1)"
      if [[ -n "$built_exe_path" && -f "$built_exe_path" ]]; then
        mv "$built_exe_path" "$expected_exe_path"
        echo "renamed windows installer: $built_exe_path -> $expected_exe_path"

        if [[ -f "$built_exe_path.blockmap" ]]; then
          mv "$built_exe_path.blockmap" "$expected_exe_path.blockmap"
          echo "renamed windows blockmap: $built_exe_path.blockmap -> $expected_exe_path.blockmap"
        fi
      fi
    fi
  fi
fi
