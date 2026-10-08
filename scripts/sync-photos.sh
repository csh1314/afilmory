#!/usr/bin/env bash
# 把照片仓库同步到 apps/web/public/photos，供 builder（local provider）处理并随站点发布
# 用法：sh scripts/sync-photos.sh [照片仓库目录]，默认 ../afilmory-photos
set -euo pipefail

SRC="${1:-../afilmory-photos}"
DEST="apps/web/public/photos"

if [ ! -d "$SRC" ]; then
  echo "照片目录不存在：$SRC" >&2
  exit 1
fi

mkdir -p "$DEST"
# 排除 .git、README 等非照片文件；--delete 让仓库里删掉的照片也从站点移除
rsync -a --delete --exclude '.*' --exclude 'README.md' "$SRC"/ "$DEST"/
echo "已同步照片：$SRC -> $DEST"
