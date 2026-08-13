import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../services/call_service.dart';

/// Full-screen in-app voice call screen (driver/pilot side).
class CallScreen extends StatefulWidget {
  final String contactName;
  final String tripId;
  final String targetUserId;
  final bool isIncoming;
  final String? callerIdForIncoming;
  final String callScope;
  final String? poolModule;

  const CallScreen({
    super.key,
    required this.contactName,
    required this.tripId,
    required this.targetUserId,
    this.isIncoming = false,
    this.callerIdForIncoming,
    this.callScope = 'trip',
    this.poolModule,
  });

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  final CallService _callService = CallService();
  final List<StreamSubscription> _subs = [];
  CallState _state = CallState.idle;
  bool _isMuted = false;
  bool _isSpeaker = false;
  int _durationSec = 0;
  Timer? _durationTimer;

  @override
  void initState() {
    super.initState();
    _subs.add(_callService.onCallState.listen((s) {
      if (!mounted) return;
      setState(() => _state = s);
      if (s == CallState.connected) _startDurationTimer();
      if (s == CallState.idle || s == CallState.rejected || s == CallState.failed) {
        _durationTimer?.cancel();
        Future.delayed(const Duration(milliseconds: 500), () {
          if (mounted) Navigator.of(context).pop();
        });
      }
    }));

    if (widget.isIncoming) {
      _state = CallState.incoming;
    } else {
      _state = CallState.outgoing;
      _callService.startCall(
        targetUserId: widget.targetUserId,
        tripId: widget.tripId,
        callerName: 'Pilot',
        scope: widget.callScope,
        module: widget.poolModule,
      );
    }
  }

  void _startDurationTimer() {
    _durationTimer?.cancel();
    _durationSec = 0;
    _durationTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _durationSec++);
    });
  }

  String _formatDuration(int sec) {
    final m = (sec ~/ 60).toString().padLeft(2, '0');
    final s = (sec % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  Future<void> _hangUp() async {
    _durationTimer?.cancel();
    await _callService.hangUp();
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _accept() async {
    await _callService.acceptCall(
      callerId: widget.callerIdForIncoming ?? widget.targetUserId,
      tripId: widget.tripId,
      scope: widget.callScope,
      module: widget.poolModule,
    );
  }

  void _reject() {
    _callService.rejectIncomingCall();
    if (mounted) Navigator.of(context).pop();
  }

  @override
  void dispose() {
    _durationTimer?.cancel();
    for (final s in _subs) { s.cancel(); }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1A2E),
      body: SafeArea(
        child: Column(
          children: [
            const Spacer(flex: 2),
            Container(
              width: 100, height: 100,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: const Color(0xFF2F7BFF).withValues(alpha: 0.2),
                border: Border.all(color: const Color(0xFF2F7BFF), width: 3),
              ),
              child: const Icon(Icons.person, size: 50, color: Color(0xFF2F7BFF)),
            ),
            const SizedBox(height: 20),
            Text(
              widget.contactName,
              style: GoogleFonts.poppins(fontSize: 24, fontWeight: FontWeight.w500, color: Colors.white),
            ),
            const SizedBox(height: 8),
            Text(_statusText, style: GoogleFonts.poppins(fontSize: 14, color: Colors.white70)),
            if (_state == CallState.connected) ...[
              const SizedBox(height: 4),
              Text(
                _formatDuration(_durationSec),
                style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w400, color: const Color(0xFF4ADE80)),
              ),
            ],
            const Spacer(flex: 3),
            if (_state == CallState.incoming) _buildIncomingControls()
            else _buildActiveControls(),
            const SizedBox(height: 50),
          ],
        ),
      ),
    );
  }

  String get _statusText {
    switch (_state) {
      case CallState.outgoing: return 'Calling...';
      case CallState.incoming: return 'Incoming call';
      case CallState.connected: return 'Connected';
      case CallState.rejected: return 'Call declined';
      case CallState.idle: return 'Call ended';
      case CallState.failed: return 'Call failed';
    }
  }

  Widget _buildIncomingControls() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        GestureDetector(
          onTap: _reject,
          child: Container(
            width: 70, height: 70,
            decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFEF4444)),
            child: const Icon(Icons.call_end_rounded, color: Colors.white, size: 32),
          ),
        ),
        GestureDetector(
          onTap: _accept,
          child: Container(
            width: 70, height: 70,
            decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFF22C55E)),
            child: const Icon(Icons.call_rounded, color: Colors.white, size: 32),
          ),
        ),
      ],
    );
  }

  Widget _buildActiveControls() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        _controlButton(
          icon: _isMuted ? Icons.mic_off_rounded : Icons.mic_rounded,
          label: _isMuted ? 'Unmute' : 'Mute',
          color: _isMuted ? Colors.white24 : Colors.white12,
          onTap: () {
            setState(() => _isMuted = !_isMuted);
            _callService.setMuted(_isMuted);
          },
        ),
        GestureDetector(
          onTap: _hangUp,
          child: Container(
            width: 70, height: 70,
            decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFEF4444)),
            child: const Icon(Icons.call_end_rounded, color: Colors.white, size: 32),
          ),
        ),
        _controlButton(
          icon: _isSpeaker ? Icons.volume_up_rounded : Icons.volume_down_rounded,
          label: _isSpeaker ? 'Speaker' : 'Earpiece',
          color: _isSpeaker ? Colors.white24 : Colors.white12,
          onTap: () {
            setState(() => _isSpeaker = !_isSpeaker);
            _callService.setSpeakerphone(_isSpeaker);
          },
        ),
      ],
    );
  }

  Widget _controlButton({
    required IconData icon, required String label,
    required Color color, required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 56, height: 56,
          decoration: BoxDecoration(shape: BoxShape.circle, color: color),
          child: Icon(icon, color: Colors.white, size: 26),
        ),
        const SizedBox(height: 8),
        Text(label, style: GoogleFonts.poppins(fontSize: 11, color: Colors.white70)),
      ]),
    );
  }
}
