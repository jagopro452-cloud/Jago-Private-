import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'auth_service.dart';
import 'error_reporting.dart';

class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  IO.Socket? _socket;
  bool _isConnected = false;
  String? _activeTripId; // stored so we can re-join trip room after server restart

  /// Registers a socket event handler wrapped in a try/catch, so a single
  /// malformed/unexpected payload from the server on ANY event can't throw
  /// unguarded inside the socket_io_client callback and destabilize live
  /// trip tracking for the rest of the session. Reports non-fatally to
  /// Crashlytics with the event name for triage. Use this instead of
  /// _socket!.on(...) directly for every event registration below.
  void _on(String event, void Function(dynamic data) handler) {
    _socket!.on(event, (data) {
      try {
        handler(data);
      } catch (e, st) {
        reportSilentFailure('SocketService.on($event)', e, st);
      }
    });
  }

  final _driverAssignedController = StreamController<Map<String, dynamic>>.broadcast();
  final _driverLocationController = StreamController<Map<String, dynamic>>.broadcast();
  final _tripStatusController = StreamController<Map<String, dynamic>>.broadcast();
  final _tripCancelledController = StreamController<Map<String, dynamic>>.broadcast();
  final _connectedController = StreamController<bool>.broadcast();
  final _chatMessageController = StreamController<Map<String, dynamic>>.broadcast();
  final _messageHistoryController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolChatMessageController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolMessageHistoryController = StreamController<Map<String, dynamic>>.broadcast();
  final _noDriversController = StreamController<Map<String, dynamic>>.broadcast();
  final _tripSearchingController = StreamController<Map<String, dynamic>>.broadcast();
  final _paymentPendingController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolStatusController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolSeatUpdateController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolDriverLocationController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolIssueUpdatedController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolRefundUpdatedController = StreamController<Map<String, dynamic>>.broadcast();
  final _poolSafetyUpdatedController = StreamController<Map<String, dynamic>>.broadcast();
  final _parcelStatusController = StreamController<Map<String, dynamic>>.broadcast();
  final _parcelLocationController = StreamController<Map<String, dynamic>>.broadcast();
  final _parcelCancelledController = StreamController<Map<String, dynamic>>.broadcast();
  final _configUpdatedController = StreamController<Map<String, dynamic>>.broadcast();
  final _callIncomingController = StreamController<Map<String, dynamic>>.broadcast();
  final _callOfferController = StreamController<Map<String, dynamic>>.broadcast();
  final _callAnswerController = StreamController<Map<String, dynamic>>.broadcast();
  final _callIceController = StreamController<Map<String, dynamic>>.broadcast();
  final _callEndedController = StreamController<Map<String, dynamic>>.broadcast();
  final _callRejectedController = StreamController<Map<String, dynamic>>.broadcast();
  final _callErrorController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get onDriverAssigned => _driverAssignedController.stream;
  Stream<Map<String, dynamic>> get onDriverLocation => _driverLocationController.stream;
  Stream<Map<String, dynamic>> get onTripStatus => _tripStatusController.stream;
  Stream<Map<String, dynamic>> get onTripCancelled => _tripCancelledController.stream;
  Stream<bool> get onConnectionChanged => _connectedController.stream;
  Stream<Map<String, dynamic>> get onChatMessage => _chatMessageController.stream;
  Stream<Map<String, dynamic>> get onMessageHistory => _messageHistoryController.stream;
  Stream<Map<String, dynamic>> get onPoolChatMessage => _poolChatMessageController.stream;
  Stream<Map<String, dynamic>> get onPoolMessageHistory => _poolMessageHistoryController.stream;
  Stream<Map<String, dynamic>> get onNoDrivers => _noDriversController.stream;
  Stream<Map<String, dynamic>> get onTripSearching => _tripSearchingController.stream;
  Stream<Map<String, dynamic>> get onPaymentPending => _paymentPendingController.stream;
  Stream<Map<String, dynamic>> get onPoolStatus => _poolStatusController.stream;
  Stream<Map<String, dynamic>> get onPoolSeatUpdate => _poolSeatUpdateController.stream;
  Stream<Map<String, dynamic>> get onPoolDriverLocation => _poolDriverLocationController.stream;
  Stream<Map<String, dynamic>> get onPoolIssueUpdated => _poolIssueUpdatedController.stream;
  Stream<Map<String, dynamic>> get onPoolRefundUpdated => _poolRefundUpdatedController.stream;
  Stream<Map<String, dynamic>> get onPoolSafetyUpdated => _poolSafetyUpdatedController.stream;
  Stream<Map<String, dynamic>> get onParcelStatus => _parcelStatusController.stream;
  Stream<Map<String, dynamic>> get onParcelLocation => _parcelLocationController.stream;
  Stream<Map<String, dynamic>> get onParcelDriverLocation => _parcelLocationController.stream;
  Stream<Map<String, dynamic>> get onParcelCancelled => _parcelCancelledController.stream;
  Stream<Map<String, dynamic>> get onConfigUpdated => _configUpdatedController.stream;
  Stream<Map<String, dynamic>> get onCallIncoming => _callIncomingController.stream;
  Stream<Map<String, dynamic>> get onCallOffer => _callOfferController.stream;
  Stream<Map<String, dynamic>> get onCallAnswer => _callAnswerController.stream;
  Stream<Map<String, dynamic>> get onCallIce => _callIceController.stream;
  Stream<Map<String, dynamic>> get onCallEnded => _callEndedController.stream;
  Stream<Map<String, dynamic>> get onCallRejected => _callRejectedController.stream;
  Stream<Map<String, dynamic>> get onCallError => _callErrorController.stream;
  bool get isConnected => _isConnected;

  Future<void> connect(String baseUrl) async {
    // If already connected, no need to create a new socket — but caller may
    // still call trackTrip() after this, which will work because _isConnected=true.
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
          .setQuery({'userId': userId, 'userType': 'customer'})
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
      // Re-join trip room on every connect (first connect + reconnect after restart)
      if (_activeTripId != null) {
        _socket!.emit('customer:track_trip', {'tripId': _activeTripId});
      }
    });

    // On reconnect after server restart: re-join active trip room so events resume
    _on('reconnect', (_) {
      if (_activeTripId != null) {
        _socket!.emit('customer:track_trip', {'tripId': _activeTripId});
      }
    });

    _on('disconnect', (_) {
      _isConnected = false;
      _connectedController.add(false);
    });

    _on('connect_error', (err) {
      _isConnected = false;
      _connectedController.add(false);
    });

    _on('error', (err) {
      _isConnected = false;
      _connectedController.add(false);
      debugPrint('[SOCKET] Error: $err');
    });

    _on('auth:error', (data) {
      debugPrint('[SOCKET] Auth error: $data');
      // If we get an auth error, we might need to refresh the token or re-login.
      // For now, let's just push a disconnected state.
      _isConnected = false;
      _connectedController.add(false);
    });

    // Driver assigned to my trip (socket acceptance path)
    _on('trip:driver_assigned', (data) {
      _driverAssignedController.add(Map<String, dynamic>.from(data));
    });

    // Driver accepted my trip (HTTP acceptance path)
    _on('trip:accepted', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['driver'] = payload['driver'] is Map<String, dynamic>
          ? Map<String, dynamic>.from(payload['driver'])
          : {
              'id': payload['driverId'],
              'fullName': payload['driverName'],
              'phone': payload['driverPhone'],
              'rating': payload['driverRating'],
              'photo': payload['driverPhoto'],
              'vehicleNumber': payload['driverVehicleNumber'],
              'vehicleModel': payload['driverVehicleModel'],
              'vehicleCategory': payload['vehicleName'],
              'lat': payload['lat'],
              'lng': payload['lng'],
            };
      payload['eventType'] = 'trip_accepted';
      _driverAssignedController.add(payload);
      // Keep status stream in sync for tracking UI updates
      _tripStatusController.add({
        'tripId': payload['tripId'],
        'status': 'accepted',
        if (payload['pickupOtp'] != null) 'otp': payload['pickupOtp'],
      });
    });

    // Real-time driver GPS location
    _on('driver:location_update', (data) {
      _driverLocationController.add(Map<String, dynamic>.from(data));
    });

    // Trip status changed (arrived, in_progress, completed, cancelled)
    _on('trip:status_update', (data) {
      if (data == null) return;
      try {
        _tripStatusController.add(Map<String, dynamic>.from(data));
      } catch (e) {
        debugPrint('[SOCKET] Error processing trip:status_update: $e');
      }
    });

    // Some server paths emit completed directly instead of status_update
    _on('trip:completed', (data) {
      if (data == null) return;
      try {
        _activeTripId = null;
        final payload = Map<String, dynamic>.from(data);
        _tripStatusController.add({
          'tripId': payload['tripId'],
          'status': 'completed',
          // Pass through wallet payment info so tracking screen can show correct payment UI
          if (payload['walletPendingAmount'] != null) 'walletPendingAmount': payload['walletPendingAmount'],
          if (payload['walletPaidAmount'] != null) 'walletPaidAmount': payload['walletPaidAmount'],
          if (payload['requiresCashPayment'] != null) 'requiresCashPayment': payload['requiresCashPayment'],
          if (payload['fare'] != null) 'fare': payload['fare'],
          if (payload['userPayable'] != null) 'userPayable': payload['userPayable'],
        });
      } catch (e) {
        debugPrint('[SOCKET] Error processing trip:completed: $e');
      }
    });

    // Trip cancelled by driver
    _on('trip:cancelled', (data) {
      _activeTripId = null;
      _tripCancelledController.add(Map<String, dynamic>.from(data));
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

    // No drivers found — trip auto-cancelled
    _on('trip:no_drivers', (data) {
      _activeTripId = null;
      _noDriversController.add(Map<String, dynamic>.from(data));
      // Also push as cancelled so tracking screen updates
      _tripCancelledController.add({...Map<String, dynamic>.from(data), 'reason': 'no_drivers'});
    });

    // Trip re-searching after driver rejected
    _on('trip:searching', (data) {
      _tripSearchingController.add(Map<String, dynamic>.from(data));
    });

    // Trip timeout — server gave up finding driver
    _on('trip:timeout', (data) {
      _activeTripId = null;
      _noDriversController.add(Map<String, dynamic>.from(data));
      _tripCancelledController.add({...Map<String, dynamic>.from(data), 'reason': 'timeout'});
    });

    // Payment not yet verified — trip held at payment_pending
    _on('trip:payment_pending', (data) {
      _paymentPendingController.add(Map<String, dynamic>.from(data));
    });
    // Local pool real-time status events — backend emits these, not 'pool:status'
    _on('pool:matched', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'local_pool';
      payload['status'] = payload['pendingDriverAccept'] == true
          ? 'pending_driver_accept'
          : 'matched';
      payload['eventType'] = 'matched';
      _poolStatusController.add(payload);
    });
    _on('pool:driver_confirmed', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'local_pool';
      payload['status'] = 'matched';
      payload['eventType'] = 'driver_confirmed';
      _poolStatusController.add(payload);
    });
    _on('pool:picked_up', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'local_pool';
      payload['status'] = 'picked_up';
      payload['eventType'] = 'picked_up';
      _poolStatusController.add(payload);
    });
    _on('pool:dropped', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'local_pool';
      payload['status'] = 'dropped';
      payload['eventType'] = 'dropped';
      _poolStatusController.add(payload);
    });
    _on('pool:cancelled', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'local_pool';
      payload['status'] = 'cancelled';
      payload['eventType'] = 'cancelled';
      _poolStatusController.add(payload);
    });
    _on('pool:driver_confirm_timeout', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'local_pool';
      payload['status'] = 'searching';
      payload['eventType'] = 'driver_confirm_timeout';
      _poolStatusController.add(payload);
    });
    _on('pool:search_timeout', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'local_pool';
      payload['status'] = 'search_timeout';
      payload['eventType'] = 'search_timeout';
      _poolStatusController.add(payload);
    });
    // Driver skipped this passenger — back to searching immediately
    _on('pool:driver_skipped', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'local_pool';
      payload['status'] = 'searching';
      payload['eventType'] = 'driver_skipped';
      _poolStatusController.add(payload);
    });
    _on('pool:seat_update', (data) {
      _poolSeatUpdateController.add(Map<String, dynamic>.from(data));
    });
    _on('outstation_pool:seat_update', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'outstation_pool';
      _poolSeatUpdateController.add(payload);
    });
    _on('pool:driver_location', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'local_pool';
      _poolDriverLocationController.add(payload);
    });
    _on('outstation_pool:driver_location', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'outstation_pool';
      _poolDriverLocationController.add(payload);
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
    _on('outstation_pool:booking_cancelled', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'outstation_pool';
      payload['status'] = payload['status'] ?? 'cancelled';
      payload['eventType'] = 'booking_cancelled';
      _poolStatusController.add(payload);
    });
    _on('outstation_pool:cancellation_confirmed', (data) {
      final payload = Map<String, dynamic>.from(data);
      payload['module'] = 'outstation_pool';
      payload['status'] = payload['status'] ?? 'cancelled';
      payload['eventType'] = 'cancellation_confirmed';
      _poolStatusController.add(payload);
      _poolRefundUpdatedController.add(payload);
    });
    _on('pool:issue_updated', (data) {
      _poolIssueUpdatedController.add(Map<String, dynamic>.from(data));
    });
    _on('pool:refund_updated', (data) {
      _poolRefundUpdatedController.add(Map<String, dynamic>.from(data));
    });
    _on('pool:safety_updated', (data) {
      _poolSafetyUpdatedController.add(Map<String, dynamic>.from(data));
    });
    _on('parcel:status', (data) {
      _parcelStatusController.add(Map<String, dynamic>.from(data));
    });
    _on('parcel:location', (data) {
      _parcelLocationController.add(Map<String, dynamic>.from(data));
    });
    _on('parcel:driver_location', (data) {
      _parcelLocationController.add(Map<String, dynamic>.from(data));
    });
    _on('parcel:cancelled', (data) {
      _parcelCancelledController.add(Map<String, dynamic>.from(data));
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

    _socket!.connect();
  }

  // Start tracking a specific trip (also stored for reconnect recovery).
  // Emits immediately if connected; the stored ID ensures re-join on reconnect.
  void trackTrip(String tripId) {
    _activeTripId = tripId;
    // Always emit if socket exists (even if _isConnected flag not yet set)
    if (_socket != null && (_isConnected || _socket!.connected)) {
      _socket!.emit('customer:track_trip', {'tripId': tripId});
    }
    // If socket not ready yet, the connect handler will pick it up via _activeTripId
  }

  void stopTrackingTrip(String tripId) {
    if (_socket != null && _socket!.connected) {
      _socket!.emit('customer:leave_trip', {'tripId': tripId});
    }
    _activeTripId = null;
  }

  void trackParcel(String orderId) {
    if (_socket != null && (_isConnected || _socket!.connected)) {
      _socket!.emit('parcel:track', {'orderId': orderId});
    }
  }

  void stopTrackingParcel(String orderId) {
    if (_socket != null && _socket!.connected) {
      _socket!.emit('parcel:leave', {'orderId': orderId});
    }
  }

  // Cancel a trip
  void cancelTrip(String tripId) {
    if (!_isConnected) return;
    _socket!.emit('customer:cancel_trip', {'tripId': tripId});
  }

  // Cancel a parcel order
  void cancelParcel(String orderId, {String? reason}) {
    if (!_isConnected) return;
    _socket!.emit('customer:cancel_parcel', {'orderId': orderId, if (reason != null) 'reason': reason});
  }

  // Send in-app chat message (persisted to DB + relayed via socket)
  void sendChatMessage({required String tripId, required String message, required String senderName}) {
    if (!_isConnected) return;
    _socket!.emit('trip:send_message', {
      'tripId': tripId,
      'message': message,
      'senderName': senderName,
      'senderType': 'customer',
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
      'senderType': 'customer',
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
    _socket?.disconnect();
    _socket = null;
    _isConnected = false;
  }

  void dispose() {
    disconnect();
    _driverAssignedController.close();
    _driverLocationController.close();
    _tripStatusController.close();
    _tripCancelledController.close();
    _connectedController.close();
    _chatMessageController.close();
    _messageHistoryController.close();
    _poolChatMessageController.close();
    _poolMessageHistoryController.close();
    _noDriversController.close();
    _tripSearchingController.close();
    _paymentPendingController.close();
    _poolStatusController.close();
    _poolSeatUpdateController.close();
    _poolDriverLocationController.close();
    _poolIssueUpdatedController.close();
    _poolRefundUpdatedController.close();
    _poolSafetyUpdatedController.close();
    _parcelStatusController.close();
    _parcelLocationController.close();
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
