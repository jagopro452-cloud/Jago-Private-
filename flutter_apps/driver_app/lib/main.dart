import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'screens/splash_screen.dart';
import 'services/fcm_service.dart';
import 'services/localization_service.dart';
import 'config/jago_theme.dart';

// Global navigator key — used by FCM service to navigate after notification tap
final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

final ValueNotifier<ThemeMode> themeNotifier = ValueNotifier(ThemeMode.light);

Future<void> loadThemePreference() async {
  themeNotifier.value = ThemeMode.light;
}

Future<void> saveThemePreference(String pref) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString('theme_pref', 'light');
  await prefs.setString('theme_mode', 'light');
  themeNotifier.value = ThemeMode.light;
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await loadThemePreference();
  await L.init();
  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  try {
    await Firebase.initializeApp();
    await FcmService().init();
    await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(true);
  } catch (_) {}
  // Forward Flutter framework errors to Crashlytics
  FlutterError.onError = (details) {
    FlutterError.presentError(details);
    FirebaseCrashlytics.instance.recordFlutterFatalError(details);
  };
  // Forward async/platform errors to Crashlytics
  PlatformDispatcher.instance.onError = (error, stack) {
    FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
    return true;
  };
  ErrorWidget.builder = (FlutterErrorDetails details) {
    return MaterialApp(
      home: Scaffold(
        backgroundColor: const Color(0xFFFFFFFF),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.error_outline, color: Color(0xFF2D8CFF), size: 48),
              const SizedBox(height: 16),
              const Text('Something went wrong.\nPlease restart the app.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16, color: Color(0xFF111827), fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              Text(details.exceptionAsString(),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
            ]),
          ),
        ),
      ),
    );
  };
  runApp(const JagoPilotApp());
}

class JagoPilotApp extends StatelessWidget {
  const JagoPilotApp({super.key});

  static ThemeData _lightTheme() {
    // Single source of truth: was a hardcoded Color(0xFF1677FF) that drifted
    // from JT.primary (the color every screen actually renders with). Now
    // derives from JT so default Material widgets match the premium design.
    const primary = JT.primary;
    const bg = Color(0xFFFFFFFF);
    const card = Color(0xFFF8FAFE);
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: const ColorScheme.light(
        primary: primary,
        secondary: Color(0xFF5B9DFF),
        surface: card,
        onPrimary: Colors.white,
        onSurface: Color(0xFF111827),
        outline: Color(0xFFD9E4F5),
      ),
      scaffoldBackgroundColor: bg,
      cardColor: card,
      dividerColor: const Color(0xFFE5EDF7),
      fontFamily: GoogleFonts.poppins().fontFamily,
      textTheme: GoogleFonts.poppinsTextTheme()
          .copyWith(
            headlineLarge: GoogleFonts.poppins(fontSize: 32, fontWeight: FontWeight.w500, letterSpacing: -0.3),
            headlineMedium: GoogleFonts.poppins(fontSize: 28, fontWeight: FontWeight.w500, letterSpacing: -0.2),
            titleLarge: GoogleFonts.poppins(fontSize: 20, fontWeight: FontWeight.w500),
            titleMedium: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w500),
            bodyLarge: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w400, height: 1.4),
            bodyMedium: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w400, height: 1.4),
            bodySmall: GoogleFonts.poppins(fontSize: 12, fontWeight: FontWeight.w400, height: 1.35),
            labelLarge: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w500),
          )
          .apply(
            bodyColor: const Color(0xFF111827),
            displayColor: const Color(0xFF111827),
          ),
      appBarTheme: AppBarTheme(
        backgroundColor: bg,
        foregroundColor: const Color(0xFF111827),
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: GoogleFonts.poppins(
          fontSize: 18,
          fontWeight: FontWeight.w500,
          color: const Color(0xFF111827),
        ),
        systemOverlayStyle: SystemUiOverlayStyle.dark,
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: const BorderSide(color: Color(0xFFE5EDF7)),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 20),
          textStyle: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w500),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: primary,
          side: const BorderSide(color: Color(0xFFD6E6FF)),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 20),
          textStyle: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w500),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: card,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xFFDCE7F5)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: primary, width: 1.6),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        hintStyle: GoogleFonts.poppins(color: const Color(0xFF94A3B8), fontSize: 14),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<String>(
      valueListenable: localeNotifier,
      builder: (_, lang, __) {
        return ValueListenableBuilder<ThemeMode>(
          valueListenable: themeNotifier,
          builder: (_, mode, __) => MaterialApp(
            navigatorKey: navigatorKey,
            title: 'JAGO Pro Pilot',
            debugShowCheckedModeBanner: false,
            themeMode: ThemeMode.light,
            theme: _lightTheme(),
            darkTheme: _lightTheme(),
            home: const SplashScreen(),
          ),
        );
      },
    );
  }
}
