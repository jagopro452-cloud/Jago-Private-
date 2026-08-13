import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../main_screen.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});
  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> with SingleTickerProviderStateMixin {
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _referralCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _confirmCtrl = TextEditingController();
  bool _loading = false;
  bool _showPassword = false;
  bool _showConfirm = false;

  late AnimationController _slideCtrl;
  late Animation<Offset> _slideAnim;

  static const Color _blue = Color(0xFF2F7BFF);
  static const Color _navy = JT.textPrimary;

  @override
  void initState() {
    super.initState();
    _slideCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 550));
    _slideAnim = Tween<Offset>(begin: const Offset(0, 0.15), end: Offset.zero)
        .animate(CurvedAnimation(parent: _slideCtrl, curve: Curves.easeOutCubic));
    _slideCtrl.forward();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _emailCtrl.dispose();
    _referralCtrl.dispose();
    _passwordCtrl.dispose();
    _confirmCtrl.dispose();
    _slideCtrl.dispose();
    super.dispose();
  }

  void _showSnack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg, style: GoogleFonts.poppins(fontWeight: FontWeight.w400, color: Colors.white, fontSize: 13)),
      backgroundColor: error ? const Color(0xFFEF4444) : _blue,
      behavior: SnackBarBehavior.floating,
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      duration: const Duration(seconds: 3),
    ));
  }

  Future<void> _register() async {
    final name = _nameCtrl.text.trim();
    final phone = _phoneCtrl.text.trim();
    final password = _passwordCtrl.text;
    final confirm = _confirmCtrl.text;
    if (name.length < 2) { _showSnack('Please enter your full name', error: true); return; }
    if (phone.length != 10) { _showSnack('Enter a valid 10-digit phone number', error: true); return; }
    if (password.length < 6) { _showSnack('Password must be at least 6 characters', error: true); return; }
    if (password != confirm) { _showSnack('Passwords do not match', error: true); return; }
    setState(() => _loading = true);
    final res = await AuthService.registerWithPassword(
      phone,
      password,
      name,
      email: _emailCtrl.text.trim(),
      referralCode: _referralCtrl.text.trim(),
    );
    if (!mounted) return;
    setState(() => _loading = false);
    if (res['success'] == true) {
      Navigator.pushAndRemoveUntil(context,
        PageRouteBuilder(
          pageBuilder: (_, __, ___) => const MainScreen(),
          transitionDuration: const Duration(milliseconds: 400),
          transitionsBuilder: (_, anim, __, child) => FadeTransition(opacity: anim, child: child),
        ),
        (_) => false);
    } else {
      _showSnack(res['message'] ?? 'Registration failed. Try again.', error: true);
    }
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
          scrolledUnderElevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back_ios_new_rounded, color: JT.textPrimary, size: 20),
            onPressed: () => Navigator.pop(context),
          ),
          title: Text(
            'Create Account',
            style: GoogleFonts.poppins(
              color: _navy,
              fontWeight: FontWeight.w500,
              fontSize: 17,
            ),
          ),
          centerTitle: true,
        ),
        body: SlideTransition(
          position: _slideAnim,
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 8, 24, 40),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header
                const SizedBox(height: 4),
                Text(
                  'Join Jago Today',
                  style: GoogleFonts.poppins(
                    fontSize: 26,
                    fontWeight: FontWeight.w400,
                    color: _navy,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Fast, safe rides at your fingertips',
                  style: GoogleFonts.poppins(
                    fontSize: 13,
                    color: const Color(0xFF94A3B8),
                  ),
                ),
                const SizedBox(height: 28),

                _buildLabel('Full Name'),
                const SizedBox(height: 8),
                _buildInput(
                  controller: _nameCtrl,
                  hint: 'Enter your full name',
                  icon: Icons.person_outline_rounded,
                  textCap: TextCapitalization.words,
                ),
                const SizedBox(height: 16),

                _buildLabel('Phone Number'),
                const SizedBox(height: 8),
                _buildPhoneInput(),
                const SizedBox(height: 16),

                _buildLabel('Email (Optional)'),
                const SizedBox(height: 8),
                _buildInput(
                  controller: _emailCtrl,
                  hint: 'your@email.com',
                  icon: Icons.mail_outline_rounded,
                  keyboard: TextInputType.emailAddress,
                ),
                const SizedBox(height: 16),

                _buildLabel('Referral Code (Optional)'),
                const SizedBox(height: 8),
                _buildInput(
                  controller: _referralCtrl,
                  hint: 'Enter referral code',
                  icon: Icons.card_giftcard_rounded,
                ),
                const SizedBox(height: 16),

                _buildLabel('Password'),
                const SizedBox(height: 8),
                _buildPasswordInput(
                  ctrl: _passwordCtrl,
                  hint: 'Create a strong password',
                  show: _showPassword,
                  onToggle: () => setState(() => _showPassword = !_showPassword),
                ),
                const SizedBox(height: 16),

                _buildLabel('Confirm Password'),
                const SizedBox(height: 8),
                _buildPasswordInput(
                  ctrl: _confirmCtrl,
                  hint: 'Re-enter your password',
                  show: _showConfirm,
                  onToggle: () => setState(() => _showConfirm = !_showConfirm),
                ),
                const SizedBox(height: 32),

                // Create account button
                SizedBox(
                  width: double.infinity,
                  height: 58,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: _loading ? null : const LinearGradient(
                        colors: [Color(0xFF56CCF2), Color(0xFF1A6FE0)],
                        begin: Alignment.centerLeft,
                        end: Alignment.centerRight,
                      ),
                      color: _loading ? _blue.withValues(alpha: 0.4) : null,
                      borderRadius: BorderRadius.circular(18),
                      boxShadow: _loading ? [] : [
                        BoxShadow(
                          color: _blue.withValues(alpha: 0.4),
                          blurRadius: 20,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: ElevatedButton(
                      onPressed: _loading ? null : _register,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.transparent,
                        shadowColor: Colors.transparent,
                        disabledBackgroundColor: Colors.transparent,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                        elevation: 0,
                      ),
                      child: _loading
                        ? const SizedBox(width: 24, height: 24,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                        : Text(
                            'Create Account',
                            style: GoogleFonts.poppins(
                              fontSize: 17,
                              fontWeight: FontWeight.w400,
                              color: Colors.white,
                              letterSpacing: 0.3,
                            ),
                          ),
                    ),
                  ),
                ),

                const SizedBox(height: 20),

                // Login link
                Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Text(
                    'Already have an account?  ',
                    style: GoogleFonts.poppins(color: const Color(0xFF94A3B8), fontSize: 14),
                  ),
                  GestureDetector(
                    onTap: () => Navigator.pop(context),
                    child: Text(
                      'Login',
                      style: GoogleFonts.poppins(
                        color: _blue,
                        fontWeight: FontWeight.w400,
                        fontSize: 14,
                      ),
                    ),
                  ),
                ]),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildLabel(String text) {
    return Text(
      text,
      style: GoogleFonts.poppins(
        fontSize: 13,
        fontWeight: FontWeight.w400,
        color: const Color(0xFF475569),
      ),
    );
  }

  Widget _buildInput({
    required TextEditingController controller,
    required String hint,
    required IconData icon,
    TextCapitalization textCap = TextCapitalization.none,
    TextInputType keyboard = TextInputType.text,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
      ),
      child: TextField(
        controller: controller,
        keyboardType: keyboard,
        textCapitalization: textCap,
        style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w400, color: _navy),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: GoogleFonts.poppins(fontSize: 14, color: const Color(0xFF94A3B8)),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
          prefixIcon: Icon(icon, color: const Color(0xFF94A3B8), size: 20),
        ),
      ),
    );
  }

  Widget _buildPhoneInput() {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
      ),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
          decoration: const BoxDecoration(
            border: Border(right: BorderSide(color: Color(0xFFE2E8F0), width: 1.5)),
          ),
          child: Text('+91', style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w500, color: _blue)),
        ),
        Expanded(
          child: TextField(
            controller: _phoneCtrl,
            keyboardType: TextInputType.phone,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
            style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w400, color: _navy),
            decoration: InputDecoration(
              hintText: '10-digit mobile number',
              hintStyle: GoogleFonts.poppins(fontSize: 14, color: const Color(0xFF94A3B8)),
              border: InputBorder.none,
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
            ),
          ),
        ),
      ]),
    );
  }

  Widget _buildPasswordInput({
    required TextEditingController ctrl,
    required String hint,
    required bool show,
    required VoidCallback onToggle,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
      ),
      child: TextField(
        controller: ctrl,
        obscureText: !show,
        style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w400, color: _navy),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: GoogleFonts.poppins(fontSize: 14, color: const Color(0xFF94A3B8)),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
          prefixIcon: const Icon(Icons.lock_outline_rounded, color: Color(0xFF94A3B8), size: 20),
          suffixIcon: IconButton(
            icon: Icon(
              show ? Icons.visibility_off_outlined : Icons.visibility_outlined,
              color: const Color(0xFF94A3B8),
              size: 20,
            ),
            onPressed: onToggle,
          ),
        ),
      ),
    );
  }
}
