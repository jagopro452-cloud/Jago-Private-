import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../home/home_screen.dart';
import 'register_screen.dart';

/// Mobile number + OTP verification for existing driver accounts, matched
/// by phone number. Unlike the customer app, this never auto-creates an
/// account — a number with no driver record yet is sent to the KYC
/// onboarding wizard instead. OTP is a fixed dev code (1234) while Firebase
/// Phone Auth isn't wired up yet; only this screen and the server's
/// otp.service.ts change when that happens.
class OtpScreen extends StatefulWidget {
  const OtpScreen({super.key, required this.phone});

  final String phone;

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> with TickerProviderStateMixin {
  static const _otpLength = 4;

  // A single hidden field drives input; the boxes below are pure decoration
  // (centered Text, not TextFields) so there's no per-box font-metrics/
  // padding alignment to fight with, and backspace/paste/focus-jumping are
  // handled for free by the one real text field.
  final _otpCtrl = TextEditingController();
  final _otpFocus = FocusNode();

  bool _loading = false;
  bool _resending = false;
  int _resendSeconds = 30;
  Timer? _resendTimer;

  static const _blue = JT.primary;
  static const _dark = Color(0xFF080F1E);

  late final AnimationController _cardCtrl;
  late final Animation<Offset> _cardSlide;

  @override
  void initState() {
    super.initState();
    _cardCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 500));
    _cardSlide = Tween<Offset>(begin: const Offset(0, 0.15), end: Offset.zero)
        .animate(CurvedAnimation(parent: _cardCtrl, curve: Curves.easeOutCubic));
    _cardCtrl.forward();
    _startResendTimer();
    _otpFocus.addListener(() {
      if (mounted) setState(() {});
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) FocusScope.of(context).requestFocus(_otpFocus);
    });
  }

  @override
  void dispose() {
    _resendTimer?.cancel();
    _cardCtrl.dispose();
    _otpCtrl.dispose();
    _otpFocus.dispose();
    super.dispose();
  }

  void _startResendTimer() {
    _resendTimer?.cancel();
    setState(() => _resendSeconds = 30);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      if (_resendSeconds <= 1) {
        t.cancel();
        setState(() => _resendSeconds = 0);
      } else {
        setState(() => _resendSeconds -= 1);
      }
    });
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

  void _onOtpChanged(String value) {
    setState(() {});
    if (value.length == _otpLength) {
      FocusScope.of(context).unfocus();
      _verify();
    }
  }

  Future<void> _verify() async {
    final otp = _otpCtrl.text;
    if (otp.length != _otpLength) {
      _snack('Enter the complete OTP', error: true);
      return;
    }
    setState(() => _loading = true);
    final res = await AuthService.verifyOtp(widget.phone, otp);
    if (!mounted) return;
    setState(() => _loading = false);

    if (res['success'] == true && res['token'] != null) {
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const HomeScreen()),
        (_) => false,
      );
      return;
    }

    if (res['code'] == 'USER_NOT_FOUND') {
      _promptOnboarding();
      return;
    }

    _snack(res['message']?.toString() ?? 'Invalid OTP. Try again.', error: true);
    _otpCtrl.clear();
    setState(() {});
    FocusScope.of(context).requestFocus(_otpFocus);
  }

  void _promptOnboarding() {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('No driver account found', style: GoogleFonts.poppins(fontWeight: FontWeight.w500)),
        content: Text(
          "We couldn't find a driver account for +91 ${widget.phone}. Complete onboarding to get started.",
          style: GoogleFonts.poppins(fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('Cancel', style: GoogleFonts.poppins(color: const Color(0xFF94A3B8))),
          ),
          TextButton(
            onPressed: () async {
              Navigator.pop(context);
              // RegisterScreen prefills its phone field from this key.
              final prefs = await SharedPreferences.getInstance();
              await prefs.setString('user_phone', widget.phone);
              if (!mounted) return;
              Navigator.pushReplacement(
                context,
                MaterialPageRoute(builder: (_) => const RegisterScreen()),
              );
            },
            child: Text('Start Onboarding', style: GoogleFonts.poppins(color: _blue, fontWeight: FontWeight.w500)),
          ),
        ],
      ),
    );
  }

  Future<void> _resend() async {
    setState(() => _resending = true);
    final res = await AuthService.sendOtp(widget.phone);
    if (!mounted) return;
    setState(() => _resending = false);
    if (res['success'] == true) {
      _snack('OTP resent');
      _startResendTimer();
    } else {
      _snack(res['message']?.toString() ?? 'Could not resend OTP', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(statusBarColor: Colors.transparent, statusBarIconBrightness: Brightness.dark),
      child: Scaffold(
        backgroundColor: Colors.white,
        resizeToAvoidBottomInset: true,
        appBar: AppBar(
          backgroundColor: Colors.white,
          elevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back_ios_new_rounded, color: _dark, size: 20),
            onPressed: () => Navigator.pop(context),
          ),
        ),
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 28),
              child: SlideTransition(
                position: _cardSlide,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 76,
                      height: 76,
                      margin: const EdgeInsets.only(bottom: 18),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(24),
                        color: const Color(0xFFF0F6FF),
                        border: Border.all(color: const Color(0xFFD8E6F8)),
                      ),
                      child: Padding(padding: const EdgeInsets.all(10), child: JT.logoBlue(height: 44)),
                    ),
                    Text('Enter OTP', style: GoogleFonts.poppins(fontSize: 26, fontWeight: FontWeight.w500, color: _dark)),
                    const SizedBox(height: 4),
                    Text("We've sent a 4-digit OTP to", textAlign: TextAlign.center, style: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF94A3B8))),
                    Text('+91 ${widget.phone}', style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w500, color: _dark)),
                    const SizedBox(height: 28),
                    _buildOtpInput(),
                    const SizedBox(height: 20),
                    _resendSeconds > 0
                        ? Text('Resend OTP in 00:${_resendSeconds.toString().padLeft(2, '0')}', style: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF94A3B8)))
                        : GestureDetector(
                            onTap: _resending ? null : _resend,
                            child: Text(_resending ? 'Resending...' : 'Resend OTP', style: GoogleFonts.poppins(fontSize: 13, fontWeight: FontWeight.w500, color: _blue)),
                          ),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      height: 56,
                      child: ElevatedButton(
                        onPressed: _loading ? null : _verify,
                        style: ElevatedButton.styleFrom(backgroundColor: _blue, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)), elevation: 0),
                        child: _loading
                            ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                            : Text('Verify OTP', style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w500)),
                      ),
                    ),
                    const SizedBox(height: 40),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildOtpInput() {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => FocusScope.of(context).requestFocus(_otpFocus),
      child: SizedBox(
        height: 60,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(_otpLength, _otpBox),
            ),
            // Captures all keyboard input; invisible but functional. Sized
            // to zero so it never affects layout or intercepts stray taps
            // outside the boxes — the GestureDetector above handles that.
            SizedBox(
              width: 0,
              height: 0,
              child: Opacity(
                opacity: 0,
                child: TextField(
                  controller: _otpCtrl,
                  focusNode: _otpFocus,
                  keyboardType: TextInputType.number,
                  maxLength: _otpLength,
                  showCursor: false,
                  enableInteractiveSelection: false,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(counterText: ''),
                  onChanged: _onOtpChanged,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _otpBox(int index) {
    final text = _otpCtrl.text;
    final filled = index < text.length;
    final isCursor = index == text.length && _otpFocus.hasFocus;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 150),
      width: 52,
      height: 58,
      margin: const EdgeInsets.symmetric(horizontal: 6),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: filled ? const Color(0xFFEAF2FF) : const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isCursor ? _blue : (filled ? _blue.withValues(alpha: 0.35) : const Color(0xFFE2E8F0)),
          width: isCursor ? 2 : 1.4,
        ),
        boxShadow: isCursor
            ? [BoxShadow(color: _blue.withValues(alpha: 0.18), blurRadius: 10, offset: const Offset(0, 3))]
            : null,
      ),
      child: Text(
        filled ? text[index] : '',
        style: GoogleFonts.poppins(fontSize: 24, fontWeight: FontWeight.w600, color: _dark, height: 1.0),
      ),
    );
  }
}
