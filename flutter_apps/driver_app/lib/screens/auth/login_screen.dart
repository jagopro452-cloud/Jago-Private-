import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import 'otp_screen.dart';
import 'register_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> with TickerProviderStateMixin {
  final _phoneCtrl = TextEditingController();
  final _phoneFocus = FocusNode();
  bool _loading = false;

  late final AnimationController _cardCtrl;
  late final Animation<Offset> _cardSlide;
  late final AnimationController _logoCtrl;
  late final Animation<double> _logoFade;

  static const _blue = JT.primary;
  static const _dark = Color(0xFF080F1E);

  @override
  void initState() {
    super.initState();
    _cardCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));
    _cardSlide = Tween<Offset>(begin: const Offset(0, 1), end: Offset.zero)
        .animate(CurvedAnimation(parent: _cardCtrl, curve: Curves.easeOutCubic));
    _logoCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 600));
    _logoFade = Tween<double>(begin: 0, end: 1)
        .animate(CurvedAnimation(parent: _logoCtrl, curve: Curves.easeOut));
    _logoCtrl.forward();
    Future.delayed(const Duration(milliseconds: 160), () {
      if (mounted) _cardCtrl.forward();
    });
    _phoneFocus.addListener(() {
      if (mounted) setState(() {});
    });
    _phoneCtrl.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _cardCtrl.dispose();
    _logoCtrl.dispose();
    _phoneCtrl.dispose();
    _phoneFocus.dispose();
    super.dispose();
  }

  void _snack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg, style: GoogleFonts.poppins(color: Colors.white, fontSize: 13)),
        backgroundColor: error ? JT.error : JT.success,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  Future<void> _continue() async {
    final phone = _phoneCtrl.text.trim();
    if (phone.length != 10) {
      _snack('Enter a valid 10-digit mobile number', error: true);
      return;
    }
    setState(() => _loading = true);
    final res = await AuthService.sendOtp(phone);
    if (!mounted) return;
    setState(() => _loading = false);
    if (res['success'] == true) {
      Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => OtpScreen(phone: phone)),
      );
      return;
    }
    _snack(res['message']?.toString() ?? 'Could not send OTP. Try again.', error: true);
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(statusBarColor: Colors.transparent, statusBarIconBrightness: Brightness.light),
      child: Scaffold(
        backgroundColor: _blue,
        resizeToAvoidBottomInset: true,
        body: Theme(
          data: ThemeData.light().copyWith(textTheme: GoogleFonts.poppinsTextTheme()),
          child: Stack(
            children: [
              Positioned.fill(
                child: Container(
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [_blue, Color(0xFF1565D8), Colors.white], stops: [0.0, 0.42, 0.42]),
                  ),
                ),
              ),
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                height: size.height * 0.42,
                child: FadeTransition(
                  opacity: _logoFade,
                  child: SafeArea(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          width: 76,
                          height: 76,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(20),
                            color: Colors.white.withValues(alpha: 0.2),
                            border: Border.all(color: Colors.white.withValues(alpha: 0.4), width: 1.5),
                            boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.15), blurRadius: 24, offset: const Offset(0, 8))],
                          ),
                          child: Padding(padding: const EdgeInsets.all(10), child: JT.logoWhite(height: 44)),
                        ),
                        const SizedBox(height: 18),
                        JT.logoWhite(height: 36),
                        const SizedBox(height: 6),
                        Text('Secure driver login', style: GoogleFonts.poppins(fontSize: 12, color: Colors.white.withValues(alpha: 0.78), letterSpacing: 0.5)),
                      ],
                    ),
                  ),
                ),
              ),
              Positioned(
                bottom: 0,
                left: 0,
                right: 0,
                child: SlideTransition(
                  position: _cardSlide,
                  child: Container(
                    constraints: BoxConstraints(maxHeight: size.height * 0.64),
                    decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(32))),
                    child: SingleChildScrollView(
                      padding: EdgeInsets.fromLTRB(28, 20, 28, MediaQuery.of(context).viewInsets.bottom + 32),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Center(child: Container(width: 36, height: 4, decoration: BoxDecoration(color: const Color(0xFFE2E8F0), borderRadius: BorderRadius.circular(2)))),
                          const SizedBox(height: 24),
                          Text('Driver Sign In', style: GoogleFonts.poppins(fontSize: 26, fontWeight: FontWeight.w500, color: _dark)),
                          const SizedBox(height: 4),
                          Text('Login with your mobile number to continue', style: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF94A3B8))),
                          const SizedBox(height: 28),
                          _phoneField(),
                          const SizedBox(height: 24),
                          _button('Continue', _continue),
                          const SizedBox(height: 24),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text('New driver?  ', style: GoogleFonts.poppins(color: const Color(0xFF94A3B8), fontSize: 14)),
                              GestureDetector(
                                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const RegisterScreen())),
                                child: Text('Start Onboarding', style: GoogleFonts.poppins(color: _blue, fontWeight: FontWeight.w500, fontSize: 14)),
                              ),
                            ],
                          ),
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
    );
  }

  Widget _phoneField() {
    final valid = _phoneCtrl.text.length == 10;
    return TextField(
      controller: _phoneCtrl,
      focusNode: _phoneFocus,
      keyboardType: TextInputType.phone,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
      textInputAction: TextInputAction.done,
      onSubmitted: (_) => _continue(),
      style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w500, color: _dark, letterSpacing: 0.5),
      decoration: _decoration(
        'Mobile number',
        Icons.phone_iphone_rounded,
        prefixText: '+91 ',
        suffixIcon: valid ? const Icon(Icons.check_circle_rounded, color: Color(0xFF16A34A), size: 20) : null,
      ),
    );
  }

  InputDecoration _decoration(String hint, IconData icon, {String? prefixText, Widget? suffixIcon}) => InputDecoration(
        hintText: hint,
        prefixText: prefixText,
        prefixIcon: Icon(icon, color: _blue, size: 20),
        suffixIcon: suffixIcon,
        filled: true,
        fillColor: const Color(0xFFF8FAFC),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFFE2E8F0))),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: Color(0xFFE2E8F0))),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: _blue, width: 1.8)),
      );

  Widget _button(String label, VoidCallback onTap) => SizedBox(
        width: double.infinity,
        height: 56,
        child: ElevatedButton(
          onPressed: _loading ? null : onTap,
          style: ElevatedButton.styleFrom(backgroundColor: _blue, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)), elevation: 0),
          child: _loading
              ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
              : Text(label, style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w500)),
        ),
      );
}
