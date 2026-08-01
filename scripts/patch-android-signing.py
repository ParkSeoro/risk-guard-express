#!/usr/bin/env python3
"""Inject release signingConfigs into android/app/build.gradle if missing."""
from __future__ import annotations

import re
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: patch-android-signing.py <build.gradle>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    s = open(path, encoding="utf-8").read()
    if "signingConfigs {" in s:
        print("signingConfigs already present; skip")
        return 0
    sign = """
    signingConfigs {
        release {
            storeFile file('release.jks')
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_KEY_PASSWORD')
        }
    }"""
    s2, n1 = re.subn(r"android\s*\{", "android {" + sign, s, count=1)
    s3, n2 = re.subn(
        r"buildTypes\s*\{\s*release\s*\{",
        "buildTypes {\n        release {\n            signingConfig signingConfigs.release",
        s2,
        count=1,
    )
    if n1 != 1 or n2 != 1:
        print(
            f"error: expected one android{{}} and one release buildType (got {n1}, {n2})",
            file=sys.stderr,
        )
        return 1
    open(path, "w", encoding="utf-8").write(s3)
    print("signingConfigs injected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
