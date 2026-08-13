import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/jago_theme.dart';
import '../services/driver_session_manager.dart';
import 'home/home_screen.dart';
import 'auth/login_screen.dart';
import 'onboarding/language_select_screen.dart';
import 'onboarding/driver_onboarding_screen.dart';
import 'onboarding/terms_screen.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});
  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with TickerProviderStateMixin {
  late AnimationController _logoCtrl;
  late Animation<double> _logoScale;
  late Animation<double> _logoOpacity;

  late AnimationController _textCtrl;
  late Animation<Offset> _textSlide;
  late Animation<double> _textOpacity;

  late AnimationController _progressCtrl;

  @override
  void initState() {
    super.initState();
    SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF1A50D0),
      systemNavigationBarIconBrightness: Brightness.light,
    ));

    _logoCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 900));
    _logoScale = Tween<double>(begin: 0.75, end: 1.0)
        .animate(CurvedAnimation(parent: _logoCtrl, curve: Curves.easeOutBack));
    _logoOpacity = Tween<double>(begin: 0.0, end: 1.0)
        .animate(CurvedAnimation(parent: _logoCtrl, curve: const Interval(0.0, 0.65)));

    _textCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));
    _textSlide = Tween<Offset>(begin: const Offset(0, 0.5), end: Offset.zero)
        .animate(CurvedAnimation(parent: _textCtrl, curve: Curves.easeOutCubic));
    _textOpacity = Tween<double>(begin: 0.0, end: 1.0)
        .animate(CurvedAnimation(parent: _textCtrl, curve: Curves.easeOut));

    _progressCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 2600))
      ..forward();

    _runSequence();
    _navigate();
  }

  Future<void> _runSequence() async {
    await Future.delayed(const Duration(milliseconds: 250));
    if (!mounted) return;
    _logoCtrl.forward();
    await Future.delayed(const Duration(milliseconds: 600));
    if (!mounted) return;
    _textCtrl.forward();
  }

  @override
  void dispose() {
    _logoCtrl.dispose();
    _textCtrl.dispose();
    _progressCtrl.dispose();
    super.dispose();
  }

  Future<void> _navigate() async {
    await Future.delayed(const Duration(milliseconds: 3000));
    if (!mounted) return;
    final prefs = await SharedPreferences.getInstance();
    final termsAccepted = prefs.getBool('terms_accepted') ?? false;
    if (!termsAccepted) {
      Navigator.pushReplacement(context, PageRouteBuilder(
        pageBuilder: (_, __, ___) => const TermsScreen(),
        transitionDuration: const Duration(milliseconds: 500),
        transitionsBuilder: (_, anim, __, child) => FadeTransition(opacity: anim, child: child),
      ));
      return;
    }
    final onboardingSeen = prefs.getBool('driver_onboarding_seen') ?? false;
    if (!onboardingSeen) {
      Navigator.pushReplacement(context, PageRouteBuilder(
        pageBuilder: (_, __, ___) => const DriverOnboardingScreen(),
        transitionDuration: const Duration(milliseconds: 500),
        transitionsBuilder: (_, anim, __, child) => FadeTransition(opacity: anim, child: child),
      ));
      return;
    }
    final langSelected = prefs.getBool('language_selected') ?? false;
    if (!langSelected) {
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const LanguageSelectScreen()));
      return;
    }
    final hasSession = await DriverSessionManager.restore();
    if (!mounted) return;
    Navigator.pushReplacement(context, PageRouteBuilder(
      pageBuilder: (_, __, ___) => hasSession ? const HomeScreen() : const LoginScreen(),
      transitionDuration: const Duration(milliseconds: 600),
      transitionsBuilder: (_, anim, __, child) => FadeTransition(opacity: anim, child: child),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    return Scaffold(
      backgroundColor: JT.primary,
      body: Stack(
        children: [
          // Full gradient background
          Positioned.fill(
            child: Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFF5B8FFF), Color(0xFF1A50D0)],
                ),
              ),
            ),
          ),

          // Decorative circle — top right
          Positioned(
            top: -size.width * 0.25,
            right: -size.width * 0.15,
            child: Container(
              width: size.width * 0.72,
              height: size.width * 0.72,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white.withValues(alpha: 0.06),
              ),
            ),
          ),

          // Decorative circle — bottom left
          Positioned(
            bottom: -size.width * 0.18,
            left: -size.width * 0.12,
            child: Container(
              width: size.width * 0.55,
              height: size.width * 0.55,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white.withValues(alpha: 0.05),
              ),
            ),
          ),

          // Center content
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Logo — scale + fade
                AnimatedBuilder(
                  animation: _logoCtrl,
                  builder: (_, child) => Opacity(
                    opacity: _logoOpacity.value,
                    child: Transform.scale(scale: _logoScale.value, child: child),
                  ),
                  child: JT.logoWhite(height: 100),
                ),

                const SizedBox(height: 28),

                // Tagline — slide up + fade
                AnimatedBuilder(
                  animation: _textCtrl,
                  builder: (_, child) => FadeTransition(
                    opacity: _textOpacity,
                    child: SlideTransition(position: _textSlide, child: child),
                  ),
                  child: Column(children: [
                    Text(
                      'Pilot Partner App',
                      style: GoogleFonts.poppins(
                        fontSize: 20,
                        fontWeight: FontWeight.w500,
                        color: Colors.white,
                        letterSpacing: 0.3,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Drive. Earn. Grow.',
                      style: GoogleFonts.poppins(
                        fontSize: 14,
                        fontWeight: FontWeight.w400,
                        color: Colors.white.withValues(alpha: 0.72),
                      ),
                    ),
                  ]),
                ),
              ],
            ),
          ),

          // Bottom: progress bar + company name
          Positioned(
            bottom: 0, left: 0, right: 0,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedBuilder(
                  animation: _progressCtrl,
                  builder: (_, __) => LinearProgressIndicator(
                    value: _progressCtrl.value,
                    backgroundColor: Colors.white.withValues(alpha: 0.15),
                    valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
                    minHeight: 2,
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  'Mindwhile IT Solutions Pvt Ltd',
                  style: GoogleFonts.poppins(
                    color: Colors.white.withValues(alpha: 0.45),
                    fontSize: 11,
                    letterSpacing: 0.8,
                  ),
                ),
                const SizedBox(height: 28),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
