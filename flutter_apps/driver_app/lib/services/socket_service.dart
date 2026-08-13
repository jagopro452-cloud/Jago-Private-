import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:socket_io_client/socket_io_client.dart' as IO;
import '../config/api_config.dart';
import 'auth_service.dart';
import 'error_reporting.dart';

class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  IO.Socket? _socket;
  bool _isConnected = false;

  /// Registers a socket event handler wrapped in a try/catch, so a single
  /// malformed/unexpected payload from the server on ANY event can't throw
  /// unguarded inside the socket_io_client callback and destabilize a live
  /// trip/dispatch session. Reports non-fatally to Crashlytics with the
  /// event name for triage. Use this instead of _socket!.on(...) directly.
  void _on(String event, void Function(dynamic data) handler) {
    _socket!.on(event, (data) {
      try {
        handler(data);
      } catch (e, st) {
        reportSilentFailure('SocketService.on($event)', e, st);
      }
    });
  }
  bool _wasOnline = false;
  double? _lastLat;
  double? _lastLng;
  String? _activeTripId; // tracks current trip for room rejoin on reconnect
  DateTime? _lastLocationSentAt; // for auto-offline detection
  Timer? _heartbeatTimer;
  bool _appInBackground = false;

  // In-memory retry buffer for location pings that failed to reach the
  // server over HTTP (socket-disconnected fallback path). Bounded and
  // dropped on staleness rather than persisted - a ping more than 2 min old
  // is no longer useful to backfill, and the app is expected to be
  // foregrounded while online, so surviving a full app restart isn't needed.
  final List<Map<String, dynamic>> _locationRetryQueue = [];
  static const int _maxQueuedLocations = 5;
  static const Duration _maxQueuedAge = Duration(minutes: 2);

  final _newTripController = StreamController<Map<String, dynamic>>.broadcast();
  final _tripCancelledController = StreamController<Map<String, dynamic>>.broadcast();
  final _tripStatusController = StreamController<Map<String, dynamic>>.broadcast();
  final _connectedController = StreamController<bool>.broadcast();
  final _tripTakenController = StreamController<Map<String, dynamic>>.broadcast();
  final _tripTimeoutController = StreamController<Map<String, dynamic>>.broadcast();
  final _chatMessageController = StreamController<Map<String, dynamic>>.broadcast();
  final _messageHistoryController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolChatMessageController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolMessageHistoryController = StreamController<Map<String, dynamic>>.broadcast();
  final _noDriversController = StreamController<Map<String, dynamic>>.broadcast();
  final _newParcelController = StreamController<Map<String, dynamic>>.broadcast();
  final _walletRechargedController = StreamController<Map<String, dynamic>>.broadcast();
  final _walletUpdatedController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolNewPassengerController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolSeatUpdateController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolPassengerCancelledController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolStatusController = StreamController<Map<String, dynamic>>.broadcast();
  final _outstationPoolNewRequestController = StreamController<Map<String, dynamic>>.broadcast();
  final _configUpdatedController = StreamController<Map<String, dynamic>>.broadcast();
  final _callIncomingController = StreamController<Map<String, dynamic>>.broadcast();
  final _callOfferController = StreamController<Map<String, dynamic>>.broadcast();
  final _callAnswerController = StreamController<Map<String, dynamic>>.broadcast();
  final _callIceController = StreamController<Map<String, dynamic>>.broadcast();
  final _callEndedController = StreamController<Map<String, dynamic>>.broadcast();
  final _callRejectedController = StreamController<Map<String, dynamic>>.broadcast();
  final _callErrorController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get onNewTrip => _newTripController.stream;
  Stream<Map<String, dynamic>> get onTripCancelled => _tripCancelledController.stream;
  Stream<Map<String, dynamic>> get onTripStatus => _tripStatusController.stream;
  Stream<bool> get onConnectionChanged => _connectedController.stream;
  Stream<Map<String, dynamic>> get onTripTaken => _tripTakenController.stream;
  Stream<Map<String, dynamic>> get onTripTimeout => _tripTimeoutController.stream;
  Stream<Map<String, dynamic>> get onChatMessage => _chatMessageController.stream;
  Stream<Map<String, dynamic>> get onMessageHistory => _messageHistoryController.stream;
  Stream<Map<String, dynamic>> get onPoolChatMessage => _poolChatMessageController.stream;
  Stream<Map<String, dynamic>> get onPoolMessageHistory => _poolMessageHistoryController.stream;
  Stream<Map<String, dynamic>> get onNoDrivers => _noDriversController.stream;
  Stream<Map<String, dynamic>> get onNewParcel => _newParcelController.stream;
  Stream<Map<String, dynamic>> get onWalletRecharged => _walletRechargedController.stream;
  Stream<Map<String, dynamic>> get onWalletUpdated => _walletUpdatedController.stream;
  Stream<Map<String, dynamic>> get onPoolNewPassenger => _poolNewPassengerController.stream;
  Stream<Map<String, dynamic>> get onPoolSeatUpdate => _poolSeatUpdateController.stream;
  Stream<Map<String, dynamic>> get onPoolPassengerCancelled => _poolPassengerCancelledController.stream;
  Stream<Map<String, dynamic>> get onPoolStatus => _poolStatusController.stream;
  Stream<Map<String, dynamic>> get onOutstationPoolNewRequest => _outstationPoolNewRequestController.stream;
  Stream<Map<String, dynamic>> get onConfigUpdated => _configUpdatedController.stream;
  Stream<Map<String, dynamic>> get onCallIncoming => _callIncomingController.stream;
  Stream<Map<String, dynamic>> get onCallOffer => _callOfferController.stream;
  Stream<Map<String, dynamic>> get onCallAnswer => _callAnswerController.stream;
  Stream<Map<String, dynamic>> get onCallIce => _callIceController.stream;
  Stream<Map<String, dynamic>> get onCallEnded => _callEndedController.stream;
  Stream<Map<String, dynamic>> get onCallRejected => _callRejectedController.stream;
  Stream<Map<String, dynamic>> get onCallError => _callErrorController.stream;
  bool get isConnected => _isConnected;

  void setAppInBackground(bool value) {
    _appInBackground = value;
  }

  Future<void> connect(String baseUrl) async {
    if (_socket?.connected == true) return;

    // getUserId() recovers from saved user JSON (and persists the recovery)
    // for older installs where user_id was never stored separately.
    final userId = await AuthService.getUserId();
    final token = await AuthService.getToken() ?? '';

    if (userId.isEmpty) return;

    _socket = IO.io(
      baseUrl,
      IO.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          // userId/userType are non-sensitive routing hints only - the auth
          // token goes in the auth payload, not the query string, so it
          // isn't captured by proxy/load-balancer access logs (server
          // already reads handshake.auth?.token as a fallback).
          .setQuery({'userId': userId, 'userType': 'driver'})
          .setAuth({'token': token})
          .enableAutoConnect()
          .enableReconnection()
          .setReconnectionAttempts(999)
          .setReconnectionDelay(3000)
          .build(),
    );

    _on('connect', (_) {
      _isConnected = true;
      _connectedController.add(true);
    });

    // On reconnect after server restart: restore online status so driver stays visible
    _on('reconnect', (_) {
      if (_wasOnline) {
        _socket!.emit('driver:online', {
          'isOnline': true,
          if (_lastLat != null) 'lat': _lastLat,
          if (_lastLng != null) 'lng': _lastLng,
        });
      }
      // Rejoin active trip room so server routes trip events to this socket again
      if (_activeTripId != null) {
        _socket!.emit('driver:rejoin_trip', {'tripId': _activeTripId});
        // Also re-emit last location so server has fresh data for this trip
        if (_lastLat != null && _lastLng != null) {
          _socket!.emit('driver:location', {'lat': _lastLat, 'lng': _lastLng, 'heading': 0, 'speed': 0});
        }
      }
    });

    _on('disconnect', (_) {
      _isConnected = false;
      _connectedController.add(false);
    });

    _on('trip:new_request', (data) {
      _newTripController.add(Map<String, dynamic>.from(data));
    });

    _on('trip:cancelled', (data) {
      _activeTripId = null;
      _tripCancelledController.add(Map<String, dynamic>.from(data));
    });

    _on('trip:status_update', (data) {
      final map = Map<String, dynamic>.from(data);
      final status = (map['status'] ?? map['currentStatus'] ?? '').toString();
      if (status == 'completed' || status == 'cancelled') {
        _activeTripId = null;
      }
      _tripStatusController.add(map);
    });

    _on('trip:request_taken', (data) {
      _tripTakenController.add(Map<String, dynamic>.from(data));
    });

    // Backend emits 'trip:offer_timeout' when driver doesn't respond in time
    _on('trip:offer_timeout', (data) {
      _tripTimeoutController.add(Map<String, dynamic>.from(data));
    });
    // Also handle legacy event name
    _on('trip:timeout', (data) {
      _tripTimeoutController.add(Map<String, dynamic>.from(data));
    });

    // In-app chat message received (live)
    _on('trip:new_message', (data) {
      _chatMessageController.add(Map<String, dynamic>.from(data));
    });

    // Chat history loaded from DB on reconnect
    _on('trip:message_history', (data) {
      _messageHistoryController.add(Map<String, dynamic>.from(data));
    });
    _on('pool:new_message', (data) {
      _poolChatMessageController.add(Map<String, dynamic>.from(data));
    });
    _on('pool:message_history', (data) {
      _poolMessageHistoryController.add(Map<String, dynamic>.from(data));
    });

    // No available drivers found within all reassignment rounds
    _on('trip:no_drivers', (data) {
      _noDriversController.add(Map<String, dynamic>.from(data));
    });

    // Parcel delivery request
    _on('parcel:new_request', (data) {
      _newParcelController.add(Map<String, dynamic>.from(data));
    });

    // Wallet recharged (after Razorpay payment verified)
    _on('wallet:recharged', (data) {
      final payload = Map<String, dynamic>.from(data);
      _walletRechargedController.add(payload);
      _walletUpdatedController.add(payload);
    });
    _on('wallet:updated', (data) {
      _walletUpdatedController.add(Map<String, dynamic>.from(data));
    });
    _on('pool:new_passenger', (data) {
      _poolNewPassengerController.add(Map<String, dynamic>.from(data));
    });
    // Outstation pool auto-match: a customer request was proposed to this
    // driver's active availability window; driver must accept/skip within
    // expiresInSeconds or it auto-releases back to the matching pool.
    _on('outstation_pool:new_request', (data) {
      _outstationPoolNewRequestController.add(Map<String, dynamic>.from(data));
    });
    _on('outstation_pool:new_booking', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'outstation_pool';
      _poolNewPassengerController.add(payload);
    });
    _on('pool:seat_update', (data) {
      _poolSeatUpdateController.add(Map<String, dynamic>.from(data));
    });
    _on('outstation_pool:seat_update', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'outstation_pool';
      _poolSeatUpdateController.add(payload);
    });
    _on('pool:passenger_cancelled', (data) {
      _poolPassengerCancelledController.add(Map<String, dynamic>.from(data));
    });
    _on('outstation_pool:booking_cancelled', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'outstation_pool';
      payload['eventType'] = 'booking_cancelled';
      _poolPassengerCancelledController.add(payload);
      _poolStatusController.add(payload);
    });
    _on('outstation_pool:trip_started', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'outstation_pool';
      payload['status'] = payload['status'] ?? 'active';
      payload['eventType'] = 'trip_started';
      _poolStatusController.add(payload);
    });
    _on('outstation_pool:picked_up', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'outstation_pool';
      payload['status'] = payload['status'] ?? 'picked_up';
      payload['eventType'] = 'picked_up';
      _poolStatusController.add(payload);
    });
    _on('config:updated', (data) {
      _configUpdatedController.add(Map<String, dynamic>.from(data));
    });

    // ── WebRTC Call Signaling ──────────────────────────────────
    _on('call:incoming', (data) {
      _callIncomingController.add(Map<String, dynamic>.from(data));
    });
    _on('call:offer', (data) {
      _callOfferController.add(Map<String, dynamic>.from(data));
    });
    _on('call:answer', (data) {
      _callAnswerController.add(Map<String, dynamic>.from(data));
    });
    _on('call:ice', (data) {
      _callIceController.add(Map<String, dynamic>.from(data));
    });
    _on('call:ended', (data) {
      _callEndedController.add(Map<String, dynamic>.from(data));
    });
    _on('call:rejected', (data) {
      _callRejectedController.add(Map<String, dynamic>.from(data));
    });
    _on('call:error', (data) {
      _callErrorController.add(Map<String, dynamic>.from(data));
    });

    // Ping/pong: server pings driver to confirm still active; auto-respond immediately.
    // If driver misses 3 consecutive pings the server applies a penalty automatically.
    _on('system:ping_request', (data) {
      if (_isConnected) {
        _socket!.emit('system:ping_response', {
          'driverId': userId,
          if (data is Map && data['pingId'] != null) 'pingId': data['pingId'],
          if (data is Map && data['tripId'] != null) 'tripId': data['tripId'],
        });
      }
    });
    _on('ping_request', (data) {
      if (_isConnected) {
        _socket!.emit('ping_response', {
          'driverId': userId,
          if (data is Map && data['pingId'] != null) 'pingId': data['pingId'],
          if (data is Map && data['tripId'] != null) 'tripId': data['tripId'],
        });
      }
    });

    _socket!.connect();
    _startHeartbeat();
  }

  /// Heartbeat: if driver is online but no location sent for 15s → auto-offline.
  /// Prevents ghost-online drivers who have GPS failures.
  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (!_wasOnline) return;
      if (_appInBackground || _activeTripId != null) return;
      final last = _lastLocationSentAt;
      if (last == null) return;
      final stale = DateTime.now().difference(last).inSeconds >= 15;
      if (stale && _isConnected) {
        // GPS failed or app went background — mark driver offline
        _socket!.emit('driver:online', {'isOnline': false});
        _wasOnline = false;
      }
    });
  }

  /// Call when driver enters/exits a trip so socket can rejoin room on reconnect.
  /// Also joins the room immediately if connected.
  void setActiveTrip(String? tripId) {
    _activeTripId = tripId;
    if (tripId != null && _isConnected && _socket != null) {
      _socket!.emit('driver:rejoin_trip', {'tripId': tripId});
    }
  }

  void sendLocation({
    required double lat,
    required double lng,
    double heading = 0,
    double speed = 0,
    int? remainingDistanceMeters,
    int? etaSeconds,
  }) {
    _lastLat = lat;
    _lastLng = lng;
    _lastLocationSentAt = DateTime.now();
    if (_isConnected) {
      _socket!.emit('driver:location', {
        'lat': lat,
        'lng': lng,
        'heading': heading,
        'speed': speed,
        if (remainingDistanceMeters != null) 'remainingDistanceMeters': remainingDistanceMeters,
        if (etaSeconds != null) 'etaSeconds': etaSeconds,
      });
      return;
    }
    _postLocationViaHttp(
      lat: lat,
      lng: lng,
      heading: heading,
      speed: speed,
    );
  }

  Future<void> _postLocationViaHttp({
    required double lat,
    required double lng,
    double heading = 0,
    double speed = 0,
  }) async {
    final payload = {
      'lat': lat,
      'lng': lng,
      'heading': heading,
      'speed': speed,
      'isOnline': _wasOnline,
      '_queuedAt': DateTime.now(),
    };
    // Drain anything queued from a previous failure before sending the
    // latest fix, so a brief connectivity blip doesn't silently lose pings.
    if (_locationRetryQueue.isNotEmpty) {
      final pending = List<Map<String, dynamic>>.from(_locationRetryQueue);
      _locationRetryQueue.clear();
      for (final queued in pending) {
        final queuedAt = queued['_queuedAt'] as DateTime;
        if (DateTime.now().difference(queuedAt) > _maxQueuedAge) continue;
        await _sendLocationPayload(queued, requeueOnFailure: true);
      }
    }
    await _sendLocationPayload(payload, requeueOnFailure: true);
  }

  Future<void> _sendLocationPayload(Map<String, dynamic> payload,
      {required bool requeueOnFailure}) async {
    try {
      final token = await AuthService.getToken();
      if (token == null || token.isEmpty) return;
      final body = Map<String, dynamic>.from(payload)..remove('_queuedAt');
      await http.post(
        Uri.parse(ApiConfig.driverLocation),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: jsonEncode(body),
      ).timeout(const Duration(seconds: 10));
    } catch (e, st) {
      reportSilentFailure('SocketService._postLocationViaHttp', e, st);
      if (requeueOnFailure) {
        _locationRetryQueue.add(payload);
        while (_locationRetryQueue.length > _maxQueuedLocations) {
          _locationRetryQueue.removeAt(0);
        }
      }
    }
  }

  void setOnlineStatus({required bool isOnline, double? lat, double? lng}) {
    _wasOnline = isOnline;
    if (lat != null) _lastLat = lat;
    if (lng != null) _lastLng = lng;
    if (_isConnected) {
      _socket!.emit('driver:online', {
        'isOnline': isOnline,
        if (lat != null) 'lat': lat,
        if (lng != null) 'lng': lng,
      });
    } else {
      // Socket not connected — use HTTP fallback so go-online always works
      _setOnlineViaHttp(isOnline: isOnline, lat: lat, lng: lng);
    }
  }

  Future<void> _setOnlineViaHttp({required bool isOnline, double? lat, double? lng}) async {
    try {
      final token = await AuthService.getToken();
      if (token == null) return;
      await http.patch(
        Uri.parse(ApiConfig.driverOnlineStatus),
        headers: {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'},
        body: jsonEncode({
          'isOnline': isOnline,
          if (lat != null) 'lat': lat,
          if (lng != null) 'lng': lng,
        }),
      ).timeout(const Duration(seconds: 10));
    } catch (_) {}
  }

  Future<bool> acceptTrip(String tripId) async {
    if (!_isConnected) return false;
    final completer = Completer<bool>();

    // Safe complete guard — prevents double-completion race between ack and once listeners
    void safeComplete(bool value) {
      if (!completer.isCompleted) completer.complete(value);
    }

    _socket!.emitWithAck('driver:accept_trip', {'tripId': tripId}, ack: (data) {
      if (data is Map && data['ok'] == false) {
        safeComplete(false);
        return;
      }
      safeComplete(true);
    });
    _socket!.once('driver:accept_trip_ok', (_) => safeComplete(true));
    _socket!.once('driver:accept_trip_error', (_) => safeComplete(false));

    return completer.future.timeout(
      const Duration(seconds: 10),
      onTimeout: () {
        safeComplete(false);
        return false;
      },
    );
  }

  void updateTripStatus(String tripId, String status, {String? otp}) {
    if (!_isConnected) return;
    _socket!.emit('driver:trip_status', {
      'tripId': tripId,
      'status': status,
      if (otp != null) 'otp': otp,
    });
  }

  // Send in-app chat message (persisted to DB + relayed via socket)
  void sendChatMessage({required String tripId, required String message, required String senderName}) {
    if (!_isConnected) return;
    _socket!.emit('trip:send_message', {
      'tripId': tripId,
      'message': message,
      'senderName': senderName,
      'senderType': 'driver',
    });
  }

  // Load message history from DB (call after joining trip room)
  void loadChatHistory(String tripId) {
    if (!_isConnected) return;
    _socket!.emit('trip:get_messages', {'tripId': tripId});
  }

  void joinPoolChat({required String module, required String referenceId}) {
    if (!_isConnected) return;
    _socket!.emit('pool:join_chat', {'module': module, 'referenceId': referenceId});
  }

  void sendPoolChatMessage({
    required String module,
    required String referenceId,
    required String message,
    required String senderName,
  }) {
    if (!_isConnected) return;
    _socket!.emit('pool:send_message', {
      'module': module,
      'referenceId': referenceId,
      'message': message,
      'senderName': senderName,
      'senderType': 'driver',
    });
  }

  void loadPoolChatHistory({required String module, required String referenceId}) {
    if (!_isConnected) return;
    _socket!.emit('pool:get_messages', {'module': module, 'referenceId': referenceId});
  }

  // ── WebRTC Call Methods ──────────────────────────────────
  void initiateCall({required String targetUserId, required String tripId, required String callerName, String scope = 'trip', String? module}) {
    if (!_isConnected) return;
    _socket!.emit('call:initiate', {'targetUserId': targetUserId, 'tripId': tripId, 'callerName': callerName, 'scope': scope, if (module != null) 'module': module});
  }

  void sendCallOffer({required String targetUserId, required String tripId, required dynamic sdp, String scope = 'trip', String? module}) {
    if (!_isConnected) return;
    _socket!.emit('call:offer', {'targetUserId': targetUserId, 'tripId': tripId, 'sdp': sdp, 'scope': scope, if (module != null) 'module': module});
  }

  void sendCallAnswer({required String targetUserId, required String tripId, required dynamic sdp, String scope = 'trip', String? module}) {
    if (!_isConnected) return;
    _socket!.emit('call:answer', {'targetUserId': targetUserId, 'tripId': tripId, 'sdp': sdp, 'scope': scope, if (module != null) 'module': module});
  }

  void sendIceCandidate({required String targetUserId, required String tripId, required dynamic candidate, String scope = 'trip', String? module}) {
    if (!_isConnected) return;
    _socket!.emit('call:ice', {'targetUserId': targetUserId, 'tripId': tripId, 'candidate': candidate, 'scope': scope, if (module != null) 'module': module});
  }

  void endCall({required String targetUserId, String? tripId, int? durationSec}) {
    if (!_isConnected) return;
    _socket!.emit('call:end', {'targetUserId': targetUserId, if (tripId != null) 'tripId': tripId, if (durationSec != null) 'durationSec': durationSec});
  }

  void rejectCall({required String targetUserId, String? tripId}) {
    if (!_isConnected) return;
    _socket!.emit('call:reject', {'targetUserId': targetUserId, if (tripId != null) 'tripId': tripId});
  }

  void disconnect() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    _socket?.disconnect();
    _socket = null;
    _isConnected = false;
  }

  void dispose() {
    disconnect();
    _newTripController.close();
    _tripCancelledController.close();
    _tripStatusController.close();
    _connectedController.close();
    _tripTakenController.close();
    _tripTimeoutController.close();
    _chatMessageController.close();
    _messageHistoryController.close();
    _poolChatMessageController.close();
    _poolMessageHistoryController.close();
    _newParcelController.close();
    _noDriversController.close();
    _walletRechargedController.close();
    _walletUpdatedController.close();
    _poolNewPassengerController.close();
    _poolSeatUpdateController.close();
    _poolPassengerCancelledController.close();
    _poolStatusController.close();
    _outstationPoolNewRequestController.close();
    _configUpdatedController.close();
    _callIncomingController.close();
    _callOfferController.close();
    _callAnswerController.close();
    _callIceController.close();
    _callEndedController.close();
    _callRejectedController.close();
    _callErrorController.close();
  }
}
