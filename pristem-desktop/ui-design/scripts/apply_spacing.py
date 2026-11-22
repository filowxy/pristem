#!/usr/bin/env python3
"""T3: route every padding/margin/gap declaration onto an 8-tier spacing scale.

Values that already sit on the scale keep their exact value (zero visual
change); off-scale values move to the nearest tier (at most 2px). The script
prints the mapping table before it writes anything.
"""
from __future__ import annotations

import io
import re
import sys
from collections import Counter

PATH = sys.argv[1] if len(sys.argv) > 1 else "ui/src/styles.css"

# 8 tiers: two half-steps for optical alignment, then the 4px/8px rhythm.
SCALE = [
    ("--sp-1", 2), ("--sp-2", 4), ("--sp-3", 6), ("--sp-4", 8),
    ("--sp-6", 12), ("--sp-8", 16), ("--sp-12", 24), ("--sp-16", 32),
]

PROPS = ("padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
         "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
         "gap", "row-gap", "column-gap")

DECL = re.compile(
    r"(?P<prop>\b(?:%s)\s*:\s*)(?P<value>[^;{}]+)(?P<semi>;)" % "|".join(PROPS)
)


def nearest(px: float) -> tuple[str, int]:
    best = None
    for name, value in SCALE:
        delta = abs(value - px)
        # ties resolve upward so a padded control never gets cramped
        key = (delta, -value)
        if best is None or key < best[0]:
            best = (key, name, value)
    return best[1], best[2]


def main() -> int:
    with io.open(PATH, encoding="utf-8") as fh:
        text = fh.read()

    mapping: Counter = Counter()
    changed = 0

    def repl(m: re.Match) -> str:
        nonlocal changed
        value = m.group("value")
        if any(k in value for k in ("auto", "calc(", "var(", "%", "em", "rem", "vh", "vw", "ch", "fr")):
            return m.group(0)
        if "px" not in value:
            return m.group(0)
        out = value
        for num in re.findall(r"(\d+(?:\.\d+)?)px", value):
            px = float(num)
            if px == 0:
                continue
            name, target = nearest(px)
            mapping[f"{num}px->{name}({target}px)"] += 1
            out = out.replace(f"{num}px", f"var({name})")
        if out != value:
            changed += 1
        return m.group("prop") + out + m.group("semi")

    new_text = DECL.sub(repl, text)

    print(f"declarations rewritten: {changed}")
    for key, count in sorted(mapping.items(), key=lambda kv: -kv[1]):
        print(f"  {key:26} ×{count}")

    with io.open(PATH, "w", encoding="utf-8", newline="") as fh:
        fh.write(new_text)
    print("written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
