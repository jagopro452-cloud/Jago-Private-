import 'dart:async';
import 'dart:io' show Platform;
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:app_links/app_links.dart';
import 'package:google_maps_flutter_android/google_maps_flutter_android.dart';
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'screens/splash_screen.dart';
import 'services/auth_service.dart';
import 'services/fcm_service.dart';
import 'services/localization_service.dart';
import 'services/socket_service.dart';
import 'services/runtime_config_service.dart';
import 'src/core/config/api_config.dart';
import 'config/jago_theme.dart';
import 'screens/booking/voice_booking_screen.dart';

// Global navigator key — used for 401 auto-logout and deep-link navigation
final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

final ValueNotifier<ThemeMode> themeNotifier = ValueNotifier(ThemeMode.light);

Future<void> loadThemePreference() async {
  themeNotifier.value = ThemeMode.light;
}

Future<void> saveThemePreference(String _) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString('theme_pref', 'light');
  await prefs.setString('theme_mode', 'light');
  themeNotifier.value = ThemeMode.light;
}

Future<void> configureAndroidGoogleMaps() async {
  if (!Platform.isAndroid) return;
  final mapsImplementation = GoogleMapsFlutterPlatform.instance;
  if (mapsImplementation is GoogleMapsFlutterAndroid) {
    mapsImplementation.useAndroidViewSurface = true;
    try {
      final renderer =
          await mapsImplementation.initializeWithRenderer(AndroidMapRenderer.platformDefault);
      debugPrint('[MAP] Customer Android renderer initialized: $renderer useAndroidViewSurface=${mapsImplementation.useAndroidViewSurface}');
    } catch (e, st) {
      debugPrint('[MAP] Customer Android renderer init failed: $e\n$st');
    }
  }
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await configureAndroidGoogleMaps();
  await loadThemePreference();
  await L.init();
  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  try {
    await Firebase.initializeApp();
    await FcmService().init();
    await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(true);
  } catch (e, st) {
    debugPrint('[Firebase init] FAILED: $e\n$st');
  }
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
  // Catch any widget build error — show message instead of blank screen
  ErrorWidget.builder = (FlutterErrorDetails details) {
    return MaterialApp(
      home: Scaffold(
        backgroundColor: const Color(0xFFFFFFFF),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.error_outline,
                  color: Color(0xFF2F80ED), size: 48),
              const SizedBox(height: 16),
              const Text('Something went wrong.\nPlease restart the app.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      fontSize: 16,
                      color: Color(0xFF0B0B0B),
                      fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              Text(details.exceptionAsString(),
                  textAlign: TextAlign.center,
                  style:
                      const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
            ]),
          ),
        ),
      ),
    );
  };
  runApp(const JagoCustomerApp());
}

class JagoCustomerApp extends StatefulWidget {
  const JagoCustomerApp({super.key});

  @override
  State<JagoCustomerApp> createState() => _JagoCustomerAppState();
}

class _JagoCustomerAppState extends State<JagoCustomerApp> with WidgetsBindingObserver {
  final GlobalKey<NavigatorState> _navKey = navigatorKey;
  StreamSubscription<Uri>? _linkSub;
  bool _voiceRouteOpen = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initDeepLinks();
    unawaited(_ensureSocketAlive());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _linkSub?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // When the app comes back from background, Android may have suspended the
    // socket connection. Force a reconnect so trip events resume immediately
    // instead of waiting for the user to tap something that triggers an HTTP
    // request first.
    if (state == AppLifecycleState.resumed) {
      _ensureSocketAlive();
    }
  }

  Future<void> _ensureSocketAlive() async {
    try {
      final socket = SocketService();
      final config = RuntimeConfigService();
      if (!socket.isConnected) {
        await socket.connect(ApiConfig.socketUrl);
      }
      await config.initialize();
      await config.refresh();
    } catch (_) {}
  }

  bool _isVoiceBookingUri(Uri uri) {
    final u = uri.toString().toLowerCase();
    return u.startsWith('jago://voice/booking') ||
        (uri.scheme == 'https' &&
            uri.host == 'jagopro.org' &&
            uri.path.startsWith('/voice-booking'));
  }

  Future<void> _openVoiceBookingIfAllowed() async {
    if (_voiceRouteOpen) return;
    final token = await AuthService.getToken();
    if (token == null || token.isEmpty) return;
    final nav = _navKey.currentState;
    if (nav == null) return;
    _voiceRouteOpen = true;
    nav
        .push(MaterialPageRoute(builder: (_) => const VoiceBookingScreen()))
        .whenComplete(() {
      _voiceRouteOpen = false;
    });
  }

  Future<void> _handleIncomingUri(Uri? uri, {bool coldStart = false}) async {
    if (uri == null || !_isVoiceBookingUri(uri)) return;
    if (coldStart) {
      await Future.delayed(const Duration(milliseconds: 2000));
    }
    await _openVoiceBookingIfAllowed();
  }

  Future<void> _initDeepLinks() async {
    final appLinks = AppLinks();
    try {
      final initial = await appLinks.getInitialAppLink();
      await _handleIncomingUri(initial, coldStart: true);
    } catch (_) {}
    _linkSub = appLinks.uriLinkStream.listen((uri) {
      _handleIncomingUri(uri);
    }, onError: (_) {});
  }

  static ThemeData _lightTheme() {
    // Single source of truth: was a hardcoded Color(0xFF1677FF) that drifted
    // from JT.primary (the color every screen actually renders with). Now
    // derives from JT so default Material widgets match the premium design.
    const primary = JT.primary;
    const bg = Color(0xFFFFFFFF);
    const card = Color(0xFFF7FAFF);
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: const ColorScheme.light(
        primary: primary,
        secondary: Color(0xFF5B9DFF),
        surface: card,
        onPrimary: Colors.white,
        onSecondary: Colors.white,
        onSurface: Color(0xFF111827),
        outline: Color(0xFFD9E4F5),
      ),
      scaffoldBackgroundColor: bg,
      cardColor: card,
      dividerColor: const Color(0xFFE5EDF7),
      fontFamily: GoogleFonts.poppins().fontFamily,
      textTheme: GoogleFonts.poppinsTextTheme()
          .copyWith(
            headlineLarge: GoogleFonts.poppins(
                fontSize: 32, fontWeight: FontWeight.w500, height: 1.08, letterSpacing: -0.3),
            headlineMedium: GoogleFonts.poppins(
                fontSize: 28, fontWeight: FontWeight.w500, height: 1.1, letterSpacing: -0.2),
            titleLarge: GoogleFonts.poppins(
                fontSize: 20, fontWeight: FontWeight.w500, height: 1.15),
            titleMedium: GoogleFonts.poppins(
                fontSize: 16, fontWeight: FontWeight.w500, height: 1.2),
            bodyLarge: GoogleFonts.poppins(
                fontSize: 15, fontWeight: FontWeight.w400, height: 1.4),
            bodyMedium: GoogleFonts.poppins(
                fontSize: 14, fontWeight: FontWeight.w400, height: 1.4),
            bodySmall: GoogleFonts.poppins(
                fontSize: 12, fontWeight: FontWeight.w400, height: 1.35),
            labelLarge: GoogleFonts.poppins(
                fontSize: 15, fontWeight: FontWeight.w500, height: 1.1),
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
            color: const Color(0xFF111827)),
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
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          minimumSize: const Size.fromHeight(54),
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 22),
          textStyle:
              GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w500),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: primary,
          side: const BorderSide(color: Color(0xFFD6E6FF)),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          minimumSize: const Size.fromHeight(54),
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 22),
          textStyle:
              GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w500),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFFF7FAFF),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: BorderSide.none),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: const BorderSide(color: Color(0xFFDCE7F5))),
        focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: const BorderSide(color: primary, width: 1.6)),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        hintStyle: GoogleFonts.poppins(
            color: const Color(0xFF94A3B8),
            fontSize: 14,
            fontWeight: FontWeight.w400),
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

  static ThemeData _darkTheme() {
    const primary = JT.primary;
    const bg = Color(0xFF0F1720);
    const card = Color(0xFF1A2530);
    const onSurface = Color(0xFFE5EAF0);
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: const ColorScheme.dark(
        primary: primary,
        secondary: Color(0xFF5B9DFF),
        surface: card,
        onPrimary: Colors.white,
        onSecondary: Colors.white,
        onSurface: onSurface,
        outline: Color(0xFF2E3B47),
      ),
      scaffoldBackgroundColor: bg,
      cardColor: card,
      dividerColor: const Color(0xFF2E3B47),
      fontFamily: GoogleFonts.poppins().fontFamily,
      textTheme: GoogleFonts.poppinsTextTheme(ThemeData(brightness: Brightness.dark).textTheme)
          .apply(bodyColor: onSurface, displayColor: onSurface),
      appBarTheme: AppBarTheme(
        backgroundColor: bg,
        foregroundColor: onSurface,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: GoogleFonts.poppins(
            fontSize: 18, fontWeight: FontWeight.w500, color: onSurface),
        systemOverlayStyle: SystemUiOverlayStyle.light,
      ),
      cardTheme: CardThemeData(
        color: card,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: const BorderSide(color: Color(0xFF2E3B47)),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          minimumSize: const Size.fromHeight(54),
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 22),
          textStyle: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w500),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: primary,
          side: const BorderSide(color: Color(0xFF2E3B47)),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          minimumSize: const Size.fromHeight(54),
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 22),
          textStyle: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w500),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFF1A2530),
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: const BorderSide(color: Color(0xFF2E3B47))),
        focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: const BorderSide(color: primary, width: 1.6)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        hintStyle: GoogleFonts.poppins(
            color: const Color(0xFF7C8A99), fontSize: 14, fontWeight: FontWeight.w400),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: card,
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
          builder: (_, mode, __) {
            final isDark = mode == ThemeMode.dark ||
                (mode == ThemeMode.system &&
                    WidgetsBinding.instance.platformDispatcher.platformBrightness ==
                        Brightness.dark);
            SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle(
              statusBarColor: Colors.transparent,
              statusBarIconBrightness: isDark ? Brightness.light : Brightness.dark,
              systemNavigationBarColor: isDark ? const Color(0xFF0F1720) : Colors.white,
              systemNavigationBarIconBrightness: isDark ? Brightness.light : Brightness.dark,
            ));
            return MaterialApp(
              title: 'Jago',
              debugShowCheckedModeBanner: false,
              navigatorKey: _navKey,
              themeMode: mode,
              theme: _lightTheme(),
              darkTheme: _darkTheme(),
              // Layouts throughout the app (e.g. the fare/payment step header,
              // which packs a title next to a "For me/For else" toggle in a
              // fixed-width row) assume a roughly 1x system font scale.
              // Uncapped, a device with a large accessibility text size
              // multiplies every font size well past what those rows can
              // hold, forcing catastrophic mid-word wrapping. Clamping still
              // honors the user's preference for larger text, just not
              // without bound.
              builder: (context, child) {
                final mediaQuery = MediaQuery.of(context);
                return MediaQuery(
                  data: mediaQuery.copyWith(
                    textScaler: mediaQuery.textScaler.clamp(
                      minScaleFactor: 0.85,
                      maxScaleFactor: 1.15,
                    ),
                  ),
                  child: child!,
                );
              },
              home: const SplashScreen(),
            );
          },
        );
      },
    );
  }
}
