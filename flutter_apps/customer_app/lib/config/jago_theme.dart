import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class JT {
  /// Haversine formula to calculate distance between two points in km
  static double calculateDistance(double lat1, double lon1, double lat2, double lon2) {
    const double p = 0.017453292519943295;
    final double a = 0.5 -
        math.cos((lat2 - lat1) * p) / 2 +
        math.cos(lat1 * p) *
            math.cos(lat2 * p) *
            (1 - math.cos((lon2 - lon1) * p)) /
            2;
    return 12742 * math.asin(math.sqrt(a));
  }

  // ── PREMIUM DESIGN SYSTEM (v3 Senior-Level) ────────────────────────────

  // ──────────────────────────────────────────────────────────────────────────
  // PRIMARY PALETTE — Professional Blue
  // ──────────────────────────────────────────────────────────────────────────
  static const Color primary = Color(0xFF2D8CFF); // Primary blue
  static const Color primaryLight = Color(0xFFE8F2FF); // Light variant
  static const Color primaryDark = Color(0xFF1A6FDB); // Dark variant
  static const Color secondary = Color(0xFF5B9DFF); // Supporting blue

  // ──────────────────────────────────────────────────────────────────────────
  // BACKGROUNDS & SURFACES
  // ──────────────────────────────────────────────────────────────────────────
  static const Color bg = Color(0xFFFFFFFF); // Main background
  static const Color bgSoft = Color(0xFFF9FAFB); // Soft background
  static const Color surface = Color(0xFFFFFFFF); // Surface
  static const Color surfaceAlt = Color(0xFFF3F6FF); // Alt surface
  static const Color card = Color(0xFFFBFCFE); // Premium card bg

  // ──────────────────────────────────────────────────────────────────────────
  // BORDER & DIVIDERS
  // ──────────────────────────────────────────────────────────────────────────
  static const Color border = Color(0xFFE5E7EB);
  static const Color borderLight = Color(0xFFF0F1F3);
  static const Color divider = Color(0xFFECEEF1);

  // ──────────────────────────────────────────────────────────────────────────
  // TEXT HIERARCHY
  // ──────────────────────────────────────────────────────────────────────────
  static const Color textPrimary = Color(0xFF111827); // Heading/primary
  static const Color textSecondary = Color(0xFF6B7280); // Body text
  static const Color textTertiary = Color(0xFF9CA3AF); // Subtle text
  static const Color iconInactive = Color(0xFFD1D5DB);

  // ──────────────────────────────────────────────────────────────────────────
  // SEMANTIC COLORS
  // ──────────────────────────────────────────────────────────────────────────
  static const Color error = Color(0xFFDC2626);
  static const Color errorLight = Color(0xFFFEE2E2);
  static const Color success = Color(0xFF16A34A);
  static const Color successLight = Color(0xFFDCFCE7);
  static const Color warning = Color(0xFFF59E0B);
  static const Color warningLight = Color(0xFFFEF3C7);
  static const Color info = Color(0xFF0EA5E9);
  static const Color infoLight = Color(0xFFCFFAFE);

  // ── GRADIENTS ──
  static const LinearGradient grad = LinearGradient(
    colors: [Color(0xFF2D8CFF), Color(0xFF1A6FDB)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient gradReverse = LinearGradient(
    colors: [Color(0xFF1A6FDB), Color(0xFF2D8CFF)],
    begin: Alignment.bottomLeft,
    end: Alignment.topRight,
  );

  // ── SHADOWS — Premium Elevation System ──
  static List<BoxShadow> get shadowXs => [
        BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 2,
            offset: const Offset(0, 1)),
      ];

  static List<BoxShadow> get shadowSm => [
        BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 8,
            offset: const Offset(0, 2)),
      ];

  static List<BoxShadow> get shadowMd => [
        BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 16,
            offset: const Offset(0, 4)),
      ];

  static List<BoxShadow> get shadowLg => [
        BoxShadow(
            color: Colors.black.withValues(alpha: 0.1),
            blurRadius: 24,
            offset: const Offset(0, 8)),
      ];

  static List<BoxShadow> get cardShadow => shadowSm;

  static List<BoxShadow> get btnShadow => [
        BoxShadow(
            color: primary.withValues(alpha: 0.14),
            blurRadius: 14,
            offset: const Offset(0, 4)),
      ];

  static List<BoxShadow> get btnShadowHover => [
        BoxShadow(
            color: primary.withValues(alpha: 0.35),
            blurRadius: 20,
            offset: const Offset(0, 8)),
      ];

  // ── TEXT STYLES (Typography Hierarchy) ──
  static TextStyle get h1 => GoogleFonts.poppins(
        fontSize: 28,
        fontWeight: FontWeight.w600,
        color: textPrimary,
        letterSpacing: -0.3,
        height: 1.1,
      );

  static TextStyle get h2 => GoogleFonts.poppins(
        fontSize: 24,
        fontWeight: FontWeight.w600,
        color: textPrimary,
        letterSpacing: -0.2,
        height: 1.15,
      );

  static TextStyle get h3 => GoogleFonts.poppins(
        fontSize: 20,
        fontWeight: FontWeight.w500,
        color: textPrimary,
        height: 1.2,
      );

  static TextStyle get h4 => GoogleFonts.poppins(
        fontSize: 18,
        fontWeight: FontWeight.w500,
        color: textPrimary,
        height: 1.2,
      );

  static TextStyle get h5 => GoogleFonts.poppins(
        fontSize: 16,
        fontWeight: FontWeight.w500,
        color: textPrimary,
        height: 1.25,
      );

  static TextStyle get subtitle1 => GoogleFonts.poppins(
        fontSize: 15,
        fontWeight: FontWeight.w500,
        color: textPrimary,
        height: 1.3,
      );

  static TextStyle get subtitle2 => GoogleFonts.poppins(
        fontSize: 14,
        fontWeight: FontWeight.w400,
        color: textSecondary,
        height: 1.3,
      );

  static TextStyle get body => GoogleFonts.poppins(
        fontSize: 14,
        fontWeight: FontWeight.w400,
        color: textSecondary,
        height: 1.5,
      );

  static TextStyle get bodyPrimary => GoogleFonts.poppins(
        fontSize: 14,
        fontWeight: FontWeight.w400,
        color: textPrimary,
        height: 1.5,
      );

  static TextStyle get smallText => GoogleFonts.poppins(
        fontSize: 13,
        fontWeight: FontWeight.w400,
        color: textSecondary,
        height: 1.4,
      );

  static TextStyle get caption => GoogleFonts.poppins(
        fontSize: 12,
        fontWeight: FontWeight.w400,
        color: textTertiary,
        height: 1.4,
      );

  static TextStyle get captionBold => GoogleFonts.poppins(
        fontSize: 12,
        fontWeight: FontWeight.w400,
        color: textSecondary,
        height: 1.4,
      );

  static TextStyle get btnText => GoogleFonts.poppins(
        fontSize: 15,
        fontWeight: FontWeight.w500,
        color: Colors.white,
        letterSpacing: 0.2,
      );

  static TextStyle get btnSmallText => GoogleFonts.poppins(
        fontSize: 13,
        fontWeight: FontWeight.w500,
        color: Colors.white,
      );

  // ── BUTTON COMPONENTS ──
  static Widget gradientButton({
    required String label,
    required VoidCallback onTap,
    IconData? icon,
    bool loading = false,
    double height = 54,
    double radius = 16,
    EdgeInsets padding = const EdgeInsets.symmetric(horizontal: 24),
  }) {
    return GestureDetector(
      onTap: loading ? null : onTap,
      child: Container(
        height: height,
        padding: padding,
        decoration: BoxDecoration(
          gradient: grad,
          borderRadius: BorderRadius.circular(radius),
          boxShadow: btnShadow,
        ),
        child: Center(
          child: loading
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    color: Colors.white,
                    strokeWidth: 2.5,
                  ),
                )
              : Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (icon != null) ...[
                      Icon(icon, color: Colors.white, size: 20),
                      const SizedBox(width: 10),
                    ],
                    Text(label, style: btnText),
                  ],
                ),
        ),
      ),
    );
  }

  static Widget outlineButton({
    required String label,
    required VoidCallback onTap,
    Color borderColor = primary,
    double height = 54,
    double radius = 16,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: height,
        decoration: BoxDecoration(
          border: Border.all(color: borderColor, width: 2),
          borderRadius: BorderRadius.circular(radius),
          color: Colors.white,
        ),
        child: Center(
          child: Text(label, style: btnText.copyWith(color: borderColor)),
        ),
      ),
    );
  }

  // ── CARD STYLES ──
  static BoxDecoration get cardStyle => BoxDecoration(
        color: card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderLight, width: 1),
        boxShadow: shadowSm,
      );

  static BoxDecoration get cardElevated => BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: shadowMd,
      );

  static BoxDecoration get cardOutline => BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: border, width: 1),
      );

  // ── MODERN INPUT STYLE ──
  static InputDecoration modernInputDecoration({
    required String labelText,
    required String hintText,
    Widget? prefixIcon,
    Widget? suffixIcon,
  }) {
    return InputDecoration(
      labelText: labelText,
      hintText: hintText,
      prefixIcon: prefixIcon,
      suffixIcon: suffixIcon,
      filled: true,
      fillColor: surfaceAlt,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: borderLight, width: 1.5),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: borderLight, width: 1.5),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: primary, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: error, width: 1.5),
      ),
      labelStyle: subtitle2,
      hintStyle: body,
    );
  }

  // ── LOGOS ──
  static Widget logoBlue({double height = 36}) =>
      Image.asset('assets/images/jago_logo_new.png',
          height: height, fit: BoxFit.contain);

  static Widget logoWhite({double height = 36}) =>
      ColorFiltered(
        colorFilter: const ColorFilter.mode(Colors.white, BlendMode.srcIn),
        child: Image.asset('assets/images/jago_logo_new.png',
            height: height,
            fit: BoxFit.contain),
      );

  // ── MODERN SPACING SYSTEM ──
  static const double spacing2 = 2;
  static const double spacing4 = 4;
  static const double spacing6 = 6;
  static const double spacing8 = 8;
  static const double spacing12 = 12;
  static const double spacing16 = 16;
  static const double spacing20 = 20;
  static const double spacing24 = 24;
  static const double spacing32 = 32;
  static const double spacing40 = 40;

  // ── BORDER RADIUS ──
  static const double radiusSm = 8;
  static const double radiusMd = 12;
  static const double radiusLg = 16;
  static const double radiusXl = 20;
  static const double radiusCircle = 999;

  // ── ANIMATION DURATIONS ──
  static const Duration animationFast = Duration(milliseconds: 150);
  static const Duration animationMedium = Duration(milliseconds: 300);
  static const Duration animationSlow = Duration(milliseconds: 500);

  // ── MODERN LOADING SKELETON ──
  static Widget modernSkeleton({
    double width = double.infinity,
    double height = 100,
    double radius = 12,
  }) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: borderLight,
        borderRadius: BorderRadius.circular(radius),
      ),
      child: const _SkeletonLoader(),
    );
  }
}

// ── INTERNAL: Skeleton Pulse Animation ──
class _SkeletonLoader extends StatefulWidget {
  const _SkeletonLoader();

  @override
  State<_SkeletonLoader> createState() => _SkeletonLoaderState();
}

class _SkeletonLoaderState extends State<_SkeletonLoader>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(seconds: 1),
      vsync: this,
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ScaleTransition(
      scale: Tween<double>(begin: 0.95, end: 1.05).animate(
        CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
      ),
      child: Container(
        color: JT.borderLight.withValues(alpha: 0.5),
      ),
    );
  }
}
