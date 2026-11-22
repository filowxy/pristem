#!/usr/bin/env python3
"""派生 Windows 应用图标资源（不重绘，只做尺寸派生）。

输入: pristem-icon-taskbar.png (256x256, 不透明深色底 — 任务栏/快捷方式上用这个)
输出:
  pristem.ico        多尺寸 ico，给 .lnk 快捷方式用
  icon_128.rgba      裸 RGBA 像素，shell/src/main.rs 用 include_bytes! 喂给 tao::Icon::from_rgba

用法: python make-app-icon.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "pristem-icon-taskbar.png")

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
RGBA_SIZE = 128  # 窗口/Alt-Tab 用的位图；128 足够，4 字节/px = 64 KiB

src = Image.open(SRC).convert("RGBA")

ico_path = os.path.join(HERE, "pristem.ico")
src.save(ico_path, format="ICO", sizes=[(s, s) for s in ICO_SIZES])

rgba_path = os.path.join(HERE, "icon_128.rgba")
rgba = src.resize((RGBA_SIZE, RGBA_SIZE), Image.LANCZOS).convert("RGBA").tobytes()
open(rgba_path, "wb").write(rgba)

print("ico :", ico_path, os.path.getsize(ico_path), "bytes", ICO_SIZES)
print("rgba:", rgba_path, os.path.getsize(rgba_path), "bytes", RGBA_SIZE, "x", RGBA_SIZE)
assert os.path.getsize(rgba_path) == RGBA_SIZE * RGBA_SIZE * 4
