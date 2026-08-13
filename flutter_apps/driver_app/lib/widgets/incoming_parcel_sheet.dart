import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:flutter_tts/flutter_tts.dart';
import '../services/alarm_service.dart';
import '../config/jago_theme.dart';

/// Full-screen parcel request overlay.
/// - Plays looping alarm siren (same as ride)
/// - VOICE announcement via TTS: "New parcel delivery request!"
/// - Vibrates every 400ms
/// - Auto-rejects after 40 seconds if driver doesn't respond
class IncomingParcelSheet extends StatefulWidget {
  final Map<String, dynamic> parcel;
  final VoidCallback onAccept;
  final VoidCallback onSkip;
  const IncomingParcelSheet({
    super.key,
    required this.parcel,
    required this.onAccept,
    required this.onSkip,
  });
  @override
  State<IncomingParcelSheet> createState() => _IncomingParcelSheetState();
}

class _IncomingParcelSheetState extends State<IncomingParcelSheet>
    with TickerProviderStateMixin {
  late AnimationController _pulseCtrl;
  int _countdown = 40;
  Timer? _countdownTimer;
  Timer? _vibrationTimer;
  bool _responded = false;
  final FlutterTts _tts = FlutterTts();

  @override
  void initState() {
    super.initState();

    _pulseCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 600))
      ..repeat(reverse: true);
    // Start loud alarm siren
    AlarmService().startAlarm();

    // Voice announcement — TTS
    _announceVoice();

    // Vibration burst on arrival
    _triggerBurst();

    // Continuous vibration every 400ms
    _vibrationTimer = Timer.periodic(const Duration(milliseconds: 400), (t) {
      if (!mounted) { t.cancel(); return; }
      HapticFeedback.heavyImpact();
    });

    // 40-second countdown → auto-skip
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) { t.cancel(); return; }
      if (_countdown <= 0) {
        t.cancel();
        _autoSkip();
        return;
      }
      setState(() => _countdown--);
    });
  }

  Future<void> _announceVoice() async {
    try {
      await _tts.setLanguage('en-IN');
      await _tts.setSpeechRate(0.45);
      await _tts.setVolume(1.0);
      await _tts.setPitch(1.0);
      // Small delay so alarm starts first
      await Future.delayed(const Duration(milliseconds: 400));
      await _tts.speak('New parcel delivery request! Accept now.');
    } catch (_) {}
  }

  void _triggerBurst() {
    for (int i = 0; i < 5; i++) {
      Future.delayed(Duration(milliseconds: 80 * i), () {
        if (mounted) {
          HapticFeedback.heavyImpact();
          if (i % 2 == 0) SystemSound.play(SystemSoundType.alert);
        }
      });
    }
  }

  Future<void> _stopAll() async {
    _countdownTimer?.cancel();
    _vibrationTimer?.cancel();
    try { await _tts.stop(); } catch (_) {}
    await AlarmService().stopAlarm();
  }

  Future<void> _respond(bool accepted) async {
    if (_responded) return;
    _responded = true;
    await _stopAll();
    if (accepted) {
      widget.onAccept();
    } else {
      widget.onSkip();
    }
  }

  Future<void> _autoSkip() async {
    if (_responded) return;
    _responded = true;
    await _stopAll();
    widget.onSkip();
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    _countdownTimer?.cancel();
    _vibrationTimer?.cancel();
    if (!_responded) {
      _tts.stop();
      AlarmService().stopAlarm();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final parcel = widget.parcel;
    final vehicleType = parcel['vehicleCategory']?.toString() ?? 'bike_parcel';
    final fare = parcel['totalFare'] ?? 0;
    final stops = parcel['dropCount'] ?? 1;
    final weight = parcel['weightKg']?.toString() ?? '';
    final pickup = parcel['pickupAddress']?.toString() ?? parcel['pickup_address']?.toString() ?? '';
    final isFragile = parcel['isFragile'] == true;
    final urgency = _countdown <= 10;

    final vehicleIcon = vehicleType.contains('pickup') || vehicleType.contains('truck')
        ? Icons.fire_truck_rounded
        : vehicleType.contains('tata') || vehicleType.contains('mini') || vehicleType.contains('tempo')
            ? Icons.local_shipping_rounded
            : vehicleType.contains('auto') ? Icons.electric_rickshaw_rounded
            : Icons.electric_bike_rounded;

    final vehicleName = vehicleType.contains('pickup') || vehicleType.contains('truck') ? 'Pickup Truck'
        : vehicleType.contains('tata') || vehicleType.contains('mini') || vehicleType.contains('tempo') ? 'Mini Truck'
        : vehicleType.contains('auto') ? 'Auto Parcel'
        : 'Bike Parcel';

    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: const Color(0xFF0B0B0B),
        body: SafeArea(
          child: Column(children: [
            // ── Header ──────────────────────────────────────────────────────
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: urgency
                      ? [const Color(0xFFF59E0B).withValues(alpha: 0.18), const Color(0xFFF59E0B).withValues(alpha: 0.05)]
                      : [const Color(0xFFF59E0B).withValues(alpha: 0.15), Colors.transparent],
                  begin: Alignment.topLeft, end: Alignment.bottomRight),
                border: Border(bottom: BorderSide(color: Colors.white.withValues(alpha: 0.06))),
              ),
              child: Row(children: [
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    AnimatedBuilder(
                      animation: _pulseCtrl,
                      builder: (_, __) => Container(
                        width: 10, height: 10,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: const Color(0xFFF59E0B),
                          boxShadow: [BoxShadow(
                            color: const Color(0xFFF59E0B).withValues(alpha: 0.4 + 0.4 * _pulseCtrl.value),
                            blurRadius: 8 + 4 * _pulseCtrl.value)],
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      urgency ? 'Respond Now!' : 'New Parcel Delivery!',
                      style: TextStyle(
                        color: urgency ? const Color(0xFFF59E0B) : Colors.white,
                        fontSize: 22, fontWeight: FontWeight.w500, letterSpacing: -0.3),
                    ),
                  ]),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF59E0B).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0xFFF59E0B).withValues(alpha: 0.4))),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      const Text('📦', style: TextStyle(fontSize: 13)),
                      const SizedBox(width: 6),
                      Text(vehicleName, style: const TextStyle(
                        color: Color(0xFFF59E0B), fontSize: 12, fontWeight: FontWeight.w400, letterSpacing: 0.4)),
                    ]),
                  ),
                ])),
                const SizedBox(width: 16),
                AnimatedBuilder(
                  animation: _pulseCtrl,
                  builder: (_, __) => Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: urgency
                          ? const Color(0xFFF59E0B).withValues(alpha: 0.20 + 0.08 * _pulseCtrl.value)
                          : Colors.white.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: const Color(0xFFF59E0B).withValues(alpha: urgency ? 0.55 : 0.28),
                      ),
                    ),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.timer_rounded,
                          color: urgency ? const Color(0xFFF59E0B) : Colors.white,
                          size: 16),
                      const SizedBox(width: 6),
                      Text('$_countdown s',
                          style: TextStyle(
                            color: urgency ? const Color(0xFFF59E0B) : Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                          )),
                    ]),
                  ),
                ),
              ]),
            ),

            // ── Details ──────────────────────────────────────────────────────
            Expanded(child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                // Vehicle icon + fare
                Row(children: [
                  AnimatedBuilder(
                    animation: _pulseCtrl,
                    builder: (_, __) => Container(
                      width: 80, height: 80,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: const Color(0xFFF59E0B).withValues(alpha: 0.08 + 0.06 * _pulseCtrl.value),
                        border: Border.all(color: const Color(0xFFF59E0B).withValues(alpha: 0.3 + 0.2 * _pulseCtrl.value), width: 2),
                        boxShadow: [BoxShadow(
                          color: const Color(0xFFF59E0B).withValues(alpha: 0.1 + 0.15 * _pulseCtrl.value),
                          blurRadius: 18 + 8 * _pulseCtrl.value)],
                      ),
                      child: Icon(vehicleIcon, color: const Color(0xFFF59E0B), size: 38)),
                  ),
                  const SizedBox(width: 16),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(vehicleName, style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w400)),
                    const SizedBox(height: 4),
                    Text('Parcel Delivery', style: TextStyle(color: Colors.white.withValues(alpha: 0.45), fontSize: 13)),
                  ])),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(colors: [Color(0xFFF59E0B), Color(0xFFD97706)]),
                      borderRadius: BorderRadius.circular(14),
                      boxShadow: [BoxShadow(color: const Color(0xFFF59E0B).withValues(alpha: 0.4), blurRadius: 12)]),
                    child: Text('₹${fare}',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 24)),
                  ),
                ]),
                const SizedBox(height: 18),

                // Stats row
                Row(children: [
                  _stat(Icons.place_rounded, '$stops stop${stops > 1 ? 's' : ''}', 'Drops', const Color(0xFFF59E0B)),
                  const SizedBox(width: 8),
                  if (weight.isNotEmpty) _stat(Icons.scale_rounded, '$weight kg', 'Weight', JT.primary),
                  if (isFragile) ...[const SizedBox(width: 8),
                    _stat(Icons.warning_amber_rounded, 'Fragile', 'Handle\nCare', Colors.red)],
                ]),
                const SizedBox(height: 14),

                // Pickup address
                if (pickup.isNotEmpty) Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.04),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.08))),
                  child: Row(children: [
                    const Icon(Icons.store_rounded, color: Color(0xFF10B981), size: 20),
                    const SizedBox(width: 10),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('PICKUP', style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 10, fontWeight: FontWeight.w500, letterSpacing: 0.8)),
                      const SizedBox(height: 4),
                      Text(pickup, style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w500), maxLines: 2, overflow: TextOverflow.ellipsis),
                    ])),
                  ]),
                ),
              ]),
            )),

            // ── Action buttons ────────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
              child: Column(children: [
                // ACCEPT
                GestureDetector(
                  onTap: () => _respond(true),
                  child: Container(
                    width: double.infinity, height: 76,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFFF59E0B), Color(0xFFD97706)],
                        begin: Alignment.topLeft, end: Alignment.bottomRight),
                      borderRadius: BorderRadius.circular(20),
                      boxShadow: [BoxShadow(color: const Color(0xFFF59E0B).withValues(alpha: 0.45), blurRadius: 24, offset: const Offset(0, 8))]),
                    child: Center(child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      const Icon(Icons.inventory_2_rounded, color: Colors.white, size: 30),
                      const SizedBox(width: 12),
                      Text('ACCEPT DELIVERY',
                        style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 20)),
                    ])),
                  ),
                ),
                const SizedBox(height: 12),
                // SKIP
                GestureDetector(
                  onTap: () => _respond(false),
                  child: Container(
                    width: double.infinity, height: 50,
                    decoration: BoxDecoration(
                      color: Colors.red.withValues(alpha: 0.07),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: Colors.red.withValues(alpha: 0.22), width: 1.5)),
                    child: Center(child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      const Icon(Icons.close_rounded, color: Color(0xFFF87171), size: 20),
                      const SizedBox(width: 8),
                      const Text('Skip this delivery',
                        style: TextStyle(color: Color(0xFFF87171), fontWeight: FontWeight.w400, fontSize: 15)),
                    ])),
                  ),
                ),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _stat(IconData icon, String value, String label, Color color) {
    return Expanded(child: Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.15))),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(height: 4),
        Text(value, style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.w500), textAlign: TextAlign.center),
        Text(label, style: TextStyle(color: Colors.white.withValues(alpha: 0.35), fontSize: 9, fontWeight: FontWeight.w400), textAlign: TextAlign.center),
      ]),
    ));
  }
}
