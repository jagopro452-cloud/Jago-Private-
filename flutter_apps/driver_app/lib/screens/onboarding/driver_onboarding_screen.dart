import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'language_select_screen.dart';

class DriverOnboardingScreen extends StatefulWidget {
  const DriverOnboardingScreen({super.key});
  @override
  State<DriverOnboardingScreen> createState() => _DriverOnboardingScreenState();
}

class _DriverOnboardingScreenState extends State<DriverOnboardingScreen>
    with TickerProviderStateMixin {
  final _pageCtrl = PageController();
  int _current = 0;
  late AnimationController _animCtrl;
  late Animation<double> _fadeAnim;
  late Animation<Offset> _slideAnim;

  // Color system
  static const _bg = Color(0xFFFFFFFF);
  static const _border = Color(0xFFDDE8FF);
  static const _textSecondary = JT.textSecondary;

  static const _slides = [
    _Slide(
      icon: Icons.directions_car_rounded,
      neonColor: JT.primary,
      label: 'RIDES',
      title: 'Accept Rides\nInstantly',
      subtitle: 'Go online with one tap. See trip details before accepting — you\'re always in control.',
      features: ['One-tap online / offline', 'Preview trip before accepting', 'Choose trips on your route'],
      gradient: [JT.bg, Color(0xFF0A1E30)],
    ),
    _Slide(
      icon: Icons.map_rounded,
      neonColor: Color(0xFF00E676),
      label: 'NAVIGATE',
      title: 'Navigate\nEvery Trip',
      subtitle: 'Built-in navigation guides you door-to-door. Start and complete trips with simple taps.',
      features: ['Turn-by-turn navigation', 'Live trip status updates', 'Simple start & end flow'],
      gradient: [JT.bg, Color(0xFF0A1E18)],
    ),
    _Slide(
      icon: Icons.account_balance_wallet_rounded,
      neonColor: Color(0xFFFFB300),
      label: 'EARNINGS',
      title: 'Track Your\nEarnings',
      subtitle: 'Earnings updated after every trip. View daily/weekly totals. Withdraw to bank anytime.',
      features: ['Instant earnings per trip', 'Daily & weekly summaries', 'Easy bank withdrawal'],
      gradient: [JT.bg, Color(0xFF1E1200)],
    ),
    _Slide(
      icon: Icons.verified_user_rounded,
      neonColor: Color(0xFFFF3D57),
      label: 'SAFETY',
      title: 'Safety First,\nAlways',
      subtitle: 'Verify customer OTP before every trip. Keep documents updated. SOS button always ready.',
      features: ['Verify OTP before start', 'Keep documents updated', 'SOS emergency button'],
      gradient: [JT.bg, Color(0xFF1E0810)],
    ),
  ];

  @override
  void initState() {
    super.initState();
    SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ));
    _animCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 500));
    _fadeAnim = CurvedAnimation(parent: _animCtrl, curve: Curves.easeOut);
    _slideAnim = Tween<Offset>(begin: const Offset(0, 0.1), end: Offset.zero)
        .animate(CurvedAnimation(parent: _animCtrl, curve: Curves.easeOutCubic));
    _animCtrl.forward();
  }

  @override
  void dispose() {
    _pageCtrl.dispose();
    _animCtrl.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('driver_onboarding_seen', true);
    if (!mounted) return;
    Navigator.pushReplacement(context, PageRouteBuilder(
      pageBuilder: (_, __, ___) => const LanguageSelectScreen(),
      transitionDuration: const Duration(milliseconds: 500),
      transitionsBuilder: (_, anim, __, child) => FadeTransition(opacity: anim, child: child),
    ));
  }

  void _next() {
    if (_current < _slides.length - 1) {
      _pageCtrl.nextPage(duration: const Duration(milliseconds: 400), curve: Curves.easeInOut);
    } else {
      _finish();
    }
  }

  @override
  Widget build(BuildContext context) {
    final slide = _slides[_current];
    final isLast = _current == _slides.length - 1;
    final size = MediaQuery.of(context).size;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(statusBarColor: Colors.transparent, statusBarIconBrightness: Brightness.dark),
      child: Scaffold(
        backgroundColor: _bg,
        body: AnimatedContainer(
          duration: const Duration(milliseconds: 450),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: slide.gradient,
            ),
          ),
          child: SafeArea(
            child: Column(
              children: [
                // Top bar — progress dots + skip
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 20, 16, 0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: List.generate(_slides.length, (i) => AnimatedContainer(
                          duration: const Duration(milliseconds: 300),
                          margin: const EdgeInsets.only(right: 6),
                          width: i == _current ? 28 : 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: i == _current
                                ? slide.neonColor
                                : _border,
                            borderRadius: BorderRadius.circular(3),
                            boxShadow: i == _current ? [
                              BoxShadow(
                                color: slide.neonColor.withValues(alpha: 0.6),
                                blurRadius: 8,
                              ),
                            ] : [],
                          ),
                        )),
                      ),
                      if (!isLast)
                        TextButton(
                          onPressed: _finish,
                          style: TextButton.styleFrom(
                            foregroundColor: _textSecondary,
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          ),
                          child: Text('Skip', style: GoogleFonts.poppins(
                            fontWeight: FontWeight.w400, fontSize: 14, color: _textSecondary,
                          )),
                        )
                      else
                        const SizedBox(width: 60),
                    ],
                  ),
                ),

                // Page content
                Expanded(
                  child: PageView.builder(
                    controller: _pageCtrl,
                    onPageChanged: (i) {
                      _animCtrl.reset();
                      setState(() => _current = i);
                      _animCtrl.forward();
                    },
                    itemCount: _slides.length,
                    itemBuilder: (_, i) => _SlidePage(
                      slide: _slides[i],
                      fadeAnim: _fadeAnim,
                      slideAnim: _slideAnim,
                      screenHeight: size.height,
                    ),
                  ),
                ),

                // CTA button
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 8, 24, 36),
                  child: SizedBox(
                    width: double.infinity,
                    height: 60,
                    child: GestureDetector(
                      onTap: _next,
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 300),
                        decoration: BoxDecoration(
                          color: slide.neonColor,
                          borderRadius: BorderRadius.circular(20),
                          boxShadow: [
                            BoxShadow(
                              color: slide.neonColor.withValues(alpha: 0.45),
                              blurRadius: 24,
                              offset: const Offset(0, 8),
                            ),
                          ],
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              isLast ? 'Start Driving' : 'Continue',
                              style: GoogleFonts.poppins(
                                fontWeight: FontWeight.w400,
                                fontSize: 16,
                                color: Colors.black,
                              ),
                            ),
                            const SizedBox(width: 8),
                            const Icon(Icons.arrow_forward_rounded, size: 20, color: Colors.black),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SlidePage extends StatelessWidget {
  final _Slide slide;
  final Animation<double> fadeAnim;
  final Animation<Offset> slideAnim;
  final double screenHeight;
  const _SlidePage({required this.slide, required this.fadeAnim, required this.slideAnim, required this.screenHeight});

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: fadeAnim,
      child: SlideTransition(
        position: slideAnim,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Icon container with neon glow
              Container(
                width: 100, height: 100,
                decoration: BoxDecoration(
                  color: const Color(0xFFF0F5FF),
                  borderRadius: BorderRadius.circular(28),
                  border: Border.all(color: slide.neonColor.withValues(alpha: 0.4), width: 1.5),
                  boxShadow: [
                    BoxShadow(
                      color: slide.neonColor.withValues(alpha: 0.3),
                      blurRadius: 30,
                      spreadRadius: 0,
                    ),
                    BoxShadow(
                      color: slide.neonColor.withValues(alpha: 0.1),
                      blurRadius: 60,
                      spreadRadius: 5,
                    ),
                  ],
                ),
                child: Icon(slide.icon, color: slide.neonColor, size: 46),
              ),

              SizedBox(height: screenHeight * 0.05),

              // Label chip
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
                decoration: BoxDecoration(
                  color: slide.neonColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: slide.neonColor.withValues(alpha: 0.3), width: 1),
                ),
                child: Text(slide.label, style: GoogleFonts.poppins(
                  color: slide.neonColor,
                  fontSize: 11, fontWeight: FontWeight.w400, letterSpacing: 2.5,
                )),
              ),

              const SizedBox(height: 18),

              // Title
              Text(slide.title, style: GoogleFonts.poppins(
                color: Colors.white, fontSize: 34,
                fontWeight: FontWeight.w500, height: 1.1, letterSpacing: -0.5,
              )),

              const SizedBox(height: 16),

              // Subtitle
              Text(slide.subtitle, style: GoogleFonts.poppins(
                color: JT.textSecondary,
                fontSize: 15, fontWeight: FontWeight.w400, height: 1.65,
              )),

              SizedBox(height: screenHeight * 0.045),

              // Feature list
              ...slide.features.map((f) => Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Row(children: [
                  Container(
                    width: 32, height: 32,
                    decoration: BoxDecoration(
                      color: slide.neonColor.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: slide.neonColor.withValues(alpha: 0.25), width: 1),
                    ),
                    child: Icon(Icons.check_rounded, color: slide.neonColor, size: 18),
                  ),
                  const SizedBox(width: 14),
                  Text(f, style: GoogleFonts.poppins(
                    color: Colors.white.withValues(alpha: 0.88),
                    fontSize: 14, fontWeight: FontWeight.w400,
                  )),
                ]),
              )),
            ],
          ),
        ),
      ),
    );
  }
}

class _Slide {
  final IconData icon;
  final Color neonColor;
  final List<Color> gradient;
  final String label;
  final String title;
  final String subtitle;
  final List<String> features;
  const _Slide({
    required this.icon, required this.neonColor, required this.gradient,
    required this.label, required this.title, required this.subtitle, required this.features,
  });
}
