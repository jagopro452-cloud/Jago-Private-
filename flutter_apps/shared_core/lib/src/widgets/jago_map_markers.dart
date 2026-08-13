import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

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

  static Future<BitmapDescriptor> vehicle(
    String rawType, {
    bool searching = false,
  }) async {
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

  static Future<BitmapDescriptor> destination() => _pin(
        'destination',
        icon: Icons.location_on_rounded,
        fill: _errorColor,
      );

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

    if (type.contains('tempo') || type.contains('truck')) {
      return _VehicleSpec(
        cacheKey: 'tempo${badge.name}',
        icon: Icons.local_shipping_rounded,
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
