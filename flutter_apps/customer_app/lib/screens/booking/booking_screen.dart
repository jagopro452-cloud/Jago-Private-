import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/map_night_style.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'package:shimmer/shimmer.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../services/error_reporting.dart';
import '../../services/vehicle_status_service.dart';
import '../tracking/tracking_screen.dart';

class BookingScreen extends StatefulWidget {
  final String pickup;
  final String destination;
  final double pickupLat, pickupLng, destLat, destLng;
  final String? vehicleCategoryId;
  final String? vehicleCategoryName;
  final String? category; // 'ride' | 'parcel' | 'pool'
  const BookingScreen({
    super.key,
    required this.pickup,
    required this.destination,
    this.pickupLat = 17.3850, this.pickupLng = 78.4867,
    this.destLat = 0, this.destLng = 0,
    this.vehicleCategoryId,
    this.vehicleCategoryName,
    this.category,
  });
  @override
  State<BookingScreen> createState() => _BookingScreenState();
}

enum _BookingStep { route, vehicle, farePayment, confirm }

class _BookingScreenState extends State<BookingScreen> with TickerProviderStateMixin {
  GoogleMapController? _mapController;
  bool _loading = false;
  bool _estimating = true;
  List<Map<String, dynamic>> _allFares = [];
  int _selectedFareIndex = 0;
  String _paymentMethod = 'cash';
  double _walletBalance = 0;
  final TextEditingController _promoCtrl = TextEditingController();
  final VehicleStatusService _vehicleStatusService = VehicleStatusService();
  String? _appliedPromo;
  double _promoDiscount = 0;
  bool _promoLoading = false;
  String? _promoError;
  Timer? _debounce;

  late Razorpay _razorpay;

  bool _bookForSomeone = false;
  String _passengerGender = 'male';
  final _passengerNameCtrl = TextEditingController();
  final _passengerPhoneCtrl = TextEditingController();
  final _receiverNameCtrl = TextEditingController();
  final _receiverPhoneCtrl = TextEditingController();
  final _noteCtrl = TextEditingController();
  bool _popularForPickup = false;
  // Every entry point already provides a fully-set pickup and destination
  // (the location screen only enables "Confirm Trip" once both are chosen),
  // so the route-review step has nothing left to verify — start on vehicle.
  _BookingStep _bookingStep = _BookingStep.vehicle;
  
  Set<Polyline> _polylines = {};
  double _routedDistanceKm = 0.0;
  BitmapDescriptor? _pickupMarkerIcon;
  BitmapDescriptor? _dropMarkerIcon;
  Offset _pickupMarkerAnchor = const Offset(0.5, 0.5);
  Offset _dropMarkerAnchor = const Offset(0.5, 0.5);

  static const Color _jagoPrimary = JT.primary;

  static const Color _blue = Color(0xFF6366F1); // Vibrant Indigo
  static const Color _green = JT.success;

  LatLng get _pickupLatLng => LatLng(widget.pickupLat, widget.pickupLng);
  LatLng get _destLatLng => widget.destLat != 0 && widget.destLng != 0
    ? LatLng(widget.destLat, widget.destLng)
    : LatLng(widget.pickupLat + 0.02, widget.pickupLng + 0.02);

  Map<String, dynamic>? get _fare => _allFares.isNotEmpty ? _allFares[_selectedFareIndex] : null;

  double get _autoDiscount {
    if (_appliedPromo != null) return 0;
    return double.tryParse(_fare?['autoDiscountAmount']?.toString() ?? '0') ?? 0;
  }

  String? get _autoDiscountName {
    if (_appliedPromo != null) return null;
    final name = _fare?['autoDiscountName']?.toString();
    return name != null && name.isNotEmpty ? name : null;
  }

  String get _vehicleName => _fare?['vehicleCategoryName']?.toString() ?? _fare?['name']?.toString() ?? widget.vehicleCategoryName ?? 'Bike';

  String _fareVehicleName(Map<String, dynamic> fare) {
    return fare['vehicleCategoryName']?.toString() ??
        fare['vehicleName']?.toString() ??
        fare['name']?.toString() ??
        'Bike';
  }

  List<MapEntry<int, Map<String, dynamic>>> _visibleFareEntries(
    Map<String, VehicleStatus> statuses,
  ) {
    return _allFares.asMap().entries.where((entry) {
      final name = _fareVehicleName(entry.value);
      return VehicleStatusService.isActive(statuses, name);
    }).toList();
  }

  static IconData _iconForVehicle(String name) {
    final n = name.toLowerCase();
    if (n.contains('pickup van') || n.contains('pickup')) return Icons.fire_truck_rounded;
    if (n.contains('mini truck') || n.contains('tata ace') || n.contains('mini cargo')) return Icons.local_shipping_rounded;
    if (n.contains('parcel bike') || n.contains('bike parcel') || n.contains('parcel auto')) return Icons.delivery_dining_rounded;
    if (n.contains('parcel')) return Icons.inventory_2_rounded;
    if (n.contains('bike')) return Icons.electric_bike_rounded;
    if (n.contains('auto')) return Icons.electric_rickshaw_rounded;
    if (n.contains('cargo truck')) return Icons.fire_truck_rounded;
    if (n.contains('cargo')) return Icons.local_shipping_rounded;
    if (n.contains('suv')) return Icons.directions_car_filled_rounded;
    if (n.contains('car')) return Icons.directions_car_filled_rounded;
    return Icons.directions_car_filled_rounded;
  }

  static String _emojiForVehicle(String name) {
    final n = name.toLowerCase();
    // Parcel vehicles — MUST show goods/delivery vehicles, NOT passenger
    if (n.contains('pickup van') || n.contains('pickup')) return '🚛';     // Heavy pickup van
    if (n.contains('mini truck') || n.contains('tata ace')) return '🚐';   // Mini cargo truck
    if (n.contains('parcel bike') || n.contains('bike parcel')) return '🛵'; // Delivery bike
    if (n.contains('parcel auto')) return '🛻';  // ✅ GOODS AUTO — pickup/cargo truck feel (not passenger auto 🛺, not bus)
    if (n.contains('parcel')) return '🚐';       // Generic parcel vehicle
    // Ride vehicles
    if (n.contains('bike')) return '🏍️';
    if (n.contains('auto')) return '🛺';         // Passenger auto only for ride
    if (n.contains('cargo truck')) return '🚛';
    if (n.contains('cargo')) return '🚐';
    if (n.contains('suv')) return '🚙';
    if (n.contains('car')) return '🚗';
    return '🚗';
  }

  // Rule 3: Parcel Auto subtitle must clearly say GOODS ONLY
  // Rule 4: Returns true if vehicle should be HIDDEN
  static bool _shouldHideVehicle(String name) {
    final n = name.toLowerCase();
    
    // Whitelist only requested categories: bike, auto, cab, premium
    // Relaxed contains checks to avoid hiding valid variations (e.g. "Bike - Fast")
    if (n.contains('bike')) return false;
    if (n.contains('auto')) return false;
    if (n.contains('cab')) return false;
    if (n.contains('premium')) return false;
    if (n.contains('sedan')) return false;
    if (n.contains('car')) return false;

    // Hide everything else (Parcel, SUV, Pool, etc. if not requested)
    return true;
  }

  static Color _accentForVehicle(String name) {
    return const Color(0xFF6366F1); // Unified Premium Indigo
  }

  // ── Vehicle image URLs (real vehicle images, network with emoji fallback) ──
  // Matches the premium Cloudinary assets used in home_screen.dart
  static final Map<String, String> _vehicleImageUrls = {
    'bike': 'https://res.cloudinary.com/kits/image/upload/q_auto/f_auto/v1775123974/bike_logo_g7idrq.png',
    'auto': 'https://res.cloudinary.com/kits/image/upload/q_auto/f_auto/v1775125550/ChatGPT_Image_Apr_2_2026_03_55_30_PM_ywb7fj.png',
    'cab': 'https://res.cloudinary.com/dg5ct7fys/image/upload/f_auto,q_auto/ChatGPT_Image_Apr_17_2026_11_27_28_AM_w0rcnh',
    'premium': 'https://res.cloudinary.com/dg5ct7fys/image/upload/f_auto,q_auto/ChatGPT_Image_Apr_17_2026_11_31_05_AM_kavp5e',
    'parcel_bike': 'https://res.cloudinary.com/dg5ct7fys/image/upload/f_auto,q_auto/ChatGPT_Image_Apr_17_2026_11_49_26_AM_gjbrxs',
    'parcel_auto': '${ApiConfig.baseUrl}/static/vehicles/parcel_auto.png',
    'mini_truck':  'https://res.cloudinary.com/dg5ct7fys/image/upload/f_auto,q_auto/ChatGPT_Image_Apr_17_2026_11_51_59_AM_jzd119',
    'pickup_van':  'https://res.cloudinary.com/dg5ct7fys/image/upload/f_auto,q_auto/ChatGPT_Image_Apr_17_2026_11_54_02_AM_hicx7s',
  };

  static String? _vehicleImageKey(String name) {
    final n = name.toLowerCase();
    if (n.contains('premium')) return 'premium';
    if (n.contains('pickup van') || n.contains('pickup')) return 'pickup_van';
    if (n.contains('mini truck') || n.contains('tata ace')) return 'mini_truck';
    if (n.contains('parcel bike') || n.contains('bike parcel')) return 'parcel_bike';
    if (n.contains('parcel auto')) return 'parcel_auto';
    if (n.contains('parcel')) return 'parcel_bike';
    if (n.contains('bike')) return 'bike';
    if (n.contains('auto')) return 'auto';
    if (n.contains('cab') || n.contains('car') || n.contains('suv')) return 'cab';
    return null;
  }

  /// Renders vehicle artwork — real network image with icon fallback.
  // ignore: unused_element
  Widget _buildVehicleArtwork(String name, Color accent, bool isSelected, {double size = 96}) {
    final imageKey = _vehicleImageKey(name);
    final imageUrl = imageKey != null ? _vehicleImageUrls[imageKey] : null;
    final icon = _iconForVehicle(name);
    final isParcel = widget.category == 'parcel';

    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      width: size, height: size,
      decoration: BoxDecoration(
        color: isSelected ? accent.withValues(alpha: 0.08) : const Color(0xFFF8FAFC),
        borderRadius: const BorderRadius.only(
          topLeft: Radius.circular(14), bottomLeft: Radius.circular(14)),
      ),
      child: Stack(alignment: Alignment.center, children: [
        // Vehicle image (real) with icon fallback
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 8, 8, 18),
          child: imageUrl != null
            ? Image.network(
                imageUrl,
                fit: BoxFit.contain,
                errorBuilder: (_, __, ___) => Icon(
                  icon, size: size * 0.44,
                  color: accent.withValues(alpha: isSelected ? 0.85 : 0.60),
                ),
              )
            : Icon(
                icon, size: size * 0.44,
                color: accent.withValues(alpha: isSelected ? 0.85 : 0.60),
              ),
        ),
        // DELIVERY / RIDE badge at bottom
        Positioned(
          bottom: 5,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: isSelected ? accent : accent.withValues(alpha: 0.65),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              isParcel ? 'DELIVERY' : 'RIDE',
              style: const TextStyle(color: Colors.white, fontSize: 7,
                fontWeight: FontWeight.w500, letterSpacing: 0.5),
            ),
          ),
        ),
      ]),
    );
  }

  // ignore: unused_element
  Widget _buildVehicleHero() {
    if (_allFares.isEmpty) return const SizedBox.shrink();
    final fare = _allFares[_selectedFareIndex];
    final name = fare['vehicleCategoryName']?.toString() ?? fare['name']?.toString() ?? 'Bike';
    final emoji = _emojiForVehicle(name);
    final accent = _accentForVehicle(name);
    final fareVal = (fare['estimatedFare'] ?? 0).toDouble();
    final rawMin = (fare['fareMin'] ?? (fareVal * 0.95)).toDouble();
    final rawMax = (fare['fareMax'] ?? (fareVal * 1.05)).toDouble();
    final displayMin = (rawMin - _promoDiscount - _autoDiscount).clamp(0.0, double.infinity);
    final displayMax = (rawMax - _promoDiscount - _autoDiscount).clamp(0.0, double.infinity);
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 320),
      transitionBuilder: (child, anim) => SlideTransition(
        position: Tween<Offset>(begin: const Offset(0.3, 0), end: Offset.zero).animate(
          CurvedAnimation(parent: anim, curve: Curves.easeOutCubic)),
        child: FadeTransition(opacity: anim, child: child),
      ),
      child: Container(
        key: ValueKey('hero_$name'),
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [accent, accent.withValues(alpha: 0.75)],
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
          ),
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(color: accent.withValues(alpha: 0.35), blurRadius: 18, offset: const Offset(0, 6)),
          ],
        ),
        child: Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(8)),
              child: Text('SELECTED', style: const TextStyle(
                color: Colors.white, fontSize: 9, fontWeight: FontWeight.w500, letterSpacing: 1.5)),
            ),
            const SizedBox(height: 8),
            Text(name, style: const TextStyle(
              color: Colors.white, fontSize: 22, fontWeight: FontWeight.w500, letterSpacing: -0.5)),
            const SizedBox(height: 4),
            Text('₹${displayMin.floor()} – ₹${displayMax.ceil()}',
              style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w400)),
            Text('estimated fare', style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 11)),
          ])),
          // Real vehicle image — emoji fallback if network fails
          Builder(builder: (_) {
            final imgKey = _vehicleImageKey(name);
            final imgUrl = imgKey != null ? _vehicleImageUrls[imgKey] : null;
            return SizedBox(
              width: 100, height: 80,
              child: imgUrl != null
                ? Image.network(
                    imgUrl,
                    fit: BoxFit.contain,
                    color: Colors.white.withValues(alpha: 0.92),
                    colorBlendMode: BlendMode.modulate,
                    errorBuilder: (_, __, ___) =>
                        Text(emoji, style: const TextStyle(fontSize: 64)),
                  )
                : Text(emoji, style: const TextStyle(fontSize: 64)),
            );
          }),
        ]),
      ),
    );
  }

  /// Parse "~5 min" / "5 min" / "5-8 min" → arrival minutes number
  static int _etaMins(String timeStr) {
    final match = RegExp(r'(\d+)').firstMatch(timeStr);
    return match != null ? int.tryParse(match.group(1) ?? '5') ?? 5 : 5;
  }

  /// "Drop 6:14 pm" style string from eta
  static String _dropTimeStr(String timeStr) {
    final mins = _etaMins(timeStr);
    final dropTime = DateTime.now().add(Duration(minutes: mins + 10));
    final h = dropTime.hour > 12 ? dropTime.hour - 12 : (dropTime.hour == 0 ? 12 : dropTime.hour);
    final m = dropTime.minute.toString().padLeft(2, '0');
    final ampm = dropTime.hour >= 12 ? 'pm' : 'am';
    return '$h:$m $ampm';
  }

  // ignore: unused_element
  static String _capacityForVehicle(String name) {
    final n = name.toLowerCase();
    if (n.contains('pickup van') || n.contains('pickup')) return 'Up to 2000 kg';
    if (n.contains('mini truck') || n.contains('tata ace')) return 'Up to 500 kg';
    if (n.contains('parcel bike') || n.contains('bike parcel')) return 'Up to 10 kg';
    if (n.contains('parcel auto')) return 'Up to 50 kg';
    if (n.contains('parcel')) return 'Package delivery';
    if (n.contains('suv')) return '6 seats';
    if (n.contains('car')) return '4 seats';
    if (n.contains('auto')) return '3 seats';
    if (n.contains('bike')) return '1 rider';
    if (n.contains('cargo truck')) return 'Up to 1000 kg';
    if (n.contains('cargo')) return 'Up to 500 kg';
    return '';
  }

  double get _distanceKm {
    if (_routedDistanceKm > 0) return _routedDistanceKm;
    if (widget.destLat == 0 && widget.destLng == 0) return 3.0;
    // Haversine formula for accurate distance calculation
    const double earthRadius = 6371.0;
    final double lat1 = widget.pickupLat * pi / 180;
    final double lat2 = widget.destLat * pi / 180;
    final double dlat = (widget.destLat - widget.pickupLat) * pi / 180;
    final double dlng = (widget.destLng - widget.pickupLng) * pi / 180;
    final double a = sin(dlat / 2) * sin(dlat / 2) +
        cos(lat1) * cos(lat2) * sin(dlng / 2) * sin(dlng / 2);
    final double c = 2 * atan2(sqrt(a), sqrt(1 - a));
    // Road distance is typically 1.3x aerial distance
    return (earthRadius * c * 1.3).clamp(0.5, 200.0);
  }

  String _shortLocation(String value) {
    final v = value.trim();
    if (v.isEmpty) return v;
    return v.split(',').first.trim();
  }

  // ignore: unused_element
  void _quickSelectPopular(Map<String, dynamic> location) {
    final name = (location['name'] ?? '').toString();
    final lat = (location['lat'] as num?)?.toDouble() ?? 0.0;
    final lng = (location['lng'] as num?)?.toDouble() ?? 0.0;
    if (name.isEmpty || lat == 0 || lng == 0) return;

    final next = BookingScreen(
      pickup: _popularForPickup ? name : widget.pickup,
      destination: _popularForPickup ? widget.destination : name,
      pickupLat: _popularForPickup ? lat : widget.pickupLat,
      pickupLng: _popularForPickup ? lng : widget.pickupLng,
      destLat: _popularForPickup ? widget.destLat : lat,
      destLng: _popularForPickup ? widget.destLng : lng,
      vehicleCategoryId: widget.vehicleCategoryId,
      vehicleCategoryName: widget.vehicleCategoryName,
      category: widget.category,
    );
    Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => next));
  }

  double get _finalFare {
    final f = (_fare?['estimatedFare'] ?? 0).toDouble();
    return (f - _promoDiscount - _autoDiscount).clamp(0, double.infinity);
  }

  @override
  void initState() {
    super.initState();
    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _handleRazorpaySuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _handleRazorpayError);
    _razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, _handleExternalWallet);
    _estimateFare();
    _fetchWallet();
    _fetchRoutePolyline();
    _buildRouteMarkerIcons();
  }

  /// Builds the floating "Pickup"/"Drop" label-chip markers shown on the
  /// live route map — a white rounded chip with the tag + short address,
  /// sitting above a colored pin, baked into one bitmap per marker.
  Future<void> _buildRouteMarkerIcons() async {
    final pickup = await _labeledMarkerBitmap(
      tag: 'Pickup',
      address: _shortLocation(widget.pickup),
      tagColor: const Color(0xFF16A34A),
      pinColor: const Color(0xFF16A34A),
    );
    final drop = await _labeledMarkerBitmap(
      tag: 'Drop',
      address: _shortLocation(widget.destination),
      tagColor: JT.primary,
      pinColor: const Color(0xFF0F172A),
    );
    if (!mounted) return;
    setState(() {
      _pickupMarkerIcon = pickup.icon;
      _pickupMarkerAnchor = pickup.anchor;
      _dropMarkerIcon = drop.icon;
      _dropMarkerAnchor = drop.anchor;
    });
  }

  Future<({BitmapDescriptor icon, Offset anchor})> _labeledMarkerBitmap({
    required String tag,
    required String address,
    required Color tagColor,
    required Color pinColor,
  }) async {
    final tagPainter = TextPainter(
      text: TextSpan(
        text: tag,
        style: TextStyle(
            color: tagColor, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.2),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final addrPainter = TextPainter(
      text: TextSpan(
        text: address.isNotEmpty ? address : 'Selected location',
        style: const TextStyle(
            color: Color(0xFF0F172A), fontSize: 15, fontWeight: FontWeight.w700),
      ),
      textDirection: TextDirection.ltr,
      ellipsis: '…',
      maxLines: 1,
    )..layout(maxWidth: 220);

    const chipPadH = 14.0;
    const chipPadV = 8.0;
    final chipWidth =
        (tagPainter.width > addrPainter.width ? tagPainter.width : addrPainter.width) +
            chipPadH * 2;
    final chipHeight = tagPainter.height + addrPainter.height + chipPadV * 2 + 2;
    const pinSize = 22.0;
    const gap = 6.0;
    final totalWidth = chipWidth + 16;
    final totalHeight = chipHeight + gap + pinSize + 6;

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, Rect.fromLTWH(0, 0, totalWidth, totalHeight));
    final chipRect = RRect.fromRectAndRadius(
      Rect.fromLTWH((totalWidth - chipWidth) / 2, 4, chipWidth, chipHeight),
      const Radius.circular(12),
    );
    canvas.drawRRect(
      chipRect.shift(const Offset(0, 2)),
      Paint()
        ..color = Colors.black.withValues(alpha: 0.18)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4),
    );
    canvas.drawRRect(chipRect, Paint()..color = Colors.white);

    tagPainter.paint(canvas, Offset((totalWidth - chipWidth) / 2 + chipPadH, 4 + chipPadV));
    addrPainter.paint(
      canvas,
      Offset((totalWidth - chipWidth) / 2 + chipPadH, 4 + chipPadV + tagPainter.height + 2),
    );

    final pinCenterX = totalWidth / 2;
    final pinCenterY = 4 + chipHeight + gap + pinSize / 2;
    canvas.drawCircle(Offset(pinCenterX, pinCenterY), pinSize / 2, Paint()..color = pinColor);
    canvas.drawCircle(Offset(pinCenterX, pinCenterY), pinSize / 2 - 5, Paint()..color = Colors.white);
    canvas.drawCircle(Offset(pinCenterX, pinCenterY), pinSize / 2 - 8, Paint()..color = pinColor);

    final picture = recorder.endRecording();
    final img = await picture.toImage(totalWidth.toInt(), totalHeight.toInt());
    final data = await img.toByteData(format: ui.ImageByteFormat.png);
    final icon = BitmapDescriptor.bytes(
      data!.buffer.asUint8List(),
      width: totalWidth,
      height: totalHeight,
    );
    // Anchor at the pin's center so the pin — not the label — sits on the coordinate.
    return (icon: icon, anchor: Offset(0.5, pinCenterY / totalHeight));
  }

  // ignore: unused_element
  Future<void> _fetchPopularLocations() async {}

  @override
  void dispose() {
    _debounce?.cancel();
    _promoCtrl.dispose();
    _razorpay.clear();
    _passengerNameCtrl.dispose();
    _passengerPhoneCtrl.dispose();
    _receiverNameCtrl.dispose();
    _receiverPhoneCtrl.dispose();
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchWallet() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.wallet),
        headers: headers);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (mounted) setState(() => _walletBalance = (data['balance'] ?? 0).toDouble());
      }
    } catch (e, st) { reportSilentFailure('BookingScreen._fetchWallet', e, st); }
  }

  void _onCouponChanged(String value) {
    // Clear stale error/discount on code change
    if (_promoError != null) setState(() => _promoError = null);
    _debounce?.cancel();
    // Only auto-apply when user has typed a plausible code (≥4 chars)
    if (value.trim().length >= 4) {
      _debounce = Timer(const Duration(milliseconds: 600), () {
        if (_promoCtrl.text.trim().isNotEmpty) _applyPromo();
      });
    }
  }

  Future<void> _applyPromo() async {
    final code = _promoCtrl.text.trim().toUpperCase();
    if (code.isEmpty) return;
    setState(() { _promoLoading = true; _promoError = null; });
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(Uri.parse(ApiConfig.applyCoupon),
        headers: headers,
        body: jsonEncode({'code': code, 'fareAmount': (_fare?['estimatedFare'] ?? 0).toDouble()}));
      if (res.statusCode == 200) {
        try {
          final data = jsonDecode(res.body);
          setState(() {
            _appliedPromo = code;
            _promoDiscount = double.tryParse(data['discount']?.toString() ?? '0') ?? 0;
            _promoLoading = false;
          });
        } catch (_) {
          setState(() { _promoError = 'Invalid response from server'; _promoLoading = false; });
        }
      } else {
        try {
          final data = jsonDecode(res.body);
          setState(() { _promoError = data['message'] ?? 'Invalid code'; _promoLoading = false; });
        } catch (_) {
          setState(() { _promoError = 'Invalid coupon code'; _promoLoading = false; });
        }
      }
    } catch (_) {
      setState(() { _promoError = 'Network error'; _promoLoading = false; });
    }
  }

  Future<void> _estimateFare() async {
    setState(() => _estimating = true);
    try {
      final headers = await AuthService.getHeaders();
      final body = <String, dynamic>{
        'pickupLat': widget.pickupLat, 'pickupLng': widget.pickupLng,
        'destLat': widget.destLat, 'destLng': widget.destLng,
        'distanceKm': _distanceKm,
      };
      if (widget.vehicleCategoryId != null) body['vehicleCategoryId'] = widget.vehicleCategoryId;
      if (widget.category != null) body['category'] = widget.category;
      final res = await http.post(Uri.parse(ApiConfig.estimateFare),
        headers: headers,
        body: jsonEncode(body));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final rawFares = data['fares'];
        final fares = rawFares is List ? rawFares.whereType<Map<String, dynamic>>().toList() : null;
        if (fares != null && fares.isNotEmpty) {
          setState(() {
            // Rule 2: Strict service separation — filter by category, hide inactive
            var filtered = fares.toList();
            final cat = widget.category ?? 'ride';
            if (cat == 'parcel') {
              filtered = filtered.where((f) {
                final vname = (f['vehicleCategoryName'] ?? f['vehicleName'] ?? f['name'] ?? '').toString().toLowerCase();
                final vtype = (f['type'] ?? f['vehicleType'] ?? '').toString().toLowerCase();
                return vtype == 'parcel' || vname.contains('parcel') ||
                    vname.contains('truck') || vname.contains('van') ||
                    vname.contains('tata') || vname.contains('mini');
              }).toList();
            } else {
              filtered = filtered.where((f) {
                final vname = (f['vehicleCategoryName'] ?? f['vehicleName'] ?? f['name'] ?? '').toString().toLowerCase();
                final vtype = (f['type'] ?? f['vehicleType'] ?? '').toString().toLowerCase();
                // Exclude parcel/cargo vehicles from ride
                if (vtype == 'parcel' || vname.contains('parcel') || vname.contains('truck') || vname.contains('cargo')) return false;
                // Rule 4: Hide inactive services
                if (_shouldHideVehicle(vname)) return false;
                return true;
              }).toList();
            }
            _allFares = filtered;
            
            // Ensure we have at least the core categories (Bike, Auto, Cab)
            if (widget.category != 'parcel') {
              final fallbacks = _buildFallbackFares();
              for (var fb in fallbacks) {
                final fbName = fb['vehicleCategoryName'].toString();
                // Add fallback if no similar category exists in server result
                if (!_allFares.any((f) {
                  final name = (f['vehicleCategoryName'] ?? f['vehicleName'] ?? f['name'] ?? '').toString().toLowerCase();
                  return name.contains(fbName.split(' ').first.toLowerCase());
                })) {
                  _allFares.add(fb);
                }
              }
            }
            
            // Final safety check: if still empty (shouldn't happen with fallbacks), use all fallbacks
            if (_allFares.isEmpty) _allFares = _buildFallbackFares();
            if (widget.vehicleCategoryId != null || widget.vehicleCategoryName != null) {
              final targetName = (widget.vehicleCategoryName ?? '').toLowerCase();
              final idx = _allFares.indexWhere((f) {
                final fName = (f['vehicleCategoryName'] ?? f['vehicleName'] ?? f['name'] ?? '').toString().toLowerCase();
                final fId = f['vehicleCategoryId']?.toString() ?? f['id']?.toString();
                // Prefer a real, bookable fare (non-null category id) over a
                // same-named client-side fallback placeholder when both match.
                return (fId == widget.vehicleCategoryId && fId != null) ||
                       (targetName.isNotEmpty && fName.contains(targetName) && fId != null);
              });
              if (idx >= 0) _selectedFareIndex = idx;
            }
          });
        } else {
          // Server returned 200 but body wasn't as expected — use fallbacks
          if (mounted) setState(() => _allFares = _buildFallbackFares());
        }
      } else {
        // Server returned error status — use fallbacks
        if (mounted) setState(() => _allFares = _buildFallbackFares());
      }
    } catch (_) {
      // Network error — show client-side estimates only on connectivity failure
      if (mounted) setState(() => _allFares = _buildFallbackFares());
    }
    if (mounted) setState(() => _estimating = false);
  }

  /// Builds client-side fare estimates (Bike/Auto/Car) when the server returns
  /// no fares. Formula: Total = Base + (Distance × Per-KM Rate) + 5% GST.
  List<Map<String, dynamic>> _buildFallbackFares() {
    final dist = _distanceKm;
    Map<String, dynamic> make(
        String name, double base, double perKm, double minFareVal, int eta) {
      final raw = (base + dist * perKm).clamp(minFareVal, double.infinity);
      final gst = double.parse((raw * 0.05).toStringAsFixed(2));
      final grandTotal = double.parse((raw + gst).toStringAsFixed(2));
      return {
        'vehicleCategoryId': null,
        'vehicleCategoryName': name,
        'vehicleName': name,
        'baseFare': base,
        'farePerKm': perKm,
        'billableKm': dist,
        'distanceFare': double.parse((dist * perKm).toStringAsFixed(2)),
        'timeFare': 0.0,
        'subtotal': double.parse(raw.toStringAsFixed(2)),
        'gst': gst,
        'estimatedFare': grandTotal,
        'fareMin': (grandTotal * 0.95).floor(),
        'fareMax': (grandTotal * 1.05).ceil(),
        'minimumFare': minFareVal,
        'cancellationFee': 10.0,
        'waitingChargePerMin': 0.0,
        'isNightCharge': false,
        'nightMultiplier': 1.0,
        'helperCharge': 0.0,
        'estimatedTime': '$eta min',
      };
    }
    // Parcel-specific vehicles — never mix with ride vehicles
    if (widget.category == 'parcel') {
      return [
        make('Parcel Bike',  20,  8,  25, (dist * 4).ceil()),
        make('Parcel Auto',  30, 10,  35, (dist * 4).ceil()),
        make('Mini Truck',  100, 25, 120, (dist * 5).ceil()),
        make('Pickup Van',  150, 35, 180, (dist * 5).ceil()),
      ];
    }
    // Ride vehicles (default)
    return [
      make('Bike', 25, 10, 28, (dist * 3).ceil()),
      make('Auto', 35, 13, 40, (dist * 3.5).ceil()),
      make('Cab',  50, 16, 60, (dist * 4).ceil()),
      make('Premium Cab', 70, 20, 80, (dist * 4).ceil()),
    ];
  }

  Future<void> _confirmBooking({String? razorpayPaymentId}) async {
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final body = <String, dynamic>{
        'pickupAddress': widget.pickup,
        'destinationAddress': widget.destination,
        'pickupShortName': _shortLocation(widget.pickup),
        'destinationShortName': _shortLocation(widget.destination),
        'pickupLat': widget.pickupLat, 'pickupLng': widget.pickupLng,
        'destinationLat': widget.destLat, 'destinationLng': widget.destLng,
        'estimatedFare': _finalFare,
        'estimatedDistance': _distanceKm,
        'paymentMethod': _paymentMethod,
        if (_promoDiscount > 0) 'promoDiscount': _promoDiscount,
        if (_appliedPromo != null) 'couponCode': _appliedPromo,
        if (razorpayPaymentId != null) 'razorpayPaymentId': razorpayPaymentId,
        'ride_for': _bookForSomeone ? 'other' : 'self',
        if (_bookForSomeone) 'isForSomeoneElse': true,
        if (_bookForSomeone && _passengerNameCtrl.text.trim().isNotEmpty) ...{
          'passengerName': _passengerNameCtrl.text.trim(),
          'passenger_name': _passengerNameCtrl.text.trim(),
        },
        if (_bookForSomeone && _passengerPhoneCtrl.text.trim().isNotEmpty) ...{
          'passengerPhone': _passengerPhoneCtrl.text.trim(),
          'passenger_mobile': _passengerPhoneCtrl.text.trim(),
        },
        if (_bookForSomeone) 'passengerGender': _passengerGender,
        if (_bookForSomeone && _receiverNameCtrl.text.trim().isNotEmpty)
          'receiverName': _receiverNameCtrl.text.trim(),
        if (_bookForSomeone && _receiverPhoneCtrl.text.trim().isNotEmpty)
          'receiverPhone': _receiverPhoneCtrl.text.trim(),
        if (_bookForSomeone && _noteCtrl.text.trim().isNotEmpty)
          'note': _noteCtrl.text.trim(),
      };
      final vcId = _fare?['vehicleCategoryId']?.toString() ?? _fare?['id']?.toString() ?? widget.vehicleCategoryId;
      if (vcId == null || vcId.isEmpty) {
        // Selected fare is a client-side estimate (fare-estimate call failed or
        // returned no usable fares) with no real backend vehicle category —
        // booking would always be rejected server-side. Retry the estimate
        // instead of sending a request guaranteed to fail.
        if (!mounted) return;
        _showSnack('Could not confirm fare for this vehicle. Refreshing fares — please try again.', error: true);
        setState(() => _loading = false);
        unawaited(_estimateFare());
        return;
      }
      body['vehicleCategoryId'] = vcId;
      final res = await http.post(Uri.parse(ApiConfig.bookRide),
        headers: headers,
        body: jsonEncode(body));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final tripId = data['trip']?['id']?.toString() ?? '';
        if (!mounted) return;
        if (tripId.isEmpty) {
          _showSnack('Booking confirmed but could not track trip. Please check My Trips.', error: false);
          setState(() => _loading = false);
          Navigator.pop(context);
          return;
        }
        Navigator.pushReplacement(context, MaterialPageRoute(
          builder: (_) => TrackingScreen(tripId: tripId)));
      } else {
        if (!mounted) return;
        try {
          final err = jsonDecode(res.body);
          _showSnack(err['message'] ?? 'Booking failed', error: true);
        } catch (_) {
          _showSnack('Booking failed. Please try again.', error: true);
        }
      }
    } catch (_) {
      if (!mounted) return;
      _showSnack('Network error. Try again.', error: true);
    }
    if (mounted) setState(() => _loading = false);
  }

  /// Offers Google Maps navigation to pickup location after booking is confirmed.
  /// Shows a premium bottom sheet with "Navigate" and "Skip" options.
  // ignore: unused_element
  Future<void> _offerNavigateToPickup() async {
    if (!mounted) return;
    final pickupLat = widget.pickupLat;
    final pickupLng = widget.pickupLng;
    final pickupAddr = widget.pickup;

    await showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isDismissible: true,
      builder: (_) => Container(
        margin: const EdgeInsets.all(16),
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.3), blurRadius: 30)],
        ),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 56, height: 56,
            decoration: BoxDecoration(
              gradient: const LinearGradient(colors: [Color(0xFF16A34A), Color(0xFF15803D)]),
              shape: BoxShape.circle,
              boxShadow: [BoxShadow(color: const Color(0xFF16A34A).withValues(alpha: 0.35), blurRadius: 16)],
            ),
            child: const Icon(Icons.check_rounded, color: Colors.white, size: 28),
          ),
          const SizedBox(height: 16),
          Text('Ride Booked! 🎉',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w500,
              color: JT.textPrimary)),
          const SizedBox(height: 8),
          Text('Navigate to pickup location?',
            style: TextStyle(fontSize: 14, color: Colors.grey[600])),
          const SizedBox(height: 6),
          Text(pickupAddr,
            style: const TextStyle(fontSize: 13, color: JT.primary, fontWeight: FontWeight.w400),
            maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center),
          const SizedBox(height: 20),
          Row(children: [
            Expanded(
              child: GestureDetector(
                onTap: () => Navigator.pop(context),
                child: Container(
                  height: 48,
                  decoration: BoxDecoration(
                    color: Colors.grey.shade100,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: Colors.grey.shade200),
                  ),
                  child: Center(child: Text('Skip',
                    style: TextStyle(fontWeight: FontWeight.w500,
                      color: Colors.grey[700]))),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              flex: 2,
              child: GestureDetector(
                onTap: () async {
                  Navigator.pop(context);
                  // Try Google Maps first, fallback to geo: URI
                  final gmUrl = 'google.navigation:q=$pickupLat,$pickupLng&mode=d';
                  final geoUrl = 'geo:$pickupLat,$pickupLng?q=$pickupLat,$pickupLng($pickupAddr)';
                  final mapsUrl = 'https://maps.google.com/?daddr=$pickupLat,$pickupLng&directionsmode=driving';
                  if (await canLaunchUrl(Uri.parse(gmUrl))) {
                    await launchUrl(Uri.parse(gmUrl));
                  } else if (await canLaunchUrl(Uri.parse(geoUrl))) {
                    await launchUrl(Uri.parse(geoUrl));
                  } else {
                    await launchUrl(Uri.parse(mapsUrl), mode: LaunchMode.externalApplication);
                  }
                },
                child: Container(
                  height: 48,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(colors: [JT.primary, Color(0xFF1244A2)]),
                    borderRadius: BorderRadius.circular(14),
                    boxShadow: [BoxShadow(color: JT.primary.withValues(alpha: 0.35), blurRadius: 12)],
                  ),
                  child: const Center(child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Icon(Icons.navigation_rounded, color: Colors.white, size: 18),
                    SizedBox(width: 8),
                    Text('Navigate Now', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 14)),
                  ])),
                ),
              ),
            ),
          ]),
          const SizedBox(height: 8),
        ]),
      ),
    );
  }

  /// Passenger details (for-someone-else name/phone/gender) are now collected
  /// inline on the fare & payment step, so this just re-checks admin
  /// availability — matching the old RideForWhomScreen gate — then books.
  Future<void> _confirmAndBook() async {
    try {
      final statuses = await _vehicleStatusService.watchVehicleStatuses().first;
      if (!VehicleStatusService.isActive(statuses, _vehicleName)) {
        _showSnack('$_vehicleName is temporarily unavailable by admin.', error: true);
        return;
      }
    } catch (e, st) { reportSilentFailure('BookingScreen._confirmAndBook', e, st); }
    if (_bookForSomeone &&
        (_passengerNameCtrl.text.trim().isEmpty || _passengerPhoneCtrl.text.trim().isEmpty)) {
      _showSnack('Please enter the rider\'s name and mobile number.', error: true);
      return;
    }
    _handleOnConfirm();
  }

  Future<void> _handleOnConfirm() async {
    if (_paymentMethod == 'upi') {
      await _startRazorpayRidePayment();
    } else {
      if (_paymentMethod == 'wallet') {
        final fare = _finalFare;
        if (_walletBalance < fare) {
          _showSnack('Insufficient wallet balance. Please recharge.', error: true);
          return;
        }
      }
      await _confirmBooking();
    }
  }

  Future<void> _startRazorpayRidePayment() async {
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final fare = _finalFare;
      final res = await http.post(Uri.parse(ApiConfig.rideCreateOrder),
        headers: headers,
        body: jsonEncode({'amount': fare}));
      if (res.statusCode != 200) {
        setState(() => _loading = false);
        try {
          final err = jsonDecode(res.body);
          _showSnack(err['message'] ?? 'Payment setup failed', error: true);
        } catch (_) {
          _showSnack('Payment setup failed. Try again.', error: true);
        }
        return;
      }
      final data = jsonDecode(res.body);
      final order = data['order'];
      final keyId = data['keyId'];
      if (order == null || keyId == null) {
        setState(() => _loading = false);
        _showSnack('Payment setup failed. Try again.', error: true);
        return;
      }
      final profileData = await AuthService.getProfile();
      final options = {
        'key': keyId,
        'amount': order['amount'],
        'currency': 'INR',
        'name': 'Jago Rides',
        'description': 'Ride to ${_shortLocation(widget.destination)}',
        'order_id': order['id'],
        'prefill': {
          'name': profileData?['fullName'] ?? '',
          'contact': profileData?['phone'] ?? '',
        },
        'theme': {'color': '#1E6DE5'},
      };
      _razorpay.open(options);
    } catch (_) {
      setState(() => _loading = false);
      _showSnack('Payment failed. Try again.', error: true);
    }
  }

  void _handleRazorpaySuccess(PaymentSuccessResponse response) async {
    if (!mounted) return;
    setState(() => _loading = true);
    await _verifyRidePayment(response: response, attempt: 1);
  }

  /// Verifies a ride payment with the server, retrying automatically on
  /// network/timeout failure (Razorpay has already charged the user at this
  /// point) before falling back to a support message that keeps the
  /// Razorpay payment ID visible and offers an in-app retry action.
  Future<void> _verifyRidePayment({
    required PaymentSuccessResponse response,
    required int attempt,
  }) async {
    const maxAttempts = 3;
    try {
      final headers = await AuthService.getHeaders();
      final verifyRes = await http.post(Uri.parse(ApiConfig.rideVerifyPayment),
        headers: headers,
        body: jsonEncode({
          'razorpayOrderId': response.orderId,
          'razorpayPaymentId': response.paymentId,
          'razorpaySignature': response.signature,
          'amount': _finalFare,
        })).timeout(const Duration(seconds: 10));
      if (!mounted) return;
      if (verifyRes.statusCode == 200) {
        await _confirmBooking(razorpayPaymentId: response.paymentId);
        return;
      }
      // Server explicitly rejected verification - not a transient failure.
      setState(() => _loading = false);
      _showSnack('Payment verification failed. Contact support.', error: true);
    } catch (_) {
      if (attempt < maxAttempts) {
        await Future.delayed(Duration(seconds: attempt * 2));
        if (!mounted) return;
        return _verifyRidePayment(response: response, attempt: attempt + 1);
      }
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(
          'Payment done (ref: ${response.paymentId ?? "unknown"}) but verification failed after $maxAttempts attempts.',
          style: const TextStyle(fontWeight: FontWeight.w400, color: Colors.white),
        ),
        backgroundColor: const Color(0xFFDC2626),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 8),
        action: SnackBarAction(
          label: 'RETRY',
          textColor: Colors.white,
          onPressed: () {
            if (mounted) setState(() => _loading = true);
            _verifyRidePayment(response: response, attempt: 1);
          },
        ),
      ));
    }
  }

  void _handleRazorpayError(PaymentFailureResponse response) {
    setState(() => _loading = false);
    _showSnack(response.message ?? 'Payment cancelled', error: true);
  }

  void _handleExternalWallet(ExternalWalletResponse response) {
    setState(() => _loading = false);
  }

  void _showSnack(String msg, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg, style: const TextStyle(fontWeight: FontWeight.w400, color: Colors.white)),
      backgroundColor: error ? const Color(0xFFDC2626) : _green,
      behavior: SnackBarBehavior.floating,
      margin: const EdgeInsets.all(16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ));
  }

  List<LatLng> _decodePolyline(String encoded) {
    final List<LatLng> pts = [];
    int index = 0;
    int lat = 0, lng = 0;
    while (index < encoded.length) {
      int b, shift = 0, result = 0;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      final dLat = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
      lat += dLat;
      shift = 0;
      result = 0;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      final dLng = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
      lng += dLng;
      pts.add(LatLng(lat / 1e5, lng / 1e5));
    }
    return pts;
  }

  Future<void> _fetchRoutePolyline() async {
    bool success = false;
    List<LatLng> points = [];
    double fetchedDistMeters = 0.0;

    // Attempt 1: OSRM Public Routing API (Highly reliable, no API key, returns distance)
    try {
      final uri = Uri.parse(
        'https://router.project-osrm.org/route/v1/driving/${widget.pickupLng},${widget.pickupLat};${widget.destLng},${widget.destLat}?overview=full&geometries=polyline'
      );
      final res = await http.get(uri).timeout(const Duration(seconds: 4));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (data['code'] == 'Ok' && data['routes'] != null && data['routes'].isNotEmpty) {
          final route = data['routes'][0];
          final encoded = route['geometry'];
          points = _decodePolyline(encoded);
          fetchedDistMeters = (route['distance'] as num).toDouble();
          success = points.isNotEmpty;
        }
      }
    } catch (e, st) { reportSilentFailure('BookingScreen._fetchRoutePolyline', e, st); }

    // Attempt 2: Direct Google Directions API
    if (!success) {
      try {
        final uri = Uri.parse(
          'https://maps.googleapis.com/maps/api/directions/json?origin=${widget.pickupLat},${widget.pickupLng}&destination=${widget.destLat},${widget.destLng}&key=${ApiConfig.googleMapsApiKey}'
        );
        final res = await http.get(uri).timeout(const Duration(seconds: 4));
        if (res.statusCode == 200) {
          final data = jsonDecode(res.body);
          if (data['routes'] != null && data['routes'].isNotEmpty) {
            final encoded = data['routes'][0]['overview_polyline']['points'];
            points = _decodePolyline(encoded);
            final legs = data['routes'][0]['legs'];
            if (legs != null && legs.isNotEmpty) {
               fetchedDistMeters = (legs[0]['distance']['value'] as num).toDouble();
            }
            success = points.isNotEmpty;
          }
        }
      } catch (e, st) { reportSilentFailure('BookingScreen._fetchRoutePolyline.retry1', e, st); }
    }

    // Attempt 3: Backend Navigation API
    if (!success) {
      try {
        final headers = await AuthService.getHeaders();
        final res = await http.post(
          Uri.parse(ApiConfig.routeMultiWaypoint),
          headers: {...headers, 'Content-Type': 'application/json'},
          body: jsonEncode({
            'origin': {'lat': widget.pickupLat, 'lng': widget.pickupLng},
            'destination': {'lat': widget.destLat, 'lng': widget.destLng},
            'waypoints': [],
            'optimize': false,
          }),
        ).timeout(const Duration(seconds: 4));
        
        if (res.statusCode == 200) {
          final data = jsonDecode(res.body) as Map<String, dynamic>;
          final overviewPolyline = data['overviewPolyline']?.toString();
          if (overviewPolyline != null && overviewPolyline.isNotEmpty) {
            points = _decodePolyline(overviewPolyline);
            success = points.isNotEmpty;
          }
        }
      } catch (e, st) { reportSilentFailure('BookingScreen._fetchRoutePolyline.retry2', e, st); }
    }

    if (!mounted) return;

    if (success) {
      if (fetchedDistMeters > 0) {
        _routedDistanceKm = fetchedDistMeters / 1000.0;
        // Recalculate true road distance fares
        _estimateFare();
      }

      setState(() {
        _polylines = {
          Polyline( // Production quality curvy road line constraint
            polylineId: const PolylineId('route'),
            points: points,
            color: _jagoPrimary,
            width: 5,
            jointType: JointType.round,
            startCap: Cap.roundCap,
            endCap: Cap.roundCap,
            geodesic: true,
          )
        };
      });
      _fitMapToRoute(routePoints: points);
    } else {
      setState(() {
        _polylines = {
          Polyline(
            polylineId: const PolylineId('route_fallback'),
            points: [_pickupLatLng, _destLatLng],
            color: _blue, width: 4,
            patterns: [PatternItem.dash(20), PatternItem.gap(10)]
          )
        };
      });
      _fitMapToRoute();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bg,
      body: StreamBuilder<Map<String, VehicleStatus>>(
        stream: _vehicleStatusService.watchVehicleStatuses(),
        builder: (context, snapshot) {
          final statuses = snapshot.data ?? {};
          final visibleFares = _visibleFareEntries(statuses);
          final canContinueFromVehicle =
              !_estimating && visibleFares.isNotEmpty && _selectedFareIndex < _allFares.length;
          final canContinueFromFare = !_loading && !_estimating;

          return Stack(
            children: [
              Positioned.fill(
                child: GoogleMap(
                  initialCameraPosition: CameraPosition(target: _pickupLatLng, zoom: 14),
                  style: Theme.of(context).brightness == Brightness.dark ? kMapNightStyle : null,
                  onMapCreated: (c) {
                    _mapController = c;
                    _fitMapToRoute();
                  },
                  markers: {
                    Marker(
                      markerId: const MarkerId('pickup'),
                      position: _pickupLatLng,
                      anchor: _pickupMarkerAnchor,
                      icon: _pickupMarkerIcon ??
                          BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
                    ),
                    Marker(
                      markerId: const MarkerId('destination'),
                      position: _destLatLng,
                      anchor: _dropMarkerAnchor,
                      icon: _dropMarkerIcon ??
                          BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
                    ),
                  },
                  polylines: _polylines,
                  zoomControlsEnabled: false,
                  myLocationButtonEnabled: false,
                  mapToolbarEnabled: false,
                  compassEnabled: false,
                  padding: EdgeInsets.only(
                    bottom: _bookingStep == _BookingStep.farePayment ? 500 : 320,
                    top: 104,
                  ),
                ),
              ),
              Positioned(
                right: 16,
                bottom: _bookingStep == _BookingStep.farePayment ? 556 : 376,
                child: GestureDetector(
                  onTap: () => _fitMapToRoute(),
                  child: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                      boxShadow: JT.cardShadow,
                    ),
                    child: const Icon(Icons.my_location_rounded, color: JT.primary, size: 20),
                  ),
                ),
              ),
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: SafeArea(
                  bottom: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            GestureDetector(
                              onTap: () => Navigator.pop(context),
                              child: Container(
                                width: 48,
                                height: 48,
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(16),
                                  boxShadow: JT.cardShadow,
                                ),
                                child: const Icon(Icons.arrow_back_rounded, color: JT.textPrimary),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(20),
                                  boxShadow: JT.cardShadow,
                                ),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            _bookingStepTitle,
                                            style: GoogleFonts.poppins(
                                              fontSize: 18,
                                              fontWeight: FontWeight.w600,
                                              color: JT.textPrimary,
                                            ),
                                          ),
                                          const SizedBox(height: 4),
                                          Text(
                                            _bookingStepSubtitle,
                                            style: GoogleFonts.poppins(
                                              fontSize: 12,
                                              color: JT.textSecondary,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    if (_bookingStep == _BookingStep.farePayment) ...[
                                      const SizedBox(width: 12),
                                      _buildForWhomToggle(),
                                    ],
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        _buildStepProgressBar(),
                      ],
                    ),
                  ),
                ),
              ),
              Align(
                alignment: Alignment.bottomCenter,
                child: Container(
                  constraints: BoxConstraints(
                    maxHeight: _bookingStep == _BookingStep.farePayment ? 540 : 360,
                  ),
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                    boxShadow: [BoxShadow(color: Color(0x22000000), blurRadius: 24)],
                  ),
                  child: SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Center(child: _buildSheetHandle()),
                          const SizedBox(height: 16),
                          Expanded(
                            child: Builder(builder: (context) {
                              try {
                                return _buildStepBody(statuses, visibleFares);
                              } catch (e, st) {
                                reportSilentFailure('BookingScreen._buildStepBody', e, st);
                                return SingleChildScrollView(
                                  child: Container(
                                    padding: const EdgeInsets.all(16),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFFEF2F2),
                                      borderRadius: BorderRadius.circular(12),
                                      border: Border.all(color: const Color(0xFFFCA5A5)),
                                    ),
                                    child: Text(
                                      'Could not load this step:\n$e',
                                      style: const TextStyle(color: Color(0xFFDC2626), fontSize: 12),
                                    ),
                                  ),
                                );
                              }
                            }),
                          ),
                          const SizedBox(height: 16),
                          SizedBox(
                            width: double.infinity,
                            height: 56,
                            child: ElevatedButton(
                              onPressed: _loading
                                  ? null
                                  : () => _advanceBookingStep(
                                        canContinueFromVehicle:
                                            canContinueFromVehicle,
                                        canContinueFromFare:
                                            canContinueFromFare,
                                      ),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: JT.primary,
                                foregroundColor: Colors.white,
                                disabledBackgroundColor: JT.border,
                                disabledForegroundColor: JT.textSecondary,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(16),
                                ),
                                elevation: 0,
                              ),
                              child: AnimatedSwitcher(
                                duration: const Duration(milliseconds: 220),
                                transitionBuilder: (child, animation) =>
                                    FadeTransition(
                                  opacity: animation,
                                  child: ScaleTransition(
                                    scale: Tween<double>(
                                      begin: 0.98,
                                      end: 1,
                                    ).animate(animation),
                                    child: child,
                                  ),
                                ),
                                child: _loading
                                    ? const SizedBox(
                                        key: ValueKey('booking_loading'),
                                        width: 22,
                                        height: 22,
                                        child: CircularProgressIndicator(
                                          color: Colors.white,
                                          strokeWidth: 2.4,
                                        ),
                                      )
                                    : Row(
                                        key: ValueKey('booking_${_bookingStep.name}'),
                                        mainAxisAlignment: MainAxisAlignment.center,
                                        children: [
                                          Text(
                                            _bookingStepCta(
                                              canContinueFromVehicle:
                                                  canContinueFromVehicle,
                                              canContinueFromFare:
                                                  canContinueFromFare,
                                            ),
                                            style: GoogleFonts.poppins(
                                              fontSize: 16,
                                              fontWeight: FontWeight.w600,
                                            ),
                                          ),
                                          if (_bookingStep == _BookingStep.farePayment &&
                                              canContinueFromFare) ...[
                                            const SizedBox(width: 8),
                                            const Icon(Icons.arrow_forward_rounded, size: 18),
                                          ],
                                        ],
                                      ),
                              ),
                            ),
                          ),
                          if (_bookingStep == _BookingStep.farePayment && !_bookForSomeone) ...[
                            const SizedBox(height: 10),
                            Center(
                              child: Row(mainAxisSize: MainAxisSize.min, children: [
                                Icon(Icons.lock_rounded, size: 12, color: JT.textSecondary),
                                const SizedBox(width: 4),
                                Text('Secure payments. Your data is protected.',
                                    style: GoogleFonts.poppins(fontSize: 11, color: JT.textSecondary)),
                              ]),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  String get _bookingStepTitle {
    switch (_bookingStep) {
      case _BookingStep.route:
        return 'Choose your route';
      case _BookingStep.vehicle:
        return 'Choose your ride';
      case _BookingStep.farePayment:
        return 'Review fare & payment';
      case _BookingStep.confirm:
        return 'Confirm your trip';
    }
  }

  String get _bookingStepSubtitle {
    switch (_bookingStep) {
      case _BookingStep.route:
        return 'Verify pickup and destination before continuing.';
      case _BookingStep.vehicle:
        return 'Select one vehicle option that fits this trip.';
      case _BookingStep.farePayment:
        return 'Check your trip details, fare and payment options.';
      case _BookingStep.confirm:
        return 'Double-check your trip details before booking.';
    }
  }

  String _bookingStepCta({
    required bool canContinueFromVehicle,
    required bool canContinueFromFare,
  }) {
    switch (_bookingStep) {
      case _BookingStep.route:
        return 'Continue';
      case _BookingStep.vehicle:
        return canContinueFromVehicle ? 'Choose Vehicle' : 'No Vehicles Available';
      case _BookingStep.farePayment:
        if (!canContinueFromFare) return 'Please Wait';
        return _bookForSomeone ? 'Confirm & Continue' : 'Confirm Trip';
      case _BookingStep.confirm:
        return 'Confirm Ride';
    }
  }

  void _advanceBookingStep({
    required bool canContinueFromVehicle,
    required bool canContinueFromFare,
  }) {
    if (_loading) return;
    HapticFeedback.selectionClick();
    switch (_bookingStep) {
      case _BookingStep.route:
        setState(() => _bookingStep = _BookingStep.vehicle);
        break;
      case _BookingStep.vehicle:
        if (canContinueFromVehicle) {
          setState(() => _bookingStep = _BookingStep.farePayment);
        }
        break;
      case _BookingStep.farePayment:
        if (canContinueFromFare) {
          HapticFeedback.mediumImpact();
          _confirmAndBook();
        }
        break;
      case _BookingStep.confirm:
        HapticFeedback.mediumImpact();
        _confirmAndBook();
        break;
    }
  }

  Widget _buildSheetHandle() {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      width: 44,
      height: 4,
      decoration: BoxDecoration(
        color: JT.border,
        borderRadius: BorderRadius.circular(4),
      ),
    );
  }

  Widget _buildStepProgressBar() {
    final steps = _BookingStep.values;
    final current = steps.indexOf(_bookingStep);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: JT.cardShadow,
      ),
      child: Row(
        children: List.generate(steps.length, (index) {
          final isDone = index < current;
          final isActive = index == current;
          return Expanded(
            child: Row(
              children: [
                Expanded(
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 220),
                    height: 6,
                    decoration: BoxDecoration(
                      color: isDone || isActive ? JT.primary : JT.border,
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                ),
                if (index < steps.length - 1) const SizedBox(width: 6),
              ],
            ),
          );
        }),
      ),
    );
  }

  Widget _buildStepBody(
    Map<String, VehicleStatus> statuses,
    List<MapEntry<int, Map<String, dynamic>>> visibleFares,
  ) {
    switch (_bookingStep) {
      case _BookingStep.route:
        return SingleChildScrollView(
          key: const ValueKey('route'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildStepSectionTitle('Route'),
              const SizedBox(height: 12),
              Container(
                decoration: BoxDecoration(
                  color: JT.surface,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: JT.border),
                ),
                child: Column(
                  children: [
                    _addressRow(Icons.circle_rounded, JT.primary, widget.pickup),
                    const Divider(height: 1, indent: 52, endIndent: 16),
                    _addressRow(Icons.location_on_rounded, JT.error, widget.destination),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              _buildInlineInfoCard(
                icon: Icons.route_rounded,
                title: '${_distanceKm.toStringAsFixed(1)} km route',
                subtitle: 'Map stays visible while you choose the ride.',
              ),
            ],
          ),
        );
      case _BookingStep.vehicle:
        return SingleChildScrollView(
          key: const ValueKey('vehicle'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildStepSectionTitle('Vehicle selection'),
              const SizedBox(height: 12),
              _buildVehicleSelector(statuses),
            ],
          ),
        );
      case _BookingStep.farePayment:
        return SingleChildScrollView(
          key: const ValueKey('farePayment'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFF00AA),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Text(
                  'BUILD MARKER — FAREPAYMENT V3',
                  style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
              _buildRouteSummaryCard(),
              const SizedBox(height: 12),
              _buildVehicleSummaryCard(),
              if (_bookForSomeone) ...[
                const SizedBox(height: 12),
                _buildForSomeoneElseForm(),
              ],
              const SizedBox(height: 12),
              if (_fare != null) _buildFareBreakdown(_fare!),
              const SizedBox(height: 16),
              _buildPaymentSection(),
            ],
          ),
        );
      case _BookingStep.confirm:
        return SingleChildScrollView(
          key: const ValueKey('confirm'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildStepSectionTitle('Trip summary'),
              const SizedBox(height: 12),
              _buildInlineInfoCard(
                icon: _iconForVehicle(_vehicleName),
                title: _vehicleName,
                subtitle: 'Estimated fare ₹${_finalFare.toStringAsFixed(0)} • ${_paymentMethod.toUpperCase()}',
              ),
              const SizedBox(height: 12),
              _buildInlineInfoCard(
                icon: Icons.alt_route_rounded,
                title: _shortLocation(widget.pickup),
                subtitle: _shortLocation(widget.destination),
              ),
              const SizedBox(height: 12),
              _buildInlineInfoCard(
                icon: _bookForSomeone ? Icons.person_rounded : Icons.person_outline_rounded,
                title: _bookForSomeone
                    ? (_passengerNameCtrl.text.trim().isEmpty ? 'Ride for someone else' : _passengerNameCtrl.text.trim())
                    : 'Ride for yourself',
                subtitle: _bookForSomeone
                    ? (_passengerPhoneCtrl.text.trim().isEmpty ? 'Passenger details will be added next' : _passengerPhoneCtrl.text.trim())
                    : 'You can edit rider details on the next step.',
              ),
            ],
          ),
        );
    }
  }

  Widget _buildStepSectionTitle(String title) {
    return Text(
      title,
      style: GoogleFonts.poppins(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: JT.textPrimary,
      ),
    );
  }

  Widget _buildInlineInfoCard({
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: JT.primary.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, color: JT.primary, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: GoogleFonts.poppins(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: JT.textPrimary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  style: GoogleFonts.poppins(
                    fontSize: 12,
                    color: JT.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildForWhomToggle() {
    Widget segment({required bool selected, required IconData icon, required String label, required VoidCallback onTap}) {
      return GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: selected ? JT.primary : Colors.transparent,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 14, color: selected ? Colors.white : JT.textSecondary),
            const SizedBox(width: 5),
            Text(label,
                style: GoogleFonts.poppins(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: selected ? Colors.white : JT.textSecondary)),
          ]),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: JT.surfaceAlt,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: JT.border),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        segment(
          selected: !_bookForSomeone,
          icon: Icons.person_rounded,
          label: 'For me',
          onTap: () => setState(() => _bookForSomeone = false),
        ),
        segment(
          selected: _bookForSomeone,
          icon: Icons.group_rounded,
          label: 'For else',
          onTap: () => setState(() => _bookForSomeone = true),
        ),
      ]),
    );
  }

  Widget _buildRouteSummaryCard() {
    Widget statChip(IconData icon, String value, String label) {
      return Expanded(
        child: Column(children: [
          Icon(icon, color: JT.primary, size: 20),
          const SizedBox(height: 6),
          Text(value,
              style: GoogleFonts.poppins(
                  fontSize: 13, fontWeight: FontWeight.w700, color: JT.textPrimary)),
          Text(label, style: GoogleFonts.poppins(fontSize: 10, color: JT.textSecondary)),
        ]),
      );
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.border),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          flex: 2,
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Column(children: [
              Container(width: 8, height: 8, decoration: const BoxDecoration(color: Color(0xFF16A34A), shape: BoxShape.circle)),
              Container(width: 1.4, height: 34, color: JT.border),
              Container(width: 8, height: 8, decoration: const BoxDecoration(color: JT.primary, shape: BoxShape.circle)),
            ]),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_shortLocation(widget.pickup),
                    style: GoogleFonts.poppins(fontSize: 13, fontWeight: FontWeight.w700, color: JT.textPrimary),
                    maxLines: 1, overflow: TextOverflow.ellipsis),
                Text('Pickup location', style: GoogleFonts.poppins(fontSize: 10, color: JT.textSecondary)),
                const SizedBox(height: 14),
                Text(_shortLocation(widget.destination),
                    style: GoogleFonts.poppins(fontSize: 13, fontWeight: FontWeight.w700, color: JT.textPrimary),
                    maxLines: 1, overflow: TextOverflow.ellipsis),
                Text('Drop location', style: GoogleFonts.poppins(fontSize: 10, color: JT.textSecondary)),
              ]),
            ),
          ]),
        ),
        Container(width: 1, height: 64, color: JT.border, margin: const EdgeInsets.symmetric(horizontal: 8)),
        statChip(Icons.route_rounded, '${_distanceKm.toStringAsFixed(1)} km', 'Distance'),
        statChip(Icons.access_time_rounded, '${(_distanceKm * 3).ceil()} min', 'Est. Time'),
        statChip(Icons.alt_route_rounded, 'Best', 'Route'),
      ]),
    );
  }

  Widget _buildVehicleSummaryCard() {
    final imgKey = _vehicleImageKey(_vehicleName);
    final imgUrl = imgKey != null ? _vehicleImageUrls[imgKey] : null;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.border),
      ),
      child: Row(children: [
        Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(color: JT.surfaceAlt, borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.all(6),
          child: imgUrl != null
              ? Image.network(imgUrl, fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) => Icon(_iconForVehicle(_vehicleName), color: JT.primary))
              : Icon(_iconForVehicle(_vehicleName), color: JT.primary),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Vehicle Selected', style: GoogleFonts.poppins(fontSize: 11, color: JT.textSecondary)),
            Text(_vehicleName,
                style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w700, color: JT.textPrimary)),
            const SizedBox(height: 2),
            Row(children: [
              Icon(Icons.person_rounded, size: 13, color: JT.textSecondary),
              const SizedBox(width: 3),
              Text(_isParcel ? 'Parcel' : '1 Rider',
                  style: GoogleFonts.poppins(fontSize: 11, color: JT.textSecondary)),
              const SizedBox(width: 10),
              Icon(Icons.directions_car_rounded, size: 13, color: JT.textSecondary),
              const SizedBox(width: 3),
              Text('Any $_vehicleName', style: GoogleFonts.poppins(fontSize: 11, color: JT.textSecondary)),
            ]),
          ]),
        ),
        OutlinedButton(
          onPressed: () => setState(() => _bookingStep = _BookingStep.vehicle),
          style: OutlinedButton.styleFrom(
            foregroundColor: JT.primary,
            side: const BorderSide(color: JT.primary),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          ),
          child: Text('Change', style: GoogleFonts.poppins(fontSize: 12, fontWeight: FontWeight.w600)),
        ),
      ]),
    );
  }

  Widget _buildForSomeoneElseForm() {
    Widget field(String label, TextEditingController ctrl, {String? prefix, TextInputType? keyboardType}) {
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: GoogleFonts.poppins(fontSize: 11, color: JT.textSecondary)),
        const SizedBox(height: 6),
        Container(
          decoration: BoxDecoration(
            border: Border.all(color: JT.border),
            borderRadius: BorderRadius.circular(12),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(children: [
            if (prefix != null) ...[
              Text(prefix, style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w600, color: JT.textPrimary)),
              const SizedBox(width: 6),
            ],
            Expanded(
              child: TextField(
                controller: ctrl,
                keyboardType: keyboardType,
                style: GoogleFonts.poppins(fontSize: 14, color: JT.textPrimary),
                decoration: InputDecoration(
                  isDense: true,
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(vertical: 14),
                  hintText: label == 'Full Name' ? 'Enter name' : 'Enter mobile number',
                  hintStyle: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF94A3B8)),
                ),
              ),
            ),
          ]),
        ),
      ]);
    }

    Widget genderOption(String value, IconData icon, String label) {
      final selected = _passengerGender == value;
      return Expanded(
        child: GestureDetector(
          onTap: () => setState(() => _passengerGender = value),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(selected ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded,
                color: selected ? JT.primary : JT.textSecondary, size: 18),
            const SizedBox(width: 6),
            Icon(icon, size: 16, color: JT.textSecondary),
            const SizedBox(width: 4),
            Text(label, style: GoogleFonts.poppins(fontSize: 13, color: JT.textPrimary)),
          ]),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Ride for someone else',
            style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w600, color: JT.textPrimary)),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: field('Full Name', _passengerNameCtrl)),
          const SizedBox(width: 10),
          Expanded(
            child: field('Mobile Number', _passengerPhoneCtrl, prefix: '+91', keyboardType: TextInputType.phone),
          ),
        ]),
        const SizedBox(height: 14),
        Text('Gender', style: GoogleFonts.poppins(fontSize: 11, color: JT.textSecondary)),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(border: Border.all(color: JT.border), borderRadius: BorderRadius.circular(12)),
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(children: [
            genderOption('male', Icons.male_rounded, 'Male'),
            genderOption('female', Icons.female_rounded, 'Female'),
          ]),
        ),
      ]),
    );
  }

  bool get _isParcel {
    final n = _vehicleName.toLowerCase();
    return n.contains('parcel') || n.contains('cargo') || n.contains('delivery');
  }

  Widget _buildPaymentSection() {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Payment Method',
        style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: Color(0xFF374151), letterSpacing: 0.2)),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(child: _payBtn('cash', Icons.payments_rounded, 'Cash')),
        const SizedBox(width: 8),
        Expanded(child: _payBtn('wallet', Icons.account_balance_wallet_rounded, 'Wallet')),
        const SizedBox(width: 8),
        Expanded(child: _payBtn('upi', Icons.qr_code_scanner_rounded, 'Online')),
      ]),
      if (_paymentMethod == 'wallet') ...[
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: _walletBalance >= _finalFare
              ? const Color(0xFFF0FDF4)
              : const Color(0xFFFEF2F2),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: _walletBalance >= _finalFare
                ? const Color(0xFF86EFAC)
                : const Color(0xFFFCA5A5)),
          ),
          child: Row(children: [
            Icon(
              _walletBalance >= _finalFare ? Icons.check_circle_rounded : Icons.warning_rounded,
              color: _walletBalance >= _finalFare ? _green : const Color(0xFFDC2626),
              size: 16,
            ),
            const SizedBox(width: 8),
            Expanded(child: Text(
              _walletBalance >= _finalFare
                ? 'Wallet balance ₹${_walletBalance.toStringAsFixed(0)} • Sufficient'
                : 'Insufficient balance (₹${_walletBalance.toStringAsFixed(0)}). Please recharge.',
              style: TextStyle(
                fontSize: 12, fontWeight: FontWeight.w400,
                color: _walletBalance >= _finalFare ? _green : const Color(0xFFDC2626),
              ),
            )),
          ]),
        ),
      ],
      if (_paymentMethod == 'upi') ...[
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: const Color(0xFFF0F7FF),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: JT.primary.withValues(alpha: 0.2)),
          ),
          child: Row(children: [
            const Icon(Icons.lock_rounded, color: JT.primary, size: 15),
            const SizedBox(width: 8),
            const Expanded(child: Text(
              'Secure payment via Razorpay — online payments accepted',
              style: TextStyle(fontSize: 12, color: JT.primary, fontWeight: FontWeight.w500),
            )),
          ]),
        ),
      ],
    ]);
  }

  Widget _payBtn(String method, IconData icon, String label) {
    final selected = _paymentMethod == method;

    return GestureDetector(
      onTap: () {
        HapticFeedback.selectionClick();
        setState(() => _paymentMethod = method);
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 250),
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 10),
        decoration: BoxDecoration(
          color: selected ? JT.primary.withValues(alpha: 0.08) : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? JT.primary : JT.border,
            width: selected ? 2 : 1.5,
          ),
          boxShadow: selected ? [
            BoxShadow(color: JT.primary.withValues(alpha: 0.15), blurRadius: 10, offset: const Offset(0, 4))
          ] : [],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 22, color: selected ? JT.primary : Colors.grey.shade500),
            const SizedBox(height: 6),
            Text(
              label,
              style: GoogleFonts.poppins(
                fontSize: 13,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: selected ? JT.primary : Colors.grey.shade600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _addressRow(IconData icon, Color color, String text, [Color? textColor]) {
    final tColor = textColor ?? JT.textPrimary;
    final isPickup = icon == Icons.circle_rounded;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        Container(
          width: 28, height: 28,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.1),
            shape: BoxShape.circle,
            border: Border.all(color: color.withValues(alpha: 0.3), width: 1.5),
          ),
          child: Icon(icon, color: color, size: isPickup ? 10 : 16),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(isPickup ? 'PICKUP' : 'DROP',
            style: TextStyle(fontSize: 9, fontWeight: FontWeight.w500, color: color.withValues(alpha: 0.8), letterSpacing: 0.8)),
          const SizedBox(height: 2),
          Text(text,
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: tColor),
            maxLines: 1, overflow: TextOverflow.ellipsis),
        ])),
      ]),
    );
  }

  bool _isNightTime() {
    final hour = DateTime.now().hour;
    return hour >= 22 || hour < 6;
  }

  // ignore: unused_element
  Widget _buildNightChargeIndicator() {
    if (!_isNightTime()) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: JT.surfaceAlt, borderRadius: BorderRadius.circular(12),
          border: Border.all(color: JT.border)),
        child: Row(children: [
          const Text('🌙', style: TextStyle(fontSize: 16)),
          const SizedBox(width: 8),
          Expanded(child: Text('Night charges apply (10PM - 6AM)',
            style: TextStyle(color: JT.textPrimary, fontSize: 13, fontWeight: FontWeight.w400))),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(color: JT.primary.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
            child: Text('1.25x', style: TextStyle(color: JT.primary, fontSize: 12, fontWeight: FontWeight.w400)),
          ),
        ]),
      ),
    );
  }

  String? _getVehicleTag(int index) {
    if (_allFares.length < 2) return null;
    int fastestIdx = 0, saverIdx = 0, premiumIdx = 0;
    for (int j = 0; j < _allFares.length; j++) {
      final f = _allFares[j];
      final fare = (f['estimatedFare'] ?? 0).toDouble();
      final bestFare = (_allFares[saverIdx]['estimatedFare'] ?? 0).toDouble();
      final highFare = (_allFares[premiumIdx]['estimatedFare'] ?? 0).toDouble();
      if (fare < bestFare) saverIdx = j;
      if (fare > highFare) premiumIdx = j;
      final timeStr = f['estimatedTime']?.toString() ?? '99 min';
      final timeNum = int.tryParse(timeStr.replaceAll(RegExp(r'[^0-9]'), '')) ?? 99;
      final bestTimeStr = _allFares[fastestIdx]['estimatedTime']?.toString() ?? '99 min';
      final bestTimeNum = int.tryParse(bestTimeStr.replaceAll(RegExp(r'[^0-9]'), '')) ?? 99;
      if (timeNum < bestTimeNum) fastestIdx = j;
    }
    if (index == fastestIdx) return 'FASTEST';
    if (index == saverIdx && index != fastestIdx) return 'SAVER';
    if (index == premiumIdx && index != fastestIdx && _allFares.length >= 3) return 'PREMIUM';
    return null;
  }

  // ignore: unused_element
  Widget _vehicleTagBadge(String tag) {
    Color color;
    IconData icon;
    switch (tag) {
      case 'FASTEST':
        color = const Color(0xFF7C3AED); // Premium Purple matching image
        icon = Icons.bolt_rounded;
        break;
      case 'SAVER':
        color = const Color(0xFF10B981);
        icon = Icons.savings_rounded;
        break;
      case 'PREMIUM':
        color = const Color(0xFFFFD700);
        icon = Icons.star_rounded;
        break;
      default:
        return const SizedBox.shrink();
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.35), width: 1),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, color: color, size: 10),
        const SizedBox(width: 3),
        Text(tag, style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.w500, letterSpacing: 0.5)),
      ]),
    );
  }

  void _fitMapToRoute({List<LatLng>? routePoints, GoogleMapController? controllerOverride}) {
    final controller = controllerOverride ?? _mapController;
    if (controller == null) return;
    Future.delayed(const Duration(milliseconds: 300), () {
      double minLat, maxLat, minLng, maxLng;
      
      if (routePoints != null && routePoints.isNotEmpty) {
        minLat = maxLat = routePoints.first.latitude;
        minLng = maxLng = routePoints.first.longitude;
        for (final p in routePoints) {
          if (p.latitude < minLat) minLat = p.latitude;
          if (p.latitude > maxLat) maxLat = p.latitude;
          if (p.longitude < minLng) minLng = p.longitude;
          if (p.longitude > maxLng) maxLng = p.longitude;
        }
      } else {
        final pLat = _pickupLatLng.latitude;
        final pLng = _pickupLatLng.longitude;
        final dLat = widget.destLat != 0 ? widget.destLat : pLat + 0.005;
        final dLng = widget.destLng != 0 ? widget.destLng : pLng + 0.005;
        minLat = min(pLat, dLat);
        maxLat = max(pLat, dLat);
        minLng = min(pLng, dLng);
        maxLng = max(pLng, dLng);
      }

      try {
        controller.animateCamera(CameraUpdate.newLatLngBounds(
          LatLngBounds(
            southwest: LatLng(minLat, minLng),
            northeast: LatLng(maxLat, maxLng),
          ),
          90, // Significant visual padding for the route
        ));
      } catch (e, st) { reportSilentFailure('BookingScreen._fitMapToRoute', e, st); }
    });
  }

  Widget _buildVehicleSelector(Map<String, VehicleStatus> statuses) {
    if (_estimating) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Shimmer.fromColors(
          baseColor: const Color(0xFFE5E7EB),
          highlightColor: const Color(0xFFF3F4F6),
          child: Column(children: List.generate(2, (_) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Container(height: 80, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20))),
          ))),
        ),
      );
    }
    final visibleFares = _visibleFareEntries(statuses);
    if (visibleFares.isEmpty && !_estimating) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 30),
        decoration: BoxDecoration(
          color: const Color(0xFFF8FAFC),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: JT.border),
        ),
        child: Column(
          children: [
            const Icon(Icons.no_transfer_rounded, color: Color(0xFF64748B), size: 40),
            const SizedBox(height: 12),
            Text(
              'No vehicles available',
              style: GoogleFonts.poppins(
                color: const Color(0xFF0F172A),
                fontSize: 17,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Please check back in a few minutes.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Color(0xFF64748B), fontSize: 13),
            ),
          ],
        ),
      );
    }

    return Column(
      children: visibleFares.map((entry) {
        final i = entry.key;
        final f = entry.value;
        final isActive = f['isActive'] != false;
        final isSelected = i == _selectedFareIndex && isActive;
        final name = f['vehicleCategoryName']?.toString() ?? f['vehicleName']?.toString() ?? f['name']?.toString() ?? 'Bike';
        final fareVal = (f['estimatedFare'] ?? 0).toDouble();
        final time = f['estimatedTime']?.toString() ?? '~5 min';
        final autoDiscount =
            double.tryParse(f['autoDiscountAmount']?.toString() ?? '0') ?? 0;
        final selectedCouponDiscount = isSelected ? _promoDiscount : 0.0;
        final selectedAutoDiscount =
            isSelected && _appliedPromo == null ? autoDiscount : 0.0;
        final displayFare =
            (fareVal - selectedCouponDiscount - selectedAutoDiscount)
                .clamp(0.0, double.infinity);
        
        final etaMins = _etaMins(time);
        final dropTime = _dropTimeStr(time);
        final tag = _getVehicleTag(i);
        final isFastest = tag == 'FASTEST';
        
        final subtitle = isActive ? '$etaMins min • Drop $dropTime' : 'Currently Unavailable';

        final Color selColor = const Color(0xFF7C3AED); // matches the active bottom-nav accent

        return GestureDetector(
          key: ValueKey(i),
          onTap: () {
            if (!isActive) return;
            HapticFeedback.selectionClick();
            setState(() => _selectedFareIndex = i);
          },
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 300),
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: isSelected ? selColor.withValues(alpha: 0.06) : Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: isSelected ? selColor.withValues(alpha: 0.3) : JT.border,
                width: isSelected ? 2 : 1,
              ),
              boxShadow: isSelected ? [
                BoxShadow(color: selColor.withValues(alpha: 0.08), blurRadius: 12, offset: const Offset(0, 4))
              ] : [
                BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 5, offset: const Offset(0, 2))
              ],
            ),
            child: Opacity(
              opacity: isActive ? 1.0 : 0.6,
              child: Row(
                children: [
                  // Vehicle Illustration
                  Container(
                    width: 70, height: 70,
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: isSelected ? selColor.withValues(alpha: 0.1) : const Color(0xFFF9FAFB),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Builder(builder: (_) {
                      final imgKey = _vehicleImageKey(name);
                      final imgUrl = imgKey != null ? _vehicleImageUrls[imgKey] : null;
                      return imgUrl != null 
                          ? Image.network(imgUrl, fit: BoxFit.contain)
                          : Center(child: Text(_emojiForVehicle(name), style: const TextStyle(fontSize: 32)));
                    }),
                  ),
                  const SizedBox(width: 16),
                  
                  // Details
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              name,
                              style: GoogleFonts.poppins(
                                fontSize: 18, 
                                fontWeight: FontWeight.w700, 
                                color: const Color(0xFF1E293B)
                              ),
                            ),
                            if (isFastest && isActive) ...[
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFE8F2FF),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text('FASTEST',
                                  style: GoogleFonts.poppins(color: JT.primary, fontSize: 9, fontWeight: FontWeight.w800)),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          subtitle,
                          style: GoogleFonts.poppins(
                            color: isSelected ? selColor : const Color(0xFF64748B), 
                            fontSize: 13, 
                            fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400
                          ),
                        ),
                      ],
                    ),
                  ),
                  
                  // Pricing
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        '₹${displayFare.toStringAsFixed(0)}',
                        style: GoogleFonts.poppins(
                          fontSize: 22, 
                          fontWeight: FontWeight.w800, 
                          color: const Color(0xFF1E293B)
                        ),
                      ),
                      if (isSelected && _promoDiscount > 0)
                        Text(
                          '₹${fareVal.toInt()}',
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.grey,
                            decoration: TextDecoration.lineThrough
                          ),
                        ),
                    ],
                  ),
                  if (isSelected) ...[
                    const SizedBox(width: 10),
                    Container(
                      width: 26,
                      height: 26,
                      decoration: const BoxDecoration(
                        color: Color(0xFF7C3AED),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.check_rounded, color: Colors.white, size: 16),
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  // ignore: unused_element
  Widget _buildFareBreakdown(Map<String, dynamic> fare) {
    const cardBg = Color(0xFFF8FAFF);
    const borderCol = Color(0xFFE8EFFF);
    const textMain = JT.textPrimary;
    final textSub = Colors.grey.shade600;

    final baseFare = (fare['baseFare'] ?? 0).toDouble();
    final distanceFare = (fare['distanceFare'] ?? 0).toDouble();
    final timeFare = (fare['timeFare'] ?? 0).toDouble();
    final helperCharge = (fare['helperCharge'] ?? 0).toDouble();
    final gst = (fare['gst'] ?? 0).toDouble();
    final minFare = (fare['minimumFare'] ?? 0).toDouble();
    final farePerKm = (fare['farePerKm'] ?? 0).toDouble();
    final waitingChargePerMin = (fare['waitingChargePerMin'] ?? 0).toDouble();
    final subtotal = (fare['subtotal'] ?? (baseFare + distanceFare + timeFare)).toDouble();
    final isMinFareApplied = minFare > 0 && subtotal <= minFare + 0.01;
    final isNight = fare['isNightCharge'] == true;

    return Container(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderCol),
      ),
      child: Column(children: [
        // Header
        Container(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
          decoration: BoxDecoration(
            color: _jagoPrimary.withValues(alpha: 0.06),
            borderRadius: const BorderRadius.only(topLeft: Radius.circular(15), topRight: Radius.circular(15)),
            border: Border(bottom: BorderSide(color: borderCol)),
          ),
          child: Row(children: [
            const Icon(Icons.receipt_long_rounded, size: 16, color: _jagoPrimary),
            const SizedBox(width: 8),
            Text(_isParcel ? 'Delivery Fare Details' : 'Fare Breakdown',
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w400, color: _jagoPrimary)),
            const Spacer(),
            if (isMinFareApplied)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: JT.primary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: JT.primary.withValues(alpha: 0.3)),
                ),
                child: const Text('Min fare', style: TextStyle(
                  fontSize: 10, color: JT.primary, fontWeight: FontWeight.w400)),
              )
            else if (isNight)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: _blue.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: _blue.withValues(alpha: 0.3)),
                ),
                child: const Text('Night fare', style: TextStyle(
                  fontSize: 10, color: _blue, fontWeight: FontWeight.w400)),
              )
            else
              Text('Incl. GST', style: TextStyle(fontSize: 10, color: Colors.grey[400], fontWeight: FontWeight.w500)),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.all(14),
          child: Column(children: [
            // Base fare row with rate info
            _fareRow('Base Fare (Booking Fee)', '₹${baseFare.toStringAsFixed(0)}', textSub: textSub),
            // Distance fare — always show when farePerKm > 0
            if (farePerKm > 0) ...[
              _fareRow(
                '${_distanceKm.toStringAsFixed(1)} km × ₹${farePerKm.toStringAsFixed(0)}/km',
                '₹${distanceFare.toStringAsFixed(0)}',
                textSub: textSub,
              ),
            ] else if (distanceFare > 0)
              _fareRow('Distance (${_distanceKm.toStringAsFixed(1)} km)',
                '₹${distanceFare.toStringAsFixed(0)}', textSub: textSub),
            if (timeFare > 0)
              _fareRow('Time Charge (per min)', '₹${timeFare.toStringAsFixed(0)}', textSub: textSub),
            if (waitingChargePerMin > 0)
              _fareRow('Waiting Charge (₹${waitingChargePerMin.toStringAsFixed(0)}/min)', '—', textSub: textSub),
            // Parcel-specific: helper charge (Porter style)
            if (_isParcel && helperCharge > 0)
              Container(
                margin: const EdgeInsets.symmetric(vertical: 4),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFF10B981).withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.2)),
                ),
                child: Row(children: [
                  const Icon(Icons.person_2_rounded, size: 13, color: Color(0xFF10B981)),
                  const SizedBox(width: 6),
                  Expanded(child: Text('Helper Charge (loading/unloading)',
                    style: TextStyle(fontSize: 11, color: textSub))),
                  Text('₹${helperCharge.toStringAsFixed(0)}',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: Color(0xFF10B981))),
                ]),
              )
            else if (!_isParcel && helperCharge > 0)
              _fareRow('Helper Charge', '₹${helperCharge.toStringAsFixed(0)}', textSub: textSub),
            // Night multiplier
            if (isNight) ...[
              const SizedBox(height: 2),
              Row(children: [
                const Icon(Icons.nightlight_round, size: 12, color: _blue),
                const SizedBox(width: 5),
                Text('Night fare applies (1.0x–1.25x)',
                  style: TextStyle(fontSize: 11, color: textSub, fontStyle: FontStyle.italic)),
              ]),
            ],
            // Minimum fare note
            if (minFare > 0) ...[
              const SizedBox(height: 4),
              Row(children: [
                Icon(Icons.info_outline_rounded, size: 12, color: Colors.grey[400]),
                const SizedBox(width: 5),
                Text('Minimum fare: ₹${minFare.toStringAsFixed(0)}',
                  style: TextStyle(fontSize: 11, color: Colors.grey[400])),
              ]),
            ],
            Divider(height: 18, color: borderCol, thickness: 1),
            _fareRow('GST (5%)', '₹${gst.toStringAsFixed(0)}', textSub: textSub),
            if (_promoDiscount > 0)
              _fareRow('Promo Discount', '-₹${_promoDiscount.toInt()}', positive: true, textSub: textSub),
            if (_promoDiscount == 0 && _autoDiscount > 0)
              _fareRow(_autoDiscountName ?? 'Auto Discount', '-₹${_autoDiscount.toInt()}', positive: true, textSub: textSub),
            const SizedBox(height: 8),
            // Total row — bold, large, primary blue
            Row(children: [
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Total Fare', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: textMain)),
                if (minFare > 0 && isMinFareApplied)
                  Text('Min fare applied', style: TextStyle(fontSize: 10, color: Colors.grey[400])),
              ]),
              const Spacer(),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text('₹${_finalFare.toStringAsFixed(0)}',
                  style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w500, color: _jagoPrimary)),
                Text('incl. GST', style: TextStyle(fontSize: 10, color: Colors.grey[400])),
              ]),
            ]),
          ]),
        ),
      ]),
    );
  }

  Widget _fareRow(String label, String value, {bool bold = false, bool positive = false, Color? textSub}) {
    final sub = textSub ?? Colors.grey.shade600;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(children: [
        Expanded(child: Text(label, style: TextStyle(fontSize: 12, color: sub))),
        Text(value, style: TextStyle(fontSize: 12,
          fontWeight: bold ? FontWeight.w500 : FontWeight.w500,
          color: positive ? _green : sub)),
      ]),
    );
  }

  // ignore: unused_element
  Widget _buildPromoRow() {
    const cardBg = Color(0xFFF8FBFF);
    const borderCol = Color(0xFFDCE8F8);
    const textColor = JT.textPrimary;
    if (_appliedPromo != null) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFFF0FDF4), Color(0xFFECFDF5)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFF86EFAC)),
          boxShadow: [
            BoxShadow(
              color: JT.success.withValues(alpha: 0.08),
              blurRadius: 16,
              offset: const Offset(0, 6),
            ),
          ]),
        child: Row(children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.75),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.local_offer_rounded, color: Color(0xFF16A34A), size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('$_appliedPromo applied!',
              style: const TextStyle(fontWeight: FontWeight.w500, color: Color(0xFF16A34A), fontSize: 13)),
            Text('You save ₹${_promoDiscount.toInt()}',
              style: TextStyle(color: Colors.green[700], fontSize: 12)),
          ])),
          GestureDetector(
            onTap: () => setState(() { _appliedPromo = null; _promoDiscount = 0; _promoCtrl.clear(); }),
            child: const Icon(Icons.close_rounded, color: Color(0xFF16A34A), size: 20)),
        ]),
      );
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: cardBg, borderRadius: BorderRadius.circular(18),
        border: Border.all(color: borderCol),
        boxShadow: JT.shadowXs),
      child: Column(children: [
        Row(children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFFE8F2FF), Color(0xFFD7E8FF)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.local_offer_outlined, color: _jagoPrimary, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: _promoCtrl,
              textCapitalization: TextCapitalization.characters,
              onChanged: _onCouponChanged,
              decoration: InputDecoration(
                hintText: 'Enter coupon code',
                border: InputBorder.none, isDense: true,
                hintStyle: const TextStyle(fontSize: 13, color: Color(0xFF94A3B8))),
              style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, letterSpacing: 1.2, color: textColor),
            ),
          ),
          const SizedBox(width: 10),
          GestureDetector(
            onTap: _promoLoading ? null : _applyPromo,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [JT.primary, JT.primaryDark],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(12),
                boxShadow: JT.btnShadow,
              ),
              child: _promoLoading
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('Apply', style: TextStyle(color: Colors.white, fontSize: 12.5, fontWeight: FontWeight.w600)),
            ),
          ),
        ]),
        if (_promoError != null)
          Padding(
            padding: const EdgeInsets.only(top: 10, left: 52, right: 6),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(_promoError!, style: const TextStyle(color: Color(0xFFDC2626), fontSize: 11.5, fontWeight: FontWeight.w500)),
            )),
        if (_promoError == null && _autoDiscount > 0)
          Padding(
            padding: const EdgeInsets.only(top: 10, left: 52, right: 6),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '${_autoDiscountName ?? 'Auto Discount'} applied: save ₹${_autoDiscount.toInt()}',
                style: const TextStyle(
                  color: Color(0xFF16A34A),
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
      ]),
    );
  }

  // ignore: unused_element
  Widget _headerAction(IconData icon) {
    return Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: Icon(icon, color: const Color(0xFF64748B), size: 24),
    );
  }

  // ignore: unused_element
  Widget _buildBottomNav() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Colors.grey.shade100, width: 1)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _navItem(0, Icons.home_rounded, Icons.home_outlined, 'Home'),
              _navItem(1, Icons.receipt_long_rounded, Icons.receipt_long_outlined, 'Trips'),
              _navItem(2, Icons.account_balance_wallet_rounded, Icons.account_balance_wallet_outlined, 'Wallet'),
              _navItem(3, Icons.person_rounded, Icons.person_outline_rounded, 'Profile'),
            ],
          ),
        ),
      ),
    );
  }

  Widget _navItem(int index, IconData activeIcon, IconData inactiveIcon, String label) {
    bool isSelected = index == 0;
    return GestureDetector(
      onTap: () => Navigator.pop(context),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: isSelected
            ? BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF7C3AED), Color(0xFF6366F1)], 
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(color: const Color(0xFF7C3AED).withValues(alpha: 0.3), blurRadius: 10, offset: const Offset(0, 4)),
                ],
              )
            : null,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              isSelected ? activeIcon : inactiveIcon,
              color: isSelected ? Colors.white : const Color(0xFF94A3B8),
              size: 22,
            ),
            if (isSelected) ...[
              const SizedBox(width: 8),
              Text(
                label,
                style: GoogleFonts.poppins(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
              ),
            ]
          ],
        ),
      ),
    );
  }
}

class DashedLinePainter extends CustomPainter {
  final Color color;
  const DashedLinePainter({required this.color});
  @override
  void paint(Canvas canvas, Size size) {
    double dashHeight = 5, dashSpace = 3, startY = 0;
    final paint = Paint()..color = color..strokeWidth = 1;
    while (startY < size.height) {
      canvas.drawLine(Offset(0, startY), Offset(0, startY + dashHeight), paint);
      startY += dashHeight + dashSpace;
    }
  }
  @override
  bool shouldRepaint(DashedLinePainter oldDelegate) => oldDelegate.color != color;
}
