import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../src/core/config/api_config.dart';
import '../config/jago_theme.dart';

/// Single source for vehicle images with premium 3D PNG priority.
/// Priority: Local 3D PNG → Network URL → Admin Icon → Emergency SVG → Icon fallback.
class VehicleArtwork extends StatelessWidget {
  final String vehicleKey;
  final double? width;
  final double? height;
  final String? networkUrl;
  final String? adminIcon;
  final BoxFit fit;
  final Color? tint;

  const VehicleArtwork({
    super.key,
    required this.vehicleKey,
    this.width,
    this.height,
    this.networkUrl,
    this.adminIcon,
    this.fit = BoxFit.contain,
    this.tint,
  });

  /// Official JAGO customer app PNG artwork (home + booking).
  /// PRIORITY 1: Local bundled 3D PNGs for offline consistency.
  static const Map<String, String> localPng3D = {
    'bike': 'assets/vehicles_3d/bike.png',
    'auto': 'assets/vehicles_3d/auto.png',
    'cab': 'assets/vehicles_3d/cab.png',
    'mini_car': 'assets/vehicles_3d/cab.png',
    'sedan': 'assets/vehicles_3d/sedan.png',
    'suv': 'assets/vehicles_3d/suv.png',
    'premium': 'assets/vehicles_3d/premium.png',
    'parcel': 'assets/vehicles_3d/parcel.png',
    'parcel_bike': 'assets/vehicles_3d/parcel_bike.png',
    'parcel_auto': 'assets/vehicles_3d/parcel_auto.png',
    'mini_truck': 'assets/vehicles_3d/tata_ace.png',
    'tata_ace': 'assets/vehicles_3d/tata_ace.png',
    'pickup_van': 'assets/vehicles_3d/pickup_van.png',
    'pickup_truck': 'assets/vehicles_3d/pickup_van.png',
    'bolero': 'assets/vehicles_3d/bolero.png',
    'tempo_407': 'assets/vehicles_3d/tempo_407.png',
    'carpool': 'assets/vehicles_3d/carpool.png',
    'outstation': 'assets/vehicles_3d/outstation.png',
    'delivery': 'assets/vehicles_3d/delivery.png',
    // Pool variants map to closest 3D equivalent
    'pool_bike': 'assets/vehicles_3d/bike.png',
    'pool_auto': 'assets/vehicles_3d/auto.png',
    'pool_mini': 'assets/vehicles_3d/cab.png',
    'pool_sedan': 'assets/vehicles_3d/sedan.png',
    'pool_suv': 'assets/vehicles_3d/suv.png',
  };

  /// PRIORITY 2 (emergency): Local SVG fallback for unknown keys.
  static const Map<String, String> _assets = {
    'bike': 'assets/vehicles/bike.svg',
    'auto': 'assets/vehicles/auto.svg',
    'cab': 'assets/vehicles/mini_car.svg',
    'mini_car': 'assets/vehicles/mini_car.svg',
    'premium': 'assets/vehicles/sedan.svg',
    'sedan': 'assets/vehicles/sedan.svg',
    'suv': 'assets/vehicles/suv.svg',
    'parcel': 'assets/vehicles/parcel_bike.svg',
    'parcel_bike': 'assets/vehicles/parcel_bike.svg',
    'bike_parcel': 'assets/vehicles/parcel_bike.svg',
    'parcel_auto': 'assets/vehicles/parcel_auto.svg',
    'auto_parcel': 'assets/vehicles/parcel_auto.svg',
    'tata_ace': 'assets/vehicles/tata_ace.svg',
    'mini_truck': 'assets/vehicles/tata_ace.svg',
    'pickup_van': 'assets/vehicles/parcel_van.svg',
    'pickup_truck': 'assets/vehicles/parcel_van.svg',
    'bolero_pickup': 'assets/vehicles/bolero.svg',
    'bolero': 'assets/vehicles/bolero.svg',
    'tempo_407': 'assets/vehicles/tempo_407.svg',
    'carpool': 'assets/vehicles/carpool.svg',
    'pool_bike': 'assets/vehicles/pool_bike.svg',
    'pool_auto': 'assets/vehicles/pool_auto.svg',
    'pool_mini': 'assets/vehicles/pool_mini.svg',
    'pool_sedan': 'assets/vehicles/pool_sedan.svg',
    'pool_suv': 'assets/vehicles/pool_suv.svg',
    'ride': 'assets/vehicles/sedan.svg',
    'delivery': 'assets/vehicles/parcel_bike.svg',
  };

  static String normalizeKey(String raw) {
    final n = raw.toLowerCase().trim();
    if (n.contains('premium') || n.contains('prime')) return 'premium';
    if (n.contains('pickup van') || n.contains('pickup_truck') || n.contains('pickup')) return 'pickup_van';
    if (n.contains('mini truck') || n.contains('tata ace') || n.contains('tata_ace')) return 'tata_ace';
    if (n.contains('bolero')) return 'bolero';
    if (n.contains('tempo') || n.contains('407')) return 'tempo_407';
    if (n.contains('parcel bike') || n.contains('bike parcel') || n.contains('bike_parcel')) return 'parcel_bike';
    if (n.contains('parcel auto') || n.contains('auto parcel') || n.contains('auto_parcel')) return 'parcel_auto';
    if (n.contains('parcel') || n.contains('delivery')) return 'parcel_bike';
    if (n.contains('carpool') || n.contains('pool') || n.contains('share')) return 'carpool';
    if (n.contains('outstation') || n.contains('intercity')) return 'outstation';
    if (n.contains('suv') || n.contains('xl')) return 'suv';
    if (n.contains('sedan')) return 'sedan';
    if (n.contains('mini')) return 'mini_car';
    if (n.contains('cab') || n.contains('car')) return 'cab';
    if (n.contains('auto')) return 'auto';
    if (n.contains('bike')) return 'bike';
    return n.replaceAll(' ', '_');
  }

  /// Resolve display URL: admin icon only (local 3D PNGs handle all known vehicles).
  /// Explicit networkUrl and CDN fallback are intentionally not used — all vehicle
  /// types have bundled 3D assets, avoiding network dependency for vehicle images.
  static String? resolveDisplayUrl({
    required String nameOrKey,
    String? adminIcon,
    String? networkUrl,
  }) {
    final icon = adminIcon?.trim() ?? '';
    if (icon.startsWith('http://') || icon.startsWith('https://')) return icon;
    if (icon.startsWith('/')) return '${ApiConfig.baseUrl}$icon';

    return null;
  }

  static String? assetPathFor(String raw) {
    final key = normalizeKey(raw);
    return _assets[key] ?? _assets[raw.toLowerCase()];
  }

  static IconData iconFor(String raw) {
    final key = normalizeKey(raw);
    switch (key) {
      case 'bike':
      case 'parcel_bike':
      case 'pool_bike':
        return Icons.two_wheeler_rounded;
      case 'auto':
      case 'parcel_auto':
      case 'pool_auto':
        return Icons.electric_rickshaw_rounded;
      case 'parcel':
      case 'delivery':
      case 'tata_ace':
      case 'pickup_van':
      case 'bolero':
      case 'tempo_407':
        return Icons.local_shipping_rounded;
      case 'carpool':
        return Icons.people_alt_rounded;
      default:
        return Icons.directions_car_filled_rounded;
    }
  }

  static String? local3DPngPathFor(String raw) {
    final key = normalizeKey(raw);
    return localPng3D[key] ?? localPng3D[raw.toLowerCase()];
  }

  @override
  Widget build(BuildContext context) {
    // PRIORITY 1: Explicit Network / Admin Icon (if provided)
    final url = resolveDisplayUrl(
      nameOrKey: vehicleKey,
      adminIcon: adminIcon,
      networkUrl: networkUrl,
    );
    if (url != null) {
      return _networkOrFallback();
    }

    // PRIORITY 2: Check for local 3D PNG (premium consistent display)
    final local3D = local3DPngPathFor(vehicleKey);
    if (local3D != null) {
      return Image.asset(
        local3D,
        width: width,
        height: height,
        fit: fit,
        errorBuilder: (_, __, ___) => _networkOrFallback(),
      );
    }

    return _networkOrFallback();
  }

  Widget _networkOrFallback() {
    final url = resolveDisplayUrl(
      nameOrKey: vehicleKey,
      adminIcon: adminIcon,
      networkUrl: networkUrl,
    );
    if (url != null) {
      if (url.toLowerCase().endsWith('.svg')) {
        return SvgPicture.network(
          url,
          width: width,
          height: height,
          fit: fit,
          placeholderBuilder: (_) => _local(),
        );
      }
      return CachedNetworkImage(
        imageUrl: url,
        width: width,
        height: height,
        fit: fit,
        placeholder: (_, __) => const SizedBox.shrink(),
        errorWidget: (_, __, ___) => _local(),
      );
    }
    return _local();
  }

  Widget _local() {
    final path = assetPathFor(vehicleKey);
    if (path != null) {
      return SvgPicture.asset(
        path,
        width: width,
        height: height,
        fit: fit,
        colorFilter: tint != null ? ColorFilter.mode(tint!, BlendMode.srcIn) : null,
        placeholderBuilder: (_) => _icon(),
      );
    }
    return _icon();
  }

  Widget _icon() {
    final size = height ?? width ?? 48.0;
    return Icon(iconFor(vehicleKey), size: size * 0.72, color: tint ?? JT.primary);
  }
}
