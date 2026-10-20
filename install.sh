#!/usr/bin/env sh
# 超級跳跳 3D 安裝腳本（macOS / Linux）
# 用法：curl -fsSL https://raw.githubusercontent.com/n753951f/easygame/main/install.sh | sh
# 有 XAMPP 就裝到其 htdocs/easygame，否則裝到目前資料夾下的 easygame
set -eu

REPO_TGZ="https://github.com/n753951f/easygame/archive/refs/heads/main.tar.gz"

if [ -n "${EASYGAME_DIR:-}" ]; then
  TARGET="$EASYGAME_DIR"
elif [ -d /Applications/XAMPP/htdocs ]; then
  TARGET="/Applications/XAMPP/htdocs/easygame"
elif [ -d /opt/lampp/htdocs ]; then
  TARGET="/opt/lampp/htdocs/easygame"
else
  TARGET="$(pwd)/easygame"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "下載中：$REPO_TGZ"
curl -fsSL "$REPO_TGZ" | tar -xz -C "$TMP"
mkdir -p "$TARGET"
cp -R "$TMP/easygame-main/." "$TARGET/"
chmod -R a+rX "$TARGET"
chmod 777 "$TARGET/data" 2>/dev/null || true   # 讓 Apache 可寫入排行榜

echo ""
echo "安裝完成：$TARGET"
echo "啟動 XAMPP 的 Apache 後，瀏覽器開啟 http://localhost/easygame/"
