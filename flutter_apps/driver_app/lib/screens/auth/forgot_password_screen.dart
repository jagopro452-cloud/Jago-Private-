import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _phoneCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();
  final _newPasswordCtrl = TextEditingController();
  final _confirmPasswordCtrl = TextEditingController();

  bool _sending = false;
  bool _resetting = false;
  bool _otpSent = false;
  bool _hidePassword = true;
  bool _hideConfirmPassword = true;

  static const _blue = JT.primary;

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _otpCtrl.dispose();
    _newPasswordCtrl.dispose();
    _confirmPasswordCtrl.dispose();
    super.dispose();
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
      ),
    );
  }

  Future<void> _sendOtp() async {
    final phone = _phoneCtrl.text.trim();
    if (phone.length != 10) {
      _snack('Enter a valid 10-digit mobile number', error: true);
      return;
    }

    setState(() => _sending = true);
    final res = await AuthService.forgotPassword(phone);
    if (!mounted) return;
    setState(() => _sending = false);

    if (res['success'] == true) {
      setState(() => _otpSent = true);
      _snack(res['message']?.toString() ?? 'OTP sent successfully');
      return;
    }

    _snack(
      res['message']?.toString() ?? 'Unable to send OTP right now.',
      error: true,
    );
  }

  Future<void> _resetPassword() async {
    final phone = _phoneCtrl.text.trim();
    final otp = _otpCtrl.text.trim();
    final password = _newPasswordCtrl.text;
    final confirm = _confirmPasswordCtrl.text;

    if (phone.length != 10) {
      _snack('Enter a valid 10-digit mobile number', error: true);
      return;
    }
    if (otp.length != 6) {
      _snack('Enter the 6-digit OTP', error: true);
      return;
    }
    if (password.length < 8 ||
        !RegExp(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$').hasMatch(password)) {
      _snack(
        'Password must be 8+ chars with upper, lower and number',
        error: true,
      );
      return;
    }
    if (password != confirm) {
      _snack('Passwords do not match', error: true);
      return;
    }

    setState(() => _resetting = true);
    final res = await AuthService.resetPassword(phone, otp, password);
    if (!mounted) return;
    setState(() => _resetting = false);

    if (res['success'] == true) {
      _snack(res['message']?.toString() ?? 'Password reset successfully');
      Navigator.pop(context);
      return;
    }

    _snack(
      res['message']?.toString() ?? 'Unable to reset password.',
      error: true,
    );
  }

  InputDecoration _decoration(String hint, IconData icon) => InputDecoration(
    hintText: hint,
    prefixIcon: Icon(icon, color: _blue, size: 20),
    filled: true,
    fillColor: const Color(0xFFF8FAFC),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: const BorderSide(color: _blue, width: 1.4),
    ),
  );

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
        backgroundColor: Colors.white,
        appBar: AppBar(
          backgroundColor: Colors.white,
          elevation: 0,
          leading: IconButton(
            icon: const Icon(
              Icons.arrow_back_ios_new_rounded,
              color: Color(0xFF1A1A2E),
            ),
            onPressed: () => Navigator.pop(context),
          ),
          title: Text(
            'Reset Driver Password',
            style: GoogleFonts.poppins(
              color: const Color(0xFF1A1A2E),
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.lock_reset_rounded, size: 56, color: JT.primary),
              const SizedBox(height: 16),
              Text(
                _otpSent ? 'Choose a new password' : 'Send reset OTP',
                style: GoogleFonts.poppins(
                  fontSize: 22,
                  fontWeight: FontWeight.w500,
                  color: const Color(0xFF080F1E),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _otpSent
                    ? 'Enter the OTP sent to your driver mobile number and set a new password.'
                    : 'Use your registered driver mobile number to receive an OTP.',
                style: GoogleFonts.poppins(
                  color: const Color(0xFF94A3B8),
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 24),
              TextField(
                controller: _phoneCtrl,
                keyboardType: TextInputType.phone,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(10),
                ],
                decoration: _decoration(
                  'Mobile number',
                  Icons.phone_iphone_rounded,
                ).copyWith(prefixText: '+91 '),
              ),
              if (_otpSent) ...[
                const SizedBox(height: 16),
                TextField(
                  controller: _otpCtrl,
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                  decoration: _decoration(
                    '6-digit OTP',
                    Icons.verified_user_outlined,
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _newPasswordCtrl,
                  obscureText: _hidePassword,
                  decoration: _decoration(
                    'New password',
                    Icons.lock_outline_rounded,
                  ).copyWith(
                    suffixIcon: IconButton(
                      icon: Icon(
                        _hidePassword
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined,
                      ),
                      onPressed: () {
                        setState(() => _hidePassword = !_hidePassword);
                      },
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _confirmPasswordCtrl,
                  obscureText: _hideConfirmPassword,
                  decoration: _decoration(
                    'Confirm new password',
                    Icons.lock_reset_rounded,
                  ).copyWith(
                    suffixIcon: IconButton(
                      icon: Icon(
                        _hideConfirmPassword
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined,
                      ),
                      onPressed: () {
                        setState(
                          () => _hideConfirmPassword = !_hideConfirmPassword,
                        );
                      },
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: _sending ? null : _sendOtp,
                    child: Text(
                      'Resend OTP',
                      style: GoogleFonts.poppins(
                        color: _blue,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton(
                  onPressed: _sending || _resetting
                      ? null
                      : _otpSent
                      ? _resetPassword
                      : _sendOtp,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _blue,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(18),
                    ),
                    elevation: 0,
                  ),
                  child: (_sending || _resetting)
                      ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2.5,
                          ),
                        )
                      : Text(
                          _otpSent ? 'Reset Password' : 'Send OTP',
                          style: GoogleFonts.poppins(
                            fontSize: 16,
                            fontWeight: FontWeight.w500,
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
}
