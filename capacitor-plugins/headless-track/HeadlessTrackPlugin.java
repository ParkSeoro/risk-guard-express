package org.safenex.app;

import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Starts {@link HeadlessTrackService} so GPS → track-location continues after the activity is destroyed.
 */
@CapacitorPlugin(name = "HeadlessTrack")
public class HeadlessTrackPlugin extends Plugin {
  private static final String TAG = "HeadlessTrack";

  @PluginMethod
  public void start(PluginCall call) {
    try {
      persistFromCall(call);
      startService();
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "start failed", e);
      call.reject("HeadlessTrack.start failed: " + e.getMessage());
    }
  }

  /** Persist tokens so a recents-swipe can restart GPS without a JS start. */
  @PluginMethod
  public void arm(PluginCall call) {
    try {
      persistFromCall(call);
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "arm failed", e);
      call.reject("HeadlessTrack.arm failed: " + e.getMessage());
    }
  }

  @PluginMethod
  public void stop(PluginCall call) {
    try {
      Intent i = new Intent(getContext(), HeadlessTrackService.class);
      i.setAction(HeadlessTrackService.ACTION_STOP);
      getContext().startService(i);
      getContext().stopService(new Intent(getContext(), HeadlessTrackService.class));
      boolean disarm = Boolean.TRUE.equals(call.getBoolean("disarm"));
      if (disarm) {
        HeadlessTrackService.clearConfig(getContext());
      }
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "stop failed", e);
      call.reject("HeadlessTrack.stop failed: " + e.getMessage());
    }
  }

  private void persistFromCall(PluginCall call) throws Exception {
    JSObject cfg = new JSObject();
    copy(call, cfg, "supabaseUrl");
    copy(call, cfg, "anonKey");
    copy(call, cfg, "accessToken");
    copy(call, cfg, "refreshToken");
    copy(call, cfg, "projectId");
    copy(call, cfg, "workerId");
    copy(call, cfg, "workerName");
    copy(call, cfg, "workerPhone");
    copy(call, cfg, "companyId");
    copy(call, cfg, "workerRole");
    if (call.getInt("intervalMs") != null) cfg.put("intervalMs", call.getInt("intervalMs"));
    if (call.getInt("exitStreak") != null) cfg.put("exitStreak", call.getInt("exitStreak"));
    if (call.getDouble("maxAccuracyM") != null) cfg.put("maxAccuracyM", call.getDouble("maxAccuracyM"));
    if (call.getInt("resumePollMs") != null) cfg.put("resumePollMs", call.getInt("resumePollMs"));
    if (call.getBoolean("skipFence") != null) cfg.put("skipFence", call.getBoolean("skipFence"));
    if (call.getBoolean("suppressLastPosition") != null) {
      cfg.put("suppressLastPosition", call.getBoolean("suppressLastPosition"));
    }
    if (call.getDouble("fenceLat") != null) cfg.put("fenceLat", call.getDouble("fenceLat"));
    if (call.getDouble("fenceLng") != null) cfg.put("fenceLng", call.getDouble("fenceLng"));
    if (call.getDouble("fenceRadiusM") != null) cfg.put("fenceRadiusM", call.getDouble("fenceRadiusM"));
    HeadlessTrackService.persistConfig(getContext(), new org.json.JSONObject(cfg.toString()));
  }

  private void startService() {
    Intent i = new Intent(getContext(), HeadlessTrackService.class);
    i.setAction(HeadlessTrackService.ACTION_START);
    if (Build.VERSION.SDK_INT >= 26) {
      getContext().startForegroundService(i);
    } else {
      getContext().startService(i);
    }
  }

  private static void copy(PluginCall call, JSObject cfg, String key) {
    String v = call.getString(key);
    if (v != null) cfg.put(key, v);
  }
}
