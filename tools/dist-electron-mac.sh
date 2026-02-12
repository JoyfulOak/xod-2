#!/usr/bin/env bash
set -euo pipefail

arch="${1:-}"
if [[ "$arch" != "x64" && "$arch" != "arm64" ]]; then
  echo "usage: $0 <x64|arm64>" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
project_dir="$repo_root/packages/xod-client-electron"
version="$(node -p "require('$project_dir/package.json').version")"

if [[ "$arch" == "x64" ]]; then
  archive="$repo_root/arduino-cli-binaries/mac-x64/arduino-cli_1.4.1_macOS_64bit.tar"
  output_dir="$repo_root/dist/mac-x64"
  expected_arch="x86_64"
else
  archive="$repo_root/arduino-cli-binaries/mac-arm64/arduino-cli_1.4.1_macOS_ARM64.tar"
  output_dir="$repo_root/dist/mac-arm64"
  expected_arch="arm64"
fi
channel="mac-$arch"

if [[ ! -f "$archive" ]]; then
  echo "missing arduino-cli archive: $archive" >&2
  exit 1
fi

tmpdir="$(mktemp -d /tmp/xod-electron-dist-XXXXXX)"
trap 'rm -rf "$tmpdir"' EXIT

tar -xf "$archive" -C "$tmpdir" arduino-cli
cp "$tmpdir/arduino-cli" "$project_dir/arduino-cli"
chmod 755 "$project_dir/arduino-cli"

echo "prepared bundled arduino-cli for $arch:"
file "$project_dir/arduino-cli"

mkdir -p "$output_dir"

"$repo_root/node_modules/.bin/electron-builder" \
  --projectDir "$project_dir" \
  --publish never \
  --config.publish.channel="$channel" \
  --config.mac.target=zip \
  --mac \
  --"$arch" \
  --config.directories.output="$output_dir"

# Ensure channel metadata file exists for electron-updater lookups.
# electron-updater expects "<channel>-mac.yml" on macOS.
if [[ -f "$output_dir/latest-mac.yml" && ! -f "$output_dir/$channel-mac.yml" ]]; then
  cp "$output_dir/latest-mac.yml" "$output_dir/$channel-mac.yml"
  echo "created channel metadata: $output_dir/$channel-mac.yml"
fi

if [[ -d "$output_dir/mac" ]]; then
  rm -rf "$output_dir/mac-$arch"
  mv "$output_dir/mac" "$output_dir/mac-$arch"
  echo "renamed app folder: $output_dir/mac -> $output_dir/mac-$arch"
fi

# Normalize archive naming to explicit architecture suffixes.
for zip_path in "$output_dir"/*.zip; do
  [[ -e "$zip_path" ]] || continue
  zip_name="$(basename "$zip_path")"
  if [[ "$zip_name" != *"-$version-"* ]]; then
    continue
  fi
  base_without_suffix="${zip_name%.zip}"
  base_without_suffix="${base_without_suffix%-mac}"
  base_without_suffix="${base_without_suffix%-mac-arm64}"
  base_without_suffix="${base_without_suffix%-mac-x64}"

  # Normalize file name to a safe, deterministic upload name.
  # Replace spaces with dashes and collapse duplicate separators.
  # Keep dots in version components (e.g., 2026.2.10).
  normalized_base="$(printf '%s' "$base_without_suffix" | sed -E 's/[[:space:]]+/-/g; s/-+/-/g; s/^-//; s/-$//')"
  final_zip_name="${normalized_base}-mac-$arch.zip"
  renamed_zip="$output_dir/$final_zip_name"

  if [[ "$zip_path" != "$renamed_zip" ]]; then
    if [[ -f "$renamed_zip" ]]; then
      rm -f "$zip_path"
      echo "removed duplicate zip: $zip_path (kept $renamed_zip)"
    else
      mv "$zip_path" "$renamed_zip"
      echo "renamed zip: $zip_path -> $renamed_zip"
    fi
  fi

  # Keep arch-channel metadata in sync with renamed archive file.
  channel_yml="$output_dir/$channel-mac.yml"
  if [[ -f "$channel_yml" ]]; then
    zip_basename="$final_zip_name"
    escaped_zip_basename="$(printf '%s\n' "$zip_basename" | sed -e 's/[&]/\\&/g')"
    sed -i '' -E \
      -e "s#^(  - url: ).*\$#\\1$escaped_zip_basename#" \
      -e "s#^(path: ).*\$#\\1$escaped_zip_basename#" \
      "$channel_yml"
    echo "updated channel metadata archive name in: $channel_yml"
  fi

  original_blockmap="$zip_path.blockmap"
  renamed_blockmap="$renamed_zip.blockmap"
  if [[ -f "$original_blockmap" ]]; then
    if [[ "$original_blockmap" != "$renamed_blockmap" ]]; then
      if [[ -f "$renamed_blockmap" ]]; then
        rm -f "$original_blockmap"
        echo "removed duplicate blockmap: $original_blockmap (kept $renamed_blockmap)"
      else
        mv "$original_blockmap" "$renamed_blockmap"
        echo "renamed blockmap: $original_blockmap -> $renamed_blockmap"
      fi
    fi
  fi
done

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
