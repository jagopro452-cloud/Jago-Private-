import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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

  static const Color _blue = JT.primary;

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _otpCtrl.dispose();
    _newPasswordCtrl.dispose();
    _confirmPasswordCtrl.dispose();
    super.dispose();
  }

  void _showSnack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg, style: const TextStyle(fontWeight: FontWeight.w400)),
        backgroundColor: error ? const Color(0xFFE53935) : _blue,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  Future<void> _submitResetRequest() async {
    final phone = _phoneCtrl.text.trim();
    if (phone.length != 10) {
      _showSnack('Enter a valid 10-digit phone number', error: true);
      return;
    }

    setState(() => _sending = true);
    final res = await AuthService.forgotPassword(phone);
    if (!mounted) return;
    setState(() => _sending = false);

    if (res['success'] == true) {
      setState(() => _otpSent = true);
      _showSnack(res['message']?.toString() ?? 'OTP sent successfully');
      return;
    }

    _showSnack(
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
      _showSnack('Enter a valid 10-digit phone number', error: true);
      return;
    }
    if (otp.length != 6) {
      _showSnack('Enter the 6-digit OTP', error: true);
      return;
    }
    if (password.length < 8 ||
        !RegExp(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$').hasMatch(password)) {
      _showSnack(
        'Password must be 8+ chars with upper, lower and number',
        error: true,
      );
      return;
    }
    if (password != confirm) {
      _showSnack('Passwords do not match', error: true);
      return;
    }

    setState(() => _resetting = true);
    final res = await AuthService.resetPassword(phone, otp, password);
    if (!mounted) return;
    setState(() => _resetting = false);

    if (res['success'] == true) {
      _showSnack(
        res['message']?.toString() ?? 'Password reset successfully',
      );
      Navigator.pop(context);
      return;
    }

    _showSnack(
      res['message']?.toString() ?? 'Unable to reset password.',
      error: true,
    );
  }

  Widget _textField({
    required TextEditingController controller,
    required String hintText,
    TextInputType keyboardType = TextInputType.text,
    List<TextInputFormatter>? inputFormatters,
    bool obscureText = false,
    Widget? suffixIcon,
    bool enabled = true,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFF5F7FA),
        borderRadius: BorderRadius.circular(14),
      ),
      child: TextField(
        controller: controller,
        enabled: enabled,
        keyboardType: keyboardType,
        inputFormatters: inputFormatters,
        obscureText: obscureText,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w400),
        decoration: InputDecoration(
          hintText: hintText,
          border: InputBorder.none,
          suffixIcon: suffixIcon,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 16,
          ),
        ),
      ),
    );
  }

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
          title: const Text(
            'Forgot Password',
            style: TextStyle(
              color: Color(0xFF1A1A2E),
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
                _otpSent ? 'Reset Your Password' : 'Request OTP',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w400,
                  color: Colors.grey[900],
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _otpSent
                    ? 'Enter the OTP sent to your registered mobile number and choose a new password.'
                    : 'Enter your registered mobile number to receive a password reset OTP.',
                style: TextStyle(color: Colors.grey[500], fontSize: 14),
              ),
              const SizedBox(height: 32),
              Text(
                'Phone Number',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: Colors.grey[700],
                ),
              ),
              const SizedBox(height: 8),
              Container(
                decoration: BoxDecoration(
                  color: const Color(0xFFF5F7FA),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Row(
                  children: [
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 16),
                      child: Text(
                        '+91',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                      ),
                    ),
                    Container(width: 1, height: 24, color: Colors.grey[300]),
                    Expanded(
                      child: TextField(
                        controller: _phoneCtrl,
                        keyboardType: TextInputType.phone,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                          LengthLimitingTextInputFormatter(10),
                        ],
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w400,
                        ),
                        decoration: const InputDecoration(
                          hintText: 'Enter 10-digit number',
                          border: InputBorder.none,
                          contentPadding:
                              EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              if (_otpSent) ...[
                Text(
                  'OTP',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: Colors.grey[700],
                  ),
                ),
                const SizedBox(height: 8),
                _textField(
                  controller: _otpCtrl,
                  hintText: 'Enter 6-digit OTP',
                  keyboardType: TextInputType.number,
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                ),
                const SizedBox(height: 16),
                Text(
                  'New Password',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: Colors.grey[700],
                  ),
                ),
                const SizedBox(height: 8),
                _textField(
                  controller: _newPasswordCtrl,
                  hintText: 'Enter new password',
                  obscureText: _hidePassword,
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
                const SizedBox(height: 16),
                Text(
                  'Confirm Password',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: Colors.grey[700],
                  ),
                ),
                const SizedBox(height: 8),
                _textField(
                  controller: _confirmPasswordCtrl,
                  hintText: 'Re-enter new password',
                  obscureText: _hideConfirmPassword,
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
                const SizedBox(height: 12),
                TextButton(
                  onPressed: _sending ? null : _submitResetRequest,
                  child: const Text('Resend OTP'),
                ),
              ],
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton(
                  onPressed: _sending || _resetting
                      ? null
                      : _otpSent
                      ? _resetPassword
                      : _submitResetRequest,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _blue,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    elevation: 0,
                  ),
                  child: (_sending || _resetting)
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2.5,
                          ),
                        )
                      : Text(
                          _otpSent ? 'Reset Password' : 'Send OTP',
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w400,
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
