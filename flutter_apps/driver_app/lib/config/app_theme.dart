import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

// ══════════════════════════════════════════════════════════════════════════════
// PREMIUM CLEAN DESIGN SYSTEM FOR DRIVER APP (v3 — Light Blue + White)
// ══════════════════════════════════════════════════════════════════════════════

class AppColors {
  // ──────────────────────────────────────────────────────────────────────────
  // PRIMARY PALETTE — Premium Blue (#2D8CFF)
  // ──────────────────────────────────────────────────────────────────────────
  static const bg = Color(0xFFFFFFFF);             // Clean white background
  static const surface = Color(0xFFF8FAFE);        // Soft surface
  static const card = Color(0xFFFFFFFF);           // Card white
  static const cardAlt = Color(0xFFF3F7FF);        // Alt card blue-tinted
  static const border = Color(0xFFE5E9F0);         // Border
  static const borderLight = Color(0xFFF0F3F8);    // Light border

  static const primary = Color(0xFF2D8CFF);        // Hero blue
  static const primaryDark = Color(0xFF1A6FDB);    // Darker variant
  static const primaryLight = Color(0xFFE8F2FF);   // Light variant
  static const secondary = Color(0xFF5B9DFF);      // Supporting blue
  static const tertiary = Color(0xFF2D8CFF);       // Alias
  static const error = Color(0xFFDC2626);
  static const warning = Color(0xFFF59E0B);
  static const success = Color(0xFF16A34A);

  // ──────────────────────────────────────────────────────────────────────────
  // TEXT HIERARCHY — Dark on Light
  // ──────────────────────────────────────────────────────────────────────────
  static const textPrimary = Color(0xFF111827);
  static const textSecondary = Color(0xFF6B7280);
  static const textTertiary = Color(0xFF9CA3AF);
  static const textHint = Color(0xFFBCC3CF);
  static const textInverse = Color(0xFFFFFFFF);

  // ──────────────────────────────────────────────────────────────────────────
  // LEGACY ALIASES (Backward Compatibility)
  // ──────────────────────────────────────────────────────────────────────────
  static const primary_ = primary;
  static const darkBg = bg;
  static const darkCard = card;
  static const darkSurface = surface;
  static const darkBorder = border;
  static const lightBg = Color(0xFFFFFFFF);
  static const lightCard = Color(0xFFF8FAFE);
  static const lightBorder = Color(0xFFE5E9F0);
  static const textWhite = Color(0xFFFFFFFF);
  static const textSub = textSecondary;
  static const textMuted = textHint;
  static const textDark = Color(0xFF111827);
  static const purple = Color(0xFF2D8CFF);
  static const orange = Color(0xFFF59E0B);

  // ──────────────────────────────────────────────────────────────────────────
  // GRADIENT DEFINITIONS — Blue gradients only
  // ──────────────────────────────────────────────────────────────────────────
  static const LinearGradient neonGrad = LinearGradient(
    colors: [Color(0xFF2D8CFF), Color(0xFF1A6FDB)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient neonGradReverse = LinearGradient(
    colors: [Color(0xFF1A6FDB), Color(0xFF2D8CFF)],
    begin: Alignment.bottomLeft,
    end: Alignment.topRight,
  );

  static const LinearGradient successGrad = LinearGradient(
    colors: [Color(0xFF16A34A), Color(0xFF15803D)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient warningGrad = LinearGradient(
    colors: [Color(0xFFF59E0B), Color(0xFFD97706)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TYPOGRAPHY SYSTEM — Professional Text Styles
// ══════════════════════════════════════════════════════════════════════════════

class AppText {
  // ──────────────────────────────────────────────────────────────────────────
  // HEADING HIERARCHY
  // ──────────────────────────────────────────────────────────────────────────
  static TextStyle h1(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 32,
    fontWeight: FontWeight.w500,
    color: AppColors.textPrimary,
    letterSpacing: -0.5,
  );

  static TextStyle h2(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 28,
    fontWeight: FontWeight.w600,
    color: AppColors.textPrimary,
    letterSpacing: -0.3,
  );

  static TextStyle h3(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 24,
    fontWeight: FontWeight.w600,
    color: AppColors.textPrimary,
  );

  static TextStyle h4(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 20,
    fontWeight: FontWeight.w500,
    color: AppColors.textPrimary,
  );

  static TextStyle heading(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 22,
    fontWeight: FontWeight.w500,
    color: AppColors.textPrimary,
  );

  // ──────────────────────────────────────────────────────────────────────────
  // BODY TEXT
  // ──────────────────────────────────────────────────────────────────────────
  static TextStyle subheading(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 15,
    fontWeight: FontWeight.w500,
    color: AppColors.textPrimary,
  );

  static TextStyle body(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: AppColors.textSecondary,
  );

  static TextStyle bodyPrimary(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: AppColors.textPrimary,
  );

  static TextStyle bodySmall(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 13,
    fontWeight: FontWeight.w400,
    color: AppColors.textSecondary,
  );

  // ──────────────────────────────────────────────────────────────────────────
  // LABELS & CAPTIONS
  // ──────────────────────────────────────────────────────────────────────────
  static TextStyle label(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 12,
    fontWeight: FontWeight.w400,
    color: AppColors.textSecondary,
  );

  static TextStyle labelSmall(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 11,
    fontWeight: FontWeight.w400,
    color: AppColors.textTertiary,
  );

  static TextStyle caption(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 12,
    fontWeight: FontWeight.w400,
    color: AppColors.textHint,
  );

  // ──────────────────────────────────────────────────────────────────────────
  // BUTTON TEXT
  // ──────────────────────────────────────────────────────────────────────────
  static TextStyle btnText({Color color = Colors.white}) => GoogleFonts.poppins(
    fontSize: 16,
    fontWeight: FontWeight.w500,
    color: color,
    letterSpacing: 0.2,
  );

  static TextStyle btnSmallText({Color color = Colors.white}) => GoogleFonts.poppins(
    fontSize: 14,
    fontWeight: FontWeight.w500,
    color: color,
  );

  // ──────────────────────────────────────────────────────────────────────────
  // STATISTICS & EMPHASIS
  // ──────────────────────────────────────────────────────────────────────────
  static TextStyle statBig({Color color = AppColors.primary}) => GoogleFonts.poppins(
    fontSize: 28,
    fontWeight: FontWeight.w600,
    color: color,
    letterSpacing: -0.5,
  );

  static TextStyle statMedium({Color color = AppColors.primary}) => GoogleFonts.poppins(
    fontSize: 22,
    fontWeight: FontWeight.w600,
    color: color,
  );

  static TextStyle badgeText({Color color = Colors.white}) => GoogleFonts.poppins(
    fontSize: 11,
    fontWeight: FontWeight.w500,
    color: color,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CARD DECORATION SYSTEM — Clean Flat Cards
// ══════════════════════════════════════════════════════════════════════════════

class AppCard {
  static BoxDecoration dark({double radius = 16}) => BoxDecoration(
    color: AppColors.card,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: AppColors.border, width: 1),
  );

  static BoxDecoration darkElevated({double radius = 16}) => BoxDecoration(
    color: AppColors.card,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: AppColors.borderLight, width: 1),
    boxShadow: [
      BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 12, offset: const Offset(0, 2)),
    ],
  );

  static BoxDecoration neonBorder({
    double radius = 16,
    Color color = AppColors.primary,
    double borderWidth = 1.5,
  }) => BoxDecoration(
    color: AppColors.card,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: color.withValues(alpha: 0.20), width: borderWidth),
    boxShadow: [
      BoxShadow(color: color.withValues(alpha: 0.06), blurRadius: 12, offset: const Offset(0, 2)),
    ],
  );

  static BoxDecoration neonGlowBorder({
    double radius = 16,
    Color color = AppColors.primary,
  }) => BoxDecoration(
    color: AppColors.card,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: color.withValues(alpha: 0.25), width: 1.5),
    boxShadow: [
      BoxShadow(color: color.withValues(alpha: 0.08), blurRadius: 12, offset: const Offset(0, 2)),
    ],
  );

  static BoxDecoration gradient({
    double radius = 16,
    LinearGradient grad = AppColors.neonGrad,
  }) => BoxDecoration(
    color: AppColors.primary,
    borderRadius: BorderRadius.circular(radius),
    boxShadow: [
      BoxShadow(color: AppColors.primary.withValues(alpha: 0.12), blurRadius: 14, offset: const Offset(0, 4)),
    ],
  );

  static BoxDecoration gradientNoShadow({
    double radius = 16,
    LinearGradient grad = AppColors.neonGrad,
  }) => BoxDecoration(
    color: AppColors.primary,
    borderRadius: BorderRadius.circular(radius),
  );

  static BoxDecoration light({double radius = 16}) => BoxDecoration(
    color: AppColors.lightCard,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: AppColors.lightBorder, width: 1),
  );

  static BoxDecoration lightElevated({double radius = 16}) => BoxDecoration(
    color: AppColors.lightCard,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: AppColors.lightBorder, width: 1),
    boxShadow: [
      BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 10, offset: const Offset(0, 2)),
    ],
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SHADOW UTILITIES — Clean Elevation (No Neon Glow)
// ══════════════════════════════════════════════════════════════════════════════

class AppGlow {
  static List<BoxShadow> neon(Color color, {double blur = 20, double spread = 0}) => [
    BoxShadow(color: color.withValues(alpha: 0.10), blurRadius: blur * 0.6, spreadRadius: 0),
  ];

  static List<BoxShadow> neonIntense(Color color) => [
    BoxShadow(color: color.withValues(alpha: 0.12), blurRadius: 16, spreadRadius: 0),
  ];

  static List<BoxShadow> soft(Color color) => [
    BoxShadow(color: color.withValues(alpha: 0.08), blurRadius: 10, offset: const Offset(0, 3)),
  ];

  static List<BoxShadow> softMedium() => [
    BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 12, offset: const Offset(0, 4)),
  ];

  static List<BoxShadow> softSmall() => [
    BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6, offset: const Offset(0, 2)),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
// BUTTON COMPONENTS — Clean Blue Buttons
// ══════════════════════════════════════════════════════════════════════════════

class AppButton {
  static Widget neonGradient({
    required String label,
    required VoidCallback onTap,
    bool loading = false,
    double height = 56,
    double radius = 14,
    Color neonColor = AppColors.primary,
  }) {
    return GestureDetector(
      onTap: loading ? null : onTap,
      child: Container(
        height: height,
        decoration: BoxDecoration(
          color: neonColor,
          borderRadius: BorderRadius.circular(radius),
          boxShadow: [
            BoxShadow(color: neonColor.withValues(alpha: 0.14), blurRadius: 14, offset: const Offset(0, 4)),
          ],
        ),
        child: Center(
          child: loading
              ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
              : Text(label, style: AppText.btnText()),
        ),
      ),
    );
  }

  static Widget outline({
    required String label,
    required VoidCallback onTap,
    Color borderColor = AppColors.primary,
    double height = 52,
    double radius = 14,
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
          child: Text(label, style: AppText.btnText(color: borderColor)),
        ),
      ),
    );
  }

  static Widget secondary({
    required String label,
    required VoidCallback onTap,
    double height = 52,
    double radius = 14,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: height,
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(radius),
          border: Border.all(color: AppColors.border, width: 1),
        ),
        child: Center(
          child: Text(label, style: AppText.btnSmallText(color: AppColors.textPrimary)),
        ),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// INPUT DECORATION SYSTEM — Clean Inputs
// ══════════════════════════════════════════════════════════════════════════════

class AppInputs {
  static InputDecoration neonInput({
    required String label,
    required String hint,
    Widget? prefixIcon,
    Widget? suffixIcon,
    Color neonColor = AppColors.primary,
  }) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      prefixIcon: prefixIcon,
      suffixIcon: suffixIcon,
      filled: true,
      fillColor: AppColors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.border, width: 1.5),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.border, width: 1.5),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: neonColor, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppColors.error, width: 1.5),
      ),
      labelStyle: AppText.label(null),
      hintStyle: AppText.bodySmall(null),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SPACING & ANIMATION CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

class AppSpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
}

class AppAnimation {
  static const Duration fast = Duration(milliseconds: 150);
  static const Duration medium = Duration(milliseconds: 300);
  static const Duration slow = Duration(milliseconds: 500);
}
