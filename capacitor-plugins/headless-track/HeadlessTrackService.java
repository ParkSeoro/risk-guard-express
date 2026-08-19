package org.safenex.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Sticky foreground GPS that posts to track-location without the WebView.
 * Survives activity destroy / recents swipe (unlike BackgroundGeolocation's bound service).
 */
public class HeadlessTrackService extends Service implements LocationListener {
  public static final String PREFS = "safenex_headless_track";
  public static final String ACTION_START = "org.safenex.app.HEADLESS_TRACK_START";
  public static final String ACTION_STOP = "org.safenex.app.HEADLESS_TRACK_STOP";
  private static final String TAG = "HeadlessTrack";
  private static final String CHANNEL_ID = "safenex_location";
  private static final int NOTIF_ID = 7101;
  private static final double EARTH_M = 6371000.0;

  private LocationManager locationManager;
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private final Handler main = new Handler(Looper.getMainLooper());
  private long lastSentAt = 0;
  private int outsideStreak = 0;
  /** True = no track-location posts; GPS interval is resumePollMs until back inside. */
  private volatile boolean watchMode = false;
  private volatile boolean running = false;

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && ACTION_STOP.equals(intent.getAction())) {
      running = false;
      stopSelf();
      return START_NOT_STICKY;
    }
    running = true;
    // If FGS promotion fails (revoked location, OEM GPS off, etc.) do NOT
    // START_STICKY — that is the "Safenex keeps stopping" crash loop.
    if (!startAsForeground()) {
      running = false;
      stopSelf();
      return START_NOT_STICKY;
    }
    applyLocationUpdates();
    return START_STICKY;
  }

  @Override
  public void onDestroy() {
    running = false;
    stopUpdates();
    io.shutdownNow();
    super.onDestroy();
  }

  /** @return false if we must not keep the process alive */
  private boolean startAsForeground() {
    try {
      ensureChannel();
      Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
      PendingIntent pi = launch == null
          ? null
          : PendingIntent.getActivity(
              this,
              0,
              launch,
              PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

      Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
          .setContentTitle("SafeNex 위치 추적")
          .setContentText("앱을 닫아도 현장 위험구역 감지를 유지합니다")
          .setSmallIcon(android.R.drawable.ic_menu_mylocation)
          .setOngoing(true)
          .setContentIntent(pi)
          .setPriority(NotificationCompat.PRIORITY_LOW)
          .build();

      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
      } else {
        startForeground(NOTIF_ID, n);
      }
      return true;
    } catch (Exception e) {
      Log.e(TAG, "startForeground failed — stopping to avoid crash loop", e);
      return false;
    }
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    NotificationChannel ch = new NotificationChannel(
        CHANNEL_ID,
        "위치 추적",
        NotificationManager.IMPORTANCE_LOW);
    ch.setDescription("현장 위험구역 GPS 추적");
    nm.createNotificationChannel(ch);
  }

  private void setWatchMode(boolean next) {
    if (watchMode == next) return;
    watchMode = next;
    if (running) main.post(this::applyLocationUpdates);
  }

  private boolean providerUsable(String name) {
    try {
      if (locationManager == null) return false;
      if (!locationManager.getAllProviders().contains(name)) return false;
      return locationManager.isProviderEnabled(name);
    } catch (Exception e) {
      return false;
    }
  }

  private void requestSafe(String provider, long minTime, float minDist) {
    if (!providerUsable(provider)) return;
    try {
      locationManager.requestLocationUpdates(provider, minTime, minDist, this, Looper.getMainLooper());
    } catch (SecurityException e) {
      Log.w(TAG, "no location permission for " + provider, e);
    } catch (IllegalArgumentException e) {
      Log.w(TAG, "provider unavailable: " + provider, e);
    } catch (Exception e) {
      Log.w(TAG, "requestLocationUpdates failed: " + provider, e);
    }
  }

  private void applyLocationUpdates() {
    if (!running) return;
    try {
      if (locationManager == null) {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
      }
      if (locationManager == null) return;
      try {
        locationManager.removeUpdates(this);
      } catch (Exception ignored) {
      }
      SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
      long minTime = watchMode
          ? Math.max(30_000, p.getInt("resume_poll_ms", 300_000))
          : Math.max(5_000, p.getInt("interval_ms", 45_000));
      float minDist = watchMode ? 40f : 8f;
      // Never assume GPS exists — missing provider throws and START_STICKY loops
      // the process ("Safenex keeps stopping") on many Korean OEM phones.
      requestSafe(LocationManager.GPS_PROVIDER, minTime, minDist);
      requestSafe(LocationManager.NETWORK_PROVIDER, Math.max(minTime, 20_000), watchMode ? 50f : 15f);
      if (!providerUsable(LocationManager.GPS_PROVIDER)
          && !providerUsable(LocationManager.NETWORK_PROVIDER)) {
        requestSafe(LocationManager.PASSIVE_PROVIDER, minTime, minDist);
      }
    } catch (Exception e) {
      Log.w(TAG, "applyLocationUpdates failed", e);
    }
  }

  private void stopUpdates() {
    try {
      if (locationManager != null) locationManager.removeUpdates(this);
    } catch (Exception ignored) {
    }
  }

  @Override
  public void onLocationChanged(@NonNull Location location) {
    if (!running) return;
    try {
      io.execute(() -> {
        if (!running) return;
        postFix(location);
      });
    } catch (Exception e) {
      Log.w(TAG, "drop location after shutdown", e);
    }
  }

  @Override
  public void onStatusChanged(String provider, int status, Bundle extras) {}

  @Override
  public void onProviderEnabled(@NonNull String provider) {}

  @Override
  public void onProviderDisabled(@NonNull String provider) {}

  private void postFix(Location loc) {
    SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
    String url = p.getString("supabase_url", "");
    String anon = p.getString("anon_key", "");
    String access = p.getString("access_token", "");
    String refresh = p.getString("refresh_token", "");
    String projectId = p.getString("project_id", "");
    if (url.isEmpty() || anon.isEmpty() || access.isEmpty() || projectId.isEmpty()) {
      return;
    }

    double lat = loc.getLatitude();
    double lng = loc.getLongitude();
    float acc = loc.hasAccuracy() ? loc.getAccuracy() : 30f;

    double fenceLat = Double.longBitsToDouble(p.getLong("fence_lat_bits", 0));
    double fenceLng = Double.longBitsToDouble(p.getLong("fence_lng_bits", 0));
    float fenceR = p.getFloat("fence_radius_m", 0f);
    boolean skipFence = p.getBoolean("skip_fence", false);
    int exitStreakNeed = Math.max(1, p.getInt("exit_streak", 5));
    float maxAcc = p.getFloat("max_accuracy_m", 55f);
    // Same hysteresis as TS isDefinitelyOutsideSite / isInsideResumeFence:
    // leave uses radius + accuracy pad; resume requires being inside radius with a good fix.
    if (!skipFence && fenceR > 0 && fenceLat != 0 && fenceLng != 0) {
      double d = haversineM(fenceLat, fenceLng, lat, lng);
      boolean accOk = acc <= maxAcc;
      boolean definitelyOutside = accOk && d > fenceR + Math.max(acc, 25f);
      boolean insideResume = accOk && d <= fenceR;
      if (watchMode) {
        if (insideResume) {
          Log.i(TAG, "re-entered site fence — resuming posts");
          outsideStreak = 0;
          setWatchMode(false);
        } else {
          return;
        }
      } else if (definitelyOutside) {
        outsideStreak += 1;
        if (outsideStreak >= exitStreakNeed) {
          Log.i(TAG, "left site fence — low-power watch (no stopSelf)");
          outsideStreak = 0;
          setWatchMode(true);
          return;
        }
      } else {
        outsideStreak = 0;
      }
    } else if (watchMode && skipFence) {
      outsideStreak = 0;
      setWatchMode(false);
    }

    long now = System.currentTimeMillis();
    int intervalMs = p.getInt("interval_ms", 45_000);
    if (now - lastSentAt < intervalMs) return;
    lastSentAt = now;

    try {
      JSONObject body = new JSONObject();
      body.put("project_id", projectId);
      if (p.contains("worker_id")) body.put("worker_id", p.getString("worker_id", JSONObject.NULL.toString()));
      putOpt(body, "worker_name", p.getString("worker_name", null));
      putOpt(body, "worker_phone", p.getString("worker_phone", null));
      putOpt(body, "company_id", p.getString("company_id", null));
      putOpt(body, "worker_role", p.getString("worker_role", null));
      body.put("lat", lat);
      body.put("lng", lng);
      body.put("accuracy_m", acc);
      if (p.getBoolean("suppress_last_position", false)) {
        body.put("suppress_last_position", true);
      }
      body.put("device_ts", new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
          .format(new java.util.Date(now)));

      int code = postJson(url + "/functions/v1/track-location", anon, access, body.toString());
      if (code == 401 && refresh != null && !refresh.isEmpty()) {
        String next = refreshAccess(url, anon, refresh);
        if (next != null) {
          p.edit().putString("access_token", next).apply();
          postJson(url + "/functions/v1/track-location", anon, next, body.toString());
        }
      }
    } catch (Exception e) {
      Log.w(TAG, "postFix failed", e);
    }
  }

  private static void putOpt(JSONObject body, String key, String val) throws Exception {
    if (val != null && !val.isEmpty() && !"null".equals(val)) body.put(key, val);
  }

  private String refreshAccess(String supabaseUrl, String anon, String refreshToken) {
    try {
      JSONObject body = new JSONObject();
      body.put("refresh_token", refreshToken);
      String resp = postJsonBody(
          supabaseUrl + "/auth/v1/token?grant_type=refresh_token",
          anon,
          anon,
          body.toString());
      if (resp == null) return null;
      JSONObject j = new JSONObject(resp);
      String access = j.optString("access_token", "");
      String nextRefresh = j.optString("refresh_token", "");
      if (!access.isEmpty() && !nextRefresh.isEmpty()) {
        getSharedPreferences(PREFS, MODE_PRIVATE)
            .edit()
            .putString("refresh_token", nextRefresh)
            .apply();
      }
      return access.isEmpty() ? null : access;
    } catch (Exception e) {
      Log.w(TAG, "refresh failed", e);
      return null;
    }
  }

  private int postJson(String url, String apikey, String bearer, String json) throws Exception {
    HttpURLConnection c = open(url, apikey, bearer);
    try {
      byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
      c.setFixedLengthStreamingMode(bytes.length);
      OutputStream os = c.getOutputStream();
      os.write(bytes);
      os.flush();
      int code = c.getResponseCode();
      Log.d(TAG, "track-location HTTP " + code);
      return code;
    } finally {
      c.disconnect();
    }
  }

  private String postJsonBody(String url, String apikey, String bearer, String json) throws Exception {
    HttpURLConnection c = open(url, apikey, bearer);
    try {
      byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
      c.setFixedLengthStreamingMode(bytes.length);
      OutputStream os = c.getOutputStream();
      os.write(bytes);
      os.flush();
      int code = c.getResponseCode();
      java.io.InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
      if (in == null) return null;
      Scanner s = new Scanner(in, StandardCharsets.UTF_8.name()).useDelimiter("\\A");
      return s.hasNext() ? s.next() : null;
    } finally {
      c.disconnect();
    }
  }

  private HttpURLConnection open(String url, String apikey, String bearer) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setConnectTimeout(12_000);
    c.setReadTimeout(20_000);
    c.setRequestMethod("POST");
    c.setDoOutput(true);
    c.setRequestProperty("Content-Type", "application/json");
    c.setRequestProperty("apikey", apikey);
    c.setRequestProperty("Authorization", "Bearer " + bearer);
    return c;
  }

  private static double haversineM(double lat1, double lng1, double lat2, double lng2) {
    double rlat1 = Math.toRadians(lat1);
    double rlat2 = Math.toRadians(lat2);
    double dLat = Math.toRadians(lat2 - lat1);
    double dLng = Math.toRadians(lng2 - lng1);
    double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_M * Math.asin(Math.sqrt(a));
  }

  public static void persistConfig(Context ctx, JSONObject cfg) {
    SharedPreferences.Editor e = ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit();
    e.putString("supabase_url", cfg.optString("supabaseUrl"));
    e.putString("anon_key", cfg.optString("anonKey"));
    e.putString("access_token", cfg.optString("accessToken"));
    e.putString("refresh_token", cfg.optString("refreshToken"));
    e.putString("project_id", cfg.optString("projectId"));
    putStr(e, "worker_id", cfg.optString("workerId", null));
    putStr(e, "worker_name", cfg.optString("workerName", null));
    putStr(e, "worker_phone", cfg.optString("workerPhone", null));
    putStr(e, "company_id", cfg.optString("companyId", null));
    putStr(e, "worker_role", cfg.optString("workerRole", null));
    e.putInt("interval_ms", cfg.optInt("intervalMs", 45_000));
    e.putInt("exit_streak", cfg.optInt("exitStreak", 5));
    e.putFloat("max_accuracy_m", (float) cfg.optDouble("maxAccuracyM", 55));
    e.putInt("resume_poll_ms", cfg.optInt("resumePollMs", 300_000));
    e.putBoolean("skip_fence", cfg.optBoolean("skipFence", false));
    e.putBoolean("suppress_last_position", cfg.optBoolean("suppressLastPosition", false));
    if (cfg.has("fenceLat") && cfg.has("fenceLng") && cfg.has("fenceRadiusM")) {
      e.putLong("fence_lat_bits", Double.doubleToRawLongBits(cfg.optDouble("fenceLat")));
      e.putLong("fence_lng_bits", Double.doubleToRawLongBits(cfg.optDouble("fenceLng")));
      e.putFloat("fence_radius_m", (float) cfg.optDouble("fenceRadiusM"));
    } else {
      e.remove("fence_lat_bits");
      e.remove("fence_lng_bits");
      e.remove("fence_radius_m");
    }
    e.apply();
  }

  private static void putStr(SharedPreferences.Editor e, String k, String v) {
    if (v == null || v.isEmpty() || "null".equals(v)) e.remove(k);
    else e.putString(k, v);
  }

  public static void clearConfig(Context ctx) {
    ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().clear().apply();
  }
}
