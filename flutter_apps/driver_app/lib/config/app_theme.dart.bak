import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

// ══════════════════════════════════════════════════════════════════════════════
// PREMIUM NEON DESIGN SYSTEM FOR DRIVER APP (v2 — Senior-Level Modern)
// ══════════════════════════════════════════════════════════════════════════════

class AppColors {
  // ──────────────────────────────────────────────────────────────────────────
  // DARK PALETTE — Ultra Modern Neon Aesthetic
  // ──────────────────────────────────────────────────────────────────────────
  static const bg = Color(0xFF060A14);        // Ultra-dark base
  static const surface = Color(0xFF0F1923);   // Surface layer
  static const card = Color(0xFF162030);      // Card base
  static const cardAlt = Color(0xFF1A2332);   // Alternative card
  static const border = Color(0xFF1E3050);    // Border color
  static const borderLight = Color(0xFF2A3F5F); // Light border

  // ──────────────────────────────────────────────────────────────────────────
  // NEON ACCENT PALETTE — Premium Colors
  // ──────────────────────────────────────────────────────────────────────────
  static const primary = Color(0xFF00D4FF);       // Neon cyan (hero color)
  static const primaryDark = Color(0xFF00A8CC);   // Darker neon cyan
  static const primaryLight = Color(0xFFE0FAFF);  // Light cyan
  static const secondary = Color(0xFF00E676);     // Neon green
  static const tertiary = Color(0xFFFFB300);      // Gold accent
  static const error = Color(0xFFFF3D57);         // Neon red
  static const warning = Color(0xFFFFA500);       // Neon orange
  static const success = Color(0xFF00E676);       // Neon green

  // ──────────────────────────────────────────────────────────────────────────
  // TEXT HIERARCHY — Premium Readability
  // ──────────────────────────────────────────────────────────────────────────
  static const textPrimary = Color(0xFFFFFFFF);      // Primary white text
  static const textSecondary = Color(0xFF8899BB);    // Secondary subtle text
  static const textTertiary = Color(0xFF556677);     // Tertiary muted
  static const textHint = Color(0xFF445577);         // Hints
  static const textInverse = Color(0xFF0F1923);      // Inverse for tooltips

  // ──────────────────────────────────────────────────────────────────────────
  // LEGACY ALIASES (Backward Compatibility)
  // ──────────────────────────────────────────────────────────────────────────
  static const primary_ = primary;
  static const darkBg = bg;
  static const darkCard = card;
  static const darkSurface = surface;
  static const darkBorder = border;
  static const lightBg = Color(0xFFFFFFFF);
  static const lightCard = Color(0xFFF8FAFC);
  static const lightBorder = Color(0xFFE2E8F0);
  static const textWhite = textPrimary;
  static const textSub = textSecondary;
  static const textMuted = textHint;
  static const textDark = Color(0xFF1E293B);
  static const purple = Color(0xFF8B5CF6);
  static const orange = tertiary;

  // ──────────────────────────────────────────────────────────────────────────
  // GRADIENT DEFINITIONS
  // ──────────────────────────────────────────────────────────────────────────
  static const LinearGradient neonGrad = LinearGradient(
    colors: [Color(0xFF00D4FF), Color(0xFF00A8CC)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient neonGradReverse = LinearGradient(
    colors: [Color(0xFF00A8CC), Color(0xFF00D4FF)],
    begin: Alignment.bottomLeft,
    end: Alignment.topRight,
  );

  static const LinearGradient successGrad = LinearGradient(
    colors: [Color(0xFF00E676), Color(0xFF00C853)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient warningGrad = LinearGradient(
    colors: [Color(0xFFFFB300), Color(0xFFFF6F00)],
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
    fontWeight: FontWeight.w800,
    color: AppColors.textPrimary,
    letterSpacing: -0.5,
  );

  static TextStyle h2(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 28,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
    letterSpacing: -0.3,
  );

  static TextStyle h3(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 24,
    fontWeight: FontWeight.w700,
    color: AppColors.textPrimary,
  );

  static TextStyle h4(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 20,
    fontWeight: FontWeight.w600,
    color: AppColors.textPrimary,
  );

  static TextStyle heading(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 22,
    fontWeight: FontWeight.w800,
    color: AppColors.textPrimary,
  );

  // ──────────────────────────────────────────────────────────────────────────
  // BODY TEXT
  // ──────────────────────────────────────────────────────────────────────────
  static TextStyle subheading(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 15,
    fontWeight: FontWeight.w600,
    color: AppColors.textPrimary,
  );

  static TextStyle body(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    color: AppColors.textSecondary,
  );

  static TextStyle bodyPrimary(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 14,
    fontWeight: FontWeight.w500,
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
    fontWeight: FontWeight.w500,
    color: AppColors.textSecondary,
  );

  static TextStyle labelSmall(BuildContext? context) => GoogleFonts.poppins(
    fontSize: 11,
    fontWeight: FontWeight.w500,
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
    fontWeight: FontWeight.w600,
    color: color,
    letterSpacing: 0.2,
  );

  static TextStyle btnSmallText({Color color = Colors.white}) => GoogleFonts.poppins(
    fontSize: 14,
    fontWeight: FontWeight.w600,
    color: color,
  );

  // ──────────────────────────────────────────────────────────────────────────
  // STATISTICS & EMPHASIS
  // ──────────────────────────────────────────────────────────────────────────
  static TextStyle statBig({Color color = AppColors.primary}) => GoogleFonts.poppins(
    fontSize: 32,
    fontWeight: FontWeight.w900,
    color: color,
    letterSpacing: -1,
  );

  static TextStyle statMedium({Color color = AppColors.primary}) => GoogleFonts.poppins(
    fontSize: 24,
    fontWeight: FontWeight.w800,
    color: color,
  );

  static TextStyle badgeText({Color color = Colors.white}) => GoogleFonts.poppins(
    fontSize: 11,
    fontWeight: FontWeight.w700,
    color: color,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CARD DECORATION SYSTEM — Premium Cards with Neon Styling
// ══════════════════════════════════════════════════════════════════════════════

class AppCard {
  // ──────────────────────────────────────────────────────────────────────────
  // DARK CARD STYLES
  // ──────────────────────────────────────────────────────────────────────────
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
      BoxShadow(
        color: Colors.black.withValues(alpha: 0.3),
        blurRadius: 16,
        offset: const Offset(0, 4),
      ),
    ],
  );

  // ──────────────────────────────────────────────────────────────────────────
  // NEON BORDERED CARDS (Premium)
  // ──────────────────────────────────────────────────────────────────────────
  static BoxDecoration neonBorder({
    double radius = 16,
    Color color = AppColors.primary,
    double borderWidth = 1.5,
  }) =>
      BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: color.withValues(alpha: 0.35), width: borderWidth),
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.12),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      );

  static BoxDecoration neonGlowBorder({
    double radius = 16,
    Color color = AppColors.primary,
  }) =>
      BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: color.withValues(alpha: 0.5), width: 2),
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.25),
            blurRadius: 20,
            spreadRadius: 2,
          ),
          BoxShadow(
            color: color.withValues(alpha: 0.1),
            blurRadius: 30,
            spreadRadius: 4,
          ),
        ],
      );

  // ──────────────────────────────────────────────────────────────────────────
  // GRADIENT CARDS
  // ──────────────────────────────────────────────────────────────────────────
  static BoxDecoration gradient({
    double radius = 16,
    LinearGradient grad = AppColors.neonGrad,
  }) =>
      BoxDecoration(
        gradient: grad,
        borderRadius: BorderRadius.circular(radius),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.25),
            blurRadius: 20,
            offset: const Offset(0, 4),
          ),
        ],
      );

  static BoxDecoration gradientNoShadow({
    double radius = 16,
    LinearGradient grad = AppColors.neonGrad,
  }) =>
      BoxDecoration(
        gradient: grad,
        borderRadius: BorderRadius.circular(radius),
      );

  // ──────────────────────────────────────────────────────────────────────────
  // LIGHT CARDS (For Light Theme Support)
  // ──────────────────────────────────────────────────────────────────────────
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
      BoxShadow(
        color: Colors.black.withValues(alpha: 0.08),
        blurRadius: 12,
        offset: const Offset(0, 2),
      ),
    ],
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// GLOW EFFECTS & SHADOWS — Neon Aesthetic System
// ══════════════════════════════════════════════════════════════════════════════

class AppGlow {
  // ──────────────────────────────────────────────────────────────────────────
  // NEON GLOW SHADOWS (Cyberpunk Style)
  // ──────────────────────────────────────────────────────────────────────────
  static List<BoxShadow> neon(Color color, {double blur = 20, double spread = 0}) => [
    BoxShadow(
      color: color.withValues(alpha: 0.4),
      blurRadius: blur,
      spreadRadius: spread,
    ),
    BoxShadow(
      color: color.withValues(alpha: 0.15),
      blurRadius: blur * 2.5,
      spreadRadius: spread,
    ),
  ];

  static List<BoxShadow> neonIntense(Color color) => [
    BoxShadow(
      color: color.withValues(alpha: 0.5),
      blurRadius: 30,
      spreadRadius: 2,
    ),
    BoxShadow(
      color: color.withValues(alpha: 0.25),
      blurRadius: 50,
      spreadRadius: 4,
    ),
  ];

  // ──────────────────────────────────────────────────────────────────────────
  // SOFT SHADOWS (Premium Elevation)
  // ──────────────────────────────────────────────────────────────────────────
  static List<BoxShadow> soft(Color color) => [
    BoxShadow(
      color: color.withValues(alpha: 0.22),
      blurRadius: 12,
      offset: const Offset(0, 4),
    ),
  ];

  static List<BoxShadow> softMedium() => [
    BoxShadow(
      color: Colors.black.withValues(alpha: 0.15),
      blurRadius: 16,
      offset: const Offset(0, 6),
    ),
  ];

  static List<BoxShadow> softSmall() => [
    BoxShadow(
      color: Colors.black.withValues(alpha: 0.08),
      blurRadius: 8,
      offset: const Offset(0, 2),
    ),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
// BUTTON COMPONENTS — Premium Neon Buttons
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
          gradient: LinearGradient(
            colors: [neonColor, neonColor.withValues(alpha: 0.8)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(radius),
          boxShadow: [
            BoxShadow(
              color: neonColor.withValues(alpha: 0.35),
              blurRadius: 20,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Center(
          child: loading
              ? const SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(
                    color: Colors.white,
                    strokeWidth: 2.5,
                  ),
                )
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
          color: AppColors.card,
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
          child: Text(label, style: AppText.btnSmallText()),
        ),
      ),
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// INPUT DECORATION SYSTEM — Modern Neon Inputs
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
        borderSide: BorderSide(color: AppColors.border, width: 1.5),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: AppColors.border, width: 1.5),
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

  static InputDecoration simpleInput({
    required String hint,
    Widget? prefixIcon,
  }) {
    return InputDecoration(
      hintText: hint,
      prefixIcon: prefixIcon,
      filled: true,
      fillColor: AppColors.surface,
      border: InputBorder.none,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      hintStyle: textSmall,
    );
  }

  static TextStyle get textSmall => GoogleFonts.poppins(
    fontSize: 13,
    color: AppColors.textSecondary,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SPACING & SIZING CONSTANTS — Design Grid
// ══════════════════════════════════════════════════════════════════════════════

class AppSpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;

  static const double radiusSm = 8;
  static const double radiusMd = 12;
  static const double radiusLg = 16;
  static const double radiusXl = 20;
  static const double radiusCircle = 999;
}

// ══════════════════════════════════════════════════════════════════════════════
// ANIMATION SYSTEM — Smooth Transitions
// ══════════════════════════════════════════════════════════════════════════════

class AppAnimation {
  static const Duration fast = Duration(milliseconds: 100);
  static const Duration normal = Duration(milliseconds: 200);
  static const Duration medium = Duration(milliseconds: 300);
  static const Duration slow = Duration(milliseconds: 500);

  static const Curve easeOut = Curves.easeOut;
  static const Curve easeInOut = Curves.easeInOut;
}
