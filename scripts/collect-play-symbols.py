#!/usr/bin/env python3
"""Collect Play Console deobfuscation files after bundleRelease.

AGP 8 often does not emit outputs/native-debug-symbols.zip for prebuilt
AAR .so files (ML Kit barhopper). Play still accepts a zip of
merged_native_libs/.../lib/{abi}/*.so
"""
from __future__ import annotations

import shutil
import sys
import zipfile
from pathlib import Path

ABIS = ("arm64-v8a", "armeabi-v7a", "x86", "x86_64")


def find_mapping(android_app_build: Path) -> Path | None:
    hits = list((android_app_build / "outputs" / "mapping").rglob("mapping.txt"))
    return hits[0] if hits else None


def find_official_symbols_zip(android_app_build: Path) -> Path | None:
    hits = list(android_app_build.rglob("native-debug-symbols.zip"))
    return hits[0] if hits else None


def find_merged_native_lib_dir(android_app_build: Path) -> Path | None:
    for lib in (android_app_build / "intermediates" / "merged_native_libs").rglob("lib"):
        if not lib.is_dir():
            continue
        if any((lib / abi).is_dir() for abi in ABIS):
            return lib
    return None


def zip_abi_libs(lib_dir: Path, dest_zip: Path) -> int:
    n = 0
    dest_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for abi in ABIS:
            abi_dir = lib_dir / abi
            if not abi_dir.is_dir():
                continue
            for so in sorted(abi_dir.glob("*.so")):
                zf.write(so, arcname=f"{abi}/{so.name}")
                n += 1
    return n


def collect(android_app_build: Path, dest_dir: Path) -> dict:
    dest_dir.mkdir(parents=True, exist_ok=True)
    result = {"mapping": False, "symbols": False, "symbols_source": None}

    mapping = find_mapping(android_app_build)
    if mapping:
        shutil.copy2(mapping, dest_dir / "mapping.txt")
        result["mapping"] = True

    official = find_official_symbols_zip(android_app_build)
    if official:
        shutil.copy2(official, dest_dir / "native-debug-symbols.zip")
        result["symbols"] = True
        result["symbols_source"] = "agp"
        return result

    lib_dir = find_merged_native_lib_dir(android_app_build)
    if lib_dir:
        n = zip_abi_libs(lib_dir, dest_dir / "native-debug-symbols.zip")
        if n:
            result["symbols"] = True
            result["symbols_source"] = f"merged_native_libs:{n}"
    return result


def main() -> int:
    if len(sys.argv) != 3:
        print(
            "usage: collect-play-symbols.py <android/app/build> <dest-dir>",
            file=sys.stderr,
        )
        return 2
    android_app_build = Path(sys.argv[1])
    dest = Path(sys.argv[2])
    r = collect(android_app_build, dest)
    if r["mapping"]:
        print(f"mapping.txt → {dest / 'mapping.txt'}")
    else:
        print("::warning::mapping.txt not found — R8 may have been skipped")
    if r["symbols"]:
        print(f"native-debug-symbols.zip ← {r['symbols_source']}")
    else:
        print("::warning::native-debug-symbols.zip could not be built")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
