#!/usr/bin/env bash
# 把阿里云盘共享相簿里的原图拉到照片仓库 photos/ 并提交（不 push，不做任何压缩）
# 用法：bash scripts/pull-album.sh [相簿名] [照片仓库目录]
# 依赖：aliyunpan（已登录，配置目录 ~/.config/aliyunpan）
set -euo pipefail

ALBUM="${1:-afilmory}"
REPO="${2:-$HOME/code/self/afilmory-photos}"
# 下载缓存放在仓库外，重复执行时已有文件不再下载
CACHE="${AFILMORY_ALBUM_CACHE:-$HOME/.cache/afilmory-album}"
# GitHub 建议仓库不超过 5GB，留出余量
LIMIT_MB=4000

export ALIYUNPAN_CONFIG_DIR="${ALIYUNPAN_CONFIG_DIR:-$HOME/.config/aliyunpan}"

if [ ! -d "$REPO/.git" ]; then
  echo "照片仓库不存在：$REPO" >&2
  exit 1
fi

mkdir -p "$CACHE"
aliyunpan album download-file "$ALBUM" --saveto "$CACHE" --np

# aliyunpan 会把 .livp 拆成同名 HEIC + MOV，放在 共享相册/<相簿名>/ 下
SRC="$CACHE/共享相册/$ALBUM"
if [ ! -d "$SRC" ]; then
  echo "没有找到下载目录：$SRC" >&2
  exit 1
fi

# 只增不删：相簿里删掉的照片需要手动从 photos/ 删除
mkdir -p "$REPO/photos"
rsync -a --ignore-existing --exclude '.*' "$SRC"/ "$REPO/photos"/

# GitHub 拒收单个超过 100MB 的文件
BIG=$(find "$REPO" -path "$REPO/.git" -prune -o -type f -size +95M -print)
if [ -n "$BIG" ]; then
  echo "以下文件超过 95MB，GitHub 会拒收，请先移出仓库：" >&2
  echo "$BIG" >&2
  exit 1
fi

# * 不匹配 .git 等隐藏目录
TOTAL_MB=$(du -smc "$REPO"/* | tail -1 | cut -f1)
echo "照片仓库当前约 ${TOTAL_MB}MB（上限约 ${LIMIT_MB}MB）"
if [ "$TOTAL_MB" -gt "$LIMIT_MB" ]; then
  echo "警告：照片仓库接近 GitHub 建议的 5GB 上限" >&2
fi

cd "$REPO"
git add photos
if git diff --cached --quiet; then
  echo "没有新照片"
  exit 0
fi
ADDED=$(git diff --cached --name-only --diff-filter=A | wc -l | tr -d ' ')
git commit -q -m "add ${ADDED} files from album ${ALBUM}"
echo "已提交 ${ADDED} 个新文件，确认无误后执行：cd $REPO && git push"
