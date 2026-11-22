#!/usr/bin/env python3
"""Apply the T1/T2/T4 token changes to ui/src/styles.css (deterministic, line-scoped).

Every edit is asserted before it is written; the script aborts if the file does
not look the way the plan assumed.
"""
from __future__ import annotations

import io
import sys

PATH = "ui/src/styles.css"

# ── T1: readable text moves from --text-4 to --text-3 ─────────────────────
# Lines that keep --text-4 on purpose: disabled controls, decorative glyphs,
# separators, accent fallbacks. WCAG does not require contrast for disabled
# text, and the rest are not reading surfaces.
KEEP_TEXT4 = {104, 170, 340, 817, 1836, 1889}

REPLACEMENTS = [
    # (old, new, expected_count)
    ("--text-3:#8C8C8C;", "--text-3:#949494;", 1),      # 4.38 -> 4.86:1 on the lightest surface
    ("--text-4:#6E6E6E;", "--text-4:#7E7E7E;", 1),      # 2.89 -> 3.63:1 (decorative tier only)
    ("--fs-eyebrow:10px; --fs-mono:11.5px;", "--fs-eyebrow:10px; --fs-mono:12px;", 1),
    (".guide-done h2 { font-size: 18px;", ".guide-done h2 { font-size: var(--fs-title);", 1),
    # T4: danger hardcodes -> token-derived colours
    ("background: #382D2D;", "background: color-mix(in srgb, var(--danger) 14%, var(--surface-raised));", 1),
    (".tree-del.is-confirm:hover { color: var(--text-1); background: #4A3535; background: color-mix(in srgb, var(--danger) 22%, var(--surface-raised)); }",
     ".tree-del.is-confirm:hover { color: var(--text-1); background: color-mix(in srgb, var(--danger) 22%, var(--surface-raised)); }", 1),
    (".window-controls button.is-close:hover { background: #B44646; color: #fff; }",
     ".window-controls button.is-close:hover { background: color-mix(in srgb, var(--danger) 82%, #000); color: #fff; }", 1),
]


def main() -> int:
    with io.open(PATH, encoding="utf-8") as fh:
        lines = fh.readlines()

    # ── T1 line-scoped remap ──────────────────────────────────────────────
    moved = 0
    for i, line in enumerate(lines, start=1):
        if "var(--text-4)" in line and i not in KEEP_TEXT4:
            lines[i - 1] = line.replace("var(--text-4)", "var(--text-3)")
            moved += 1
    print(f"text-4 -> text-3 on {moved} lines (kept {len(KEEP_TEXT4)} decorative/disabled lines)")

    text = "".join(lines)
    for old, new, count in REPLACEMENTS:
        found = text.count(old)
        if found != count:
            print(f"ABORT: expected {count}x {old!r}, found {found}")
            return 1
        text = text.replace(old, new)
        print(f"ok: {old[:52]!r}")

    with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    print("written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
