package org.safenex.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Local plugins: STREAM_ALARM siren + swipe-away GPS → track-location
    registerPlugin(AlarmVolumePlugin.class);
    registerPlugin(HeadlessTrackPlugin.class);
    super.onCreate(savedInstanceState);
  }

  /**
   * Recents swipe kills the activity. If check-in armed HeadlessTrack prefs,
   * restart the 3-minute heartbeat without waiting for JS.
   */
  @Override
  public void onTaskRemoved(Intent rootIntent) {
    SharedPreferences p = getSharedPreferences(HeadlessTrackService.PREFS, MODE_PRIVATE);
    if (p.getString("project_id", "").isEmpty()) {
      super.onTaskRemoved(rootIntent);
      return;
    }
    Intent i = new Intent(this, HeadlessTrackService.class);
    i.setAction(HeadlessTrackService.ACTION_START);
    if (Build.VERSION.SDK_INT >= 26) {
      startForegroundService(i);
    } else {
      startService(i);
    }
    super.onTaskRemoved(rootIntent);
  }
}
