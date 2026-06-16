#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <ios-srcroot> <resources-root>" >&2
  exit 1
fi

srcroot="$1"
resources_root="$2"
variant_root="$srcroot/../AW_Roadside"
target_root="$resources_root/www"

if [ ! -d "$variant_root" ]; then
  echo "[ios] Missing AW_Roadside variant at $variant_root" >&2
  exit 1
fi

rm -rf "$target_root"
mkdir -p "$target_root"
rsync -a --delete --exclude '.DS_Store' "$variant_root/" "$target_root/"

if [ ! -f "$target_root/home.html" ]; then
  echo "[ios] Missing home.html after sync" >&2
  exit 1
fi

echo "[ios] Synced AW_Roadside assets to $target_root"
