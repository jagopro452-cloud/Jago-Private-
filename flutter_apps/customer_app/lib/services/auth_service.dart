import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../src/core/config/api_config.dart';
import '../main.dart' show navigatorKey;
import '../screens/splash_screen.dart';
import 'device_identity_service.dart';
import 'fcm_service.dart';

enum SessionValidationState { valid, retryableFailure, unauthorized }

class SessionValidationResult {
  const SessionValidationResult({
    required this.state,
    this.profile,
  });

  final SessionValidationState state;
  final Map<String, dynamic>? profile;
}

class AuthService {
  static const _tokenKey = 'auth_token';
  static const _refreshTokenKey = 'refresh_token';
  static const _userKey = 'user_data';
  static bool _handling401 = false;

  static const Map<String, String> _base = {
    'Content-Type': 'application/json',
    'User-Agent': 'JAGOPro-Customer/1.0.63 (Android)',
    'X-Client-Version': '1.0.63+63',
    'X-Client-Platform': 'android',
    'Accept': 'application/json',
  };

  // ── Secure token storage ────────────────────────────────────────────────
  // flutter_secure_storage is the storage of record for all keys below.
  // SharedPreferences remains a temporary read fallback (for installs not
  // yet migrated) and is cleared alongside secure storage on logout — kept
  // for one full production release per the approved migration plan, then
  // removed in a later batch.
  static const FlutterSecureStorage _secureStorage = FlutterSecureStorage();
  static const List<String> _migratedKeys = [
    _tokenKey,
    _refreshTokenKey,
    _userKey,
    'user_id',
    'user_name',
    'user_phone',
  ];
  static bool _migrationAttempted = false;

  /// Read order: secure storage first, then SharedPreferences fallback.
  static Future<String?> _readValue(String key) async {
    try {
      final secureValue = await _secureStorage.read(key: key);
      if (secureValue != null && secureValue.isNotEmpty) return secureValue;
    } catch (_) {}
    try {
      final prefs = await SharedPreferences.getInstance();
      final value = prefs.getString(key);
      return (value != null && value.isNotEmpty) ? value : null;
    } catch (_) {
      return null;
    }
  }

  /// All new writes go to secure storage only.
  static Future<void> _writeValue(String key, String value) async {
    await _secureStorage.write(key: key, value: value);
  }

  /// Clears both stores so no stale plaintext copy can resurface via the
  /// read fallback after logout (e.g. a different user logging in on the
  /// same device).
  static Future<void> _deleteValue(String key) async {
    try {
      await _secureStorage.delete(key: key);
    } catch (_) {}
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(key);
    } catch (_) {}
  }

  /// One-time migration: SharedPreferences (plaintext) -> secure storage.
  /// Per key, independently: read SharedPreferences -> write secure storage
  /// -> verify secure storage (read back and compare) -> delete
  /// SharedPreferences copy. The SharedPreferences copy is deleted ONLY
  /// after the secure-storage write is verified; on any failure (secure
  /// storage unavailable, write throws, or verification mismatch) the old
  /// value is left completely untouched in SharedPreferences and the app
  /// keeps using it via the read fallback — never cleared, never lost.
  /// Each key is handled in its own try/catch so one key's failure (e.g.
  /// Keystore unavailable) does not prevent the other keys from being
  /// attempted in the same run. Idempotent and crash-safe: if the app is
  /// killed mid-migration, already-migrated keys are simply skipped next
  /// launch (their SharedPreferences copy is already gone), and
  /// not-yet-migrated keys retry from scratch — no partial/corrupted state
  /// is possible per key, and no session is ever lost. Never forces logout.
  // After this many consecutive failed migration attempts for a key across
  // app launches, stop retrying silently: clear the plaintext copy (closing
  // the exposure window) and force re-login instead of leaving it open
  // -ended forever with no visibility into how many installs are affected.
  static const int _maxMigrationAttempts = 5;

  static Future<void> migrateTokenStorageIfNeeded() async {
    if (_migrationAttempted) return;
    _migrationAttempted = true;
    late final SharedPreferences prefs;
    try {
      prefs = await SharedPreferences.getInstance();
    } catch (e) {
      debugPrint('[AuthService] Migration aborted — SharedPreferences unavailable: $e');
      return;
    }
    bool forceLogoutRequired = false;
    for (final key in _migratedKeys) {
      try {
        final oldValue = prefs.getString(key);
        if (oldValue == null || oldValue.isEmpty) continue;

        String? existingSecure;
        try {
          existingSecure = await _secureStorage.read(key: key);
        } catch (e) {
          if (await _recordMigrationFailure(prefs, key, 'secure_storage_unavailable', e)) {
            forceLogoutRequired = true;
          }
          continue;
        }
        if (existingSecure != null && existingSecure.isNotEmpty) {
          // Already migrated in a previous run — clean up the leftover copy.
          await prefs.remove(key);
          await _clearMigrationFailureCount(prefs, key);
          continue;
        }

        await _secureStorage.write(key: key, value: oldValue);
        final verified = await _secureStorage.read(key: key);
        if (verified == oldValue) {
          await prefs.remove(key);
          await _clearMigrationFailureCount(prefs, key);
        } else {
          if (await _recordMigrationFailure(prefs, key, 'verification_mismatch', null)) {
            forceLogoutRequired = true;
          }
        }
      } catch (e) {
        // This key's migration failed for any other reason — leave its
        // SharedPreferences value exactly as-is and continue with the
        // remaining keys; this key retries on the next launch.
        if (await _recordMigrationFailure(prefs, key, 'unexpected_error', e)) {
          forceLogoutRequired = true;
        }
      }
    }
    if (forceLogoutRequired) {
      debugPrint('[AuthService] Migration failed $_maxMigrationAttempts+ times for one or more keys — clearing session and forcing re-login.');
      await logout();
    }
  }

  /// Records a migration failure to Crashlytics (non-fatal — this must never
  /// affect crash-free-rate) and to a persistent per-key counter so repeated
  /// failures across launches are visible instead of silently retried
  /// forever. Returns true once the key has hit _maxMigrationAttempts.
  static Future<bool> _recordMigrationFailure(
    SharedPreferences prefs,
    String key,
    String reason,
    Object? error,
  ) async {
    debugPrint('[AuthService] Migration failed for "$key" ($reason) — will retry next launch: $error');
    try {
      await FirebaseCrashlytics.instance.recordError(
        error ?? Exception('Token storage migration failed: $reason'),
        StackTrace.current,
        reason: 'Secure storage migration failure for key "$key" ($reason)',
        fatal: false,
      );
    } catch (_) {
      // Crashlytics itself unavailable — do not let telemetry failure block
      // the actual migration retry logic.
    }
    final countKey = 'migration_fail_count_$key';
    final count = (prefs.getInt(countKey) ?? 0) + 1;
    await prefs.setInt(countKey, count);
    return count >= _maxMigrationAttempts;
  }

  static Future<void> _clearMigrationFailureCount(SharedPreferences prefs, String key) async {
    await prefs.remove('migration_fail_count_$key');
  }

  static Future<String?> getToken() async {
    await migrateTokenStorageIfNeeded();
    return _readValue(_tokenKey);
  }

  /// Returns the stored user id, recovering it from the saved user JSON
  /// (and persisting the recovery) for older installs where it was never
  /// stored separately — same recovery logic previously duplicated in
  /// socket_service.dart, now centralized here alongside the other writes.
  static Future<String> getUserId() async {
    await migrateTokenStorageIfNeeded();
    var userId = await _readValue('user_id') ?? '';
    if (userId.isEmpty) {
      final user = await getSavedUser();
      if (user != null) {
        final recovered = user['id']?.toString() ??
            user['userId']?.toString() ??
            user['user_id']?.toString() ??
            '';
        if (recovered.isNotEmpty) {
          await _writeValue('user_id', recovered);
          userId = recovered;
        }
      }
    }
    return userId;
  }

  static Future<bool> isLoggedIn() async {
    final token = await getToken();
    return token != null && token.isNotEmpty;
  }

  static Future<Map<String, String>> getHeaders() async {
    final token = await getToken();
    return {..._base, if (token != null) 'Authorization': 'Bearer $token'};
  }

  static Future<void> logout() async {
    try {
      final refreshToken = (await _readValue(_refreshTokenKey))?.trim() ?? '';
      final deviceId = await DeviceIdentityService.getDeviceId();
      final headers = await getHeaders();
      await http
          .post(
            Uri.parse(ApiConfig.logout),
            headers: {...headers, 'X-Device-Id': deviceId},
            body: jsonEncode({
              if (refreshToken.isNotEmpty) 'refreshToken': refreshToken,
            }),
          )
          .timeout(
            const Duration(seconds: 30),
          );
    } catch (_) {}
    await _clearStoredSession();
  }

  static Future<void> handle401({String source = 'customer_app'}) async {
    if (_handling401) return;
    _handling401 = true;
    try {
      await _clearStoredSession();
      final context = navigatorKey.currentContext;
      if (context != null) {
        try {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Your session has expired. Please sign in again.'),
            ),
          );
        } catch (_) {}
      }
      navigatorKey.currentState?.pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const SplashScreen()),
        (route) => false,
      );
    } finally {
      _handling401 = false;
    }
  }

  static Future<Map<String, dynamic>?> getProfile() async {
    try {
      final headers = await getHeaders();
      final res = await http
          .get(Uri.parse(ApiConfig.customerProfile), headers: headers)
          .timeout(const Duration(seconds: 30));
      if (res.statusCode == 200) {
        return jsonDecode(res.body) as Map<String, dynamic>;
      }
    } on TimeoutException {
      return null;
    } catch (_) {}
    return null;
  }

  static Future<Map<String, dynamic>> getProfileStatus() async {
    try {
      final headers = await getHeaders();
      final res = await http
          .get(Uri.parse(ApiConfig.customerProfile), headers: headers)
          .timeout(const Duration(seconds: 30));
      if (res.statusCode == 200) {
        return {
          'success': true,
          'authorized': true,
          'profile': jsonDecode(res.body),
        };
      }
      if (res.statusCode == 401) {
        return {
          'success': false,
          'authorized': false,
          'temporaryFailure': false,
        };
      }
      return {
        'success': false,
        'authorized': null,
        'temporaryFailure': true,
      };
    } on TimeoutException {
      return {
        'success': false,
        'authorized': null,
        'temporaryFailure': true,
      };
    } catch (_) {
      return {
        'success': false,
        'authorized': null,
        'temporaryFailure': true,
      };
    }
  }

  static Future<void> _clearStoredSession() async {
    for (final key in _migratedKeys) {
      await _deleteValue(key);
    }
  }

  static Future<Map<String, dynamic>?> getSavedUser() async {
    final raw = await _readValue(_userKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      return decoded is Map<String, dynamic> ? decoded : null;
    } catch (_) {
      return null;
    }
  }

  static Future<void> clearLocalSession() => _clearStoredSession();

  static Future<bool> rehydrateStoredSession({
    bool refreshProfile = true,
  }) async {
    final token = await getToken();
    if (token == null || token.isEmpty) return false;
    if (!refreshProfile) return true;
    final result = await validateStoredSession();
    return result.state != SessionValidationState.unauthorized;
  }

  static Future<SessionValidationResult> validateStoredSession() async {
    final token = await getToken();
    if (token == null || token.isEmpty) {
      return const SessionValidationResult(
        state: SessionValidationState.unauthorized,
      );
    }

    final status = await getProfileStatus();
    if (status['authorized'] == true) {
      final profile = status['profile'];
      return SessionValidationResult(
        state: SessionValidationState.valid,
        profile: profile is Map<String, dynamic> ? profile : await getSavedUser(),
      );
    }
    if (status['authorized'] == false) {
      final refreshed = await _refreshSession(clearOnFailure: false);
      if (refreshed) {
        return validateStoredSession();
      }
      return const SessionValidationResult(
        state: SessionValidationState.unauthorized,
      );
    }
    return SessionValidationResult(
      state: SessionValidationState.retryableFailure,
      profile: await getSavedUser(),
    );
  }

  static Future<bool> tryRefreshSession() async {
    return _refreshSession();
  }

  static Future<void> _persistAuth(
    String token,
    String? refreshToken,
    Map<String, dynamic> user,
    String fallbackPhone,
  ) async {
    await _writeValue(_tokenKey, token);
    if (refreshToken != null && refreshToken.trim().isNotEmpty) {
      await _writeValue(_refreshTokenKey, refreshToken.trim());
    }
    await _writeValue(_userKey, jsonEncode(user));
    final name = user['fullName'] ?? user['full_name'] ?? user['name'] ?? '';
    final phone = user['phone'] ?? fallbackPhone;
    final userId = user['id']?.toString() ??
        user['userId']?.toString() ??
        user['user_id']?.toString() ??
        '';
    if (name.toString().isNotEmpty) {
      await _writeValue('user_name', name.toString());
    }
    if (phone.toString().isNotEmpty) {
      await _writeValue('user_phone', phone.toString());
    }
    if (userId.isNotEmpty) {
      await _writeValue('user_id', userId);
    }
    FcmService().onLoginSuccess().catchError((_) {});
  }

  static Future<bool> _refreshSession({bool clearOnFailure = true}) async {
    final refreshToken = (await _readValue(_refreshTokenKey))?.trim() ?? '';
    if (refreshToken.isEmpty) {
      if (clearOnFailure) {
        await _clearStoredSession();
      }
      return false;
    }

    try {
      final deviceId = await DeviceIdentityService.getDeviceId();
      final res = await http
          .post(
            Uri.parse(ApiConfig.refreshSession),
            headers: {..._base, 'X-Device-Id': deviceId},
            body: jsonEncode({
              'refreshToken': refreshToken,
              'deviceId': deviceId,
            }),
          )
          .timeout(const Duration(seconds: 20));
      if (!(res.headers['content-type'] ?? '').contains('application/json')) {
        if (clearOnFailure) {
          await _clearStoredSession();
        }
        return false;
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode == 200 && data['token'] != null) {
        final currentUser = await getSavedUser() ?? <String, dynamic>{};
        await _persistAuth(
          data['token'].toString(),
          data['refreshToken']?.toString(),
          currentUser,
          currentUser['phone']?.toString() ?? '',
        );
        return true;
      }
    } on TimeoutException {
      return false;
    } catch (_) {}

    if (clearOnFailure) {
      await _clearStoredSession();
    }
    return false;
  }

  static Future<Map<String, dynamic>> updateProfile({
    String? fullName,
    String? email,
  }) async {
    try {
      final headers = await getHeaders();
      final body = <String, dynamic>{};
      if (fullName != null) body['fullName'] = fullName;
      if (email != null) body['email'] = email;
      final res = await http
          .patch(
            Uri.parse(ApiConfig.updateProfile),
            headers: headers,
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 30));
      return jsonDecode(res.body) as Map<String, dynamic>;
    } on TimeoutException {
      return {
        'success': false,
        'message': 'Request timed out. Check your connection.',
      };
    } catch (_) {
      return {
        'success': false,
        'message': 'Network error. Check your connection.',
      };
    }
  }

  static Future<Map<String, dynamic>> loginWithPassword(
    String phone,
    String password,
  ) async {
    try {
      final deviceId = await DeviceIdentityService.getDeviceId();
      final res = await http
          .post(
            Uri.parse(ApiConfig.loginPassword),
            headers: {..._base, 'X-Device-Id': deviceId},
            body: jsonEncode({
              'phone': phone,
              'password': password,
              'userType': 'customer',
              'deviceId': deviceId,
            }),
          )
          .timeout(const Duration(seconds: 30));
      if (!(res.headers['content-type'] ?? '').contains('application/json')) {
        return {'success': false, 'message': 'Server error. Please try again.'};
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode == 200 && data['token'] != null) {
        await _persistAuth(
          data['token'].toString(),
          data['refreshToken']?.toString(),
          (data['user'] ?? data) as Map<String, dynamic>,
          phone,
        );
      }
      return data;
    } on TimeoutException {
      return {
        'success': false,
        'message': 'Request timed out. Check your connection.',
      };
    } catch (_) {
      return {
        'success': false,
        'message': 'Network error. Check your connection.',
      };
    }
  }

  static Future<Map<String, dynamic>> sendOtp(String phone) async {
    try {
      final deviceId = await DeviceIdentityService.getDeviceId();
      final res = await http
          .post(
            Uri.parse(ApiConfig.sendOtp),
            headers: {..._base, 'X-Device-Id': deviceId},
            body: jsonEncode({
              'phone': phone,
              'userType': 'customer',
              'deviceId': deviceId,
            }),
          )
          .timeout(const Duration(seconds: 30));
      if (!(res.headers['content-type'] ?? '').contains('application/json')) {
        return {'success': false, 'message': 'Server error. Please try again.'};
      }
      return jsonDecode(res.body) as Map<String, dynamic>;
    } on TimeoutException {
      return {
        'success': false,
        'message': 'Request timed out. Check your connection.',
      };
    } catch (_) {
      return {
        'success': false,
        'message': 'Network error. Check your connection.',
      };
    }
  }

  /// Verifies the OTP and logs into the existing account for [phone], or
  /// creates a new one if none exists yet (the mobile number is the unique
  /// identifier — same phone always resolves to the same account). [name]
  /// is only used the first time, when a new account is being created.
  static Future<Map<String, dynamic>> verifyOtp(
    String phone,
    String otp, {
    String? name,
  }) async {
    try {
      final deviceId = await DeviceIdentityService.getDeviceId();
      final body = <String, dynamic>{
        'phone': phone,
        'otp': otp,
        'userType': 'customer',
        'deviceId': deviceId,
      };
      if (name != null && name.trim().isNotEmpty) body['name'] = name.trim();
      final res = await http
          .post(
            Uri.parse(ApiConfig.verifyOtp),
            headers: {..._base, 'X-Device-Id': deviceId},
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 30));
      if (!(res.headers['content-type'] ?? '').contains('application/json')) {
        return {'success': false, 'message': 'Server error. Please try again.'};
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode == 200 && data['token'] != null) {
        await _persistAuth(
          data['token'].toString(),
          data['refreshToken']?.toString(),
          (data['user'] ?? data) as Map<String, dynamic>,
          phone,
        );
      }
      return data;
    } on TimeoutException {
      return {
        'success': false,
        'message': 'Request timed out. Check your connection.',
      };
    } catch (_) {
      return {
        'success': false,
        'message': 'Network error. Check your connection.',
      };
    }
  }

  static Future<Map<String, dynamic>> registerWithPassword(
    String phone,
    String password,
    String fullName, {
    String? email,
    String? referralCode,
  }) async {
    try {
      final deviceId = await DeviceIdentityService.getDeviceId();
      final body = <String, dynamic>{
        'phone': phone,
        'password': password,
        'fullName': fullName,
        'userType': 'customer',
        'deviceId': deviceId,
      };
      if (email != null && email.isNotEmpty) body['email'] = email;
      if (referralCode != null && referralCode.trim().isNotEmpty) {
        body['referralCode'] = referralCode.trim().toUpperCase();
      }
      final res = await http
          .post(
            Uri.parse(ApiConfig.registerAccount),
            headers: {..._base, 'X-Device-Id': deviceId},
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 30));
      if (!(res.headers['content-type'] ?? '').contains('application/json')) {
        return {'success': false, 'message': 'Server error. Please try again.'};
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode == 200 && data['token'] != null) {
        await _persistAuth(
          data['token'].toString(),
          data['refreshToken']?.toString(),
          (data['user'] ?? data) as Map<String, dynamic>,
          phone,
        );
      }
      return data;
    } on TimeoutException {
      return {
        'success': false,
        'message': 'Request timed out. Check your connection.',
      };
    } catch (_) {
      return {
        'success': false,
        'message': 'Network error. Check your connection.',
      };
    }
  }

  static Future<Map<String, dynamic>> forgotPassword(String phone) async {
    try {
      final res = await http
          .post(
            Uri.parse(ApiConfig.forgotPassword),
            headers: _base,
            body: jsonEncode({'phone': phone, 'userType': 'customer'}),
          )
          .timeout(const Duration(seconds: 30));
      if (!(res.headers['content-type'] ?? '').contains('application/json')) {
        return {'success': false, 'message': 'Server error. Please try again.'};
      }
      return jsonDecode(res.body) as Map<String, dynamic>;
    } on TimeoutException {
      return {
        'success': false,
        'message': 'Request timed out. Check your connection.',
      };
    } catch (_) {
      return {
        'success': false,
        'message': 'Network error. Check your connection.',
      };
    }
  }

  static Future<Map<String, dynamic>> resetPassword(
    String phone,
    String otp,
    String newPassword,
  ) async {
    try {
      final res = await http
          .post(
            Uri.parse(ApiConfig.resetPassword),
            headers: _base,
            body: jsonEncode({
              'phone': phone,
              'otp': otp,
              'newPassword': newPassword,
              'userType': 'customer',
            }),
          )
          .timeout(const Duration(seconds: 30));
      if (!(res.headers['content-type'] ?? '').contains('application/json')) {
        return {'success': false, 'message': 'Server error. Please try again.'};
      }
      return jsonDecode(res.body) as Map<String, dynamic>;
    } on TimeoutException {
      return {
        'success': false,
        'message': 'Request timed out. Check your connection.',
      };
    } catch (_) {
      return {
        'success': false,
        'message': 'Network error. Check your connection.',
      };
    }
  }
}
