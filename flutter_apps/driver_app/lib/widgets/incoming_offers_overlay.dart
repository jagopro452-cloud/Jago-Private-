import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/alarm_service.dart';
import '../config/jago_theme.dart';

/// Full-screen overlay that shows one or two simultaneous incoming offers
/// (a ride request and/or a parcel request) as stacked cards.
///
/// Rendered declaratively inside [HomeScreen]'s Stack (not pushed as a
/// route) so it reacts instantly to [trip]/[parcel] changing, and so a
/// second offer can appear next to a card that's already on screen.
class IncomingOffersOverlay extends StatefulWidget {
  final Map<String, dynamic>? trip;
  final Map<String, dynamic>? parcel;
  final Map<String, dynamic>? pool;
  final VoidCallback onAcceptTrip;
  final VoidCallback onDeclineTrip;
  final VoidCallback onAcceptParcel;
  final VoidCallback onDeclineParcel;
  final VoidCallback onAcceptPool;
  final VoidCallback onDeclinePool;

  const IncomingOffersOverlay({
    super.key,
    required this.trip,
    required this.parcel,
    this.pool,
    required this.onAcceptTrip,
    required this.onDeclineTrip,
    required this.onAcceptParcel,
    required this.onDeclineParcel,
    this.onAcceptPool = _noop,
    this.onDeclinePool = _noop,
  });

  static void _noop() {}

  @override
  State<IncomingOffersOverlay> createState() => _IncomingOffersOverlayState();
}

class _IncomingOffersOverlayState extends State<IncomingOffersOverlay> {
  static const int _offerSeconds = 40;

  static const Color _jagoBlue = JT.primary;
  static const Color _jagoLavender = Color(0xFF8B5CF6);
  static const Color _bg = Color(0xFFF8FAFF);
  static const Color _textDark = Color(0xFF111827);
  static const Color _textGrey = Color(0xFF6B7280);
  static const Color _pillBg = Color(0xFFE8F2FF);
  static const Color _divider = Color(0xFFEDF1F7);

  Timer? _ticker;
  DateTime? _tripArrivedAt;
  DateTime? _parcelArrivedAt;
  DateTime? _poolArrivedAt;
  String? _lastTripId;
  String? _lastParcelId;
  String? _lastPoolId;
  bool _tripAutoDeclined = false;
  bool _parcelAutoDeclined = false;
  bool _poolAutoDeclined = false;

  @override
  void initState() {
    super.initState();
    _syncOffers();
  }

  @override
  void didUpdateWidget(covariant IncomingOffersOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncOffers();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    AlarmService().stopAlarm();
    super.dispose();
  }

  void _syncOffers() {
    final trip = widget.trip;
    final parcel = widget.parcel;
    bool arrived = false;

    final tripId = trip != null ? (trip['tripId'] ?? trip['id'] ?? '').toString() : null;
    if (tripId != _lastTripId) {
      _lastTripId = tripId;
      if (tripId != null && tripId.isNotEmpty) {
        _tripArrivedAt = DateTime.now();
        _tripAutoDeclined = false;
        arrived = true;
      } else {
        _tripArrivedAt = null;
      }
    }

    final parcelId = parcel != null ? (parcel['orderId'] ?? parcel['id'] ?? '').toString() : null;
    if (parcelId != _lastParcelId) {
      _lastParcelId = parcelId;
      if (parcelId != null && parcelId.isNotEmpty) {
        _parcelArrivedAt = DateTime.now();
        _parcelAutoDeclined = false;
        arrived = true;
      } else {
        _parcelArrivedAt = null;
      }
    }

    final pool = widget.pool;
    final poolId = pool != null ? (pool['requestId'] ?? pool['id'] ?? '').toString() : null;
    if (poolId != _lastPoolId) {
      _lastPoolId = poolId;
      if (poolId != null && poolId.isNotEmpty) {
        _poolArrivedAt = DateTime.now();
        _poolAutoDeclined = false;
        arrived = true;
      } else {
        _poolArrivedAt = null;
      }
    }

    if (trip != null || parcel != null || pool != null) {
      AlarmService().startAlarm();
      _ticker ??= Timer.periodic(const Duration(seconds: 1), (_) => _onTick());
      if (arrived) _burstAlert();
    } else {
      _ticker?.cancel();
      _ticker = null;
      AlarmService().stopAlarm();
    }
  }

  void _onTick() {
    if (!mounted) return;
    setState(() {});
    if (widget.trip != null && !_tripAutoDeclined && _remaining(_tripArrivedAt) <= 0) {
      _tripAutoDeclined = true;
      widget.onDeclineTrip();
    }
    if (widget.parcel != null && !_parcelAutoDeclined && _remaining(_parcelArrivedAt) <= 0) {
      _parcelAutoDeclined = true;
      widget.onDeclineParcel();
    }
    if (widget.pool != null && !_poolAutoDeclined && _remaining(_poolArrivedAt) <= 0) {
      _poolAutoDeclined = true;
      widget.onDeclinePool();
    }
  }

  int _remaining(DateTime? arrivedAt) {
    if (arrivedAt == null) return 0;
    final elapsed = DateTime.now().difference(arrivedAt).inSeconds;
    return (_offerSeconds - elapsed).clamp(0, _offerSeconds);
  }

  void _burstAlert() {
    for (int i = 0; i < 5; i++) {
      Future.delayed(Duration(milliseconds: 80 * i), () {
        if (mounted) {
          HapticFeedback.heavyImpact();
          if (i % 2 == 0) SystemSound.play(SystemSoundType.alert);
        }
      });
    }
  }

  double? _num(dynamic v) => v == null ? null : double.tryParse(v.toString());

  IconData _rideIcon(String vehicleType) {
    final t = vehicleType.toLowerCase();
    if (t.contains('auto')) return Icons.electric_rickshaw_rounded;
    if (t.contains('car') || t.contains('sedan') || t.contains('suv')) {
      return Icons.directions_car_rounded;
    }
    return Icons.two_wheeler_rounded;
  }

  IconData _parcelIcon(String vehicleType) {
    final t = vehicleType.toLowerCase();
    if (t.contains('pickup') || t.contains('truck')) return Icons.fire_truck_rounded;
    if (t.contains('tata') || t.contains('mini') || t.contains('tempo')) {
      return Icons.local_shipping_rounded;
    }
    if (t.contains('auto')) return Icons.electric_rickshaw_rounded;
    return Icons.two_wheeler_rounded;
  }

  String _parcelVehicleName(String vehicleType) {
    final t = vehicleType.toLowerCase();
    if (t.contains('pickup') || t.contains('truck')) return 'Pickup Truck';
    if (t.contains('tata') || t.contains('mini') || t.contains('tempo')) return 'Mini Truck';
    if (t.contains('auto')) return 'Auto Parcel';
    return 'Bike Parcel';
  }

  _OfferCard _rideOffer(Map<String, dynamic> trip) {
    final pickup = trip['pickupAddress']?.toString() ?? 'Pickup location';
    final dest = trip['destinationAddress']?.toString() ?? 'Destination';
    final pickupShort = (trip['pickupShortName'] ?? trip['pickup_short_name'])?.toString() ?? '';
    final destShort = (trip['destinationShortName'] ?? trip['destination_short_name'])?.toString() ?? '';
    final vehicleType = (trip['vehicleCategoryName'] ?? 'Bike').toString();
    return _OfferCard(
      vehicleLabel: '$vehicleType Ride',
      vehicleIcon: _rideIcon(vehicleType),
      fare: _num(trip['estimatedFare']) ?? 0,
      bonus: _num(trip['incentive']),
      tripKm: _num(trip['estimatedDistance']),
      pickupKm: _num(trip['driverDistanceKm']),
      pickupShort: pickupShort.isNotEmpty ? pickupShort : pickup,
      pickupFull: pickup,
      dropShort: destShort.isNotEmpty ? destShort : dest,
      dropFull: dest,
      remaining: _remaining(_tripArrivedAt),
      onAccept: widget.onAcceptTrip,
      onDecline: () {
        _tripAutoDeclined = true;
        widget.onDeclineTrip();
      },
      raw: trip,
    );
  }

  _OfferCard _parcelOffer(Map<String, dynamic> parcel) {
    final vehicleType = (parcel['vehicleCategory'] ?? 'bike_parcel').toString();
    final pickup = (parcel['pickupAddress'] ?? '').toString();
    final drop = (parcel['dropAddress'] ?? parcel['destinationAddress'])?.toString();
    return _OfferCard(
      vehicleLabel: _parcelVehicleName(vehicleType),
      vehicleIcon: _parcelIcon(vehicleType),
      fare: _num(parcel['totalFare']) ?? 0,
      bonus: _num(parcel['incentive']),
      tripKm: _num(parcel['estimatedDistance']),
      pickupKm: _num(parcel['driverDistanceKm']),
      pickupShort: pickup.isNotEmpty ? pickup : 'Pickup location',
      pickupFull: pickup,
      dropShort: (drop != null && drop.isNotEmpty) ? drop : null,
      dropFull: drop,
      remaining: _remaining(_parcelArrivedAt),
      onAccept: widget.onAcceptParcel,
      onDecline: () {
        _parcelAutoDeclined = true;
        widget.onDeclineParcel();
      },
      raw: parcel,
    );
  }

  _OfferCard _poolOffer(Map<String, dynamic> pool) {
    final pickup = (pool['pickupAddress'] ?? '').toString();
    final drop = (pool['dropAddress'] ?? '').toString();
    final seats = pool['seatsRequested'] ?? pool['seats'];
    final seatsLabel = seats != null ? '$seats seat${seats.toString() == '1' ? '' : 's'}' : null;
    final customerName = (pool['customerName'] ?? 'Passenger').toString();
    return _OfferCard(
      vehicleLabel: seatsLabel != null ? 'Car Share · $customerName · $seatsLabel' : 'Car Share · $customerName',
      vehicleIcon: Icons.groups_rounded,
      fare: _num(pool['totalFare']) ?? 0,
      bonus: null,
      tripKm: null,
      pickupKm: null,
      pickupShort: pickup.isNotEmpty ? pickup : 'Pickup location',
      pickupFull: pickup,
      dropShort: drop.isNotEmpty ? drop : null,
      dropFull: drop.isNotEmpty ? drop : null,
      remaining: _remaining(_poolArrivedAt),
      onAccept: widget.onAcceptPool,
      onDecline: () {
        _poolAutoDeclined = true;
        widget.onDeclinePool();
      },
      raw: pool,
    );
  }

  Future<void> _openPickupNavigation(Map<String, dynamic> raw) async {
    double? coord(List<String> keys) {
      for (final k in keys) {
        final d = _num(raw[k]);
        if (d != null && d != 0) return d;
      }
      return null;
    }

    final lat = coord(['pickupLat', 'pickup_lat']);
    final lng = coord(['pickupLng', 'pickup_lng']);
    final label = (raw['pickupAddress'] ?? 'Pickup location').toString();
    final uri = (lat != null && lng != null)
        ? Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$lat,$lng&travelmode=driving')
        : Uri.parse('https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(label)}');
    try {
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    final parcel = widget.parcel;
    final pool = widget.pool;
    if (trip == null && parcel == null && pool == null) return const SizedBox.shrink();

    final offers = <_OfferCard>[
      if (trip != null) _rideOffer(trip),
      if (parcel != null) _parcelOffer(parcel),
      if (pool != null) _poolOffer(pool),
    ];
    final multi = offers.length > 1;
    final parcelOnly = !multi && parcel != null;
    final poolOnly = !multi && pool != null;
    final minRemaining = offers.map((o) => o.remaining).reduce((a, b) => a < b ? a : b);

    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: _bg,
        body: SafeArea(
          child: Column(
            children: [
              _header(multi: multi, parcelOnly: parcelOnly, poolOnly: poolOnly, remaining: minRemaining),
              Expanded(
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                  itemCount: offers.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (_, i) => _offerCard(offers[i], multi: multi),
                ),
              ),
              _infoBanner(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _header({required bool multi, required bool parcelOnly, required bool poolOnly, required int remaining}) {
    final urgent = remaining <= 10;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: _jagoBlue.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(Icons.notifications_active_rounded, color: _jagoBlue, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  multi ? 'Incoming Requests' : (parcelOnly ? 'Incoming Delivery' : (poolOnly ? 'Incoming Car Share' : 'Incoming Ride')),
                  style: GoogleFonts.poppins(fontSize: 21, fontWeight: FontWeight.w800, color: _textDark),
                ),
                Text(
                  multi
                      ? 'Choose a request to accept'
                      : (parcelOnly ? 'You have a new delivery request' : (poolOnly ? 'A passenger wants to share your ride' : 'You have a new ride request')),
                  style: GoogleFonts.poppins(fontSize: 12.5, color: _textGrey),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: urgent ? [JT.error, const Color(0xFFB91C1C)] : [_jagoBlue, _jagoLavender],
              ),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.timer_rounded, color: Colors.white, size: 16),
                const SizedBox(width: 6),
                Text(
                  '${remaining}s',
                  style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 14),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _offerCard(_OfferCard o, {required bool multi}) {
    final urgent = o.remaining <= 10;
    final hasDrop = o.dropShort != null && o.dropShort!.isNotEmpty;
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 18, offset: const Offset(0, 6)),
        ],
      ),
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _pill(icon: o.vehicleIcon, label: o.vehicleLabel),
              const Spacer(),
              if (o.bonus != null && o.bonus! > 0)
                _pill(icon: Icons.bolt_rounded, label: '+₹${o.bonus!.toStringAsFixed(0)}'),
            ],
          ),
          const SizedBox(height: 16),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(flex: 5, child: _fareColumn(o)),
                const SizedBox(width: 12),
                const VerticalDivider(width: 1, thickness: 1, color: _divider),
                const SizedBox(width: 12),
                Expanded(flex: 6, child: _routeColumn(o, hasDrop: hasDrop)),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Container(height: 1, color: _divider),
          const SizedBox(height: 14),
          Row(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.access_time_rounded, size: 18, color: urgent ? JT.error : _jagoBlue),
                      const SizedBox(width: 6),
                      Text(
                        '${o.remaining}s',
                        style: GoogleFonts.poppins(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                          color: urgent ? JT.error : _jagoBlue,
                        ),
                      ),
                    ],
                  ),
                  Text('to decide', style: GoogleFonts.poppins(fontSize: 11, color: _textGrey)),
                ],
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: o.onDecline,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: _textDark,
                    side: BorderSide(color: Colors.grey.shade300),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  icon: const Icon(Icons.close_rounded, size: 18),
                  label: Text('Decline', style: GoogleFonts.poppins(fontWeight: FontWeight.w700, fontSize: 14)),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: multi ? 1 : 2,
                child: ElevatedButton.icon(
                  onPressed: o.onAccept,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _jagoBlue,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  icon: const Icon(Icons.check_circle_rounded, size: 18),
                  label: Text(
                    multi ? 'Accept' : 'Accept Ride',
                    style: GoogleFonts.poppins(fontWeight: FontWeight.w700, fontSize: 14),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _fareColumn(_OfferCard o) {
    final fareText = o.fare == o.fare.roundToDouble() ? o.fare.toStringAsFixed(0) : o.fare.toStringAsFixed(2);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('₹$fareText', style: GoogleFonts.poppins(fontSize: 28, fontWeight: FontWeight.w800, color: _textDark)),
        const SizedBox(height: 4),
        Text('Total earnings', style: GoogleFonts.poppins(fontSize: 11.5, fontWeight: FontWeight.w600, color: _textGrey)),
        if (o.bonus != null && o.bonus! > 0)
          Text('(incl. bonus)', style: GoogleFonts.poppins(fontSize: 11.5, fontWeight: FontWeight.w700, color: _jagoBlue)),
        const SizedBox(height: 14),
        if (o.tripKm != null) _statRow(Icons.route_rounded, '${o.tripKm!.toStringAsFixed(2)} km', 'Trip distance'),
        if (o.tripKm != null && o.pickupKm != null) const SizedBox(height: 10),
        if (o.pickupKm != null) _statRow(Icons.near_me_rounded, '${o.pickupKm!.toStringAsFixed(2)} km', 'Pickup distance'),
      ],
    );
  }

  Widget _statRow(IconData icon, String value, String label) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: _jagoBlue),
        const SizedBox(width: 6),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(value, style: GoogleFonts.poppins(fontSize: 14.5, fontWeight: FontWeight.w800, color: _textDark)),
            Text(label, style: GoogleFonts.poppins(fontSize: 11, color: _textGrey)),
          ],
        ),
      ],
    );
  }

  Widget _routeColumn(_OfferCard o, {required bool hasDrop}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _routePoint(label: 'PICKUP', short: o.pickupShort, full: o.pickupFull, dotColor: const Color(0xFF16A34A)),
        if (hasDrop) ...[
          const _DashedLine(),
          _routePoint(label: 'DROP', short: o.dropShort!, full: o.dropFull ?? '', dotColor: const Color(0xFFDC2626)),
        ],
        const SizedBox(height: 10),
        Align(
          alignment: Alignment.centerRight,
          child: _pill(
            icon: Icons.navigation_rounded,
            label: hasDrop ? 'Map' : 'Navigate',
            onTap: () => _openPickupNavigation(o.raw),
          ),
        ),
      ],
    );
  }

  Widget _routePoint({
    required String label,
    required String short,
    required String full,
    required Color dotColor,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 20,
          height: 20,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: dotColor.withValues(alpha: 0.12),
            border: Border.all(color: dotColor, width: 2),
          ),
          child: Center(
            child: Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(shape: BoxShape.circle, color: dotColor),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: GoogleFonts.poppins(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  color: dotColor,
                  letterSpacing: 0.6,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                short,
                style: GoogleFonts.poppins(fontSize: 14.5, fontWeight: FontWeight.w800, color: _textDark),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (full.isNotEmpty && full != short)
                Text(
                  full,
                  style: GoogleFonts.poppins(fontSize: 11.5, color: _textGrey),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _pill({required IconData icon, required String label, VoidCallback? onTap}) {
    final child = Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: _pillBg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: _jagoBlue),
          const SizedBox(width: 6),
          Text(label, style: GoogleFonts.poppins(fontSize: 12.5, fontWeight: FontWeight.w700, color: _jagoBlue)),
        ],
      ),
    );
    if (onTap == null) return child;
    return InkWell(borderRadius: BorderRadius.circular(999), onTap: onTap, child: child);
  }

  Widget _infoBanner() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: _jagoBlue.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(16)),
        child: Row(
          children: [
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(color: _jagoBlue, borderRadius: BorderRadius.circular(10)),
              child: const Icon(Icons.shield_rounded, color: Colors.white, size: 16),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Accept the request within the time to avoid auto decline.',
                style: GoogleFonts.poppins(fontSize: 12.5, fontWeight: FontWeight.w600, color: JT.primaryDark),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OfferCard {
  final String vehicleLabel;
  final IconData vehicleIcon;
  final double fare;
  final double? bonus;
  final double? tripKm;
  final double? pickupKm;
  final String pickupShort;
  final String pickupFull;
  final String? dropShort;
  final String? dropFull;
  final int remaining;
  final VoidCallback onAccept;
  final VoidCallback onDecline;
  final Map<String, dynamic> raw;

  _OfferCard({
    required this.vehicleLabel,
    required this.vehicleIcon,
    required this.fare,
    this.bonus,
    this.tripKm,
    this.pickupKm,
    required this.pickupShort,
    required this.pickupFull,
    this.dropShort,
    this.dropFull,
    required this.remaining,
    required this.onAccept,
    required this.onDecline,
    required this.raw,
  });
}

/// Small vertical dashed connector between the pickup and drop rows.
class _DashedLine extends StatelessWidget {
  const _DashedLine();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 9, top: 2, bottom: 2),
      child: SizedBox(
        height: 20,
        width: 2,
        child: Column(
          children: List.generate(
            4,
            (_) => Expanded(
              child: Container(
                margin: const EdgeInsets.symmetric(vertical: 1.5),
                color: const Color(0xFFD7DEE9),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
