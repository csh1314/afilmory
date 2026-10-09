"""把阿里云盘共享相簿里的原图增量下载到照片仓库 photos/，按内容哈希去重。

用法：python3 -I scripts/pull-album.py <相簿名> <照片仓库目录>
由 pull-album.sh 调用；登录凭证复用 aliyunpan 的配置，调用前需先跑一次 aliyunpan 刷新凭证。

- 去重依据是相簿接口返回的 content_hash：同一张照片加了多次只下载一份
- 同名但内容不同时，后加入的文件名追加哈希前 8 位，如 FullSizeRender_7ac6a9e4.JPG
- 已下载的内容记录在仓库根目录 album-index.json（content_hash → 文件列表），已入库的文件名不再变化
- 先写临时文件、校验大小后再改名，中断不会留下残缺文件
"""

import json
import os
import sys
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

API = 'https://openapi.alipan.com'
# .livp 由接口拆成照片 + 视频两路下载
LIVP_EXT = {'heic': '.HEIC', 'jpeg': '.JPG', 'mov': '.MOV'}
PARALLEL = 3
RETRY = 3


def load_token():
    config_dir = os.environ.get('ALIYUNPAN_CONFIG_DIR', os.path.expanduser('~/.config/aliyunpan'))
    with open(os.path.join(config_dir, 'aliyunpan_config.json')) as f:
        config = json.load(f)
    user = next(u for u in config['userList'] if u['userId'] == config['activeUID'])
    token = user['openapiToken']
    if token['expired'] < time.time() + 300:
        sys.exit('aliyunpan 登录凭证已过期，先执行 aliyunpan login')
    return token['accessToken']


def make_api(token):
    def post(path, data):
        req = urllib.request.Request(
            API + path,
            json.dumps(data).encode(),
            {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)

    return post


def list_album(post, album_name):
    albums = post('/adrive/v1.0/sharedAlbum/list', {})['items']
    album = next((a for a in albums if a['name'] == album_name), None)
    if album is None:
        sys.exit(f'没有找到共享相簿：{album_name}')
    items, marker = [], ''
    while True:
        page = post(
            '/adrive/v1.0/sharedAlbum/listFile',
            {'sharedAlbumId': album['sharedAlbumId'], 'limit': 100, 'marker': marker},
        )
        items += page['items']
        marker = page.get('nextMarker') or ''
        if not marker:
            return album['sharedAlbumId'], items


def stem(name):
    return os.path.splitext(name)[0]


def load_index(path):
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


def save_index(path, index):
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(index, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write('\n')
    os.replace(tmp, path)


def plan(items, index, photos_dir):
    """决定哪些内容要下载、各自用什么文件名。按加入时间排序，保证命名结果与运行次数无关。"""
    unique = {}
    for item in sorted(items, key=lambda i: i['created_at']):
        unique.setdefault(item['content_hash'], item)

    on_disk = defaultdict(list)
    for name in os.listdir(photos_dir):
        if not name.startswith('.'):
            on_disk[stem(name)].append(name)
    indexed = {stem(name) for files in index.values() for name in files}
    # 同一个原名对应的不同内容数；只有一种时，磁盘上未入索引的同名文件可直接认领（迁移旧文件用）
    variants = defaultdict(set)
    for content_hash, item in unique.items():
        variants[stem(item['name'])].add(content_hash)

    taken = set(on_disk) | indexed
    tasks, adopted = [], 0
    for content_hash, item in unique.items():
        if content_hash in index:
            continue
        base = stem(item['name'])
        if base in on_disk and base not in indexed:
            if len(variants[base]) == 1:
                index[content_hash] = sorted(on_disk[base])
                indexed.add(base)
                adopted += 1
                continue
            print(f'无法确认 photos/ 里的 {base}.* 对应哪张照片，请手动删除后重跑', file=sys.stderr)
        name = base if base not in taken else f'{base}_{content_hash[:8].lower()}'
        taken.add(name)
        tasks.append((item, name))
    return tasks, adopted, len(unique)


def download(url, dest):
    part = os.path.join(os.path.dirname(dest), '.' + os.path.basename(dest) + '.part')
    try:
        with urllib.request.urlopen(url, timeout=60) as resp, open(part, 'wb') as f:
            expected = int(resp.headers.get('Content-Length') or -1)
            while chunk := resp.read(1 << 20):
                f.write(chunk)
        size = os.path.getsize(part)
        if expected >= 0 and size != expected:
            raise OSError(f'大小不符 {size}/{expected}')
        os.replace(part, dest)
    finally:
        if os.path.exists(part):
            os.remove(part)


def fetch(post, album_id, item, name, photos_dir):
    """下载一条相簿内容，返回写入的文件名；失败时删掉已写入的部分，避免下次被当成已有文件认领。"""
    written = []
    for attempt in range(RETRY):
        try:
            info = post(
                '/adrive/v1.0/sharedAlbum/getDownloadUrl',
                {'sharedAlbumId': album_id, 'drive_id': item['drive_id'], 'file_id': item['file_id']},
            )
            if item['name'].lower().endswith('.livp'):
                streams = info.get('streams_url') or {}
                photo = 'heic' if streams.get('heic') else 'jpeg'
                files = [(streams.get(k), name + LIVP_EXT[k]) for k in (photo, 'mov') if streams.get(k)]
                if not any(f.endswith(LIVP_EXT[photo]) for _, f in files):
                    raise ValueError('实况照片缺少照片分轨')
            else:
                files = [(info['url'], name + os.path.splitext(item['name'])[1])]
            for url, filename in files:
                download(url, os.path.join(photos_dir, filename))
                written.append(filename)
            return [f for _, f in files]
        except Exception:
            if attempt == RETRY - 1:
                for filename in written:
                    path = os.path.join(photos_dir, filename)
                    if os.path.exists(path):
                        os.remove(path)
                raise
            time.sleep(2 * (attempt + 1))


def main():
    album_name, repo = sys.argv[1], sys.argv[2]
    photos_dir = os.path.join(repo, 'photos')
    index_path = os.path.join(repo, 'album-index.json')
    os.makedirs(photos_dir, exist_ok=True)
    for name in os.listdir(photos_dir):
        if name.endswith('.part'):
            os.remove(os.path.join(photos_dir, name))

    post = make_api(load_token())
    album_id, items = list_album(post, album_name)
    index = load_index(index_path)
    tasks, adopted, unique = plan(items, index, photos_dir)
    print(
        f'相簿 {len(items)} 条，去重后 {unique} 张；'
        f'已入库 {unique - len(tasks) - adopted}，认领已有文件 {adopted}，待下载 {len(tasks)}'
    )
    if adopted:
        save_index(index_path, index)

    failed = 0
    with ThreadPoolExecutor(PARALLEL) as pool:
        futures = {pool.submit(fetch, post, album_id, item, name, photos_dir): item for item, name in tasks}
        for future in as_completed(futures):
            item = futures[future]
            try:
                files = future.result()
            except Exception as e:
                failed += 1
                print(f'下载失败：{item["name"]}：{e}', file=sys.stderr)
                continue
            # 每完成一张就落盘索引，中断后重跑只补没下完的
            index[item['content_hash']] = files
            save_index(index_path, index)
            print(f'已下载：{item["name"]} → {", ".join(files)}')

    if failed:
        sys.exit(f'{failed} 张下载失败，重跑即可续传')


if __name__ == '__main__':
    main()
