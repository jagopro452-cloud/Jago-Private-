# Mobile Release Blockers (Current)

## Customer app blocker

- Kotlin metadata mismatch during release build:
  - expected `1.9.0`
  - found `2.1.0` in Gradle cache/plugins

Suggested fix path:

1. Align Android Gradle Plugin + Kotlin plugin versions in Android build files.
2. Run `flutter clean` and clear Gradle cache if needed.
3. Re-run `flutter build apk --release`.

## Driver app blocker

- Current local Flutter SDK is `3.22.2`.
- Driver app requires `>=3.24.0` from `pubspec.yaml`.

Suggested fix path:

1. Upgrade Flutter to supported version (`3.24+`, preferably latest stable).
2. Run `flutter pub get` and release build again.

## Go-live requirement

Both customer and driver release builds must pass from CI/build agent before production rollout.
