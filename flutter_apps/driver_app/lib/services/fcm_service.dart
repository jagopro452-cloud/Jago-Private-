import 'dart:async';
import 'dart:convert';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../config/api_config.dart';
import 'auth_service.dart';

const String _tripAlertChannelId = 'trip_alerts_v2';
const String _tripAlertChannelName = 'Trip Alerts';
const String _tripAlertChannelDescription = 'Incoming ride and parcel requests';
const String _tripDataKey = 'pending_trip_data';
const String _parcelDataKey = 'pending_parcel_data';
const String _poolDataKey = 'pending_pool_data';
const String _alertActionKey = 'pending_driver_alert_action';
const int _tripNotificationId = 42;
const int _parcelNotificationId = 43;
const String _tripAcceptActionId = 'trip_accept';
const String _tripRejectActionId = 'trip_reject';
const String _parcelOpenActionId = 'parcel_open';

bool _isTripAlert(Map<String, dynamic> data) => (data['type'] ?? '') == 'new_trip';
bool _isParcelAlert(Map<String, dynamic> data) => (data['type'] ?? '') == 'new_parcel';
bool _isPoolAlert(Map<String, dynamic> data) => (data['type'] ?? '').toString().startsWith('pool_');
bool _isDriverAlert(Map<String, dynamic> data) => _isTripAlert(data) || _isParcelAlert(data) || _isPoolAlert(data);

Future<void> _persistPendingAlert(Map<String, dynamic> data) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    if (_isTripAlert(data)) {
      await prefs.setString(_tripDataKey, jsonEncode(data));
    }
    if (_isParcelAlert(data)) {
      await prefs.setString(_parcelDataKey, jsonEncode(data));
    }
    if (_isPoolAlert(data)) {
      await prefs.setString(_poolDataKey, jsonEncode(data));
    }
  } catch (_) {}
}

Future<void> _queueAlertAction(String actionId, Map<String, dynamic> data) async {
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _alertActionKey,
      jsonEncode({
        'actionId': actionId,
        'data': data,
        'queuedAt': DateTime.now().toIso8601String(),
      }),
    );
    await _persistPendingAlert(data);
  } catch (_) {}
}

Future<void> _handleNotificationResponse(NotificationResponse response) async {
  final payload = response.payload;
  if (payload == null || payload.isEmpty) return;

  try {
    final decoded = jsonDecode(payload);
    if (decoded is! Map) return;
    final data = Map<String, dynamic>.from(decoded);
    final actionId = response.actionId;

    if (actionId == _tripAcceptActionId ||
        actionId == _tripRejectActionId ||
        actionId == _parcelOpenActionId) {
      await _queueAlertAction(actionId!, data);
      return;
    }

    await _persistPendingAlert(data);
  } catch (_) {}
}

AndroidNotificationChannel _tripAlertChannel() {
  return const AndroidNotificationChannel(
    _tripAlertChannelId,
    _tripAlertChannelName,
    description: _tripAlertChannelDescription,
    importance: Importance.max,
    playSound: true,
    sound: RawResourceAndroidNotificationSound('trip_alert'),
    enableVibration: true,
    showBadge: true,
  );
}

List<AndroidNotificationAction> _buildAlertActions(Map<String, dynamic> data) {
  if (_isTripAlert(data)) {
    return const <AndroidNotificationAction>[
      AndroidNotificationAction(
        _tripRejectActionId,
        'Reject',
        showsUserInterface: true,
      ),
      AndroidNotificationAction(
        _tripAcceptActionId,
        'Accept',
        showsUserInterface: true,
      ),
    ];
  }

  if (_isParcelAlert(data)) {
    return const <AndroidNotificationAction>[
      AndroidNotificationAction(
        _parcelOpenActionId,
        'Open',
        showsUserInterface: true,
      ),
    ];
  }

  return const <AndroidNotificationAction>[];
}

Future<FlutterLocalNotificationsPlugin> _createAlertPlugin() async {
  final plugin = FlutterLocalNotificationsPlugin();
  const initSettings = InitializationSettings(
    android: AndroidInitializationSettings('@mipmap/ic_launcher'),
  );
  await plugin.initialize(initSettings);
  final androidPlugin =
      plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
  await androidPlugin?.createNotificationChannel(_tripAlertChannel());
  return plugin;
}

Future<void> _showDriverAlertNotification(
  FlutterLocalNotificationsPlugin plugin,
  Map<String, dynamic> data,
) async {
  final isTrip = _isTripAlert(data);
  final isParcel = _isParcelAlert(data);
  if (!isTrip && !isParcel) return;

  final title = data['title'] ??
      (isParcel ? 'New Parcel Delivery!' : 'New Ride Request!');
  final body = data['body'] ??
      (isTrip
          ? '${data['customerName'] ?? 'Customer'} | Fare Rs ${data['estimatedFare'] ?? '0'} | ${data['pickupAddress'] ?? 'Pickup'}'
          : '${data['pickupAddress'] ?? 'Pickup'} | Fare Rs ${data['totalFare'] ?? '0'}');

  await plugin.show(
    isParcel ? _parcelNotificationId : _tripNotificationId,
    title.toString(),
    body.toString(),
    NotificationDetails(
      android: AndroidNotificationDetails(
        _tripAlertChannelId,
        _tripAlertChannelName,
        channelDescription: _tripAlertChannelDescription,
        importance: Importance.max,
        priority: Priority.max,
        playSound: true,
        sound: const RawResourceAndroidNotificationSound('trip_alert'),
        enableVibration: true,
        vibrationPattern: Int64List.fromList([0, 500, 200, 700, 200, 500, 200, 700, 200, 500]),
        icon: '@mipmap/ic_launcher',
        fullScreenIntent: true,
        autoCancel: false,
        ongoing: true,
        category: AndroidNotificationCategory.call,
        visibility: NotificationVisibility.public,
        timeoutAfter: 40000,
        actions: _buildAlertActions(data),
      ),
    ),
    payload: jsonEncode(data),
  );
}

@pragma('vm:entry-point')
Future<void> firebaseBackgroundMessageHandler(RemoteMessage message) async {
  await Firebase.initializeApp();

  final data = Map<String, dynamic>.from(message.data);
  if (!_isDriverAlert(data)) return;

  debugPrint('[FCM-BG] incoming driver alert ${data['type']}');
  await _persistPendingAlert(data);

  final plugin = await _createAlertPlugin();
  await _showDriverAlertNotification(plugin, data);
}

@pragma('vm:entry-point')
void _onBackgroundNotifTap(NotificationResponse response) {
  _handleNotificationResponse(response);
}

class FcmService {
  static final FcmService _instance = FcmService._internal();
  factory FcmService() => _instance;
  FcmService._internal();

  final FlutterLocalNotificationsPlugin _localNotif = FlutterLocalNotificationsPlugin();
  final _foregroundAlertController =
      StreamController<Map<String, dynamic>>.broadcast();
  bool _initialized = false;

  Stream<Map<String, dynamic>> get onForegroundAlert =>
      _foregroundAlertController.stream;

  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    try {
      final messaging = FirebaseMessaging.instance;

      await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        criticalAlert: true,
      ).timeout(
        const Duration(seconds: 10),
        onTimeout: () => const NotificationSettings(
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
        ),
      );

      await messaging.setForegroundNotificationPresentationOptions(
        alert: false,
        badge: true,
        sound: false,
      );

      final androidPlugin = _localNotif
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await androidPlugin?.createNotificationChannel(_tripAlertChannel());
      await androidPlugin?.createNotificationChannel(const AndroidNotificationChannel(
        'trip_updates',
        'Trip Updates',
        description: 'Status updates for active trips',
        importance: Importance.high,
      ));
      const initSettings = InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      );
      await _localNotif.initialize(
        initSettings,
        onDidReceiveNotificationResponse: _onLocalNotifTap,
        onDidReceiveBackgroundNotificationResponse: _onBackgroundNotifTap,
      );

      FirebaseMessaging.onBackgroundMessage(firebaseBackgroundMessageHandler);
      FirebaseMessaging.onMessage.listen(_onForegroundMessage);
      FirebaseMessaging.onMessageOpenedApp.listen(_onNotificationOpened);

      try {
        final initialMsg = await messaging.getInitialMessage();
        if (initialMsg != null) {
          _handleMessageData(initialMsg.data);
        }
      } catch (e) {
        debugPrint('[FCM-PILOT] getInitialMessage error: $e');
      }

      _saveFcmToken();
      messaging.onTokenRefresh.listen((token) => _saveTokenToServer(token));
    } catch (e) {
      debugPrint('[FCM-PILOT] init failed: $e');
    }
  }

  void _onForegroundMessage(RemoteMessage message) {
    final type = message.data['type'] ?? '';
    debugPrint('[FCM-FG] type=$type');

    if (type == 'new_trip' || type == 'new_parcel') {
      final data = Map<String, dynamic>.from(message.data);
      _persistPendingAlert(data);
      _showDriverAlertNotification(_localNotif, data);
      _foregroundAlertController.add(data);
      return;
    }

    _showUpdateNotification(
      title: message.notification?.title ?? message.data['title'] ?? 'JAGO Pro Pilot',
      body: message.notification?.body ?? message.data['body'] ?? '',
      data: message.data,
    );
  }

  void _onNotificationOpened(RemoteMessage message) {
    _handleMessageData(message.data);
  }

  void _handleMessageData(Map<String, dynamic> data) {
    final payload = Map<String, dynamic>.from(data);
    if (!_isDriverAlert(payload)) return;
    _persistPendingAlert(payload);
    _foregroundAlertController.add(payload);
  }

  void _onLocalNotifTap(NotificationResponse response) {
    _handleNotificationResponse(response).then((_) {
      final payload = response.payload;
      if (payload == null || payload.isEmpty) return;
      if (response.actionId != null && response.actionId!.isNotEmpty) return;

      try {
        final decoded = jsonDecode(payload);
        if (decoded is! Map) return;
        _foregroundAlertController.add(Map<String, dynamic>.from(decoded));
      } catch (_) {}
    });
  }

  Future<void> showFullScreenAlert({
    required String title,
    required String body,
    required Map<String, dynamic> data,
    bool isParcel = false,
  }) async {
    final payload = Map<String, dynamic>.from(data);
    await _persistPendingAlert(payload);
    await _localNotif.show(
      isParcel ? _parcelNotificationId : _tripNotificationId,
      title,
      body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _tripAlertChannelId,
          _tripAlertChannelName,
          channelDescription: _tripAlertChannelDescription,
          importance: Importance.max,
          priority: Priority.max,
          playSound: true,
          sound: const RawResourceAndroidNotificationSound('trip_alert'),
          enableVibration: true,
          vibrationPattern: Int64List.fromList([0, 500, 200, 700, 200, 500, 200, 700]),
          icon: '@mipmap/ic_launcher',
          fullScreenIntent: true,
          autoCancel: false,
          ongoing: true,
          category: AndroidNotificationCategory.call,
          visibility: NotificationVisibility.public,
          timeoutAfter: 40000,
          actions: _buildAlertActions(payload),
        ),
      ),
      payload: jsonEncode(payload),
    );
  }

  void _showUpdateNotification({
    required String title,
    required String body,
    Map<String, dynamic>? data,
  }) {
    _localNotif.show(
      title.hashCode.abs() % 1000 + 100,
      title,
      body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          'trip_updates',
          'Trip Updates',
          importance: Importance.high,
          priority: Priority.high,
          playSound: true,
          enableVibration: true,
          autoCancel: true,
          icon: '@mipmap/ic_launcher',
        ),
        iOS: const DarwinNotificationDetails(
          presentAlert: true,
          presentBadge: true,
          presentSound: true,
        ),
      ),
      payload: data != null ? jsonEncode(data) : null,
    );
  }

  Future<void> dismissTripNotification() async {
    try {
      await _localNotif.cancel(_tripNotificationId);
      await _localNotif.cancel(_parcelNotificationId);
    } catch (_) {}
  }

  Future<Map<String, dynamic>?> consumeQueuedAction() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_alertActionKey);
      if (raw == null || raw.isEmpty) return null;
      await prefs.remove(_alertActionKey);
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        return decoded;
      }
    } catch (_) {}
    return null;
  }

  Future<void> _saveFcmToken() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) {
        debugPrint('[FCM-PILOT] getToken returned null');
        return;
      }
      if (kDebugMode) {
        debugPrint('[FCM-PILOT] token obtained');
      }
      await _saveTokenToServer(token);
    } catch (e) {
      debugPrint('[FCM-PILOT] getToken failed: $e');
    }
  }

  Future<void> _saveTokenToServer(String token) async {
    try {
      final authToken = await AuthService.getToken();
      if (authToken == null) return;
      final res = await http.post(
        Uri.parse(ApiConfig.fcmToken),
        headers: {
          'Authorization': 'Bearer $authToken',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'fcmToken': token,
          'platform': 'android',
          'userType': 'driver',
        }),
      ).timeout(const Duration(seconds: 30));
      if (res.statusCode == 200 || res.statusCode == 201) {
        debugPrint('[FCM-PILOT] token saved');
      }
    } catch (e) {
      debugPrint('[FCM-PILOT] token save failed: $e');
    }
  }

  Future<void> onLoginSuccess() async {
    debugPrint('[FCM-PILOT] re-saving token after login');
    await _saveFcmToken();
  }
}
