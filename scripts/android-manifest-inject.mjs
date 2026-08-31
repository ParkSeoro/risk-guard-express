export const ANDROID_RUNTIME_PERMS = [
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_LOCATION",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.CAMERA",
  "android.permission.INTERNET",
];

const HEADLESS_SERVICE = `        <service
            android:name="org.safenex.app.HeadlessTrackService"
            android:exported="false"
            android:foregroundServiceType="location"
            android:stopWithTask="false" />
`;

const MLKIT_SCANNER_ACTIVITY =
  "com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity";

const MLKIT_SCANNER_OVERRIDE = `        <activity
            android:name="${MLKIT_SCANNER_ACTIVITY}"
            android:screenOrientation="fullSensor"
            tools:replace="android:screenOrientation" />
`;

function ensureToolsNamespace(xml) {
  if (xml.includes("xmlns:tools=")) return xml;
  const androidNs = 'xmlns:android="http://schemas.android.com/apk/res/android"';
  if (!xml.includes(androidNs)) {
    throw new Error("Cannot add tools namespace: AndroidManifest has no android xmlns");
  }
  return xml.replace(
    androidNs,
    `${androidNs}\n    xmlns:tools="http://schemas.android.com/tools"`,
  );
}

/** Insert GPS / camera / FCM permissions + HeadlessTrack into the app manifest. */
export function injectAndroidManifest(xml) {
  let next = ensureToolsNamespace(xml);
  for (const p of ANDROID_RUNTIME_PERMS) {
    if (next.includes(p)) continue;
    const tag = `    <uses-permission android:name="${p}" />\n`;
    if (!/<application\b/.test(next)) {
      throw new Error(`Cannot inject ${p}: AndroidManifest has no <application> tag`);
    }
    next = next.replace(/<application\b/, `${tag}    <application`);
  }
  if (!next.includes("com.google.mlkit.vision.DEPENDENCIES")) {
    if (!/(<application\b[^>]*>)/.test(next)) {
      throw new Error("Cannot inject ML Kit meta-data: no <application> opening tag");
    }
    next = next.replace(
      /(<application\b[^>]*>)/,
      `$1\n        <meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="barcode_ui"/>`,
    );
  }
  if (!next.includes("HeadlessTrackService")) {
    if (!next.includes("</application>")) {
      throw new Error("Cannot register HeadlessTrackService: no </application>");
    }
    next = next.replace("</application>", `${HEADLESS_SERVICE}    </application>`);
  }
  if (!next.includes(MLKIT_SCANNER_ACTIVITY)) {
    if (!next.includes("</application>")) {
      throw new Error("Cannot override ML Kit scanner activity: no </application>");
    }
    next = next.replace("</application>", `${MLKIT_SCANNER_OVERRIDE}    </application>`);
  }
  return next;
}
