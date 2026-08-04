import Foundation
import AVFoundation
import AudioToolbox
import UIKit
import UserNotifications
import Capacitor

/**
 * iOS AlarmVolume — danger-zone alarm helpers.
 *
 * - AVAudioSession .playback ignores the hardware mute switch (still follows volume rocker).
 * - Critical Alerts: requestAuthorization(.criticalAlert) only when Info.plist
 *   SafenexCriticalAlertsEnabled == true AND Apple entitlement is granted.
 * - System volume cannot be forced on iOS; we play at player volume 1.0 and
 *   rely on Critical Alerts push for silent-mode breakthrough when entitled.
 */
@objc(AlarmVolumePlugin)
public class AlarmVolumePlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "AlarmVolumePlugin"
  public let jsName = "AlarmVolume"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "boostMax", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "playSiren", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "vibrate", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "requestCriticalAlerts", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "criticalAlertsStatus", returnType: CAPPluginReturnPromise),
  ]

  private var player: AVAudioPlayer?
  private var previousCategory: AVAudioSession.Category?
  private var previousMode: AVAudioSession.Mode?
  private var previousOptions: AVAudioSession.CategoryOptions?
  private var sessionArmed = false
  private let synthesizer = AVSpeechSynthesizer()
  private var speakDelegate: SpeakDelegate?

  @objc func boostMax(_ call: CAPPluginCall) {
    do {
      let session = AVAudioSession.sharedInstance()
      if !sessionArmed {
        previousCategory = session.category
        previousMode = session.mode
        previousOptions = session.categoryOptions
        sessionArmed = true
      }
      // Playback category ignores mute switch; mix/duck so alert is dominant
      try session.setCategory(
        .playback,
        mode: .default,
        options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers]
      )
      try session.setActive(true, options: [])
      call.resolve([
        "ok": true,
        "note": "iOS cannot set hardware volume; session armed for playback (mute-switch bypass)",
      ])
    } catch {
      call.reject("boostMax failed: \(error.localizedDescription)")
    }
  }

  @objc func restore(_ call: CAPPluginCall) {
    stopPlayers()
    do {
      let session = AVAudioSession.sharedInstance()
      if sessionArmed, let cat = previousCategory {
        try session.setCategory(cat, mode: previousMode ?? .default, options: previousOptions ?? [])
      }
      try session.setActive(false, options: [.notifyOthersOnDeactivation])
    } catch {
      // Non-fatal — other audio may reclaim session
      print("[AlarmVolume] restore session: \(error)")
    }
    sessionArmed = false
    previousCategory = nil
    call.resolve(["ok": true])
  }

  @objc func playSiren(_ call: CAPPluginCall) {
    let durationMs = call.getInt("durationMs") ?? 2000
    do {
      _ = try? AVAudioSession.sharedInstance().setCategory(
        .playback,
        mode: .default,
        options: [.duckOthers]
      )
      try? AVAudioSession.sharedInstance().setActive(true)

      var played = false
      let candidates = [
        Bundle.main.url(forResource: "siren", withExtension: "wav", subdirectory: "public/sounds"),
        Bundle.main.url(forResource: "siren", withExtension: "wav", subdirectory: "sounds"),
        Bundle.main.url(forResource: "siren", withExtension: "wav"),
        Bundle.main.resourceURL?.appendingPathComponent("public/sounds/siren.wav"),
      ].compactMap { $0 }

      for url in candidates {
        if FileManager.default.fileExists(atPath: url.path) {
          let p = try AVAudioPlayer(contentsOf: url)
          p.volume = 1.0
          p.numberOfLoops = 0
          p.prepareToPlay()
          p.play()
          player = p
          played = true
          break
        }
      }

      if !played {
        // System sound fallback (short) + keep session hot for TTS
        AudioServicesPlaySystemSound(1005) // SMS / alert-like
      }

      DispatchQueue.main.asyncAfter(deadline: .now() + Double(durationMs) / 1000.0) { [weak self] in
        self?.player?.stop()
        self?.player = nil
      }

      call.resolve(["ok": true, "source": played ? "asset" : "system"])
    } catch {
      call.reject("playSiren failed: \(error.localizedDescription)")
    }
  }

  @objc func speak(_ call: CAPPluginCall) {
    guard let text = call.getString("text"), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      call.reject("text required")
      return
    }
    let lang = call.getString("lang") ?? "ko-KR"
    do {
      _ = try? AVAudioSession.sharedInstance().setCategory(
        .playback,
        mode: .default,
        options: [.duckOthers]
      )
      try? AVAudioSession.sharedInstance().setActive(true)
    }

    synthesizer.stopSpeaking(at: .immediate)
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = AVSpeechSynthesisVoice(language: lang)
      ?? AVSpeechSynthesisVoice(language: "ko-KR")
    utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
    utterance.pitchMultiplier = 1.05
    utterance.volume = 1.0

    let delegate = SpeakDelegate { [weak self] ok in
      call.resolve(["ok": ok, "source": "ios-avspeech"])
      self?.speakDelegate = nil
    }
    speakDelegate = delegate
    synthesizer.delegate = delegate
    synthesizer.speak(utterance)

    // Safety timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
      if self?.speakDelegate === delegate {
        call.resolve(["ok": true, "source": "ios-avspeech-timeout"])
        self?.speakDelegate = nil
      }
    }
  }

  @objc func vibrate(_ call: CAPPluginCall) {
    // Strong haptic pattern for danger
    DispatchQueue.main.async {
      let gen = UINotificationFeedbackGenerator()
      gen.prepare()
      gen.notificationOccurred(.error)
      // Extra pulses
      for i in 1...3 {
        DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.35) {
          UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        }
      }
    }
    // Also legacy vibrate for older devices
    AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
    call.resolve(["ok": true])
  }

  @objc func stop(_ call: CAPPluginCall) {
    stopPlayers()
    call.resolve(["ok": true])
  }

  /**
   * Request Critical Alerts permission (Apple entitlement required).
   * Without entitlement, iOS ignores .criticalAlert and returns normal grant.
   */
  @objc func requestCriticalAlerts(_ call: CAPPluginCall) {
    let enabled = Bundle.main.object(forInfoDictionaryKey: "SafenexCriticalAlertsEnabled") as? Bool ?? false
    var options: UNAuthorizationOptions = [.alert, .sound, .badge]
    if enabled {
      options.insert(.criticalAlert)
    }
    UNUserNotificationCenter.current().requestAuthorization(options: options) { granted, error in
      if let error = error {
        call.reject("requestCriticalAlerts failed: \(error.localizedDescription)")
        return
      }
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        var criticalStatus = "notSupported"
        if #available(iOS 12.0, *) {
          switch settings.criticalAlertSetting {
          case .enabled: criticalStatus = "enabled"
          case .disabled: criticalStatus = "disabled"
          case .notSupported: criticalStatus = "notSupported"
          @unknown default: criticalStatus = "unknown"
          }
        }
        call.resolve([
          "ok": granted,
          "granted": granted,
          "criticalAlertsEnabledInPlist": enabled,
          "criticalAlertSetting": criticalStatus,
          "note": enabled
            ? "Entitlement must be approved by Apple and present in provisioning profile"
            : "Set SafenexCriticalAlertsEnabled=true in Info.plist after Apple approves Critical Alerts",
        ])
      }
    }
  }

  @objc func criticalAlertsStatus(_ call: CAPPluginCall) {
    let enabled = Bundle.main.object(forInfoDictionaryKey: "SafenexCriticalAlertsEnabled") as? Bool ?? false
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      var criticalStatus = "notSupported"
      if #available(iOS 12.0, *) {
        switch settings.criticalAlertSetting {
        case .enabled: criticalStatus = "enabled"
        case .disabled: criticalStatus = "disabled"
        case .notSupported: criticalStatus = "notSupported"
        @unknown default: criticalStatus = "unknown"
        }
      }
      call.resolve([
        "plistFlag": enabled,
        "criticalAlertSetting": criticalStatus,
        "authorizationStatus": settings.authorizationStatus.rawValue,
      ])
    }
  }

  private func stopPlayers() {
    player?.stop()
    player = nil
    if synthesizer.isSpeaking {
      synthesizer.stopSpeaking(at: .immediate)
    }
  }
}

private final class SpeakDelegate: NSObject, AVSpeechSynthesizerDelegate {
  private let onFinish: (Bool) -> Void
  private var settled = false

  init(onFinish: @escaping (Bool) -> Void) {
    self.onFinish = onFinish
  }

  private func finish(_ ok: Bool) {
    guard !settled else { return }
    settled = true
    onFinish(ok)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    finish(true)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    finish(false)
  }
}
