#!/usr/bin/env python3
"""pristem 图标 v23 = v19 六条纹（灰白短条/红黄绿蓝/底部窄灰条）+ 圆角三角 r60 + 四色降饱和 s72
颜色: 红(204,80,77) 黄(222,179,73) 绿(89,161,92) 蓝(70,128,225)——HLS 只降饱和度 28%，色相明度不动
依赖: PIL, scipy, numpy（pip install pillow scipy numpy）
用法: python3 pristem-icon-v23.py  → 输出 pristem-icon-v23.png (1024x1024 透明底)
"""
from PIL import Image, ImageDraw
import math
import numpy as np
from scipy import ndimage
 
S = 1024
CX, CY, R = S/2, S/2 + 10, S*0.46          # 外接三角（v19 原参数）
 
# ---- 几何 ----
pts = []
for ang in (90, 210, 330):                    # apex / 左下 / 右下
    a = math.radians(ang)
    pts.append((CX + R*math.cos(a), CY - R*math.sin(a)))
apex, bl, br = pts
 
dx, dy = bl[0]-apex[0], bl[1]-apex[1]
L = math.hypot(dx, dy)                        # apex→左下 边长
ux, uy = dx/L, dy/L                           # 条纹方向单位向量
nx, ny = uy, -ux                              # 条纹深度方向（指向三角内侧）
 
# ---- 条纹参数（v19 原值）----
N = 6
GRAYW = (251, 251, 251)                       # 灰白条
COLORS = [GRAYW,                             # 顶: 灰白短条 (alpha 160)
          (204, 80, 77),                     # 红  s72
          (222, 179, 73),                    # 黄  s72
          (89, 161, 92),                     # 绿  s72
          (70, 128, 225),                    # 蓝  s72
          GRAYW]                             # 底: 灰白窄条 (alpha 160, 宽度 55%)
EDGE_KEEP = L * 0.10                          # apex 角前留白
STRIPE_W = L / (N + 0.55)
GAP = STRIPE_W * 0.16
SHORT_DEPTH = R * 0.85                        # 灰白条深度（比彩条短）
BOT_NARROW = 0.55                             # 底部灰条宽度比例
CORNER_R = 60                                 # 圆角半径
 
# ---- 条纹层 ----
stripe = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(stripe)
start = EDGE_KEEP
for i in range(N):
    t0 = start + i * STRIPE_W
    width = STRIPE_W - GAP
    if i == N - 1:
        width *= BOT_NARROW
    t1 = min(t0 + width, L)
    if t0 >= L:
        break
    p1 = (apex[0]+ux*t0, apex[1]+uy*t0)
    p2 = (apex[0]+ux*t1, apex[1]+uy*t1)
    depth = SHORT_DEPTH if i in (0, N-1) else R * 1.75   # 彩条延长到右下角
    p3 = (p2[0]+nx*depth, p2[1]+ny*depth)
    p4 = (p1[0]+nx*depth, p1[1]+ny*depth)
    if i in (0, N-1):                          # 灰白条: 半透明
        col = list(COLORS[i])
        if i == N - 1:                         # 底灰条视错觉补偿: 物理加白一档
            col = [255, 255, 255]
        fill = tuple(col) + (160,)
    else:
        fill = COLORS[i] + (255,)
    sd.polygon([p1, p2, p3, p4], fill=fill)
 
# ---- 圆角三角蒙版（距离变换法，数学保证=标准圆角多边形）----
SS = 2                                        # 2x 超采样
tri = Image.new("L", (S*SS, S*SS), 0)
ImageDraw.Draw(tri).polygon([(x*SS, y*SS) for x, y in pts], fill=255)
T = np.array(tri) > 128
cr = CORNER_R * SS
eroded = ndimage.distance_transform_edt(T) >= cr        # 腐蚀: 距边 >= cr
rounded = ndimage.distance_transform_edt(~eroded) <= cr # 膨胀: 距收缩三角 <= cr
mask = Image.fromarray((rounded*255).astype(np.uint8)).resize((S, S), Image.LANCZOS)
 
# ---- 合成 ----
final = Image.new("RGBA", (S, S), (0, 0, 0, 0))
cropped = Image.new("RGBA", (S, S), (0, 0, 0, 0))
cropped.paste(stripe, (0, 0), mask)
final.alpha_composite(cropped)
 
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pristem-icon-v23.png")
final.save(OUT)
print("saved:", OUT)
 
# ---- 自检（三顶点圆角 + 底边中点条纹在）----
px = final.load()
def at(x, y): return px[min(1023, max(0, int(x))), min(1023, max(0, int(y)))][3]
mid_bc = ((bl[0]+br[0])/2, (bl[1]+br[1])/2)          # 底边中点
print("apex 顶点 alpha:", at(*apex), "(圆角后应为 0)")
print("左下顶点 alpha:", at(*bl), "(圆角后应为 0)")
print("底边中点 alpha:", at(*mid_bc), "(条纹区应为 255)")
