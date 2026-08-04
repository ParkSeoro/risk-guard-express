package org.safenex.app;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Danger-zone alarm: force STREAM_ALARM (+ MUSIC for TTS) to max volume,
 * play siren via USAGE_ALARM so silent/vibrate modes still hear it when possible.
 *
 * Web/PWA cannot do this — only the Capacitor Android shell.
 */
@CapacitorPlugin(name = "AlarmVolume")
public class AlarmVolumePlugin extends Plugin {
  private static final String TAG = "AlarmVolume";

  private Integer prevAlarmVol = null;
  private Integer prevMusicVol = null;
  private boolean boosted = false;
  private MediaPlayer mediaPlayer = null;
  private ToneGenerator toneGenerator = null;
  private TextToSpeech tts = null;
  private boolean ttsReady = false;
  private final Object ttsLock = new Object();

  @PluginMethod
  public void boostMax(PluginCall call) {
    try {
      AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
      if (am == null) {
        call.reject("AudioManager unavailable");
        return;
      }
      if (!boosted) {
        prevAlarmVol = am.getStreamVolume(AudioManager.STREAM_ALARM);
        prevMusicVol = am.getStreamVolume(AudioManager.STREAM_MUSIC);
        boosted = true;
      }
      int maxAlarm = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
      int maxMusic = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
      // 0 = no UI toast; raise alarm + media (TTS uses media in WebView)
      am.setStreamVolume(AudioManager.STREAM_ALARM, maxAlarm, 0);
      am.setStreamVolume(AudioManager.STREAM_MUSIC, maxMusic, 0);

      // Prefer ringer modes that allow alarm stream (alarm usually bypasses silent)
      // Do not change ringer mode permanently — STREAM_ALARM is the intended bypass.

      JSObject ret = new JSObject();
      ret.put("ok", true);
      ret.put("previousAlarm", prevAlarmVol);
      ret.put("previousMusic", prevMusicVol);
      ret.put("maxAlarm", maxAlarm);
      ret.put("maxMusic", maxMusic);
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "boostMax failed", e);
      call.reject("boostMax failed: " + e.getMessage());
    }
  }

  @PluginMethod
  public void restore(PluginCall call) {
    try {
      stopPlayers();
      AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
      if (am != null && boosted) {
        if (prevAlarmVol != null) {
          am.setStreamVolume(AudioManager.STREAM_ALARM, prevAlarmVol, 0);
        }
        if (prevMusicVol != null) {
          am.setStreamVolume(AudioManager.STREAM_MUSIC, prevMusicVol, 0);
        }
      }
      boosted = false;
      prevAlarmVol = null;
      prevMusicVol = null;
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "restore failed", e);
      call.reject("restore failed: " + e.getMessage());
    }
  }

  @PluginMethod
  public void playSiren(PluginCall call) {
    int durationMs = call.getInt("durationMs", 2000);
    try {
      stopPlayers();
      boolean playedFile = playSirenFromAssets(durationMs);
      if (!playedFile) {
        playSirenTone(durationMs);
      }
      // Keep call open until duration roughly ends so JS can await
      getBridge().getActivity().runOnUiThread(() -> {
        // no-op; resolve immediately after start — JS waits SIREN_DURATION
      });
      JSObject ret = new JSObject();
      ret.put("ok", true);
      ret.put("source", playedFile ? "asset" : "tone");
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "playSiren failed", e);
      try {
        playSirenTone(durationMs);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("source", "tone-fallback");
        call.resolve(ret);
      } catch (Exception e2) {
        call.reject("playSiren failed: " + e2.getMessage());
      }
    }
  }

  @PluginMethod
  public void speak(PluginCall call) {
    final String text = call.getString("text", "");
    final String lang = call.getString("lang", "ko-KR");
    if (text == null || text.trim().isEmpty()) {
      call.reject("text required");
      return;
    }
    getBridge().getActivity().runOnUiThread(() -> ensureTtsAndSpeak(call, text.trim(), lang));
  }

  private void ensureTtsAndSpeak(PluginCall call, String text, String lang) {
    synchronized (ttsLock) {
      if (tts != null && ttsReady) {
        doSpeak(call, text, lang);
        return;
      }
      if (tts != null) {
        try {
          tts.stop();
          tts.shutdown();
        } catch (Exception ignored) {}
        tts = null;
        ttsReady = false;
      }
      tts = new TextToSpeech(getContext(), status -> {
        synchronized (ttsLock) {
          ttsReady = status == TextToSpeech.SUCCESS;
          if (!ttsReady) {
            call.resolve(speakResult(false, "tts-init-failed"));
            return;
          }
          doSpeak(call, text, lang);
        }
      });
    }
  }

  private void doSpeak(PluginCall call, String text, String lang) {
    try {
      if (tts == null) {
        call.resolve(speakResult(false, "tts-null"));
        return;
      }
      Locale locale = localeFromTag(lang);
      int avail = tts.isLanguageAvailable(locale);
      if (avail < TextToSpeech.LANG_AVAILABLE) {
        locale = Locale.KOREAN;
        avail = tts.isLanguageAvailable(locale);
      }
      if (avail >= TextToSpeech.LANG_AVAILABLE) {
        tts.setLanguage(locale);
      }
      tts.setSpeechRate(0.95f);
      tts.setPitch(1.05f);

      final String utteranceId = "safenex-danger-" + System.currentTimeMillis();
      final AtomicBoolean settled = new AtomicBoolean(false);
      final java.util.function.BiConsumer<Boolean, String> finish = (ok, source) -> {
        if (!settled.compareAndSet(false, true)) return;
        try {
          call.resolve(speakResult(ok, source));
        } catch (Exception ignored) {}
      };
      tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
        @Override
        public void onStart(String utteranceId) {}

        @Override
        public void onDone(String utteranceId) {
          finish.accept(true, "android-tts");
        }

        @Override
        public void onError(String utteranceId) {
          finish.accept(false, "tts-error");
        }
      });

      Bundle params = new Bundle();
      params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);
      int queued = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
      if (queued == TextToSpeech.ERROR) {
        finish.accept(false, "tts-queue-error");
        return;
      }
      // Safety resolve if listener never fires
      new android.os.Handler(getContext().getMainLooper()).postDelayed(
        () -> finish.accept(true, "android-tts-timeout"),
        20_000
      );
    } catch (Exception e) {
      Log.e(TAG, "speak failed", e);
      call.resolve(speakResult(false, e.getMessage()));
    }
  }

  private static JSObject speakResult(boolean ok, String source) {
    JSObject ret = new JSObject();
    ret.put("ok", ok);
    ret.put("source", source);
    return ret;
  }

  private static Locale localeFromTag(String tag) {
    if (tag == null || tag.isEmpty()) return Locale.KOREAN;
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        return Locale.forLanguageTag(tag.replace('_', '-'));
      }
    } catch (Exception ignored) {}
    return Locale.KOREAN;
  }

  @PluginMethod
  public void vibrate(PluginCall call) {
    try {
      // pattern: wait, vibe, wait, vibe... (ms)
      long[] pattern = new long[] { 0, 400, 200, 400, 200, 600, 200, 400 };
      Vibrator vibrator;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        VibratorManager vm = (VibratorManager) getContext().getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
        vibrator = vm != null ? vm.getDefaultVibrator() : null;
      } else {
        vibrator = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
      }
      if (vibrator == null || !vibrator.hasVibrator()) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        call.resolve(ret);
        return;
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
      } else {
        vibrator.vibrate(pattern, -1);
      }
      JSObject ret = new JSObject();
      ret.put("ok", true);
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "vibrate failed", e);
      call.reject("vibrate failed: " + e.getMessage());
    }
  }

  @PluginMethod
  public void stop(PluginCall call) {
    stopPlayers();
    JSObject ret = new JSObject();
    ret.put("ok", true);
    call.resolve(ret);
  }

  private boolean playSirenFromAssets(int durationMs) {
    String[] candidates = new String[] {
      "public/sounds/siren.wav",
      "sounds/siren.wav",
    };
    for (String path : candidates) {
      try {
        AssetFileDescriptor afd = getContext().getAssets().openFd(path);
        MediaPlayer mp = new MediaPlayer();
        mp.setAudioAttributes(
          new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        );
        mp.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
        afd.close();
        mp.setVolume(1.0f, 1.0f);
        mp.setLooping(false);
        mp.prepare();
        mp.start();
        mediaPlayer = mp;
        // Stop after duration
        new android.os.Handler(getContext().getMainLooper()).postDelayed(() -> {
          try {
            if (mediaPlayer == mp) {
              if (mp.isPlaying()) mp.stop();
              mp.release();
              if (mediaPlayer == mp) mediaPlayer = null;
            }
          } catch (Exception ignored) {}
        }, durationMs);
        return true;
      } catch (Exception e) {
        Log.w(TAG, "asset siren miss: " + path + " — " + e.getMessage());
      }
    }
    return false;
  }

  private void playSirenTone(int durationMs) {
    // ToneGenerator volume 0–100 relative to STREAM_ALARM
    toneGenerator = new ToneGenerator(AudioManager.STREAM_ALARM, 100);
    toneGenerator.startTone(ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK, durationMs);
    new android.os.Handler(getContext().getMainLooper()).postDelayed(() -> {
      try {
        if (toneGenerator != null) {
          toneGenerator.stopTone();
          toneGenerator.release();
          toneGenerator = null;
        }
      } catch (Exception ignored) {}
    }, durationMs + 50);
  }

  private void stopPlayers() {
    try {
      if (mediaPlayer != null) {
        if (mediaPlayer.isPlaying()) mediaPlayer.stop();
        mediaPlayer.release();
      }
    } catch (Exception ignored) {}
    mediaPlayer = null;
    try {
      if (toneGenerator != null) {
        toneGenerator.stopTone();
        toneGenerator.release();
      }
    } catch (Exception ignored) {}
    toneGenerator = null;
    try {
      if (tts != null) {
        tts.stop();
      }
    } catch (Exception ignored) {}
  }

  private void shutdownTts() {
    synchronized (ttsLock) {
      try {
        if (tts != null) {
          tts.stop();
          tts.shutdown();
        }
      } catch (Exception ignored) {}
      tts = null;
      ttsReady = false;
    }
  }

  @Override
  protected void handleOnDestroy() {
    stopPlayers();
    shutdownTts();
    // Best-effort restore if activity dies mid-alarm
    try {
      AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
      if (am != null && boosted) {
        if (prevAlarmVol != null) am.setStreamVolume(AudioManager.STREAM_ALARM, prevAlarmVol, 0);
        if (prevMusicVol != null) am.setStreamVolume(AudioManager.STREAM_MUSIC, prevMusicVol, 0);
      }
    } catch (Exception ignored) {}
    boosted = false;
    super.handleOnDestroy();
  }
}
