import 'package:firebase_crashlytics/firebase_crashlytics.dart';

/// Standard way to instrument a `catch (_) {}` block that was previously
/// silent. Records a non-fatal Crashlytics error with enough context to
/// triage, and never throws itself - a telemetry failure must never mask
/// or interrupt the original error-handling path.
///
/// Usage: `catch (e, st) { reportSilentFailure('WalletScreen._fetchWallet', e, st); ... }`
Future<void> reportSilentFailure(String context, Object error, [StackTrace? stack]) async {
  try {
    await FirebaseCrashlytics.instance.recordError(
      error,
      stack ?? StackTrace.current,
      reason: context,
      fatal: false,
    );
  } catch (_) {
    // Crashlytics itself unavailable - nothing more to do, this must not
    // propagate back into the caller's error handling.
  }
}
