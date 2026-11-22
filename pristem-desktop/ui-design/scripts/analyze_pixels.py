#!/usr/bin/env python3
"""Pixel statistics and tile crops for UI screenshots — standard library only.

Pillow is not installed in this environment, so PNGs are decoded here with
zlib + the PNG filters. That keeps the "measure before you look" rule intact
instead of dropping the evidence step.

Usage:
  python analyze_pixels.py <image.png> [--tiles 3] [--out DIR]
  python analyze_pixels.py <a.png> --diff <b.png> [--out DIR]
"""
from __future__ import annotations

import os
import struct
import sys
import zlib


# --------------------------------------------------------------------------- #
# PNG decoding
# --------------------------------------------------------------------------- #

def read_png(path: str) -> tuple[int, int, bytes]:
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: not a PNG")
    pos = 8
    width = height = depth = color = 0
    idat = bytearray()
    palette = b""
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, depth, color = struct.unpack(">IIBB", body[:10])
        elif ctype == b"PLTE":
            palette = body
        elif ctype == b"IDAT":
            idat += body
        elif ctype == b"IEND":
            break
    if depth != 8:
        raise ValueError(f"{path}: only 8-bit PNGs are supported (got {depth})")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(height * stride)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if ftype == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, bytes(out), channels, color, palette


def to_rgb(path: str) -> tuple[int, int, bytearray]:
    width, height, raw, channels, color, palette = read_png(path)
    rgb = bytearray(width * height * 3)
    for i in range(width * height):
        if color == 6:
            r, g, b = raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2]
        elif color == 2:
            r, g, b = raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]
        elif color == 0:
            r = g = b = raw[i]
        elif color == 4:
            r = g = b = raw[i * 2]
        elif color == 3:
            idx = raw[i]
            r, g, b = palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]
        else:
            raise ValueError("unsupported colour type")
        rgb[i * 3] = r
        rgb[i * 3 + 1] = g
        rgb[i * 3 + 2] = b
    return width, height, rgb


# --------------------------------------------------------------------------- #
# PNG writing (for tiles and diffs)
# --------------------------------------------------------------------------- #

def write_png(path: str, width: int, height: int, rgb: bytes) -> None:
    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)
        raw += rgb[y * stride:(y + 1) * stride]

    def chunk(tag: bytes, body: bytes) -> bytes:
        return (struct.pack(">I", len(body)) + tag + body
                + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n")
        fh.write(chunk(b"IHDR", ihdr))
        fh.write(chunk(b"IDAT", zlib.compress(bytes(raw), 6)))
        fh.write(chunk(b"IEND", b""))


def crop(rgb: bytearray, w: int, x0: int, y0: int, cw: int, ch: int) -> bytearray:
    out = bytearray(cw * ch * 3)
    for y in range(ch):
        src = ((y0 + y) * w + x0) * 3
        out[y * cw * 3:(y + 1) * cw * 3] = rgb[src:src + cw * 3]
    return out


# --------------------------------------------------------------------------- #
# statistics
# --------------------------------------------------------------------------- #

def stats(path: str) -> dict:
    w, h, rgb = to_rgb(path)
    hist: dict[tuple[int, int, int], int] = {}
    lum_sum = 0.0
    lum_sq = 0.0
    near_white = near_black = 0
    total = w * h
    for i in range(total):
        r, g, b = rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]
        key = (r // 8 * 8, g // 8 * 8, b // 8 * 8)
        hist[key] = hist.get(key, 0) + 1
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        lum_sum += lum
        lum_sq += lum * lum
        if lum > 235:
            near_white += 1
        if lum < 20:
            near_black += 1
    mean = lum_sum / total
    rms = (lum_sq / total - mean * mean) ** 0.5
    top = sorted(hist.items(), key=lambda kv: -kv[1])[:8]
    return {
        "size": f"{w}x{h}",
        "unique_buckets": len(hist),
        "mean_luminance": round(mean, 2),
        "rms_contrast": round(rms, 2),
        "near_white_ratio": round(near_white / total, 4),
        "near_black_ratio": round(near_black / total, 4),
        "top_colors": [("#%02x%02x%02x" % c, round(n / total, 4)) for c, n in top],
    }


def diff(a_path: str, b_path: str, out_dir: str) -> dict:
    aw, ah, a = to_rgb(a_path)
    bw, bh, b = to_rgb(b_path)
    if (aw, ah) != (bw, bh):
        return {"error": f"size mismatch {aw}x{ah} vs {bw}x{bh}"}
    total = aw * ah
    changed = 0
    max_delta = 0
    out = bytearray(total * 3)
    for i in range(total):
        dr = abs(a[i * 3] - b[i * 3])
        dg = abs(a[i * 3 + 1] - b[i * 3 + 1])
        db = abs(a[i * 3 + 2] - b[i * 3 + 2])
        d = max(dr, dg, db)
        if d > 8:
            changed += 1
            out[i * 3] = 255
            out[i * 3 + 1] = 0
            out[i * 3 + 2] = 0
        else:
            v = (a[i * 3] // 3 + a[i * 3 + 1] // 3 + a[i * 3 + 2] // 3) // 3
            out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = v
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "diff.png")
    write_png(path, aw, ah, bytes(out))
    return {"changed_pixels": changed, "changed_ratio": round(changed / total, 5),
            "diff_image": path, "size": f"{aw}x{ah}"}


def tiles(path: str, n: int, out_dir: str) -> list[str]:
    w, h, rgb = to_rgb(path)
    os.makedirs(out_dir, exist_ok=True)
    tw, th = w // n, h // n
    made = []
    for ty in range(n):
        for tx in range(n):
            piece = crop(rgb, w, tx * tw, ty * th, tw, th)
            p = os.path.join(out_dir, f"tile_{ty}_{tx}.png")
            write_png(p, tw, th, bytes(piece))
            made.append(p)
    return made


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    out_dir = "ui-design/screenshots"
    if "--out" in args:
        i = args.index("--out")
        out_dir = args[i + 1]
        del args[i:i + 2]
    if "--diff" in args:
        i = args.index("--diff")
        result = diff(args[0], args[i + 1], out_dir)
        print(result)
        return 0
    tile_n = 0
    if "--tiles" in args:
        i = args.index("--tiles")
        tile_n = int(args[i + 1])
        del args[i:i + 2]
    path = args[0]
    print(path)
    for key, value in stats(path).items():
        print(f"  {key}: {value}")
    if tile_n:
        made = tiles(path, tile_n, out_dir)
        print(f"  tiles: {len(made)} -> {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
