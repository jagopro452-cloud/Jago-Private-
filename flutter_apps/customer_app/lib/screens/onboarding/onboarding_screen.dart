import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../auth/login_screen.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> with TickerProviderStateMixin {
  final _pageCtrl = PageController();
  int _current = 0;
  late AnimationController _animCtrl;
  late Animation<double> _fadeAnim;
  late Animation<Offset> _slideAnim;

  static const _slides = [
    _Slide(
      icon: Icons.directions_car_rounded,
      iconBg: JT.primary,
      gradient: [JT.bg, Color(0xFF1A3A6E)],
      label: 'RIDES',
      title: 'Book a Ride\nAnywhere',
      subtitle: 'Auto, Bike, Car — real-time tracking, instant booking, cashless payments.',
      features: ['Auto  •  Bike  •  Car  •  SUV', 'Real-time driver tracking', 'Cashless payments'],
    ),
    _Slide(
      icon: Icons.inventory_2_rounded,
      iconBg: Color(0xFF7C3AED),
      gradient: [Color(0xFF150A28), Color(0xFF3B1F6E)],
      label: 'DELIVERY',
      title: 'Send Parcels\nDoor to Door',
      subtitle: 'Same-day delivery with live tracking. Documents, packages, anything.',
      features: ['Same-day delivery', 'Live parcel tracking', 'Safe & insured'],
    ),
    _Slide(
      icon: Icons.people_rounded,
      iconBg: Color(0xFF059669),
      gradient: [Color(0xFF0A2018), Color(0xFF0F4030)],
      label: 'POOL',
      title: 'Share Rides,\nSave More',
      subtitle: 'Ride with co-passengers heading the same way. Save up to 50%.',
      features: ['Up to 50% savings', 'Verified co-passengers', 'Eco-friendly travel'],
    ),
    _Slide(
      icon: Icons.verified_user_rounded,
      iconBg: Color(0xFFD97706),
      gradient: [Color(0xFF1A1000), Color(0xFF3D2800)],
      label: 'SAFE',
      title: 'Your Safety\nComes First',
      subtitle: 'Verified drivers, SOS button, live trip sharing, 24/7 support.',
      features: ['Verified & rated drivers', 'SOS emergency button', '24/7 support'],
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
    _slideAnim = Tween<Offset>(begin: const Offset(0, 0.08), end: Offset.zero)
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
    await prefs.setBool('onboarding_seen', true);
    if (!mounted) return;
    Navigator.pushReplacement(context, PageRouteBuilder(
      pageBuilder: (_, __, ___) => const LoginScreen(),
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
        body: AnimatedContainer(
          duration: const Duration(milliseconds: 450),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: slide.gradient,
            ),
          ),
          child: SafeArea(
            child: Column(
              children: [
                // Top bar — dots + skip
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 16, 16, 0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: List.generate(_slides.length, (i) => AnimatedContainer(
                          duration: const Duration(milliseconds: 300),
                          margin: const EdgeInsets.only(right: 6),
                          width: i == _current ? 24 : 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: i == _current ? Colors.white : Colors.white.withValues(alpha: 0.25),
                            borderRadius: BorderRadius.circular(3),
                          ),
                        )),
                      ),
                      if (!isLast)
                        TextButton(
                          onPressed: _finish,
                          style: TextButton.styleFrom(
                            foregroundColor: Colors.white.withValues(alpha: 0.7),
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          ),
                          child: Text('Skip', style: GoogleFonts.poppins(fontWeight: FontWeight.w500, fontSize: 14)),
                        )
                      else
                        const SizedBox(width: 60),
                    ],
                  ),
                ),

                // Main content
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

                // Bottom CTA
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 8, 24, 36),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    SizedBox(
                      width: double.infinity,
                      height: 58,
                      child: ElevatedButton(
                        onPressed: _next,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: slide.gradient[1],
                          elevation: 0,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              isLast ? 'Get Started' : 'Continue',
                              style: GoogleFonts.poppins(fontWeight: FontWeight.w400, fontSize: 16),
                            ),
                            const SizedBox(width: 8),
                            const Icon(Icons.arrow_forward_rounded, size: 18),
                          ],
                        ),
                      ),
                    ),
                  ]),
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
              // Icon card
              Container(
                width: 88,
                height: 88,
                decoration: BoxDecoration(
                  color: slide.iconBg.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(28),
                  border: Border.all(color: slide.iconBg.withValues(alpha: 0.4), width: 1.5),
                ),
                child: Icon(slide.icon, color: Colors.white, size: 40),
              ),

              SizedBox(height: screenHeight * 0.04),

              // Label chip
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(
                  color: slide.iconBg.withValues(alpha: 0.25),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  slide.label,
                  style: GoogleFonts.poppins(
                    color: Colors.white.withValues(alpha: 0.85),
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                    letterSpacing: 2,
                  ),
                ),
              ),

              const SizedBox(height: 16),

              // Title
              Text(
                slide.title,
                style: GoogleFonts.poppins(
                  color: Colors.white,
                  fontSize: 32,
                  fontWeight: FontWeight.w400,
                  height: 1.15,
                ),
              ),

              const SizedBox(height: 16),

              // Subtitle
              Text(
                slide.subtitle,
                style: GoogleFonts.poppins(
                  color: Colors.white.withValues(alpha: 0.65),
                  fontSize: 15,
                  fontWeight: FontWeight.w400,
                  height: 1.6,
                ),
              ),

              SizedBox(height: screenHeight * 0.04),

              // Features
              ...slide.features.map((f) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(children: [
                  Container(
                    width: 28, height: 28,
                    decoration: BoxDecoration(
                      color: slide.iconBg.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(Icons.check_rounded, color: Colors.white, size: 16),
                  ),
                  const SizedBox(width: 12),
                  Text(f, style: GoogleFonts.poppins(
                    color: Colors.white.withValues(alpha: 0.85),
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
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
  final Color iconBg;
  final List<Color> gradient;
  final String label;
  final String title;
  final String subtitle;
  final List<String> features;
  const _Slide({
    required this.icon,
    required this.iconBg,
    required this.gradient,
    required this.label,
    required this.title,
    required this.subtitle,
    required this.features,
  });
}
