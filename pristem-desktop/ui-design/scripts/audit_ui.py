#!/usr/bin/env python3
"""Deterministic UI audit for pristem (stdlib only).

Rule IDs follow the anti-slop checklist that was handed to this task:
A colour · B type · C layout · D motion · E copy/assets · F engineering · G era-2.

Every finding must carry file:line evidence. The script never judges taste:
it reports measurable facts and leaves the call to the worklog.

Usage: python ui-design/scripts/audit_ui.py [target ...]
       target = a file or directory (default: ui/src)
Exit code 1 when an ERROR-level finding exists.
"""
from __future__ import annotations

import colorsys
import json
import os
import re
import sys
from collections import Counter, defaultdict

# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

HEX = re.compile(r"#([0-9a-fA-F]{3,8})\b")
FUNC = re.compile(r"([a-z-]+)\s*\(\s*([^)]*)\)", re.I)
NUM = re.compile(r"(?<![\w.-])(\d+(?:\.\d+)?)(px|rem|em|%|ms|s)\b")
COLOR_FN = re.compile(r"\b(rgba?|hsla?|color-mix|color)\s*\(", re.I)
EMOJI = re.compile(
    "[\U0001F300-\U0001FAFF\U0001F000-\U0001F2FF\U0001F1E6-\U0001F1FF]"
)
BIZ = re.compile(r"赋能|极致|一站式|打造|助力|闭环|抓手|心智|颗粒度|全方位|深度赋能")
SLOP_CN = re.compile(r"lorem ipsum|placeholder text|待补充|占位文案")

ERR, WARN, INFO = "ERROR", "WARN", "INFO"


class Finding:
    __slots__ = ("rule", "level", "where", "message")

    def __init__(self, rule: str, level: str, where: str, message: str) -> None:
        self.rule, self.level, self.where, self.message = rule, level, where, message

    def as_dict(self) -> dict:
        return {"rule": self.rule, "level": self.level, "where": self.where, "message": self.message}


def read(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def blank_comments(text: str) -> str:
    """Replace comment bodies with spaces so offsets and line numbers survive."""
    return re.sub(r"/\*.*?\*/", lambda m: " " * len(m.group(0)), text, flags=re.S)


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def hex_to_rgb(value: str) -> tuple[float, float, float] | None:
    value = value.lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    if len(value) not in (6, 8):
        return None
    try:
        return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return None


def rel_lum(rgb: tuple[float, float, float]) -> float:
    def chan(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (chan(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def hue_sat(rgb: tuple[float, float, float]) -> tuple[float, float]:
    h, l, s = colorsys.rgb_to_hls(*rgb)
    return h * 360, s


def is_neutral(rgb: tuple[float, float, float]) -> bool:
    return max(rgb) - min(rgb) < 0.012


# --------------------------------------------------------------------------- #
# collection
# --------------------------------------------------------------------------- #

def collect(target: str) -> list[str]:
    if os.path.isfile(target):
        return [target]
    out: list[str] = []
    for root, _dirs, files in os.walk(target):
        for name in files:
            if name.endswith((".css", ".tsx", ".ts")):
                out.append(os.path.join(root, name))
    return sorted(out)


# --------------------------------------------------------------------------- #
# rules
# --------------------------------------------------------------------------- #

def audit(files: list[str], findings: list[Finding]) -> dict:
    stats: dict = defaultdict(Counter)
    css_text = ""
    css_files: list[str] = []
    tsx_text = ""
    tsx_files: list[str] = []

    for path in files:
        text = read(path)
        if path.endswith(".css"):
            css_text += "\n" + text
            css_files.append(path)
        elif path.endswith((".tsx", ".ts")):
            tsx_text += "\n" + text
            tsx_files.append(path)

    # ---- A colour ---------------------------------------------------------
    hexes: dict[str, list[str]] = defaultdict(list)
    for path in css_files:
        text = blank_comments(read(path))
        for m in HEX.finditer(text):
            raw = m.group(1)
            key = "#" + raw.lower()
            hexes[key].append(f"{path}:{line_of(text, m.start())}")

    palette = {k: v for k, v in hexes.items() if hex_to_rgb(k)}
    neutral = [k for k in palette if is_neutral(hex_to_rgb(k))]  # type: ignore[arg-type]
    chromatic = [k for k in palette if k not in neutral]
    stats["A"]["palette_total"] = len(palette)
    stats["A"]["palette_neutral"] = len(neutral)
    stats["A"]["palette_chromatic"] = len(chromatic)
    # palette-sprawl = a colour literal outside the token block. The token
    # block IS the palette; anything else is an undeclared colour. Mask stops
    # (#000 as an opaque alpha channel) are geometry, not palette entries.
    # A token line may carry several literals (the spectrum gradient), so every
    # hex on a line that declares a --token counts as declared.
    declared: set[str] = set()
    for m in re.finditer(r"--[a-z0-9-]+\s*:[^\n;]*", css_text):
        declared.update("#" + h.lower() for h in HEX.findall(m.group(0)))
    stray: dict[str, list[str]] = defaultdict(list)
    for path in css_files:
        text = blank_comments(read(path))
        for m in HEX.finditer(text):
            line_start = text.rfind("\n", 0, m.start()) + 1
            line_end = text.find("\n", m.start())
            if "mask-image" in text[line_start:line_end]:
                continue
            key = "#" + m.group(1).lower()
            if key not in declared:
                stray[key].append(f"{path}:{line_of(text, m.start())}")
    stats["A"]["declared_colours"] = len(declared)
    stats["A"]["stray_colours"] = len(stray)
    if stray:
        findings.append(Finding("palette-sprawl", WARN, "ui/src/styles.css",
                                f"{len(stray)} colour literals outside the token block: "
                                f"{', '.join(sorted(stray)[:12])}"))
    if neutral:
        findings.append(Finding("untinted-neutral", INFO, "ui/src/styles.css",
                                f"{len(neutral)} achromatic colours (r=g=b): "
                                f"{', '.join(sorted(neutral)[:12])}"))

    # purple / blue-violet gradients
    for path in css_files:
        text = read(path)
        for m in re.finditer(r"[a-z-]*gradient\([^;]*\)[^;]*", text, re.I):
            chunk = m.group(0)
            bad = []
            for h in HEX.finditer(chunk):
                rgb = hex_to_rgb(h.group(0))
                if not rgb:
                    continue
                hue, sat = hue_sat(rgb)
                if 240 <= hue <= 330 and sat > 0.25:
                    bad.append(h.group(0))
            if bad:
                findings.append(Finding("purple-gradient", WARN, f"{path}:{line_of(text, m.start())}",
                                        f"violet/blue gradient {bad}"))

    # neon glow: saturated shadow colours with a large blur
    for path in css_files:
        text = read(path)
        for m in re.finditer(r"box-shadow\s*:[^;}]+", text, re.I):
            chunk = m.group(0)
            blur = re.search(r"(\d+)px\s+\1px", chunk)
            for h in HEX.finditer(chunk):
                rgb = hex_to_rgb(h.group(0))
                if rgb and blur:
                    hue, sat = hue_sat(rgb)
                    if sat > 0.45 and int(blur.group(1)) >= 12:
                        findings.append(Finding("colored-glow", WARN,
                                                f"{path}:{line_of(text, m.start())}",
                                                f"saturated glow {h.group(0)} blur {blur.group(1)}px"))

    # ---- B type -----------------------------------------------------------
    families: dict[str, list[str]] = defaultdict(list)
    for path in css_files:
        text = read(path)
        for m in re.finditer(r"font-family\s*:\s*([^;}]+)", text, re.I):
            first = m.group(1).split(",")[0].strip().strip("'\"")
            families[first].append(f"{path}:{line_of(text, m.start())}")
    banned = {"inter", "roboto", "arial", "open sans", "helvetica neue"}
    for fam in families:
        if fam.lower() in banned:
            findings.append(Finding("font-default", WARN, ", ".join(families[fam][:3]),
                                    f"'{fam}' is used as a primary family"))
    stats["B"]["families"] = len(families)
    stats["B"]["family_names"] = ", ".join(sorted(families)[:12])

    sizes: dict[str, list[str]] = defaultdict(list)
    for path in css_files:
        text = read(path)
        for m in re.finditer(r"font-size\s*:\s*(\d+(?:\.\d+)?)px", text):
            sizes[m.group(1)].append(f"{path}:{line_of(text, m.start())}")
    for m in re.finditer(r"'?--fs-([a-z-]+)'?\s*:\s*(\d+(?:\.\d+)?)px", css_text):
        sizes[m.group(2)].append("ui/src/styles.css:--fs-" + m.group(1))
    ladder = sorted(float(s) for s in sizes)
    stats["B"]["type_sizes"] = len(ladder)
    stats["B"]["type_ladder"] = ", ".join(f"{s:g}" for s in ladder)
    if len(ladder) > 7:
        findings.append(Finding("type-scale-chaos", WARN, "ui/src/styles.css",
                                f"{len(ladder)} distinct px sizes (>7): "
                                f"{', '.join(f'{s:g}' for s in ladder)}"))

    # ---- C layout ---------------------------------------------------------
    radius = Counter(re.findall(r"border-radius\s*:\s*([^;}]+)", css_text))
    stats["C"]["radius_values"] = len(radius)
    top_radius = radius.most_common(1)[0] if radius else ("none", 0)
    total_radius = sum(radius.values())
    if total_radius and top_radius[1] / total_radius > 0.7 and len(radius) <= 3:
        findings.append(Finding("radius-monotony", WARN, "ui/src/styles.css",
                                f"{top_radius[0]} used in {top_radius[1]}/{total_radius} radius declarations"))
    stats["C"]["radius_top"] = ", ".join(f"{k.strip()}×{v}" for k, v in radius.most_common(6))

    # left colour bar on a card (side-tab fingerprint)
    for path in css_files:
        text = read(path)
        for m in re.finditer(r"([^{}]+)\{([^{}]*border-left\s*:\s*[^;}]+[^{}]*)\}", text, re.I):
            sel, body = m.group(1).strip().split("\n")[-1], m.group(2)
            if re.search(r"border-left\s*:\s*\d+px", body):
                findings.append(Finding("side-tab", WARN, f"{path}:{line_of(text, m.start())}",
                                        f"selector '{sel[-60:]}' paints a left colour bar"))

    # grid-pattern backgrounds
    for path in css_files:
        text = read(path)
        for m in re.finditer(r"repeating-linear-gradient\([^)]*\)", text, re.I):
            findings.append(Finding("codex-grid-background", INFO,
                                    f"{path}:{line_of(text, m.start())}", m.group(0)[:80]))

    # glassmorphism spread
    glass = len(re.findall(r"--glass-fill", css_text))
    backdrop = len(re.findall(r"backdrop-filter\s*:\s*[^;]*blur", css_text, re.I))
    stats["C"]["glass_refs"] = glass
    stats["C"]["backdrop_blur"] = backdrop
    if backdrop >= 8:
        findings.append(Finding("glassmorphism", WARN, "ui/src/styles.css",
                                f"{backdrop} backdrop-filter: blur() declarations"))

    # ---- D motion ---------------------------------------------------------
    for path in css_files:
        text = read(path)
        for m in re.finditer(r"transition\s*:\s*all\b[^;]*", text, re.I):
            findings.append(Finding("transition-all", WARN, f"{path}:{line_of(text, m.start())}",
                                    m.group(0)[:70]))
    for path in css_files:
        text = read(path)
        for m in re.finditer(r"cubic-bezier\(([^)]*)\)", text, re.I):
            nums = [float(x) for x in re.findall(r"-?\d*\.?\d+", m.group(1))]
            if len(nums) >= 3 and (max(nums) > 1.0 or min(nums) < 0.0):
                findings.append(Finding("bounce-easing", WARN, f"{path}:{line_of(text, m.start())}",
                                        f"overshoot easing cubic-bezier({m.group(1)})"))
    reduced = len(re.findall(r"prefers-reduced-motion", css_text))
    stats["D"]["reduced_motion_blocks"] = reduced
    if reduced == 0:
        findings.append(Finding("reduced-motion-missing", WARN, "ui/src/styles.css",
                                "no prefers-reduced-motion block"))

    # ---- E copy / assets --------------------------------------------------
    for path in tsx_files:
        text = read(path)
        for m in EMOJI.finditer(text):
            findings.append(Finding("emoji-icon", WARN, f"{path}:{line_of(text, m.start())}",
                                    f"emoji {m.group(0)!r}"))
        for m in BIZ.finditer(text):
            findings.append(Finding("buzzword", WARN, f"{path}:{line_of(text, m.start())}",
                                    f"marketing phrase {m.group(0)!r}"))
        for m in SLOP_CN.finditer(text):
            findings.append(Finding("placeholder-copy", WARN, f"{path}:{line_of(text, m.start())}",
                                    f"placeholder copy {m.group(0)!r}"))
    for m in re.finditer(r"<img\b(?![^>]*\balt=)[^>]*>", tsx_text, re.I):
        findings.append(Finding("img-alt", WARN, "ui/src/*.tsx", m.group(0)[:70]))

    # ---- F engineering ----------------------------------------------------
    # contrast of the declared token pairs
    token_of = {}
    for m in re.finditer(r"--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})", css_text):
        token_of.setdefault(m.group(1), m.group(2))
    surfaces = [k for k in token_of if k.startswith("surface-")]
    texts = [k for k in token_of if k.startswith("text-")]
    # --text-4 is the decorative/disabled tier (DESIGN §4.1). Readable copy
    # starts at --text-3, so WCAG body-text contrast does not apply to it.
    decorative = {"text-4"}
    pairs = 0
    for t in texts:
        tfg = hex_to_rgb(token_of[t])
        if not tfg:
            continue
        for s in surfaces:
            sfg = hex_to_rgb(token_of[s])
            if not sfg:
                continue
            ratio = contrast(tfg, sfg)
            pairs += 1
            if t in decorative:
                continue
            if ratio < 4.5:
                findings.append(Finding("contrast-fail", WARN, "ui/src/styles.css",
                                        f"--{t} on --{s}: {ratio:.2f}:1 (body text needs 4.5:1)"))
    stats["F"]["contrast_pairs"] = pairs
    for name in ("success", "warn", "danger", "info"):
        if name in token_of:
            fg = hex_to_rgb(token_of[name])
            bg = hex_to_rgb(token_of.get("surface-panel", "#1B1B1B"))
            if fg and bg:
                stats["F"][f"contrast_{name}"] = round(contrast(fg, bg), 2)

    # spacing off the 4px grid
    off_grid: Counter = Counter()
    for path in css_files:
        text = read(path)
        for prop in ("padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
                     "margin", "margin-top", "margin-bottom", "margin-left", "margin-right", "gap"):
            for m in re.finditer(rf"{prop}\s*:\s*([^;{{}}]+)", text):
                value = m.group(1).strip()
                if "var(" in value or "auto" in value or "clamp" in value or "%" in value:
                    continue
                for num in re.findall(r"(\d+(?:\.\d+)?)px", value):
                    if float(num) % 4 not in (0.0,) and float(num) not in (1.0, 2.0, 3.0):
                        off_grid[f"{num}px"] += 1
                        if off_grid[f"{num}px"] <= 3:
                            findings.append(Finding("spacing-grid", INFO,
                                                    f"{path}:{line_of(text, m.start())}",
                                                    f"{prop}: {value} (not on the 4px grid)"))
    stats["F"]["off_grid_values"] = ", ".join(f"{k}×{v}" for k, v in off_grid.most_common(8))

    # ---- G era-2 ----------------------------------------------------------
    # Cream magazine is a SURFACE problem. Only colours bound to --surface-*
    # count; an ivory text token is not a cream background.
    surface_hex = {h.lower() for h in re.findall(
        r"--surface-[a-z0-9-]+\s*:\s*(#[0-9a-fA-F]{3,8})", css_text)}
    cream = [k for k in palette if k in surface_hex and
             (lambda c: c and c[0] > 0.93 and c[1] > 0.9 and c[2] > 0.85)(hex_to_rgb(k))]
    if cream:
        findings.append(Finding("cream-magazine", WARN, "ui/src/styles.css",
                                f"cream surfaces: {', '.join(cream[:8])}"))
    scifi = 0
    for path in css_files:
        text = read(path)
        for m in re.finditer(r"#[0-9a-fA-F]{6}\b", text):
            rgb = hex_to_rgb(m.group(0))
            if rgb:
                hue, sat = hue_sat(rgb)
                if 165 <= hue <= 200 and sat > 0.5:
                    scifi += 1
    if scifi >= 4:
        findings.append(Finding("scifi-console", WARN, "ui/src/styles.css",
                                f"{scifi} cyan/teal saturated colours"))

    return {"stats": {k: dict(v) for k, v in stats.items()},
            "palette": sorted(palette)}


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # pragma: no cover - old interpreters
        pass
    targets = sys.argv[1:] or [os.path.join("pristem-desktop", "ui", "src")]
    files: list[str] = []
    for t in targets:
        files.extend(collect(t))
    files = sorted(set(files))
    if not files:
        print("no files found")
        return 2
    findings: list[Finding] = []
    report = audit(files, findings)
    order = {ERR: 0, WARN: 1, INFO: 2}
    findings.sort(key=lambda f: (order[f.level], f.rule))
    print(f"# audit_ui: {len(files)} files")
    for key, value in report["stats"].items():
        print(f"  stat {key}: {value}")
    print()
    for f in findings:
        print(f"{f.level:5} {f.rule:24} {f.where}  {f.message}")
    counts = Counter(f.level for f in findings)
    print(f"\nERROR={counts[ERR]} WARN={counts[WARN]} INFO={counts[INFO]}")
    json.dump({"findings": [f.as_dict() for f in findings], "stats": report["stats"]},
              open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "audit_report.json"), "w",
                   encoding="utf-8"), ensure_ascii=False, indent=1)
    return 1 if counts[ERR] else 0


if __name__ == "__main__":
    sys.exit(main())
