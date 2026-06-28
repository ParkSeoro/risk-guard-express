#!/usr/bin/env node
/**
 * 네이티브 빌드 전, iOS Info.plist / Android Manifest 에 필수 권한을
 * 자동으로 주입합니다. `npx cap add ios/android` 후 한 번 실행하세요.
 *
 * 사용: node scripts/prepare-native.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

// ---------- iOS Info.plist ----------
const plistPath = resolve(root, "ios/App/App/Info.plist");
if (existsSync(plistPath)) {
  let plist = readFileSync(plistPath, "utf8");
  const inserts = [
    [
      "NSLocationAlwaysAndWhenInUseUsageDescription",
      "근무 중 위치 안전 관리를 위해 백그라운드 위치 권한이 필요합니다.",
    ],
    [
      "NSLocationWhenInUseUsageDescription",
      "출퇴근 QR 체크인 시 현장 위치를 확인합니다.",
    ],
    ["NSCameraUsageDescription", "QR 스캔과 안전 점검 사진 첨부에 사용됩니다."],
    ["NSPhotoLibraryUsageDescription", "안전 점검 증빙 사진 업로드에 사용됩니다."],
    ["NSMotionUsageDescription", "낙상·이상행동 감지에 사용됩니다."],
  ];
  for (const [key, desc] of inserts) {
    if (!plist.includes(`<key>${key}</key>`)) {
      plist = plist.replace(
        "</dict>\n</plist>",
        `\t<key>${key}</key>\n\t<string>${desc}</string>\n</dict>\n</plist>`,
      );
    }
  }
  if (!plist.includes("<key>UIBackgroundModes</key>")) {
    plist = plist.replace(
      "</dict>\n</plist>",
      "\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>location</string>\n\t\t<string>fetch</string>\n\t\t<string>remote-notification</string>\n\t</array>\n</dict>\n</plist>",
    );
  }
  writeFileSync(plistPath, plist);
  console.log("✓ iOS Info.plist 권한 주입 완료");
} else {
  console.log("ℹ ios/ 폴더가 없어 iOS 단계 건너뜀 (npx cap add ios 후 재실행하세요)");
}

// ---------- Android Manifest ----------
const manifestPath = resolve(root, "android/app/src/main/AndroidManifest.xml");
if (existsSync(manifestPath)) {
  let xml = readFileSync(manifestPath, "utf8");
  const perms = [
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_LOCATION",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.CAMERA",
    "android.permission.INTERNET",
  ];
  for (const p of perms) {
    if (!xml.includes(p)) {
      xml = xml.replace(
        "<application",
        `<uses-permission android:name="${p}"/>\n    <application`,
      );
    }
  }
  writeFileSync(manifestPath, xml);
  console.log("✓ Android Manifest 권한 주입 완료");
} else {
  console.log(
    "ℹ android/ 폴더가 없어 Android 단계 건너뜀 (npx cap add android 후 재실행하세요)",
  );
}

console.log("\n다음 단계: npm run build && npx cap sync");
