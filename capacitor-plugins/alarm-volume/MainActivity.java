package org.safenex.app;

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
}
