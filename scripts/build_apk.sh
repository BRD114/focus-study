#!/usr/bin/env bash
# =============================================================================
# build_apk.sh — 一键构建可安装 APK（无需 Android Studio / Gradle）
#
#   链路：aapt2 编译资源 → aapt2 链接生成未签名包 → javac 编译 Java
#         → d8 转 dex → 打包 → zipalign 对齐 → apksigner 签名 → 校验
#
#   用法： bash scripts/build_apk.sh
#   产物： dist/Focus-1.0.5.apk
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
# Windows 上把 /c/... 转成 C:/... ，方便直接喂给原生的 aapt2 / zipalign
if command -v cygpath >/dev/null 2>&1; then ROOT="$(cygpath -m "$HERE")"; else ROOT="$HERE"; fi
cd "$HERE"

TOOLS="$ROOT/tools/x"
JDK="$(ls -d "$TOOLS"/jdk/jdk-* 2>/dev/null | head -1 || true)"
BT="$(ls -d "$TOOLS"/bt/android-* 2>/dev/null | head -1 || true)"
PLATFORM="$(ls -d "$TOOLS"/plat/android-* 2>/dev/null | head -1 || true)"
ANDROID_JAR="$PLATFORM/android.jar"

APP="android/app/src/main"
BUILD="$ROOT/build"
DIST="$ROOT/dist"
VERSION_NAME="1.0.5"
VERSION_CODE="6"

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$1"; exit 1; }

[ -n "$JDK" ] && [ -d "$JDK" ] || die "找不到 JDK，请先解压到 tools/x/jdk"
[ -n "$BT" ] && [ -d "$BT" ] || die "找不到 build-tools，请先解压到 tools/x/bt"
[ -f "$ANDROID_JAR" ] || die "找不到 android.jar：$ANDROID_JAR"

JAVA="$JDK/bin/java.exe"; [ -f "$JAVA" ] || JAVA="$JDK/bin/java"
JAVAC="$JDK/bin/javac.exe"; [ -f "$JAVAC" ] || JAVAC="$JDK/bin/javac"
JAR="$JDK/bin/jar.exe"; [ -f "$JAR" ] || JAR="$JDK/bin/jar"
KEYTOOL="$JDK/bin/keytool.exe"; [ -f "$KEYTOOL" ] || KEYTOOL="$JDK/bin/keytool"

AAPT2="$BT/aapt2.exe"; [ -f "$AAPT2" ] || AAPT2="$BT/aapt2"
ZIPALIGN="$BT/zipalign.exe"; [ -f "$ZIPALIGN" ] || ZIPALIGN="$BT/zipalign"

say "环境检查通过"
echo "  JDK      : $JDK"
echo "  BuildTool: $BT"
echo "  Platform : $PLATFORM"

# ---------- 0. 清理 ----------
rm -rf "$BUILD"
mkdir -p "$BUILD/gen" "$BUILD/classes" "$BUILD/dex" "$DIST"

# ---------- 1. 前端资源 → assets ----------
say "复制前端资源到 assets"
rm -rf "$APP/assets/www"
mkdir -p "$APP/assets"
cp -r "$ROOT/www" "$APP/assets/www"
echo "  文件数: $(find "$APP/assets/www" -type f | wc -l | tr -d ' ')"

# ---------- 2. 编译资源 ----------
say "aapt2 compile 资源"
"$AAPT2" compile --dir "$APP/res" -o "$BUILD/res.zip"

# ---------- 3. 链接资源（生成未签名 APK + R.java）----------
say "aapt2 link 生成资源包"
"$AAPT2" link \
  -o "$BUILD/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  -R "$BUILD/res.zip" \
  --java "$BUILD/gen" \
  -A "$APP/assets" \
  --min-sdk-version 26 \
  --target-sdk-version 34 \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  --auto-add-overlay

# ---------- 4. 编译 Java ----------
say "javac 编译 Java 源码"
find "$BUILD/gen" "$APP/java" -name '*.java' > "$BUILD/sources.txt"
cat "$BUILD/sources.txt" | sed 's/^/  /'
"$JAVAC" -encoding UTF-8 -source 11 -target 11 -nowarn \
  -classpath "$ANDROID_JAR" \
  -d "$BUILD/classes" \
  "@$BUILD/sources.txt"

# ---------- 5. D8 转 dex ----------
say "d8 生成 classes.dex"
# D8 只接受 .class / .jar 文件，这里显式列出（类数量很少）
CLASSES=$(find "$BUILD/classes" -name '*.class' | tr '\n' ' ')
echo "  输入: $(echo "$CLASSES" | wc -w | tr -d ' ') 个 class"
# shellcheck disable=SC2086
"$JAVA" -Xmx1g -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
  --release \
  --min-api 26 \
  --lib "$ANDROID_JAR" \
  --output "$BUILD/dex" \
  $CLASSES

# ---------- 6. 打包进 APK ----------
say "把 dex 打进 APK"
"$JAR" uf "$BUILD/base.apk" -C "$BUILD/dex" classes.dex

# ---------- 6.5 修正 zip 条目路径（关键！）----------
# aapt2 在 Windows 上会把 assets 写成 assets/www\js\app.js（反斜杠），
# 而 Android 的资源查找只认正斜杠 —— 这会导致 WebView 打不开页面（ERR_FILE_NOT_FOUND）。
say "修正 assets 条目分隔符"
python "$ROOT/scripts/repack_assets.py" "$BUILD/base.apk" "$BUILD/repacked.apk"

say "校验条目路径（原始字节，不用 zipfile.namelist，它会归一化）"
python - "$BUILD/base.apk" <<'PYEOF'
import sys
bs = chr(92)
data = open(sys.argv[1], 'rb').read()
bad = data.count(b'assets/www' + bs.encode())
good = data.count(b'assets/www/')
print('  正斜杠条目: %d 处   反斜杠条目: %d 处' % (good, bad))
if bad > 0 or good == 0:
    print('  ✗ 条目路径仍然不正确，构建终止')
    sys.exit(1)
PYEOF

# ---------- 7. 对齐 ----------
say "zipalign 4 字节对齐"
"$ZIPALIGN" -f -p 4 "$BUILD/base.apk" "$BUILD/aligned.apk"

# ---------- 8. 签名（调试签名，可直接安装）----------
say "签名 APK"
mkdir -p "$ROOT/keystore"
if [ ! -f "$ROOT/keystore/focus.keystore" ]; then
  echo "  生成签名证书（仅首次）"
  "$KEYTOOL" -genkeypair -v \
    -keystore "$ROOT/keystore/focus.keystore" \
    -storetype JKS \
    -alias focus \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass focus2026 -keypass focus2026 \
    -dname "CN=Focus Study, OU=Mobile, O=Focus, L=Hangzhou, ST=Zhejiang, C=CN" >/dev/null 2>&1
fi

OUT="$DIST/Focus-$VERSION_NAME.apk"
"$JAVA" -jar "$BT/lib/apksigner.jar" sign \
  --ks "$ROOT/keystore/focus.keystore" \
  --ks-key-alias focus \
  --ks-pass pass:focus2026 \
  --key-pass pass:focus2026 \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --out "$OUT" \
  "$BUILD/aligned.apk"

# ---------- 9. 校验 ----------
say "校验签名"
"$JAVA" -jar "$BT/lib/apksigner.jar" verify --print-certs "$OUT"

SIZE=$(du -k "$OUT" | cut -f1)
say "构建完成"
echo "  产物: $OUT"
echo "  大小: ${SIZE} KB"
