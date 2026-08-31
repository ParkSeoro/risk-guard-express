import { describe, expect, it } from "vitest";
import { injectAndroidManifest } from "../../scripts/android-manifest-inject.mjs";

const CAPACITOR_STUB = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name">
        <activity android:name=".MainActivity" />
    </application>
</manifest>
`;

describe("injectAndroidManifest", () => {
  it("adds ACCESS_FINE_LOCATION to a Capacitor template", () => {
    const out = injectAndroidManifest(CAPACITOR_STUB);
    expect(out).toContain("android.permission.ACCESS_FINE_LOCATION");
    expect(out).toContain("android.permission.ACCESS_BACKGROUND_LOCATION");
    expect(out).toContain("android.permission.FOREGROUND_SERVICE_LOCATION");
    expect(out).toContain("android.permission.POST_NOTIFICATIONS");
    expect(out).toContain("android.permission.CAMERA");
    expect(out).toContain("HeadlessTrackService");
    expect(out).toContain("com.google.mlkit.vision.DEPENDENCIES");
    expect(out).toContain("xmlns:tools=");
    expect(out).toContain(
      "com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity",
    );
    expect(out).toContain('tools:replace="android:screenOrientation"');
    expect(out).toContain('android:screenOrientation="fullSensor"');
  });

  it("is idempotent", () => {
    const once = injectAndroidManifest(CAPACITOR_STUB);
    const twice = injectAndroidManifest(once);
    expect(twice).toBe(once);
  });
});
