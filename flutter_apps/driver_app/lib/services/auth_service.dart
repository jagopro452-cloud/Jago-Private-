import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../config/api_config.dart';
import '../main.dart' show navigatorKey;
import '../models/user_model.dart';
import '../screens/splash_screen.dart';
import 'device_identity_service.dart';
import 'fcm_service.dart';

class AuthService {
  static const _tokenKey = 'auth_token';
  static const _refreshTokenKey = 'refresh_token';
  static const _userKey = 'user_data';
  static const _userNameKey = 'user_name';
  static const _userPhoneKey = 'user_phone';
  static const _userIdKey = 'user_id';

  static const Map<String, String> _base = {
    'Content-Type': 'application/json',
    'User-Agent': 'JAGOPro-Driver/1.0.64 (Android)',
    'X-Client-Version': '1.0.64+64',
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
    _userNameKey,
    _userPhoneKey,
    _userIdKey,
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
  /// read fallback after logout (e.g. a different driver logging in on the
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
    for (final key in _migratedKeys) {
      try {
        final oldValue = prefs.getString(key);
        if (oldValue == null || oldValue.isEmpty) continue;

        String? existingSecure;
        try {
          existingSecure = await _secureStorage.read(key: key);
        } catch (e) {
          debugPrint('[AuthService] Migration: secure storage unavailable for "$key" — keeping SharedPreferences copy, will retry next launch: $e');
          continue;
        }
        if (existingSecure != null && existingSecure.isNotEmpty) {
          // Already migrated in a previous run — clean up the leftover copy.
          await prefs.remove(key);
          continue;
        }

        await _secureStorage.write(key: key, value: oldValue);
        final verified = await _secureStorage.read(key: key);
        if (verified == oldValue) {
          await prefs.remove(key);
        } else {
          debugPrint('[AuthService] Migration: verification failed for "$key" — keeping SharedPreferences copy, will retry next launch.');
        }
      } catch (e) {
        // This key's migration failed for any other reason — leave its
        // SharedPreferences value exactly as-is and continue with the
        // remaining keys; this key retries on the next launch.
        debugPrint('[AuthService] Migration failed for "$key" — keeping SharedPreferences copy, will retry next launch: $e');
      }
    }
  }

  static Future<String?> getToken() async {
    await migrateTokenStorageIfNeeded();
    return _readValue(_tokenKey);
  }

  static Future<void> saveToken(String token) async {
    await _writeValue(_tokenKey, token.trim());
  }

  static Future<void> saveRefreshToken(String? token) async {
    final normalized = token?.trim() ?? '';
    if (normalized.isEmpty) {
      await _deleteValue(_refreshTokenKey);
      return;
    }
    await _writeValue(_refreshTokenKey, normalized);
  }

  static Future<void> saveUser(Map<String, dynamic> userData) async {
    await _writeValue(_userKey, jsonEncode(userData));
    final name = userData['fullName'] ?? userData['full_name'] ?? userData['name'] ?? '';
    final phone = userData['phone'] ?? '';
    final id = userData['id']?.toString() ??
        userData['userId']?.toString() ??
        userData['user_id']?.toString() ??
        '';
    if (name.toString().isNotEmpty) {
      await _writeValue(_userNameKey, name.toString());
    } else {
      await _deleteValue(_userNameKey);
    }
    if (phone.toString().isNotEmpty) {
      await _writeValue(_userPhoneKey, phone.toString());
    } else {
      await _deleteValue(_userPhoneKey);
    }
    if (id.isNotEmpty) {
      await _writeValue(_userIdKey, id);
    } else {
      await _deleteValue(_userIdKey);
    }
  }

  static Future<Map<String, dynamic>?> getSavedUser() async {
    final str = await _readValue(_userKey);
    if (str == null) return null;
    return jsonDecode(str) as Map<String, dynamic>;
  }

  /// Returns the stored user id, recovering it from the saved user JSON
  /// (and persisting the recovery) for older installs where it was never
  /// stored separately — same recovery logic previously duplicated in
  /// socket_service.dart, now centralized here alongside the other writes.
  static Future<String> getUserId() async {
    await migrateTokenStorageIfNeeded();
    var userId = await _readValue(_userIdKey) ?? '';
    if (userId.isEmpty) {
      final user = await getSavedUser();
      if (user != null) {
        final recovered = user['id']?.toString() ??
            user['userId']?.toString() ??
            user['user_id']?.toString() ??
            '';
        if (recovered.isNotEmpty) {
          await _writeValue(_userIdKey, recovered);
          userId = recovered;
        }
      }
    }
    return userId;
  }

  static String? _extractTripId(dynamic payload) {
    if (payload is! Map) return null;
    final raw = payload['id'] ??
        payload['tripId'] ??
        payload['trip_id'] ??
        payload['activeTripId'] ??
        payload['active_trip_id'];
    return raw?.toString();
  }

  static Future<bool> isLoggedIn() async {
    final token = await getToken();
    return token != null && token.isNotEmpty;
  }

  static Future<void> clearLocalSession() async {
    for (final key in _migratedKeys) {
      await _deleteValue(key);
    }
  }

  static Future<bool> rehydrateStoredSession({bool refreshProfile = true}) async {
    final token = (await getToken())?.trim() ?? '';
    if (token.isEmpty) return false;

    final savedUser = await getSavedUser();
    if (savedUser != null && savedUser.isNotEmpty) {
      await saveUser(savedUser);
    }

    if (!refreshProfile) return true;

    try {
      final res = await http
          .get(
            Uri.parse(ApiConfig.driverProfile),
            headers: {..._base, 'Authorization': 'Bearer $token'},
          )
          .timeout(const Duration(seconds: 8));

      if (res.statusCode == 200) {
        if ((res.headers['content-type'] ?? '').contains('application/json')) {
          final body = jsonDecode(res.body);
          if (body is Map<String, dynamic>) {
            await saveUser(body);
          }
        }
        return true;
      }

      if (res.statusCode == 401) {
        return refreshOnce();
      }
    } on TimeoutException {
      return true;
    } catch (_) {
      return true;
    }

    return true;
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
    await clearLocalSession();
  }

  static Future<bool> refreshOnce() {
    return _refreshSession();
  }

  static Future<String?> getActiveTripId() async {
    try {
      final headers = await getHeaders();
      final res = await http
          .get(Uri.parse(ApiConfig.driverActiveTrip), headers: headers)
          .timeout(const Duration(seconds: 8));
      if (res.statusCode != 200 ||
          !(res.headers['content-type'] ?? '').contains('application/json')) {
        return null;
      }

      final body = jsonDecode(res.body);
      if (body is! Map<String, dynamic>) return null;
      return _extractTripId(body['trip']) ??
          _extractTripId(body['activeTrip']) ??
          _extractTripId(body);
    } on TimeoutException {
      return null;
    } catch (_) {
      return null;
    }
  }

  static Future<bool> hasActiveTripSession() async {
    final tripId = await getActiveTripId();
    return tripId != null && tripId.isNotEmpty;
  }

  static Future<bool> safeLogout() async {
    if (await hasActiveTripSession()) {
      return false;
    }
    await logout();
    return true;
  }

  static Future<void> handle401({
    String source = 'driver_app',
    bool allowDuringActiveTrip = false,
  }) async {
    if (allowDuringActiveTrip && await hasActiveTripSession()) {
      return;
    }
    await clearLocalSession();
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
  }

  static Future<UserModel?> getProfile() async {
    try {
      final headers = await getHeaders();
      final res = await http
          .get(Uri.parse(ApiConfig.driverProfile), headers: headers)
          .timeout(const Duration(seconds: 30));
      if (res.statusCode == 200) {
        return UserModel.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
      }
    } on TimeoutException {
      return null;
    } catch (_) {}
    return null;
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
              'userType': 'driver',
              'deviceId': deviceId,
            }),
          )
          .timeout(const Duration(seconds: 30));
      if (!(res.headers['content-type'] ?? '').contains('application/json')) {
        return {'success': false, 'message': 'Server error. Please try again.'};
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode == 200 && data['token'] != null) {
        await saveToken(data['token'].toString());
        await saveRefreshToken(data['refreshToken']?.toString());
        await saveUser((data['user'] ?? data) as Map<String, dynamic>);
        FcmService().onLoginSuccess().catchError((_) {});
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
              'userType': 'driver',
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

  /// Verifies the OTP for an existing driver account matched by [phone].
  /// Unlike the customer app, this never auto-creates an account — drivers
  /// must complete the KYC onboarding wizard (RegisterScreen) first; the
  /// server returns USER_NOT_FOUND if no driver account exists for the
  /// number yet.
  static Future<Map<String, dynamic>> verifyOtp(String phone, String otp) async {
    try {
      final deviceId = await DeviceIdentityService.getDeviceId();
      final res = await http
          .post(
            Uri.parse(ApiConfig.verifyOtp),
            headers: {..._base, 'X-Device-Id': deviceId},
            body: jsonEncode({
              'phone': phone,
              'otp': otp,
              'userType': 'driver',
              'deviceId': deviceId,
            }),
          )
          .timeout(const Duration(seconds: 30));
      if (!(res.headers['content-type'] ?? '').contains('application/json')) {
        return {'success': false, 'message': 'Server error. Please try again.'};
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode == 200 && data['token'] != null) {
        await saveToken(data['token'].toString());
        await saveRefreshToken(data['refreshToken']?.toString());
        await saveUser((data['user'] ?? data) as Map<String, dynamic>);
        FcmService().onLoginSuccess().catchError((_) {});
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
    String? vehicleNumber,
    String? vehicleModel,
    String? vehicleCategoryId,
    String? referralCode,
  }) async {
    try {
      final deviceId = await DeviceIdentityService.getDeviceId();
      final body = <String, dynamic>{
        'phone': phone,
        'password': password,
        'fullName': fullName,
        'userType': 'driver',
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
        await saveToken(data['token'].toString());
        await saveRefreshToken(data['refreshToken']?.toString());
        await saveUser((data['user'] ?? data) as Map<String, dynamic>);
        FcmService().onLoginSuccess().catchError((_) {});
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
            body: jsonEncode({'phone': phone, 'userType': 'driver'}),
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
              'userType': 'driver',
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

  static Future<bool> _refreshSession({bool clearOnFailure = true}) async {
    final refreshToken = (await _readValue(_refreshTokenKey))?.trim() ?? '';
    if (refreshToken.isEmpty) {
      if (clearOnFailure) {
        await clearLocalSession();
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
          await clearLocalSession();
        }
        return false;
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode == 200 && data['token'] != null) {
        await saveToken(data['token'].toString());
        await saveRefreshToken(data['refreshToken']?.toString());
        return true;
      }
    } on TimeoutException {
      return false;
    } catch (_) {}

    if (clearOnFailure) {
      await clearLocalSession();
    }
    return false;
  }
}
