#!/usr/bin/env python3
"""
repack_assets.py —— 修复 aapt2 在 Windows 上写出的反斜杠条目路径

背景（这个坑藏了很久，值得记一笔）：
    aapt2 的 `-A assets` 在 Windows 上会把资源条目名写成
        assets/www\\js\\app.js        ← 分隔符是反斜杠
    而 zip 规范与 Android 的资源查找只认正斜杠：
        - WebView 打开 file:///android_asset/www/index.html → net::ERR_FILE_NOT_FOUND
        - AssetManager.open("www/index.html")               → FileNotFoundException
    更隐蔽的是：Python 的 zipfile 在 Windows 上读取条目名时会把 os.sep（\\）
    归一化成 '/'，所以用 namelist() 检查会**看起来完全正常**。
    本脚本因此用「原始字节」统计反斜杠数量，并把所有条目按 '/' 重写一遍。

用法：
    python scripts/repack_assets.py in.apk out.apk
"""
import shutil
import sys
import zipfile

BS = chr(92)  # 反斜杠


def count_backslash_entries(path):
    """按原始字节统计，绕开 zipfile 在 Windows 上的分隔符归一化"""
    with open(path, 'rb') as f:
        data = f.read()
    return data.count(('assets/www' + BS).encode())


def main(src, dst):
    before = count_backslash_entries(src)
    zin = zipfile.ZipFile(src)
    zout = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED)
    for info in zin.infolist():
        data = zin.read(info.filename)
        name = info.filename.replace(BS, '/')
        ni = zipfile.ZipInfo(name, date_time=info.date_time)
        ni.compress_type = info.compress_type     # 保留压缩方式（resources.arsc 必须是 STORED）
        ni.external_attr = info.external_attr
        ni.internal_attr = info.internal_attr
        ni.create_system = info.create_system
        zout.writestr(ni, data)
    zout.close()
    zin.close()
    shutil.move(dst, src)
    print('  重写条目完成（原始字节中反斜杠路径：修复前 %d 处）' % before)
    return before


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('usage: repack_assets.py in.apk out.apk')
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
