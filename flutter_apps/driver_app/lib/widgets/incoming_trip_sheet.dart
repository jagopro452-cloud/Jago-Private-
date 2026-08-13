import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import '../services/alarm_service.dart';
import '../config/jago_theme.dart';

class IncomingTripSheet extends StatefulWidget {
  final Map<String, dynamic> trip;
  final VoidCallback onAccept;
  final VoidCallback onReject;

  const IncomingTripSheet({
    super.key,
    required this.trip,
    required this.onAccept,
    required this.onReject,
  });

  @override
  State<IncomingTripSheet> createState() => _IncomingTripSheetState();
}

class _IncomingTripSheetState extends State<IncomingTripSheet>
    with TickerProviderStateMixin {
  late AnimationController _ringCtrl;
  int _countdown = 40;
  Timer? _countdownTimer;
  bool _responded = false;

  static const Color _jagoBlue = JT.primary;
  static const Color _jagoLavender = Color(0xFF8B5CF6);
  static const Color _jagoBg = Color(0xFFF8FAFF);
  static const Color _textDark = Color(0xFF111827);
  static const Color _textGrey = Color(0xFF6B7280);

  @override
  void initState() {
    super.initState();

    _ringCtrl = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 40),
    )..forward();

    AlarmService().startAlarm();
    _triggerAlertBurst();

    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      if (_countdown <= 0) {
        t.cancel();
        _autoReject();
        return;
      }
      setState(() => _countdown--);
    });
  }

  void _triggerAlertBurst() {
    for (int i = 0; i < 5; i++) {
      Future.delayed(Duration(milliseconds: 80 * i), () {
        if (mounted) {
          HapticFeedback.heavyImpact();
          if (i % 2 == 0) SystemSound.play(SystemSoundType.alert);
        }
      });
    }
  }

  Future<void> _stopAndRespond(bool accepted) async {
    if (_responded) return;
    HapticFeedback.mediumImpact();
    _responded = true;
    _countdownTimer?.cancel();
    await AlarmService().stopAlarm();
    if (accepted) {
      widget.onAccept();
    } else {
      widget.onReject();
    }
  }

  Future<void> _autoReject() async {
    if (_responded) return;
    _responded = true;
    await AlarmService().stopAlarm();
    widget.onReject();
  }

  @override
  void dispose() {
    _ringCtrl.dispose();
    _countdownTimer?.cancel();
    if (!_responded) {
      AlarmService().stopAlarm();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    final pickup = trip['pickupAddress']?.toString() ?? 'Pickup location';
    final dest = trip['destinationAddress']?.toString() ?? 'Destination';
    final pickupShort = trip['pickupShortName']?.toString() ??
        trip['pickup_short_name']?.toString() ??
        '';
    final destShort = trip['destinationShortName']?.toString() ??
        trip['destination_short_name']?.toString() ??
        '';

    String formatDist(dynamic d) {
      if (d == null) return '0.0';
      final val = double.tryParse(d.toString()) ?? 0.0;
      return val.toStringAsFixed(2);
    }

    final pickupDist = formatDist(trip['driverDistanceKm'] ?? '1.4');
    final tripDist = formatDist(trip['estimatedDistance'] ?? '4.8');
    final fare = trip['estimatedFare']?.toString() ?? '121';
    final extra = trip['incentive']?.toString() ?? '13';
    final vehicleType =
        (trip['vehicleCategoryName'] ?? 'Bike').toString();

    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: _jagoBg,
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Incoming Ride',
                        style: GoogleFonts.poppins(
                          fontSize: 24,
                          fontWeight: FontWeight.w700,
                          color: _textDark,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [_jagoBlue, _jagoLavender],
                        ),
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.timer_rounded,
                              color: Colors.white, size: 16),
                          const SizedBox(width: 6),
                          Text(
                            '${_countdown}s',
                            style: GoogleFonts.poppins(
                              color: Colors.white,
                              fontWeight: FontWeight.w800,
                              fontSize: 14,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  child: Column(
                    children: [
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [_jagoBlue, _jagoLavender],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(24),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 6),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.18),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(
                                vehicleType,
                                style: GoogleFonts.poppins(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w700,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                            const SizedBox(height: 14),
                            Text(
                              '₹$fare',
                              style: GoogleFonts.poppins(
                                color: Colors.white,
                                fontSize: 34,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Pickup in $pickupDist km · Ride $tripDist km · Bonus ₹$extra',
                              style: GoogleFonts.poppins(
                                color: Colors.white.withValues(alpha: 0.92),
                                fontSize: 14,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 14),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(18),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Route overview',
                              style: GoogleFonts.poppins(
                                fontSize: 18,
                                fontWeight: FontWeight.w700,
                                color: _textDark,
                              ),
                            ),
                            const SizedBox(height: 14),
                            _routeStop(
                              icon: Icons.my_location_rounded,
                              label: 'Pickup',
                              shortText: pickupShort.isNotEmpty
                                  ? pickupShort
                                  : pickup,
                              fullText: pickup,
                              accent: const Color(0xFF16A34A),
                            ),
                            Padding(
                              padding: const EdgeInsets.only(left: 11),
                              child: Container(
                                width: 2,
                                height: 28,
                                color: const Color(0xFFE5E7EB),
                              ),
                            ),
                            _routeStop(
                              icon: Icons.location_on_rounded,
                              label: 'Drop',
                              shortText:
                                  destShort.isNotEmpty ? destShort : dest,
                              fullText: dest,
                              accent: const Color(0xFFDC2626),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Expanded(
                            child: _metricCard(
                              icon: Icons.route_rounded,
                              label: 'Trip distance',
                              value: '$tripDist km',
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _metricCard(
                              icon: Icons.access_time_rounded,
                              label: 'Decision time',
                              value: '${_countdown}s',
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      SizedBox(
                        width: double.infinity,
                        height: 56,
                        child: AnimatedScale(
                          duration: const Duration(milliseconds: 180),
                          scale: _responded ? 0.985 : 1,
                          child: ElevatedButton.icon(
                            onPressed: () => _stopAndRespond(true),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: _jagoBlue,
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(18),
                              ),
                            ),
                            icon: const Icon(Icons.check_circle_rounded, size: 20),
                            label: Text(
                              'Accept Ride',
                              style: GoogleFonts.poppins(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        height: 56,
                        child: AnimatedOpacity(
                          duration: const Duration(milliseconds: 180),
                          opacity: _responded ? 0.65 : 1,
                          child: OutlinedButton.icon(
                            onPressed: () => _stopAndRespond(false),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: _textDark,
                              side: BorderSide(color: Colors.grey.shade300),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(18),
                              ),
                            ),
                            icon: const Icon(Icons.close_rounded, size: 20),
                            label: Text(
                              'Decline',
                              style: GoogleFonts.poppins(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _routeStop({
    required IconData icon,
    required String label,
    required String shortText,
    required String fullText,
    required Color accent,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 22,
          height: 22,
          decoration: BoxDecoration(
            color: accent.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(11),
          ),
          child: Icon(icon, color: accent, size: 14),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: GoogleFonts.poppins(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: _textGrey,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                shortText,
                style: GoogleFonts.poppins(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: _textDark,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                fullText,
                style: GoogleFonts.poppins(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  color: _textGrey,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _metricCard({
    required IconData icon,
    required String label,
    required String value,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: _jagoBlue, size: 18),
          const SizedBox(height: 10),
          Text(
            label,
            style: GoogleFonts.poppins(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: _textGrey,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: GoogleFonts.poppins(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: _textDark,
            ),
          ),
        ],
      ),
    );
  }
}
