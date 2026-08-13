import 'dart:async';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:permission_handler/permission_handler.dart';
import 'socket_service.dart';

class CallService {
  static final CallService _instance = CallService._internal();
  factory CallService() => _instance;
  CallService._internal();

  final SocketService _socket = SocketService();

  String? activeCallTripId;
  String? activeCallTargetId;
  String _activeCallScope = 'trip';
  String? _activePoolModule;
  DateTime? _callStartTime;
  bool _isSpeakerphone = false;
  bool _endingLocally = false;

  RTCPeerConnection? _peerConnection;
  MediaStream? _localStream;
  MediaStream? _remoteStream;
  RTCSessionDescription? _pendingRemoteOffer;

  final _remoteStreamController = StreamController<dynamic>.broadcast();
  final _callStateController = StreamController<CallState>.broadcast();
  final _callErrorController = StreamController<String>.broadcast();

  Stream<dynamic> get onRemoteStream => _remoteStreamController.stream;
  Stream<CallState> get onCallState => _callStateController.stream;
  Stream<String> get onCallError => _callErrorController.stream;

  CallState _state = CallState.idle;
  CallState get state => _state;

  final List<StreamSubscription> _subs = [];

  static const Map<String, dynamic> _rtcConfig = {
    'iceServers': [
      {'urls': ['stun:stun.l.google.com:19302']},
      {'urls': ['stun:stun1.l.google.com:19302']},
    ],
    'sdpSemantics': 'unified-plan',
  };

  void init() {
    if (_subs.isNotEmpty) return;
    _subs.add(_socket.onCallIncoming.listen(_handleIncoming));
    _subs.add(_socket.onCallOffer.listen(_handleOffer));
    _subs.add(_socket.onCallAnswer.listen(_handleAnswer));
    _subs.add(_socket.onCallIce.listen(_handleIce));
    _subs.add(_socket.onCallEnded.listen((_) => _handleRemoteEnded()));
    _subs.add(_socket.onCallRejected.listen((_) => _onCallRejected()));
    _subs.add(_socket.onCallError.listen((data) {
      _failCall((data['message'] ?? 'Call failed').toString());
    }));
  }

  Future<void> startCall({
    required String targetUserId,
    required String tripId,
    required String callerName,
    String scope = 'trip',
    String? module,
  }) async {
    if (_state != CallState.idle) return;
    final granted = await _ensureMicrophonePermission();
    if (!granted) {
      _failCall('Microphone permission is required for ride safety calling.');
      return;
    }

    activeCallTargetId = targetUserId;
    activeCallTripId = tripId;
    _activeCallScope = scope;
    _activePoolModule = module;
    _setState(CallState.outgoing);

    try {
      await _preparePeerConnection();
      _socket.initiateCall(
        targetUserId: targetUserId,
        tripId: tripId,
        callerName: callerName,
        scope: scope,
        module: module,
      );
      final offer = await _peerConnection!.createOffer({
        'offerToReceiveAudio': true,
        'offerToReceiveVideo': false,
      });
      await _peerConnection!.setLocalDescription(offer);
      _socket.sendCallOffer(
        targetUserId: targetUserId,
        tripId: tripId,
        scope: scope,
        module: module,
        sdp: {'type': offer.type, 'sdp': offer.sdp},
      );
    } catch (_) {
      _failCall('Unable to start the call.');
    }
  }

  Future<void> acceptCall({
    required String callerId,
    required String tripId,
    String scope = 'trip',
    String? module,
  }) async {
    if (_state == CallState.idle && callerId.isNotEmpty) {
      activeCallTargetId = callerId;
      activeCallTripId = tripId;
      _activeCallScope = scope;
      _activePoolModule = module;
      _setState(CallState.incoming);
    }
    if (_state != CallState.incoming) return;

    final granted = await _ensureMicrophonePermission();
    if (!granted) {
      _failCall('Microphone permission is required for ride safety calling.');
      return;
    }

    activeCallTargetId = callerId;
    activeCallTripId = tripId;
    _activeCallScope = scope;
    _activePoolModule = module;

    try {
      await _preparePeerConnection();
      if (_pendingRemoteOffer != null) {
        await _peerConnection!.setRemoteDescription(_pendingRemoteOffer!);
      }
      final answer = await _peerConnection!.createAnswer({
        'offerToReceiveAudio': true,
        'offerToReceiveVideo': false,
      });
      await _peerConnection!.setLocalDescription(answer);
      _socket.sendCallAnswer(
        targetUserId: callerId,
        tripId: tripId,
        scope: scope,
        module: module,
        sdp: {'type': answer.type, 'sdp': answer.sdp},
      );
      _callStartTime = DateTime.now();
      _setState(CallState.connected);
    } catch (_) {
      _failCall('Unable to answer the call.');
    }
  }

  void rejectIncomingCall() {
    if (activeCallTargetId != null) {
      _socket.rejectCall(
        targetUserId: activeCallTargetId!,
        tripId: activeCallTripId,
      );
    }
    unawaited(_cleanup());
    _setState(CallState.idle);
  }

  Future<void> hangUp() async {
    if (activeCallTargetId != null && !_endingLocally) {
      int? dur;
      if (_callStartTime != null) {
        dur = DateTime.now().difference(_callStartTime!).inSeconds;
      }
      _endingLocally = true;
      _socket.endCall(
        targetUserId: activeCallTargetId!,
        tripId: activeCallTripId,
        durationSec: dur,
      );
    }
    await _cleanup();
    _setState(CallState.idle);
  }

  void setMuted(bool muted) {
    for (final track in _localStream?.getAudioTracks() ?? const <MediaStreamTrack>[]) {
      track.enabled = !muted;
    }
  }

  Future<void> setSpeakerphone(bool enabled) async {
    _isSpeakerphone = enabled;
    await Helper.setSpeakerphoneOn(enabled);
  }

  Future<bool> _ensureMicrophonePermission() async {
    final status = await Permission.microphone.request();
    return status.isGranted;
  }

  Future<void> _preparePeerConnection() async {
    if (_peerConnection != null) return;

    _peerConnection = await createPeerConnection(_rtcConfig);
    _remoteStream = await createLocalMediaStream('remote-audio');
    _remoteStreamController.add(_remoteStream);

    _peerConnection!.onTrack = (RTCTrackEvent event) {
      if (event.streams.isNotEmpty) {
        _remoteStream = event.streams.first;
        _remoteStreamController.add(_remoteStream);
      }
    };
    _peerConnection!.onIceCandidate = (RTCIceCandidate candidate) {
      final targetUserId = activeCallTargetId;
      final tripId = activeCallTripId;
      if (targetUserId == null || tripId == null) return;
      if ((candidate.candidate ?? '').isEmpty) return;
      _socket.sendIceCandidate(
        targetUserId: targetUserId,
        tripId: tripId,
        scope: _activeCallScope,
        module: _activePoolModule,
        candidate: {
          'candidate': candidate.candidate,
          'sdpMid': candidate.sdpMid,
          'sdpMLineIndex': candidate.sdpMLineIndex,
        },
      );
    };
    _peerConnection!.onConnectionState = (RTCPeerConnectionState state) {
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        _callStartTime ??= DateTime.now();
        _setState(CallState.connected);
      } else if (state == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected ||
          state == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
          state == RTCPeerConnectionState.RTCPeerConnectionStateClosed) {
        _handleRemoteEnded();
      }
    };

    _localStream = await navigator.mediaDevices.getUserMedia({
      'audio': {
        'echoCancellation': true,
        'noiseSuppression': true,
        'autoGainControl': true,
      },
      'video': false,
    });

    for (final track in _localStream!.getTracks()) {
      await _peerConnection!.addTrack(track, _localStream!);
    }
    await Helper.setSpeakerphoneOn(_isSpeakerphone);
  }

  void _handleIncoming(Map<String, dynamic> data) {
    if (_state == CallState.connected || _state == CallState.outgoing) return;
    activeCallTargetId = (data['callerId'] ?? data['senderId'] ?? data['userId'])?.toString();
    activeCallTripId = data['tripId']?.toString();
    _activeCallScope = data['callScope']?.toString() == 'pool' ? 'pool' : 'trip';
    _activePoolModule = data['poolModule']?.toString();
    _pendingRemoteOffer = null;
    _setState(CallState.incoming);
  }

  Future<void> _handleOffer(Map<String, dynamic> data) async {
    if (_state == CallState.connected) return;
    activeCallTargetId = data['callerId']?.toString();
    activeCallTripId = data['tripId']?.toString() ?? activeCallTripId;
    _activeCallScope = data['callScope']?.toString() == 'pool' ? 'pool' : _activeCallScope;
    _activePoolModule = data['poolModule']?.toString() ?? _activePoolModule;
    _pendingRemoteOffer = RTCSessionDescription(
      data['sdp']?['sdp']?.toString(),
      data['sdp']?['type']?.toString(),
    );
    if (_state != CallState.incoming) {
      _setState(CallState.incoming);
    }
  }

  Future<void> _handleAnswer(Map<String, dynamic> data) async {
    if (_state != CallState.outgoing || _peerConnection == null) return;
    try {
      final answer = RTCSessionDescription(
        data['sdp']?['sdp']?.toString(),
        data['sdp']?['type']?.toString(),
      );
      await _peerConnection!.setRemoteDescription(answer);
      _callStartTime = DateTime.now();
      _setState(CallState.connected);
    } catch (_) {
      _failCall('Unable to connect the call.');
    }
  }

  Future<void> _handleIce(Map<String, dynamic> data) async {
    if (_peerConnection == null) return;
    final candidateData = data['candidate'];
    if (candidateData is! Map) return;
    final candidate = RTCIceCandidate(
      candidateData['candidate']?.toString(),
      candidateData['sdpMid']?.toString(),
      candidateData['sdpMLineIndex'] is int
          ? candidateData['sdpMLineIndex'] as int
          : int.tryParse(candidateData['sdpMLineIndex']?.toString() ?? ''),
    );
    try {
      await _peerConnection!.addCandidate(candidate);
    } catch (_) {}
  }

  void _handleRemoteEnded() {
    if (_state == CallState.idle) return;
    _endingLocally = true;
    unawaited(_cleanup());
    _setState(CallState.idle);
  }

  void _onCallRejected() {
    unawaited(_cleanup());
    _setState(CallState.rejected);
    Future.delayed(const Duration(seconds: 2), () {
      if (_state == CallState.rejected) _setState(CallState.idle);
    });
  }

  void _failCall(String message) {
    _callErrorController.add(message);
    unawaited(_cleanup());
    _setState(CallState.failed);
    Future.delayed(const Duration(seconds: 2), () {
      if (_state == CallState.failed) _setState(CallState.idle);
    });
  }

  void _setState(CallState s) {
    _state = s;
    _callStateController.add(s);
  }

  Future<void> _cleanup() async {
    for (final track in _localStream?.getTracks() ?? const <MediaStreamTrack>[]) {
      await track.stop();
    }
    for (final track in _remoteStream?.getTracks() ?? const <MediaStreamTrack>[]) {
      await track.stop();
    }
    await _localStream?.dispose();
    await _remoteStream?.dispose();
    await _peerConnection?.close();
    _peerConnection = null;
    _localStream = null;
    _remoteStream = null;
    _pendingRemoteOffer = null;
    activeCallTargetId = null;
    activeCallTripId = null;
    _activeCallScope = 'trip';
    _activePoolModule = null;
    _callStartTime = null;
    _isSpeakerphone = false;
    _endingLocally = false;
    _remoteStreamController.add(null);
  }

  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _subs.clear();
    unawaited(_cleanup());
    _remoteStreamController.close();
    _callStateController.close();
    _callErrorController.close();
  }
}

enum CallState { idle, outgoing, incoming, connected, rejected, failed }
