#!/usr/bin/env bash
# =============================================================================
# fetch_toolchain.sh — 下载构建 APK 所需的工具链（无需 Android Studio / Gradle）
#
#   JDK 17 (Temurin)                  → tools/x/jdk/jdk-*
#   Android build-tools r34           → tools/x/bt/android-14
#   Android platform 34 (android.jar) → tools/x/plat/android-34
#
#   用法： bash scripts/fetch_toolchain.sh
#   说明： 约 560MB，只下一次；tools/ 已在 .gitignore 里，不会进仓库。
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

TOOLS="tools/x"
DL="tools/_dl"
mkdir -p "$TOOLS" "$DL"

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1"; exit 1; }

unzip_to() { # unzip_to <zip> <dir>
  local zip="$1" dir="$2"
  mkdir -p "$dir"
  if command -v unzip >/dev/null 2>&1; then
    unzip -q -o "$zip" -d "$dir"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m zipfile -e "$zip" "$dir"
  elif command -v python >/dev/null 2>&1; then
    python -m zipfile -e "$zip" "$dir"
  else
    die "既没有 unzip 也没有 python，无法解压 $zip"
  fi
}

down() { # down <url> <file>
  local url="$1" out="$2"
  if [ -f "$out" ]; then
    echo "  已存在，跳过下载: $out"
    return
  fi
  echo "  下载 $url"
  curl -fL --retry 3 --connect-timeout 15 -o "$out.part" "$url" || die "下载失败：$url"
  mv "$out.part" "$out"
}

# ---------- 1. JDK 17 ----------
if ls -d "$TOOLS"/jdk/jdk-* >/dev/null 2>&1; then
  say "JDK 已就绪，跳过"
else
  say "下载 JDK 17 (Temurin)"
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS-$ARCH" in
    MINGW*|MSYS*|CYGWIN*) JDK_URL="https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse" ;;
    Darwin-arm64)         JDK_URL="https://api.adoptium.net/v3/binary/latest/17/ga/mac/aarch64/jdk/hotspot/normal/eclipse" ;;
    Darwin*)              JDK_URL="https://api.adoptium.net/v3/binary/latest/17/ga/mac/x64/jdk/hotspot/normal/eclipse" ;;
    *)                    JDK_URL="https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse" ;;
  esac
  down "$JDK_URL" "$DL/jdk17.zip"
  unzip_to "$DL/jdk17.zip" "$TOOLS/jdk"
fi

# ---------- 2. Android build-tools 34 ----------
if ls -d "$TOOLS"/bt/android-* >/dev/null 2>&1; then
  say "build-tools 已就绪，跳过"
else
  say "下载 Android build-tools r34"
  down "https://dl.google.com/android/repository/build-tools_r34-windows.zip" "$DL/bt34.zip"
  unzip_to "$DL/bt34.zip" "$TOOLS/bt"
fi

# ---------- 3. Android platform 34 ----------
if ls -d "$TOOLS"/plat/android-* >/dev/null 2>&1; then
  say "platform 已就绪，跳过"
else
  say "下载 Android platform 34"
  down "https://dl.google.com/android/repository/platform-34-ext7_r03.zip" "$DL/plat34.zip"
  unzip_to "$DL/plat34.zip" "$TOOLS/plat"
fi

say "工具链就绪"
echo "  JDK      : $(ls -d "$TOOLS"/jdk/jdk-* | head -1)"
echo "  BuildTool: $(ls -d "$TOOLS"/bt/android-* | head -1)"
echo "  Platform : $(ls -d "$TOOLS"/plat/android-* | head -1)"
echo ""
echo "下一步： bash scripts/build_apk.sh"
