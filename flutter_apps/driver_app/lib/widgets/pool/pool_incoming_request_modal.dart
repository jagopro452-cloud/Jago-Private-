import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';

/// Small centered interrupt shown when a new pool passenger request arrives
/// *while the driver is already on the Local Pool screen* — the
/// HomeScreen-level `IncomingOffersOverlay` only covers this case when the
/// driver is elsewhere in the app (it's painted inside HomeScreen's own
/// Stack, not reachable from this pushed route). Deliberately smaller/less
/// intrusive than that full-screen overlay since the driver is mid-session
/// with a map and possibly other passengers already on screen.
class PoolIncomingRequestModal extends StatefulWidget {
  final String passengerName;
  final String pickupAddress;
  final String dropAddress;
  final int seatsRequested;
  final double totalFare;
  final int expiresInSeconds;
  final VoidCallback onAccept;
  final VoidCallback onDecline;

  const PoolIncomingRequestModal({
    super.key,
    required this.passengerName,
    required this.pickupAddress,
    required this.dropAddress,
    required this.seatsRequested,
    required this.totalFare,
    required this.expiresInSeconds,
    required this.onAccept,
    required this.onDecline,
  });

  static Future<void> show(
    BuildContext context, {
    required String passengerName,
    required String pickupAddress,
    required String dropAddress,
    required int seatsRequested,
    required double totalFare,
    required int expiresInSeconds,
    required VoidCallback onAccept,
    required VoidCallback onDecline,
  }) {
    return showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => PoolIncomingRequestModal(
        passengerName: passengerName,
        pickupAddress: pickupAddress,
        dropAddress: dropAddress,
        seatsRequested: seatsRequested,
        totalFare: totalFare,
        expiresInSeconds: expiresInSeconds,
        onAccept: onAccept,
        onDecline: onDecline,
      ),
    );
  }

  @override
  State<PoolIncomingRequestModal> createState() => _PoolIncomingRequestModalState();
}

class _PoolIncomingRequestModalState extends State<PoolIncomingRequestModal> {
  late int _remaining = widget.expiresInSeconds > 0 ? widget.expiresInSeconds : 40;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      if (_remaining <= 1) {
        _ticker?.cancel();
        Navigator.of(context).pop();
        widget.onDecline();
        return;
      }
      setState(() => _remaining -= 1);
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Dialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        insetPadding: const EdgeInsets.symmetric(horizontal: 24),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(color: JT.primary.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(13)),
                    child: const Icon(Icons.person_add_alt_1_rounded, color: JT.primary),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'New Shared Ride Request',
                      style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w600, color: JT.textPrimary),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: JT.error.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(10)),
                    child: Text('${_remaining}s', style: GoogleFonts.poppins(fontSize: 11, fontWeight: FontWeight.w700, color: JT.error)),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Text(
                '${widget.passengerName} · ${widget.seatsRequested} ${widget.seatsRequested == 1 ? 'seat' : 'seats'}',
                style: GoogleFonts.poppins(fontSize: 13.5, fontWeight: FontWeight.w600, color: JT.textPrimary),
              ),
              const SizedBox(height: 8),
              _addressLine(Icons.my_location_rounded, widget.pickupAddress),
              const SizedBox(height: 4),
              _addressLine(Icons.location_on_rounded, widget.dropAddress),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(color: JT.bgSoft, borderRadius: BorderRadius.circular(12)),
                child: Text(
                  '+₹${widget.totalFare.toStringAsFixed(0)} estimated earning',
                  style: GoogleFonts.poppins(fontSize: 13, fontWeight: FontWeight.w600, color: const Color(0xFF16A34A)),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () {
                        Navigator.of(context).pop();
                        widget.onDecline();
                      },
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 13),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      child: Text('Decline', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () {
                        Navigator.of(context).pop();
                        widget.onAccept();
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: JT.primary,
                        padding: const EdgeInsets.symmetric(vertical: 13),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      child: Text('Accept', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w600)),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _addressLine(IconData icon, String text) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 14, color: JT.textSecondary),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            text,
            style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
