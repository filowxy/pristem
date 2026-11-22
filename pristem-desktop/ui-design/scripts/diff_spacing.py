#!/usr/bin/env python3
"""Recover which spacing declarations moved the most.

The pre-change build in ui/dist still holds the original values, so the two
files can be aligned by declaration order (the token pass never reordered or
added declarations). Anything that moved more than 2px is listed so it can be
restored deliberately.
"""
from __future__ import annotations

import glob
import io
import os
import re
import sys

DECL = re.compile(
    r"\b(?P<prop>padding|padding-top|padding-bottom|padding-left|padding-right|margin|"
    r"margin-top|margin-bottom|margin-left|margin-right|gap|row-gap|column-gap)"
    r"\s*:\s*(?P<value>[^;{}]+)[;}]"
)
TOKEN = re.compile(r"--sp-(\d+)")
SCALE = {1: 2, 2: 4, 3: 6, 4: 8, 6: 12, 8: 16, 12: 24, 16: 32}


def tokens(path: str) -> list[tuple[str, str]]:
    with io.open(path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    out = []
    for m in DECL.finditer(text):
        value = m.group("value")
        if "var(" not in value:
            continue
        out.append((m.group("prop"), value))
    return out


def old_values(dist_css: str) -> list[str]:
    with io.open(dist_css, encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    out = []
    for m in DECL.finditer(text):
        value = m.group("value")
        if "var(--sp-" in value:
            continue  # already tokenised (a later build)
        if "px" not in value:
            continue
        out.append(value)
    return out


def main() -> int:
    dist = sorted(glob.glob("ui/dist/assets/*.css"))
    if not dist:
        print("no dist css found")
        return 2
    print("dist:", dist)
    current = tokens("ui/src/styles.css")
    old = old_values(dist[-1])
    print(f"current tokenised declarations: {len(current)}  |  old px declarations: {len(old)}")

    def analyse(pairs) -> list:
        big = []
        for (prop, value), old_value in pairs:
            nums = [float(n) for n in re.findall(r"(\d+(?:\.\d+)?)px", old_value)]
            new_nums = []
            for t in TOKEN.finditer(value):
                new_nums.append(float(SCALE.get(int(t.group(1)), 0)))
            if not nums or not new_nums:
                continue
            pairs_in = list(zip(nums, new_nums))
            delta = max(abs(a - b) for a, b in pairs_in)
            if delta > 2:
                big.append((prop, old_value.strip(), value.strip(), delta))
        return big

    # the bundle concatenates styles.css and polish.css; try both orders
    n = len(current)
    best = None
    for offset in range(0, len(old) - n + 1):
        big = analyse(list(zip(current, old[offset:offset + n])))
        score = (len(big), sum(b[3] for b in big))
        if best is None or score < best[0]:
            best = (score, offset, big)
    score, offset, big = best
    print(f"aligned at offset {offset} (delta score {score})\n")
    print(f"declarations that moved more than 2px: {len(big)}")
    for prop, o, n2, d in big:
        print(f"  Δ{d:>4.0f}px  {prop}: {o}  ->  {n2}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
