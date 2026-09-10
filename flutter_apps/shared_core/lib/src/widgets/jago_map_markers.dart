import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;

// Moved from customer_app/driver_app's lib/widgets/jago_map_markers.dart —
// the two copies were byte-for-byte identical (410/410 lines, 0 diff).
// The only app-local dependency was `import '../config/jago_theme.dart'`,
// used solely for `JT.primary` (0xFF2D8CFF) and `JT.error` (0xFFDC2626).
// Both apps' theme classes resolve those two members to the same literal
// values (verified by reading both apps' theme sources directly), so they
// are inlined here as local constants instead of importing either app's
// theme — this keeps the widget fully self-contained and avoids coupling
// the shared package to either app's (currently divergent) theme system.
const Color _primaryColor = Color(0xFF2D8CFF);
const Color _errorColor = Color(0xFFDC2626);

class JagoMapMarkers {
  static final Map<String, BitmapDescriptor> _cache = {};

  // ── Photo-based vehicle markers ────────────────────────────────────────
  // Centralized rawType -> Cloudinary photo mapping for nearby/assigned
  // driver markers. To add a new vehicle type's photo marker, add one entry
  // here (and a match rule in _photoKeyFor if its name doesn't already fall
  // under an existing rule) — no other caller needs to change. Any type not
  // covered here (or whose photo fails to load) falls back to the existing
  // hand-drawn _buildVehicleMarker below, so an unrecognized/failed fetch
  // never breaks marker rendering.
  // The 5 newer source photos (auto/mini_car/sedan/premium/bike_parcel) were
  // supplied with a solid white background, which rendered as an ugly white
  // square on the map. Cloudinary's e_make_transparent transform (same
  // technique already used for the home-screen bike artwork) strips a
  // near-white background at the source so the marker shows just the
  // vehicle. The original bike-on-map photo is already transparent and is
  // left untouched.
  static const Map<String, String> _vehiclePhotoUrls = {
    'bike': 'https://res.cloudinary.com/kits/image/upload/v1787043541/bikeonmap_mhti9m.png',
    'auto': 'https://res.cloudinary.com/kits/image/upload/e_make_transparent:15/q_auto/f_png/v1787218843/ChatGPT_Image_Aug_19_2026_12_15_22_PM_icbpan.png',
    'mini_car': 'https://res.cloudinary.com/kits/image/upload/e_make_transparent:15/q_auto/f_png/v1787218843/ChatGPT_Image_Aug_19_2026_12_14_52_PM_w71se5.png',
    'sedan': 'https://res.cloudinary.com/kits/image/upload/e_make_transparent:15/q_auto/f_png/v1787218843/ChatGPT_Image_Aug_19_2026_12_17_44_PM_twmivt.png',
    'suv': 'https://res.cloudinary.com/kits/image/upload/e_make_transparent:15/q_auto/f_png/v1787218843/ChatGPT_Image_Aug_19_2026_12_20_53_PM_kmitap.png',
    'premium': 'https://res.cloudinary.com/kits/image/upload/e_make_transparent:15/q_auto/f_png/v1787218843/ChatGPT_Image_Aug_19_2026_12_20_53_PM_kmitap.png',
    'bike_parcel': 'https://res.cloudinary.com/kits/image/upload/e_make_transparent:15/q_auto/f_png/v1787218843/ChatGPT_Image_Aug_19_2026_12_24_05_PM_rr9pfc.png',
  };

  static final Map<String, BitmapDescriptor?> _photoCache = {};
  static final Map<String, Future<BitmapDescriptor?>> _photoLoading = {};

  /// Maps a raw vehicle type/category string exactly as callers already have
  /// it (e.g. "Bike", "Mini Car", "3-Wheeler / Auto", "Bike Delivery") to one
  /// of the canonical keys in [_vehiclePhotoUrls], or null if there's no
  /// photo marker for it.
  static String? _photoKeyFor(String rawType) {
    final t = rawType.toLowerCase();
    if (t.contains('bike parcel') ||
        t.contains('parcel bike') ||
        t.contains('bike_parcel') ||
        t.contains('bike delivery')) {
      return 'bike_parcel';
    }
    if (t.contains('bike') || t.contains('moto') || t.contains('scooter')) {
      return 'bike';
    }
    if (t.contains('mini car') || t.contains('mini_car')) return 'mini_car';
    if (t.contains('sedan')) return 'sedan';
    if (t.contains('suv') || t.contains('xl')) return 'suv';
    if (t.contains('premium')) return 'premium';
    if (t.contains('auto') || t.contains('rickshaw')) return 'auto';
    return null;
  }

  // Only a successful fetch is cached — a failed/timed-out attempt (e.g. a
  // slow mobile connection) must not permanently lock the caller into the
  // hand-drawn fallback for the rest of the app session. Leaving the key out
  // of _photoCache on failure means the next call for the same vehicle type
  // (self-icon refresh on every GPS tick, or another marker refresh) gets a
  // fresh network attempt instead of an instantly-replayed null.
  static Future<BitmapDescriptor?> _loadPhotoMarker(String key) {
    if (_photoCache.containsKey(key)) return Future.value(_photoCache[key]);
    return _photoLoading[key] ??= _fetchPhotoMarker(key).then((icon) {
      if (icon != null) _photoCache[key] = icon;
      _photoLoading.remove(key);
      return icon;
    });
  }

  static Future<BitmapDescriptor?> _fetchPhotoMarker(String key) {
    final url = _vehiclePhotoUrls[key];
    if (url == null) return Future.value(null);
    return _fetchImageMarker(url);
  }

  // Marker photos are bounded to this many logical pixels on their longer
  // edge — matches the hand-drawn markers' footprint so every photo marker
  // (vehicle or customer) reads at the same "small, map-friendly" size,
  // never dominating the map regardless of the source image's own resolution
  // or aspect ratio.
  static const int _markerTargetSize = 96;

  static Future<BitmapDescriptor?> _fetchImageMarker(String url) async {
    try {
      final res =
          await http.get(Uri.parse(url)).timeout(const Duration(seconds: 15));
      if (res.statusCode != 200) return null;
      // Decode bounded to _markerTargetSize on whichever edge is longer —
      // a portrait source stays no taller than the target, a landscape one
      // stays no wider — so the artwork is never upscaled or left oversized
      // before the square-canvas step below.
      var codec = await ui.instantiateImageCodec(res.bodyBytes,
          targetWidth: _markerTargetSize);
      var frame = await codec.getNextFrame();
      var image = frame.image;
      if (image.height > _markerTargetSize) {
        codec = await ui.instantiateImageCodec(res.bodyBytes,
            targetHeight: _markerTargetSize);
        frame = await codec.getNextFrame();
        image = frame.image;
      }
      final squared = await _padToSquare(image, _markerTargetSize);
      final byteData = await squared.toByteData(format: ui.ImageByteFormat.png);
      if (byteData == null) return null;
      return BitmapDescriptor.bytes(byteData.buffer.asUint8List());
    } catch (_) {
      return null;
    }
  }

  // Confirmed on-device: this Google Maps SDK build silently fails to render
  // a marker bitmap whose width and height differ enough (a 200x300 portrait
  // PNG never appeared on the map; an otherwise-identical 200x200 version of
  // the same artwork rendered fine). Rather than stretch non-square photos
  // to fit — which would distort them — letterbox onto a transparent square
  // canvas of a FIXED size (never the image's own longer edge, which would
  // let a tall/wide source render larger than every other marker) so every
  // photo marker is both safely square and uniformly sized, with the
  // artwork's proportions and centering preserved.
  static Future<ui.Image> _padToSquare(ui.Image image, int side) async {
    if (image.width == side && image.height == side) return image;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(
        recorder, Rect.fromLTWH(0, 0, side.toDouble(), side.toDouble()));
    final dx = (side - image.width) / 2;
    final dy = (side - image.height) / 2;
    canvas.drawImage(image, Offset(dx, dy), Paint());
    return recorder.endRecording().toImage(side, side);
  }

  // ── Customer identification marker ────────────────────────────────────
  // A single fixed photo representing the customer on the map (pickup /
  // current location) — deliberately separate from _vehiclePhotoUrls so it
  // can never be resolved by vehicle-type matching and accidentally shown
  // as (or replaced by) a vehicle marker. Only a successful fetch is
  // cached, same reasoning as the vehicle photos above: a slow/failed
  // attempt must not permanently lock the caller into the fallback pin.
  static const String _customerPhotoUrl =
      'https://res.cloudinary.com/kits/image/upload/v1787550714/ChatGPT_Image_Aug_24_2026_11_20_05_AM_zebw8f.png';
  static BitmapDescriptor? _customerCache;
  static Future<BitmapDescriptor?>? _customerLoading;

  /// The customer's map identity — always this exact photo, regardless of
  /// the booked vehicle type. Falls back to the existing hand-drawn pickup
  /// pin ([pickup]) if the photo can't be fetched, so the marker never
  /// silently disappears on a bad connection.
  static Future<BitmapDescriptor> customer() async {
    final cached = _customerCache;
    if (cached != null) return cached;
    final photo =
        await (_customerLoading ??= _fetchImageMarker(_customerPhotoUrl));
    _customerLoading = null;
    if (photo != null) {
      _customerCache = photo;
      return photo;
    }
    return pickup();
  }

  static Future<BitmapDescriptor> vehicle(
    String rawType, {
    bool searching = false,
  }) async {
    final photoKey = _photoKeyFor(rawType);
    if (photoKey != null) {
      final photo = await _loadPhotoMarker(photoKey);
      if (photo != null) return photo;
    }

    final spec = _VehicleSpec.from(rawType);
    final cacheKey = 'vehicle:${spec.cacheKey}:$searching';
    final cached = _cache[cacheKey];
    if (cached != null) return cached;
    final icon = await _buildVehicleMarker(spec, searching: searching);
    _cache[cacheKey] = icon;
    return icon;
  }

  static Future<BitmapDescriptor> pickup() =>
      _pin('pickup', icon: Icons.my_location_rounded, fill: _primaryColor);

  // Dedicated (not the shared _pin) drawing so the destination gets a richer
  // gradient, bigger ring and a finish-flag icon — a distinct "trip end"
  // marker rather than reusing the generic pickup pin shape/color.
  static Future<BitmapDescriptor> destination() async {
    const key = 'destination_v2';
    final cached = _cache[key];
    if (cached != null) return cached;

    const double size = 160;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, const Rect.fromLTWH(0, 0, size, size));
    _drawDestinationPin(canvas, size);

    final image =
        await recorder.endRecording().toImage(size.toInt(), size.toInt());
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final result = BitmapDescriptor.bytes(bytes!.buffer.asUint8List());
    _cache[key] = result;
    return result;
  }

  static final Map<String, BitmapDescriptor> _labelCache = {};

  // Same finish-flag pin as [destination], with a small always-visible name
  // chip baked above it. A Marker's infoWindow only appears on tap, which
  // isn't enough for an "always visible" destination label, so the text is
  // rendered directly into the marker bitmap instead. Cached per label text
  // — bounded by how many distinct destinations a driver sees in a session.
  // Callers should anchor this marker at Offset(0.5, 0.92) (the pin's tip
  // sits lower in this taller canvas than in [destination]'s Offset(0.5, 0.9)).
  static Future<BitmapDescriptor> destinationWithLabel(String label) async {
    final trimmed = label.trim();
    if (trimmed.isEmpty) return destination();
    final cacheKey = 'destination_label:$trimmed';
    final cached = _labelCache[cacheKey];
    if (cached != null) return cached;

    const double pinSize = 160;
    const double labelHeight = 32;
    const double gap = 8;
    const double canvasWidth = pinSize + 40;
    const double canvasHeight = labelHeight + gap + pinSize;
    const double pinOffsetX = (canvasWidth - pinSize) / 2;
    const double pinOffsetY = labelHeight + gap;
    const double centerX = canvasWidth / 2;

    final recorder = ui.PictureRecorder();
    final canvas =
        Canvas(recorder, const Rect.fromLTWH(0, 0, canvasWidth, canvasHeight));

    final textPainter = TextPainter(
      text: TextSpan(
        text: '\u{1F4CD} $trimmed',
        style: const TextStyle(
          fontSize: 12.5,
          fontWeight: FontWeight.w600,
          color: Colors.white,
          height: 1.0,
        ),
      ),
      textDirection: TextDirection.ltr,
      maxLines: 1,
      ellipsis: '…',
    )..layout(maxWidth: canvasWidth - 16);

    final chipWidth = (textPainter.width + 22).clamp(0, canvasWidth).toDouble();
    final chipRect = RRect.fromRectAndRadius(
      Rect.fromCenter(
          center: Offset(centerX, labelHeight / 2),
          width: chipWidth,
          height: labelHeight),
      const Radius.circular(16),
    );
    canvas.drawRRect(
      chipRect.shift(const Offset(0, 2)),
      Paint()
        ..color = Colors.black.withValues(alpha: 0.18)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5),
    );
    canvas.drawRRect(chipRect, Paint()..color = _primaryColor);
    canvas.drawRRect(
      chipRect,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.4
        ..color = Colors.white.withValues(alpha: 0.85),
    );
    textPainter.paint(
      canvas,
      Offset(centerX - textPainter.width / 2, labelHeight / 2 - textPainter.height / 2),
    );

    canvas.save();
    canvas.translate(pinOffsetX, pinOffsetY);
    _drawDestinationPin(canvas, pinSize);
    canvas.restore();

    final image = await recorder
        .endRecording()
        .toImage(canvasWidth.toInt(), canvasHeight.toInt());
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final result = BitmapDescriptor.bytes(bytes!.buffer.asUint8List());
    _labelCache[cacheKey] = result;
    return result;
  }

  // Shared geometry for the finish-flag destination pin, drawn into a
  // [size] x [size] region of whatever canvas/offset the caller has already
  // set up — used by both [destination] (drawn at the canvas origin) and
  // [destinationWithLabel] (drawn translated below a label chip).
  static void _drawDestinationPin(Canvas canvas, double size) {
    final center = Offset(size / 2, 58);

    final shadowPaint = Paint()
      ..color = Colors.black.withValues(alpha: 0.20)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 11);
    canvas.drawOval(
      Rect.fromCenter(center: Offset(size / 2, 134), width: 48, height: 15),
      shadowPaint,
    );

    final pinPath = Path()
      ..moveTo(center.dx, 144)
      ..quadraticBezierTo(center.dx + 30, 110, center.dx + 36, 76)
      ..arcToPoint(
        Offset(center.dx - 36, 76),
        radius: const Radius.circular(36),
        clockwise: false,
      )
      ..quadraticBezierTo(center.dx - 30, 110, center.dx, 144)
      ..close();

    canvas.drawPath(
      pinPath,
      Paint()
        ..shader = ui.Gradient.linear(
          const Offset(0, 16),
          Offset(size, 120),
          [const Color(0xFFFF6B7A), _errorColor, const Color(0xFF8E0F27)],
        ),
    );
    canvas.drawPath(
      pinPath,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 6
        ..color = Colors.white,
    );

    canvas.drawCircle(center, 26, Paint()..color = Colors.white);
    canvas.drawCircle(
      center,
      26,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = const Color(0xFFFFE1E4),
    );
    _paintIcon(
      canvas,
      icon: Icons.sports_score_rounded,
      color: _errorColor,
      center: center,
      size: 30,
    );
  }

  static Future<BitmapDescriptor> _pin(
    String key, {
    required IconData icon,
    required Color fill,
  }) async {
    final cached = _cache[key];
    if (cached != null) return cached;

    const double size = 148;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, const Rect.fromLTWH(0, 0, size, size));
    final center = const Offset(size / 2, 54);

    final shadowPaint = Paint()
      ..color = Colors.black.withValues(alpha: 0.18)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 12);
    canvas.drawOval(
      Rect.fromCenter(
        center: const Offset(size / 2, 122),
        width: 54,
        height: 18,
      ),
      shadowPaint,
    );

    final pinPath = Path()
      ..moveTo(center.dx, 136)
      ..quadraticBezierTo(center.dx + 28, 104, center.dx + 34, 72)
      ..arcToPoint(
        Offset(center.dx - 34, 72),
        radius: const Radius.circular(34),
        clockwise: false,
      )
      ..quadraticBezierTo(center.dx - 28, 104, center.dx, 136)
      ..close();

    canvas.drawPath(
      pinPath,
      Paint()
        ..shader = ui.Gradient.linear(
          const Offset(0, 18),
          const Offset(size, 112),
          [fill, const Color(0xFF0E4A98)],
        ),
    );
    canvas.drawPath(
      pinPath,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 6
        ..color = Colors.white,
    );

    canvas.drawCircle(center, 23, Paint()..color = Colors.white);
    _paintIcon(
      canvas,
      icon: icon,
      color: const Color(0xFF16304D),
      center: center,
      size: 34,
    );

    final image =
        await recorder.endRecording().toImage(size.toInt(), size.toInt());
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final result = BitmapDescriptor.bytes(bytes!.buffer.asUint8List());
    _cache[key] = result;
    return result;
  }

  static Future<BitmapDescriptor> _buildVehicleMarker(
    _VehicleSpec spec, {
    required bool searching,
  }) async {
    const double size = 156;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, const Rect.fromLTWH(0, 0, size, size));
    const bodyCenter = Offset(size / 2, 74);

    final shadowPaint = Paint()
      ..color = Colors.black.withValues(alpha: searching ? 0.12 : 0.18)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 14);
    canvas.drawOval(
      Rect.fromCenter(
        center: const Offset(size / 2, 128),
        width: 62,
        height: 20,
      ),
      shadowPaint,
    );

    final outerPath = Path()
      ..moveTo(bodyCenter.dx, 10)
      ..lineTo(bodyCenter.dx - 15, 28)
      ..quadraticBezierTo(18, 36, 18, 74)
      ..quadraticBezierTo(18, 126, bodyCenter.dx, 126)
      ..quadraticBezierTo(size - 18, 126, size - 18, 74)
      ..quadraticBezierTo(size - 18, 36, bodyCenter.dx + 15, 28)
      ..close();

    final gradientColors = spec.premium
        ? [const Color(0xFF0F4FA3), _primaryColor, const Color(0xFF0B2E56)]
        : searching
            ? [const Color(0xFF4A9BFF), _primaryColor, const Color(0xFF0E4B99)]
            : [_primaryColor, const Color(0xFF0E4B99)];

    canvas.drawPath(
      outerPath,
      Paint()
        ..shader = ui.Gradient.linear(
          const Offset(8, 12),
          const Offset(size - 8, 118),
          gradientColors,
        ),
    );
    canvas.drawPath(
      outerPath,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 6
        ..color = Colors.white,
    );

    if (searching) {
      canvas.drawCircle(
        bodyCenter,
        54,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 6
          ..color = _primaryColor.withValues(alpha: 0.20),
      );
    }

    canvas.drawCircle(bodyCenter, 34, Paint()..color = Colors.white);
    canvas.drawCircle(
      bodyCenter,
      34,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = const Color(0xFFE6EEF8),
    );

    _paintIcon(
      canvas,
      icon: spec.icon,
      color: const Color(0xFF16304D),
      center: bodyCenter,
      size: 44,
    );

    if (spec.badge != _VehicleBadge.none) {
      _paintBadge(canvas, spec.badge);
    }

    final image =
        await recorder.endRecording().toImage(size.toInt(), size.toInt());
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    return BitmapDescriptor.bytes(bytes!.buffer.asUint8List());
  }

  static void _paintBadge(Canvas canvas, _VehicleBadge badge) {
    const center = Offset(114, 108);
    final shadow = Paint()
      ..color = Colors.black.withValues(alpha: 0.14)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8);
    canvas.drawCircle(const Offset(114, 111), 18, shadow);

    canvas.drawCircle(center, 18, Paint()..color = Colors.white);
    canvas.drawCircle(
      center,
      18,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..color = const Color(0xFF16304D),
    );

    final IconData icon = switch (badge) {
      _VehicleBadge.parcel => Icons.inventory_2_rounded,
      _VehicleBadge.pool => Icons.groups_rounded,
      _VehicleBadge.outstation => Icons.route_rounded,
      _VehicleBadge.none => Icons.circle,
    };

    _paintIcon(
      canvas,
      icon: icon,
      color: _primaryColor,
      center: center,
      size: 18,
    );
  }

  static void _paintIcon(
    Canvas canvas, {
    required IconData icon,
    required Color color,
    required Offset center,
    required double size,
  }) {
    final textPainter = TextPainter(
      text: TextSpan(
        text: String.fromCharCode(icon.codePoint),
        style: TextStyle(
          fontSize: size,
          fontFamily: icon.fontFamily,
          package: icon.fontPackage,
          color: color,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();

    textPainter.paint(
      canvas,
      Offset(center.dx - (textPainter.width / 2),
          center.dy - (textPainter.height / 2)),
    );
  }
}

enum _VehicleBadge { none, parcel, pool, outstation }

class _VehicleSpec {
  final String cacheKey;
  final IconData icon;
  final _VehicleBadge badge;
  final bool premium;

  const _VehicleSpec({
    required this.cacheKey,
    required this.icon,
    required this.badge,
    this.premium = false,
  });

  factory _VehicleSpec.from(String rawType) {
    final type = rawType.toLowerCase().trim();
    final bool isParcel = type.contains('parcel');
    final bool isOutstation =
        type.contains('outstation') || type.contains('intercity');
    final bool isPool = !isOutstation &&
        (type.contains('pool') ||
            type.contains('carpool') ||
            type.contains('sharing'));

    final badge = isParcel
        ? _VehicleBadge.parcel
        : isOutstation
            ? _VehicleBadge.outstation
            : isPool
                ? _VehicleBadge.pool
                : _VehicleBadge.none;

    // Order matters: "Mini Truck (Tata Ace)" and "Pickup Truck" both contain
    // "truck", so the more specific tata-ace/bolero-pickup checks must run
    // before the generic tempo/truck fallback or they'd all collapse into
    // the same icon.
    if (type.contains('tata ace') ||
        type.contains('tata_ace') ||
        type.contains('mini truck') ||
        type.contains('mini_truck')) {
      return _VehicleSpec(
        cacheKey: 'tataace${badge.name}',
        icon: Icons.fire_truck_rounded,
        badge: badge,
      );
    }
    if (type.contains('bolero') || type.contains('pickup')) {
      return _VehicleSpec(
        cacheKey: 'bolero${badge.name}',
        icon: Icons.agriculture_rounded,
        badge: badge,
      );
    }
    if (type.contains('tempo') || type.contains('truck')) {
      return _VehicleSpec(
        cacheKey: 'tempo${badge.name}',
        icon: Icons.local_shipping_rounded,
        badge: badge,
      );
    }
    if (type.contains('van')) {
      return _VehicleSpec(
        cacheKey: 'van${badge.name}',
        icon: Icons.local_shipping_outlined,
        badge: badge,
      );
    }
    if (type.contains('bike') || type.contains('moto') || type.contains('scooter')) {
      return _VehicleSpec(
        cacheKey: 'bike${badge.name}',
        icon: Icons.two_wheeler_rounded,
        badge: badge,
      );
    }
    if (type.contains('auto')) {
      return _VehicleSpec(
        cacheKey: 'auto${badge.name}',
        icon: Icons.electric_rickshaw_rounded,
        badge: badge,
      );
    }
    if (type.contains('premium')) {
      return _VehicleSpec(
        cacheKey: 'premium${badge.name}',
        icon: Icons.directions_car_filled_rounded,
        badge: badge,
        premium: true,
      );
    }
    // SUV and XL are one eligible-vehicle category from the customer's POV
    // (see booking_screen.dart's Premium-family matcher) but get their own
    // distinct marker since a matched driver's actual vehicle should always
    // be visually identifiable.
    if (type.contains('suv') || type.contains('xl')) {
      return _VehicleSpec(
        cacheKey: 'suv${badge.name}',
        icon: Icons.airport_shuttle_rounded,
        badge: badge,
      );
    }
    if (type.contains('sedan')) {
      return _VehicleSpec(
        cacheKey: 'sedan${badge.name}',
        icon: Icons.time_to_leave_rounded,
        badge: badge,
      );
    }
    return _VehicleSpec(
      cacheKey: 'cab${badge.name}',
      icon: Icons.directions_car_rounded,
      badge: badge,
    );
  }
}

class JagoMapController {
  GoogleMapController? _inner;
  void attach(GoogleMapController map) => _inner = map;
  void move(LatLng target, {double? zoom}) {
    final m = _inner;
    if (m == null) return;
    if (zoom != null) {
      m.moveCamera(CameraUpdate.newLatLngZoom(target, zoom));
    } else {
      m.moveCamera(CameraUpdate.newLatLng(target));
    }
  }
  void moveZoom(LatLng target, double zoom) {
    _inner?.moveCamera(CameraUpdate.newLatLngZoom(target, zoom));
  }
  void animateTo(LatLng target) {
    _inner?.animateCamera(CameraUpdate.newLatLng(target));
  }
  void fitBounds(LatLngBounds bounds, {double padding = 48}) {
    _inner?.animateCamera(CameraUpdate.newLatLngBounds(bounds, padding));
  }
  void dispose() {
    _inner?.dispose();
  }
}

class JagoMapView extends StatefulWidget {
  final CameraPosition initialCameraPosition;
  final Set<Marker> markers;
  final Set<Polyline> polylines;
  final Set<Circle> circles;
  final EdgeInsets padding;
  final JagoMapController? controller;
  final String userAgentPackage;
  final void Function(JagoMapController controller)? onMapCreated;
  final void Function(CameraPosition position)? onCameraMove;
  final void Function()? onCameraIdle;
  const JagoMapView({
    super.key,
    required this.initialCameraPosition,
    this.markers = const {},
    this.polylines = const {},
    this.circles = const {},
    this.padding = EdgeInsets.zero,
    this.controller,
    this.userAgentPackage = 'com.mindwhile.jago_customer',
    this.onMapCreated,
    this.onCameraMove,
    this.onCameraIdle,
  });
  @override
  State<JagoMapView> createState() => _JagoMapViewState();
}

class _JagoMapViewState extends State<JagoMapView> {
  late final JagoMapController _jagoController;
  @override
  void initState() {
    super.initState();
    _jagoController = widget.controller ?? JagoMapController();
  }
  @override
  Widget build(BuildContext context) {
    return SizedBox.expand(
      child: GoogleMap(
        initialCameraPosition: widget.initialCameraPosition,
        markers: widget.markers,
        polylines: widget.polylines,
        circles: widget.circles,
        padding: widget.padding,
        onMapCreated: (GoogleMapController controller) {
          _jagoController.attach(controller);
          widget.onMapCreated?.call(_jagoController);
        },
        onCameraMove: widget.onCameraMove,
        onCameraIdle: widget.onCameraIdle,
        myLocationEnabled: true,
        myLocationButtonEnabled: false,
        mapToolbarEnabled: false,
        zoomControlsEnabled: false,
        compassEnabled: false,
      ),
    );
  }
}
