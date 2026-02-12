#!/usr/bin/env bash
set -euo pipefail

arch="${1:-}"
if [[ "$arch" != "x64" && "$arch" != "arm64" ]]; then
  echo "usage: $0 <x64|arm64>" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$arch" == "x64" ]]; then
  output_dir="$repo_root/dist/mac-x64"
  expected_arch="x86_64"
else
  output_dir="$repo_root/dist/mac-arm64"
  expected_arch="arm64"
fi
expected_channel_file="$output_dir/mac-$arch-mac.yml"

if [[ ! -d "$output_dir" ]]; then
  echo "missing dist output directory: $output_dir" >&2
  exit 1
fi

cli_path="$(find "$output_dir" -type f -path "*/Contents/Resources/arduino-cli" | head -n 1)"
if [[ -z "$cli_path" ]]; then
  echo "could not find bundled arduino-cli in $output_dir" >&2
  exit 1
fi

file_output="$(file "$cli_path")"
echo "$file_output"

if [[ "$file_output" != *"$expected_arch"* ]]; then
  echo "unexpected bundled arduino-cli architecture for $arch build" >&2
  exit 1
fi

app_exec_path="$(find "$output_dir" -type f -path "*/Contents/MacOS/*" ! -path "*/Frameworks/*" | head -n 1)"
if [[ -z "$app_exec_path" ]]; then
  echo "could not find packaged app executable in $output_dir" >&2
  exit 1
fi
app_file_output="$(file "$app_exec_path")"
echo "$app_file_output"
if [[ "$app_file_output" != *"$expected_arch"* ]]; then
  echo "unexpected app executable architecture for $arch build" >&2
  exit 1
fi

if [[ ! -f "$expected_channel_file" ]]; then
  echo "missing arch channel update metadata: $expected_channel_file" >&2
  exit 1
fi

update_zip_name="$(sed -n 's/^path: //p' "$expected_channel_file" | head -n 1)"
if [[ -z "$update_zip_name" ]]; then
  echo "missing path field in $expected_channel_file" >&2
  exit 1
fi
if [[ ! -f "$output_dir/$update_zip_name" ]]; then
  echo "metadata path does not match an existing zip: $output_dir/$update_zip_name" >&2
  exit 1
fi

echo "ok: $arch dist uses $expected_arch arduino-cli"
echo "ok: found update metadata $expected_channel_file"
echo "ok: metadata path points to existing zip $update_zip_name"
