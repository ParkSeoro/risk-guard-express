#!/usr/bin/env python3
"""Patch Capacitor android/app/build.gradle for Play Console crash symbols.

Play warnings this addresses:
  1) No deobfuscation file — enable R8 and keep mapping.txt in the AAB
  2) Native code without debug symbols — package NDK symbol tables in the AAB
"""
from __future__ import annotations

import re
import sys

NDK_VERSION = "27.2.12479018"
SYMBOL_LEVEL = "SYMBOL_TABLE"


def patch_gradle(src: str) -> str:
    out = src

    if not re.search(r"\bndkVersion\b", out):
        out, n = re.subn(
            r"(android\s*\{)",
            rf'\1\n    ndkVersion "{NDK_VERSION}"',
            out,
            count=1,
        )
        if n != 1:
            raise ValueError("could not inject ndkVersion into android { }")

    # Capacitor template ships minifyEnabled false — Play then has no mapping.txt.
    out, n_min = re.subn(
        r"minifyEnabled\s+false",
        "minifyEnabled true",
        out,
        count=1,
    )
    if n_min != 1 and "minifyEnabled true" not in out:
        out, n_ins = re.subn(
            r"(buildTypes\s*\{\s*release\s*\{)",
            r"\1\n            minifyEnabled true",
            out,
            count=1,
        )
        if n_ins != 1:
            raise ValueError("could not enable minifyEnabled on release")

    if "debugSymbolLevel" not in out:
        ndk_block = (
            "\n            ndk {\n"
            f"                debugSymbolLevel '{SYMBOL_LEVEL}'\n"
            "            }"
        )
        out, n_ndk = re.subn(
            r"(buildTypes\s*\{\s*release\s*\{)",
            r"\1" + ndk_block,
            out,
            count=1,
        )
        if n_ndk != 1:
            raise ValueError("could not inject ndk.debugSymbolLevel")

    return out


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: patch-android-play-symbols.py <app/build.gradle>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    src = open(path, encoding="utf-8").read()
    try:
        out = patch_gradle(src)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    if out == src:
        print("play-symbols: already patched")
        return 0
    open(path, "w", encoding="utf-8").write(out)
    print("play-symbols: minifyEnabled + ndk debugSymbolLevel injected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
