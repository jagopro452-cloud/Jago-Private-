import 'auth_service.dart';

enum SessionRestoreState { guest, authenticated, retryableFailure }

class SessionRestoreResult {
  const SessionRestoreResult({
    required this.state,
    this.cachedProfile,
  });

  final SessionRestoreState state;
  final Map<String, dynamic>? cachedProfile;

  bool get hasCachedProfile => cachedProfile != null && cachedProfile!.isNotEmpty;
}

class SessionManager {
  static Future<SessionRestoreResult> restoreSession() async {
    final hasLocalSession =
        await AuthService.rehydrateStoredSession(refreshProfile: false);
    if (!hasLocalSession) {
      return const SessionRestoreResult(state: SessionRestoreState.guest);
    }

    final validation = await AuthService.validateStoredSession();
    switch (validation.state) {
      case SessionValidationState.valid:
        return SessionRestoreResult(
          state: SessionRestoreState.authenticated,
          cachedProfile: validation.profile ?? await AuthService.getSavedUser(),
        );
      case SessionValidationState.retryableFailure:
        return SessionRestoreResult(
          state: SessionRestoreState.retryableFailure,
          cachedProfile: validation.profile ?? await AuthService.getSavedUser(),
        );
      case SessionValidationState.unauthorized:
        await AuthService.clearLocalSession();
        return const SessionRestoreResult(state: SessionRestoreState.guest);
    }
  }
}
