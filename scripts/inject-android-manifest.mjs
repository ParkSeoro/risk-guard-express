#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { injectAndroidManifest } from "./android-manifest-inject.mjs";

const path = process.argv[2] || "android/app/src/main/AndroidManifest.xml";
if (!existsSync(path)) {
  throw new Error(`AndroidManifest not found: ${path}`);
}
const next = injectAndroidManifest(readFileSync(path, "utf8"));
writeFileSync(path, next);
console.log("Manifest permission inject OK:", path);
