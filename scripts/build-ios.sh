#!/bin/sh
set -eu

project_root="$(CDPATH= cd "$(dirname "$0")/.." && pwd)"
ios_root="$project_root/ios"
project_path="$ios_root/AWRoadside.xcodeproj"
scheme="AWRoadside"
build_root="${IOS_BUILD_ROOT:-$ios_root/build}"
archive_path="${IOS_ARCHIVE_PATH:-$build_root/AWRoadside.xcarchive}"

icloud_root="${HOME}/Library/Mobile Documents/com~apple~CloudDocs"
default_export_path="$build_root/export"
if [ -d "$icloud_root" ]; then
  default_export_path="$icloud_root/AWRoadside/AppStore"
fi
export_path="${IOS_EXPORT_PATH:-$default_export_path}"

if [ ! -d "$project_path" ]; then
  echo "[ios] Missing Xcode project at $project_path" >&2
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "[ios] xcodebuild is not available. Install Xcode and run xcode-select --switch /Applications/Xcode.app" >&2
  exit 1
fi

developer_dir="${DEVELOPER_DIR:-$(xcode-select -p 2>/dev/null || true)}"
if [ -z "$developer_dir" ] || [ ! -d "$developer_dir/Platforms/iPhoneOS.platform" ]; then
  if [ -d "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform" ]; then
    export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
  else
    echo "[ios] Full Xcode with the iOS SDK is required for App Store archives." >&2
    echo "[ios] Current developer directory: ${developer_dir:-not configured}" >&2
    echo "[ios] Install Xcode, then either run:" >&2
    echo "[ios]   sudo xcode-select --switch /Applications/Xcode.app" >&2
    echo "[ios] or invoke this script with:" >&2
    echo "[ios]   DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer APPLE_TEAM_ID=<team-id> scripts/build-ios.sh" >&2
    exit 1
  fi
fi

if [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "[ios] APPLE_TEAM_ID is required to export an App Store upload bundle." >&2
  echo "[ios] Example: APPLE_TEAM_ID=ABCDE12345 scripts/build-ios.sh" >&2
  exit 1
fi

rm -rf "$archive_path" "$export_path"
mkdir -p "$export_path"

team_arg="DEVELOPMENT_TEAM=${APPLE_TEAM_ID}"

xcodebuild \
  -project "$project_path" \
  -scheme "$scheme" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$archive_path" \
  archive \
  CODE_SIGN_STYLE=Automatic \
  $team_arg

export_options="$export_path/ExportOptions.plist"
cat > "$export_options" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>teamID</key>
  <string>${APPLE_TEAM_ID}</string>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
PLIST

xcodebuild \
  -exportArchive \
  -archivePath "$archive_path" \
  -exportPath "$export_path" \
  -exportOptionsPlist "$export_options" \
  $team_arg

echo "[ios] Archive ready at $archive_path"
echo "[ios] App Store upload bundle ready at $export_path"
