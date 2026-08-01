#!/usr/bin/env python3
"""Copy SafeNex brand icons + notification glyph into android/ res, and ensure FCM meta-data."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow required: pip install pillow", file=sys.stderr)
    raise

ROOT = Path(__file__).resolve().parents[1]
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
MANIFEST = ROOT / "android" / "app" / "src" / "main" / "AndroidManifest.xml"
# Note: path must NOT be `.../android/...` — root .gitignore ignores any `android/` dir.
NATIVE = ROOT / "native-assets" / "android-res" / "res"
ICON_SRC = ROOT / "public" / "icon-512.png"

MIPMAPS = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def copy_native_res() -> None:
    if not NATIVE.exists():
        print("ℹ native-assets/android/res missing — skip")
        return
    for src in NATIVE.rglob("*"):
        if src.is_dir():
            continue
        rel = src.relative_to(NATIVE)
        dest = ANDROID_RES / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        print(f"✓ {rel}")


def write_launcher_icons() -> None:
    if not ICON_SRC.exists():
        print("ℹ public/icon-512.png missing — skip launcher icons")
        return
    if not ANDROID_RES.exists():
        print("ℹ android res missing — skip launcher icons")
        return
    base = Image.open(ICON_SRC).convert("RGBA")
    for folder, size in MIPMAPS.items():
        d = ANDROID_RES / folder
        d.mkdir(parents=True, exist_ok=True)
        icon = base.resize((size, size), Image.Resampling.LANCZOS)
        # solid background for legacy launcher bitmaps
        bg = Image.new("RGBA", (size, size), (11, 31, 58, 255))
        out = Image.alpha_composite(bg, icon)
        for name in ("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"):
            out.save(d / name, "PNG")
        print(f"✓ {folder} launcher {size}px")


META_ICON = """        <meta-data
            android:name="com.google.firebase.messaging.default_notification_icon"
            android:resource="@drawable/ic_stat_safenex" />
"""
META_COLOR = """        <meta-data
            android:name="com.google.firebase.messaging.default_notification_color"
            android:resource="@color/safenex_notification" />
"""


def patch_manifest() -> None:
    if not MANIFEST.exists():
        print("ℹ AndroidManifest missing — skip meta-data")
        return
    xml = MANIFEST.read_text(encoding="utf-8")
    changed = False
    if "default_notification_icon" not in xml:
        # Insert before closing </application>
        xml = xml.replace("</application>", META_ICON + META_COLOR + "    </application>")
        changed = True
    elif "default_notification_color" not in xml:
        xml = xml.replace("</application>", META_COLOR + "    </application>")
        changed = True
    if changed:
        MANIFEST.write_text(xml, encoding="utf-8")
        print("✓ FCM default_notification_icon/color meta-data")
    else:
        print("✓ FCM notification meta-data already present")


def main() -> int:
    if not (ROOT / "android").exists():
        print("ℹ android/ 없음 — cap add android 후 재실행")
        return 0
    copy_native_res()
    write_launcher_icons()
    patch_manifest()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
