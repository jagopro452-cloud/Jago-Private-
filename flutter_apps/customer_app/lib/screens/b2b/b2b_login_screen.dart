import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import 'b2b_dashboard_screen.dart';
import 'b2b_register_screen.dart';

class B2BLoginScreen extends StatefulWidget {
  const B2BLoginScreen({super.key});
  @override
  State<B2BLoginScreen> createState() => _B2BLoginScreenState();
}

class _B2BLoginScreenState extends State<B2BLoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _loading = false;
  bool _obscure = true;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _loading = true);
    try {
      final res = await http.post(
        Uri.parse(ApiConfig.b2bLogin),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'email': _emailCtrl.text.trim().toLowerCase(),
          'password': _passCtrl.text,
        }),
      ).timeout(const Duration(seconds: 30));

      if (!mounted) return;
      final body = jsonDecode(res.body) as Map<String, dynamic>;

      if (res.statusCode == 200 && body['success'] == true) {
        // Save B2B session
        final prefs = await SharedPreferences.getInstance();
        final company = body['company'] as Map<String, dynamic>;
        await prefs.setString('b2b_company_id', company['id']?.toString() ?? '');
        await prefs.setString('b2b_company_name', company['companyName']?.toString() ?? '');
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const B2BDashboardScreen()),
        );
      } else {
        _showError(body['message'] ?? 'Login failed');
      }
    } catch (e) {
      if (mounted) _showError('Network error. Please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: JT.error,
      behavior: SnackBarBehavior.floating,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: AppBar(
        backgroundColor: JT.primary,
        foregroundColor: Colors.white,
        title: const Text('B2B Business Login', style: TextStyle(fontWeight: FontWeight.w500)),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 16),
              // Hero
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  gradient: JT.grad,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Column(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.2),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.business_center_rounded, color: Colors.white, size: 40),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'B2B Business Portal',
                      style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w500),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Login with your business credentials',
                      style: TextStyle(color: Colors.white70, fontSize: 13),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 32),

              // Login card
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: JT.cardShadow,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Sign In', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: JT.textPrimary)),
                    const SizedBox(height: 20),
                    TextFormField(
                      controller: _emailCtrl,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      decoration: _inputDecoration('Business Email', Icons.email_rounded),
                      validator: (v) {
                        if (v == null || v.trim().isEmpty) return 'Email is required';
                        if (!v.contains('@')) return 'Enter valid email';
                        return null;
                      },
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _passCtrl,
                      obscureText: _obscure,
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _login(),
                      decoration: _inputDecoration('Password', Icons.lock_rounded).copyWith(
                        suffixIcon: IconButton(
                          icon: Icon(_obscure ? Icons.visibility_rounded : Icons.visibility_off_rounded,
                              color: JT.textSecondary, size: 20),
                          onPressed: () => setState(() => _obscure = !_obscure),
                        ),
                      ),
                      validator: (v) => (v == null || v.isEmpty) ? 'Password is required' : null,
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      child: JT.gradientButton(
                        label: 'Login to Business Portal',
                        loading: _loading,
                        onTap: _login,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // Register link
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  icon: const Icon(Icons.business_rounded, size: 18),
                  label: const Text('Register New Business'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: JT.primary,
                    side: BorderSide(color: JT.primary),
                    padding: const EdgeInsets.symmetric(vertical: 13),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const B2BRegisterScreen()),
                  ),
                ),
              ),
              const SizedBox(height: 12),

              // Owner direct access
              SizedBox(
                width: double.infinity,
                child: TextButton.icon(
                  icon: Icon(Icons.manage_accounts_rounded, size: 18, color: JT.textSecondary),
                  label: Text('Access as account owner', style: TextStyle(color: JT.textSecondary, fontSize: 13)),
                  onPressed: () async {
                    final loggedIn = await AuthService.isLoggedIn();
                    if (!mounted) return;
                    if (loggedIn) {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const B2BDashboardScreen()),
                      );
                    } else {
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                        content: const Text('Please login with your phone number first'),
                        backgroundColor: JT.error,
                        behavior: SnackBarBehavior.floating,
                      ));
                    }
                  },
                ),
              ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }

  InputDecoration _inputDecoration(String label, IconData icon) => InputDecoration(
    labelText: label,
    prefixIcon: Icon(icon, color: JT.primary, size: 20),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.border)),
    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.border)),
    focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.primary, width: 1.5)),
    filled: true,
    fillColor: JT.bgSoft,
    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
    labelStyle: TextStyle(color: JT.textSecondary, fontSize: 13),
  );
}
