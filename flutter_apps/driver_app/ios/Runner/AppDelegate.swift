import Flutter
import UIKit
import GoogleMaps

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    if let mapsKey = Bundle.main.object(forInfoDictionaryKey: "GOOGLE_MAPS_KEY") as? String,
       !mapsKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
       !mapsKey.contains("$(") {
      GMSServices.provideAPIKey(mapsKey)
    } else {
      NSLog("[MAPS] Missing GOOGLE_MAPS_KEY in Info.plist/build settings; iOS Maps SDK disabled")
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }
}
