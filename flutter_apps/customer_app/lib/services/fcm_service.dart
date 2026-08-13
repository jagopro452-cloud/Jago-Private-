import 'dart:convert';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../src/core/config/api_config.dart';
import 'auth_service.dart';

// Background message handler — top-level function required by Firebase
@pragma('vm:entry-point')
Future<void> firebaseBackgroundMessageHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

class FcmService {
  static final FcmService _instance = FcmService._internal();
  factory FcmService() => _instance;
  FcmService._internal();

  final FlutterLocalNotificationsPlugin _localNotif = FlutterLocalNotificationsPlugin();
  bool _initialized = false;

  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    try {
      // Request permission
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      ).timeout(const Duration(seconds: 10), onTimeout: () => const NotificationSettings(
        alert: AppleNotificationSetting.disabled,
        announcement: AppleNotificationSetting.disabled,
        authorizationStatus: AuthorizationStatus.notDetermined,
        badge: AppleNotificationSetting.disabled,
        carPlay: AppleNotificationSetting.disabled,
        lockScreen: AppleNotificationSetting.disabled,
        notificationCenter: AppleNotificationSetting.disabled,
        showPreviews: AppleShowPreviewSetting.never,
        sound: AppleNotificationSetting.disabled,
        criticalAlert: AppleNotificationSetting.disabled,
        timeSensitive: AppleNotificationSetting.disabled,
        providesAppNotificationSettings: AppleNotificationSetting.disabled,
      ));

      // Android notification channels
      const AndroidNotificationChannel driverChannel = AndroidNotificationChannel(
        'trip_updates',
        'Trip Updates',
        description: 'Driver assignment, arrival, and trip status updates',
        importance: Importance.max,
        playSound: true,
        enableVibration: true,
      );

      await _localNotif
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(driverChannel);

      // Init local notifications
      const initSettings = InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      );
      await _localNotif.initialize(initSettings,
        onDidReceiveNotificationResponse: _onNotifTap);

      // Register background handler
      FirebaseMessaging.onBackgroundMessage(firebaseBackgroundMessageHandler);

      // Foreground notifications
      FirebaseMessaging.onMessage.listen(_onForegroundMessage);

      // App opened from background notification
      FirebaseMessaging.onMessageOpenedApp.listen(_onNotificationOpened);

      // App launched from terminated notification
      try {
        final initial = await messaging.getInitialMessage();
        if (initial != null) _handleMessage(initial);
      } catch (e) {
        debugPrint('[FCM-CUSTOMER] getInitialMessage error: $e');
      }

      // Save token
      _saveFcmToken(); // Run in background, don't await indefinitely
      messaging.onTokenRefresh.listen(_saveTokenToServer);
    } catch (e) {
      debugPrint('[FCM-CUSTOMER] ❌ Fatal error during FcmService.init(): $e');
    }
  }

  Future<void> _saveFcmToken() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) {
        debugPrint('[FCM-CUSTOMER] ❌ getToken() returned null — Firebase not ready?');
        return;
      }
      if (kDebugMode) {
      debugPrint('[FCM-CUSTOMER] 🔑 Token obtained: ${token.substring(0, 20)}...');
      }
      await _saveTokenToServer(token);
    } catch (e) {
      debugPrint('[FCM-CUSTOMER] ❌ getToken() threw: $e');
    }
  }

  Future<void> _saveTokenToServer(String token) async {
    try {
      final authToken = await AuthService.getToken();
      if (authToken == null) {
        debugPrint('[FCM-CUSTOMER] ⚠️  No auth_token in prefs — token NOT saved (login first)');
        return;
      }
      if (kDebugMode) {
      debugPrint('[FCM-CUSTOMER] 📤 Saving token to server: ${token.substring(0, 20)}...');
      }
      final res = await http.post(
        Uri.parse(ApiConfig.fcmToken),
        headers: {
          'Authorization': 'Bearer $authToken',
          'Content-Type': 'application/json'
        },
        body: jsonEncode({
          'fcmToken': token,
          'platform': 'android',
          'userType': 'customer',
        }),
      ).timeout(const Duration(seconds: 30));
      if (res.statusCode == 200 || res.statusCode == 201) {
        debugPrint('[FCM-CUSTOMER] ✅ Token saved to server (HTTP ${res.statusCode})');
      } else {
        debugPrint('[FCM-CUSTOMER] ⚠️  Server rejected token: HTTP ${res.statusCode} — ${res.body}');
      }
    } catch (e) {
      debugPrint('[FCM-CUSTOMER] ❌ Token save failed: $e');
    }
  }

  // Call after successful login
  Future<void> onLoginSuccess() async {
    await _saveFcmToken();
  }

  void _onForegroundMessage(RemoteMessage message) {
    final notif = message.notification;
    if (notif == null) return;

    final type = message.data['type'] ?? '';
    String channelId = 'trip_updates';
    Importance importance = Importance.high;
    if (type == 'driver_arrived' || type == 'trip_accepted' || type == 'driver_assigned') {
      importance = Importance.max;
    }

    _localNotif.show(
      notif.hashCode,
      notif.title,
      notif.body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          channelId,
          'Trip Updates',
          importance: importance,
          priority: Priority.high,
          playSound: true,
          enableVibration: true,
          icon: '@mipmap/ic_launcher',
        ),
        iOS: const DarwinNotificationDetails(
          presentAlert: true,
          presentBadge: true,
          presentSound: true,
        ),
      ),
      payload: jsonEncode(message.data),
    );
  }

  void _onNotificationOpened(RemoteMessage message) => _handleMessage(message);

  void _handleMessage(RemoteMessage message) {
    final data = message.data;
    final type = data['type'] ?? '';
    // Handle all trip-related notification types (driver_assigned = server sends this when trip accepted)
    if (type == 'trip_accepted' || type == 'driver_assigned' ||
        type == 'driver_arrived' || type == 'trip_completed' ||
        type == 'trip_cancelled' || type == 'trip_searching' ||
        type.toString().startsWith('pool_') ||
        type.toString().contains('parcel')) {
      _storePendingNotification(data);
    }
  }

  Future<void> _storePendingNotification(Map<String, dynamic> data) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('pending_notification', jsonEncode(data));
  }

  void _onNotifTap(NotificationResponse response) {
    if (response.payload != null) {
      try {
        final data = jsonDecode(response.payload!);
        _storePendingNotification(Map<String, dynamic>.from(data));
      } catch (_) {}
    }
  }
}
