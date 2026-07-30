package org.safenex.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Local plugin: Android STREAM_ALARM max-volume danger siren
    registerPlugin(AlarmVolumePlugin.class);
    super.onCreate(savedInstanceState);
  }
}
