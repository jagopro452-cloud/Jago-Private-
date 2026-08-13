import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../main_screen.dart';

/// Mobile number + OTP verification. Existing accounts (matched by phone)
/// log straight in; a phone with no account yet is asked for a name once
/// the OTP is verified, then created on the spot — the phone number is the
/// account's unique identifier, so the same number always lands in the same
/// account. OTP is a fixed dev code (1234) while Firebase Phone Auth isn't
/// wired up yet; only this screen and the server's otp.service.ts change
/// when that happens.
class OtpScreen extends StatefulWidget {
  const OtpScreen({super.key, required this.phone});

  final String phone;

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

enum _OtpStep { enterOtp, verified, enterName }

class _OtpScreenState extends State<OtpScreen> with TickerProviderStateMixin {
  static const _otpLength = 4;

  // A single hidden field drives input; the boxes below are pure decoration
  // (centered Text, not TextFields) so there's no per-box font-metrics/
  // padding alignment to fight with, and backspace/paste/focus-jumping are
  // handled for free by the one real text field.
  final _otpCtrl = TextEditingController();
  final _otpFocus = FocusNode();
  final _nameCtrl = TextEditingController();

  _OtpStep _step = _OtpStep.enterOtp;
  bool _loading = false;
  bool _resending = false;
  int _resendSeconds = 30;
  Timer? _resendTimer;

  late AnimationController _cardCtrl;
  late Animation<Offset> _cardSlide;

  @override
  void initState() {
    super.initState();
    _cardCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
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
    _nameCtrl.dispose();
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
        content: Text(
          msg,
          style: GoogleFonts.poppins(color: Colors.white, fontSize: 13),
        ),
        backgroundColor: error ? JT.error : JT.success,
        behavior: SnackBarBehavior.floating,
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        duration: const Duration(seconds: 3),
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
      if (res['isNewUser'] == true) {
        setState(() => _step = _OtpStep.verified);
        Future.delayed(const Duration(milliseconds: 700), () {
          if (mounted) setState(() => _step = _OtpStep.enterName);
        });
      } else {
        _goToApp();
      }
      return;
    }

    _snack(res['message']?.toString() ?? 'Invalid OTP. Try again.', error: true);
    _otpCtrl.clear();
    setState(() {});
    FocusScope.of(context).requestFocus(_otpFocus);
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

  Future<void> _finishSignup() async {
    final name = _nameCtrl.text.trim();
    if (name.length < 2) {
      _snack('Please enter your name', error: true);
      return;
    }
    setState(() => _loading = true);
    // Session already exists from OTP verification; this just personalizes
    // the auto-created account. Proceed to the app either way — the account
    // is fully usable even if the name update itself hiccups.
    await AuthService.updateProfile(fullName: name);
    if (!mounted) return;
    setState(() => _loading = false);
    _goToApp();
  }

  void _goToApp() {
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (_) => const MainScreen()),
      (_) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: const Color(0xFFF7FAFF),
        resizeToAvoidBottomInset: true,
        body: SafeArea(
          child: Stack(
            children: [
              if (_step == _OtpStep.enterOtp)
                Positioned(
                  top: 4,
                  left: 4,
                  child: IconButton(
                    icon: const Icon(Icons.chevron_left, color: JT.textPrimary),
                    onPressed: () => Navigator.pop(context),
                  ),
                ),
              Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 24),
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
                            color: Colors.white,
                            border: Border.all(color: const Color(0xFFD8E6F8)),
                            boxShadow: [
                              BoxShadow(
                                color: JT.primary.withValues(alpha: 0.08),
                                blurRadius: 20,
                                offset: const Offset(0, 8),
                              ),
                            ],
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(10),
                            child: JT.logoBlue(height: 44),
                          ),
                        ),
                        AnimatedSwitcher(
                          duration: const Duration(milliseconds: 300),
                          child: _step == _OtpStep.enterName
                              ? _buildNameStep(key: const ValueKey('name'))
                              : _buildOtpStep(key: const ValueKey('otp')),
                        ),
                        const SizedBox(height: 24),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              _step == _OtpStep.enterName
                                  ? Icons.verified_user_outlined
                                  : Icons.lock_outline_rounded,
                              size: 15,
                              color: JT.textSecondary,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              _step == _OtpStep.enterName
                                  ? 'Your information is safe with us'
                                  : 'Your number is safe with us',
                              style: GoogleFonts.poppins(
                                color: JT.textSecondary,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                        SizedBox(height: size.height * 0.08),
                      ],
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

  Widget _buildOtpStep({Key? key}) {
    final verified = _step == _OtpStep.verified;
    return Column(
      key: key,
      children: [
        Text(
          verified ? 'Welcome!' : 'Enter OTP',
          style: GoogleFonts.poppins(
            fontSize: 26,
            fontWeight: FontWeight.w400,
            color: JT.textPrimary,
          ),
        ),
        const SizedBox(height: 4),
        if (verified) ...[
          Text(
            'OTP verified successfully',
            style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary),
          ),
          const SizedBox(height: 16),
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: JT.primaryLight,
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.check_rounded, color: JT.primary, size: 26),
          ),
        ] else ...[
          Text(
            "We've sent a 4-digit OTP to",
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary),
          ),
          Text(
            '+91 ${widget.phone}',
            style: GoogleFonts.poppins(
              fontSize: 14,
              fontWeight: FontWeight.w500,
              color: JT.textPrimary,
            ),
          ),
          const SizedBox(height: 28),
          _buildOtpInput(),
          const SizedBox(height: 20),
          _resendSeconds > 0
              ? Text(
                  'Resend OTP in 00:${_resendSeconds.toString().padLeft(2, '0')}',
                  style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary),
                )
              : GestureDetector(
                  onTap: _resending ? null : _resend,
                  child: Text(
                    _resending ? 'Resending...' : 'Resend OTP',
                    style: GoogleFonts.poppins(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: JT.primary,
                    ),
                  ),
                ),
          const SizedBox(height: 24),
          SizedBox(
            width: 260,
            child: JT.gradientButton(
              label: 'Verify OTP',
              icon: Icons.arrow_forward_rounded,
              onTap: _verify,
              loading: _loading,
            ),
          ),
        ],
      ],
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
        color: filled ? JT.primaryLight : Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isCursor
              ? JT.primary
              : (filled ? JT.primary.withValues(alpha: 0.35) : const Color(0xFFD8E6F8)),
          width: isCursor ? 2 : 1.4,
        ),
        boxShadow: [
          BoxShadow(
            color: isCursor
                ? JT.primary.withValues(alpha: 0.18)
                : Colors.black.withValues(alpha: 0.03),
            blurRadius: isCursor ? 10 : 6,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Text(
        filled ? text[index] : '',
        style: GoogleFonts.poppins(
          fontSize: 24,
          fontWeight: FontWeight.w600,
          color: JT.textPrimary,
          height: 1.0,
        ),
      ),
    );
  }

  Widget _buildNameStep({Key? key}) {
    return Column(
      key: key,
      children: [
        Text(
          'Welcome!',
          style: GoogleFonts.poppins(
            fontSize: 26,
            fontWeight: FontWeight.w400,
            color: JT.textPrimary,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'OTP verified successfully',
          style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary),
        ),
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: JT.primaryLight,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            children: [
              const Icon(Icons.phone_outlined, color: JT.primary, size: 20),
              const SizedBox(width: 12),
              Text(
                '+91 ${widget.phone}',
                style: GoogleFonts.poppins(
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                  color: JT.textPrimary,
                ),
              ),
              const Spacer(),
              Text(
                'Verified',
                style: GoogleFonts.poppins(fontSize: 12, color: JT.success),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Align(
          alignment: Alignment.centerLeft,
          child: Text(
            'Enter your name',
            style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary),
          ),
        ),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFD8E6F8), width: 1.2),
          ),
          child: TextField(
            controller: _nameCtrl,
            autofocus: true,
            textCapitalization: TextCapitalization.words,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => _finishSignup(),
            style: GoogleFonts.poppins(fontSize: 16, color: JT.textPrimary),
            decoration: InputDecoration(
              hintText: 'Full name',
              hintStyle: GoogleFonts.poppins(fontSize: 14, color: JT.iconInactive),
              border: InputBorder.none,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
              prefixIcon: const Icon(Icons.person_outline_rounded, color: JT.iconInactive, size: 20),
            ),
          ),
        ),
        const SizedBox(height: 24),
        JT.gradientButton(
          label: 'Continue',
          icon: Icons.arrow_forward_rounded,
          onTap: _finishSignup,
          loading: _loading,
        ),
      ],
    );
  }
}
