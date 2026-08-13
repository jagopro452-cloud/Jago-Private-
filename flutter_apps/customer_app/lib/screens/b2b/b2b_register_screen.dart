import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import 'b2b_dashboard_screen.dart';

class B2BRegisterScreen extends StatefulWidget {
  const B2BRegisterScreen({super.key});
  @override
  State<B2BRegisterScreen> createState() => _B2BRegisterScreenState();
}

class _B2BRegisterScreenState extends State<B2BRegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _companyNameCtrl = TextEditingController();
  final _gstCtrl = TextEditingController();
  final _addressCtrl = TextEditingController();
  final _contactNameCtrl = TextEditingController();
  final _contactPhoneCtrl = TextEditingController();
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _confirmPassCtrl = TextEditingController();

  String _deliveryPlan = 'pay_per_delivery';
  bool _loading = false;
  bool _obscurePass = true;
  bool _obscureConfirm = true;

  static const _plans = [
    {'value': 'pay_per_delivery', 'label': 'Pay Per Delivery', 'desc': 'Pay only for each delivery'},
    {'value': 'subscription', 'label': 'Subscription', 'desc': 'Fixed monthly fee'},
    {'value': 'credit', 'label': 'Credit Account', 'desc': 'Pay at month end'},
  ];

  @override
  void dispose() {
    _companyNameCtrl.dispose();
    _gstCtrl.dispose();
    _addressCtrl.dispose();
    _contactNameCtrl.dispose();
    _contactPhoneCtrl.dispose();
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    _confirmPassCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final loggedIn = await AuthService.isLoggedIn();
    if (!loggedIn) {
      if (mounted) {
        showDialog(
          context: context,
          builder: (_) => AlertDialog(
            title: const Text('Login Required'),
            content: const Text(
              'To register a B2B business account, you must first log in with your phone number from the main app.\n\nGo back → login with OTP → then open B2B Business from the menu.'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK')),
            ],
          ),
        );
      }
      return;
    }
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final body = <String, dynamic>{
        'companyName': _companyNameCtrl.text.trim(),
        'gstNumber': _gstCtrl.text.trim(),
        'address': _addressCtrl.text.trim(),
        'contactName': _contactNameCtrl.text.trim(),
        'contactPhone': _contactPhoneCtrl.text.trim(),
        'deliveryPlan': _deliveryPlan,
      };
      if (_emailCtrl.text.trim().isNotEmpty) body['email'] = _emailCtrl.text.trim().toLowerCase();
      if (_passwordCtrl.text.isNotEmpty) body['password'] = _passwordCtrl.text;

      final res = await http.post(
        Uri.parse(ApiConfig.b2bRegister),
        headers: headers,
        body: jsonEncode(body),
      ).timeout(const Duration(seconds: 15));

      if (!mounted) return;
      final responseBody = jsonDecode(res.body) as Map<String, dynamic>;

      if (res.statusCode == 200 || res.statusCode == 201) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(res.statusCode == 200 ? 'Company profile updated!' : 'B2B account created! Awaiting approval.'),
            backgroundColor: JT.success,
            behavior: SnackBarBehavior.floating,
          ),
        );
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const B2BDashboardScreen()),
        );
      } else {
        _showError(responseBody['message'] ?? 'Registration failed');
      }
    } catch (e) {
      if (mounted) _showError('Network error. Please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: JT.error,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: AppBar(
        backgroundColor: JT.primary,
        foregroundColor: Colors.white,
        title: const Text('B2B Business Registration', style: TextStyle(fontWeight: FontWeight.w500)),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Hero banner
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: JT.grad,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(Icons.business_rounded, color: Colors.white, size: 28),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: const [
                          Text('Business Account', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w500)),
                          SizedBox(height: 4),
                          Text('Bulk deliveries at business rates', style: TextStyle(color: Colors.white70, fontSize: 12)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // Company details
              _sectionLabel('Company Details'),
              const SizedBox(height: 12),
              _card(
                child: Column(
                  children: [
                    _field(
                      controller: _companyNameCtrl,
                      label: 'Company Name',
                      hint: 'e.g. ABC Traders Pvt Ltd',
                      icon: Icons.business,
                      validator: (v) => (v == null || v.trim().isEmpty) ? 'Company name is required' : null,
                    ),
                    const SizedBox(height: 16),
                    _field(
                      controller: _gstCtrl,
                      label: 'GST Number (optional)',
                      hint: 'e.g. 29ABCDE1234F1Z5',
                      icon: Icons.receipt_long_rounded,
                    ),
                    const SizedBox(height: 16),
                    _field(
                      controller: _addressCtrl,
                      label: 'Business Address',
                      hint: 'Full address',
                      icon: Icons.location_on_rounded,
                      maxLines: 2,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // Contact person
              _sectionLabel('Contact Person'),
              const SizedBox(height: 12),
              _card(
                child: Column(
                  children: [
                    _field(
                      controller: _contactNameCtrl,
                      label: 'Contact Name',
                      hint: 'e.g. Ravi Kumar',
                      icon: Icons.person_rounded,
                      validator: (v) => (v == null || v.trim().isEmpty) ? 'Contact name is required' : null,
                    ),
                    const SizedBox(height: 16),
                    _field(
                      controller: _contactPhoneCtrl,
                      label: 'Contact Phone',
                      hint: '10-digit mobile number',
                      icon: Icons.phone_rounded,
                      keyboardType: TextInputType.phone,
                      validator: (v) {
                        if (v == null || v.trim().isEmpty) return 'Phone number is required';
                        if (v.trim().length < 10) return 'Enter valid phone number';
                        return null;
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // B2B Login credentials
              _sectionLabel('B2B Login Credentials'),
              const SizedBox(height: 6),
              Text(
                'Set a separate email & password to access the B2B portal',
                style: TextStyle(fontSize: 11, color: JT.textSecondary),
              ),
              const SizedBox(height: 12),
              _card(
                child: Column(
                  children: [
                    _field(
                      controller: _emailCtrl,
                      label: 'Business Email (for B2B login)',
                      hint: 'company@example.com',
                      icon: Icons.email_rounded,
                      keyboardType: TextInputType.emailAddress,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _passwordCtrl,
                      obscureText: _obscurePass,
                      decoration: InputDecoration(
                        labelText: 'B2B Password',
                        hintText: 'Min 6 characters',
                        prefixIcon: Icon(Icons.lock_rounded, color: JT.primary, size: 20),
                        suffixIcon: IconButton(
                          icon: Icon(_obscurePass ? Icons.visibility_rounded : Icons.visibility_off_rounded,
                              color: JT.textSecondary, size: 20),
                          onPressed: () => setState(() => _obscurePass = !_obscurePass),
                        ),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.border)),
                        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.border)),
                        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.primary, width: 1.5)),
                        filled: true, fillColor: JT.bgSoft,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                        labelStyle: TextStyle(color: JT.textSecondary, fontSize: 13),
                        hintStyle: TextStyle(color: JT.textSecondary.withValues(alpha: 0.6), fontSize: 13),
                      ),
                      validator: (v) {
                        if (v != null && v.isNotEmpty && v.length < 6) return 'Password must be at least 6 characters';
                        return null;
                      },
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _confirmPassCtrl,
                      obscureText: _obscureConfirm,
                      decoration: InputDecoration(
                        labelText: 'Confirm B2B Password',
                        hintText: 'Re-enter password',
                        prefixIcon: Icon(Icons.lock_outline_rounded, color: JT.primary, size: 20),
                        suffixIcon: IconButton(
                          icon: Icon(_obscureConfirm ? Icons.visibility_rounded : Icons.visibility_off_rounded,
                              color: JT.textSecondary, size: 20),
                          onPressed: () => setState(() => _obscureConfirm = !_obscureConfirm),
                        ),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.border)),
                        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.border)),
                        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.primary, width: 1.5)),
                        filled: true, fillColor: JT.bgSoft,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                        labelStyle: TextStyle(color: JT.textSecondary, fontSize: 13),
                      ),
                      validator: (v) {
                        if (_passwordCtrl.text.isNotEmpty && v != _passwordCtrl.text) return 'Passwords do not match';
                        return null;
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // Delivery plan
              _sectionLabel('Delivery Plan'),
              const SizedBox(height: 12),
              ..._plans.map((plan) => _planOption(plan)),
              const SizedBox(height: 32),

              // Submit
              SizedBox(
                width: double.infinity,
                child: JT.gradientButton(
                  label: 'Register Business',
                  loading: _loading,
                  onTap: _submit,
                ),
              ),
              const SizedBox(height: 16),
              Center(
                child: Text(
                  'Your account will be reviewed within 24 hours',
                  style: TextStyle(fontSize: 12, color: JT.textSecondary),
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sectionLabel(String label) => Text(
    label,
    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: JT.textPrimary),
  );

  Widget _card({required Widget child}) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      boxShadow: JT.cardShadow,
    ),
    child: child,
  );

  Widget _field({
    required TextEditingController controller,
    required String label,
    required String hint,
    required IconData icon,
    TextInputType? keyboardType,
    int maxLines = 1,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      maxLines: maxLines,
      validator: validator,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: Icon(icon, color: JT.primary, size: 20),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.border)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.border)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.primary, width: 1.5)),
        filled: true,
        fillColor: JT.bgSoft,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        labelStyle: TextStyle(color: JT.textSecondary, fontSize: 13),
        hintStyle: TextStyle(color: JT.textSecondary.withValues(alpha: 0.6), fontSize: 13),
      ),
    );
  }

  Widget _planOption(Map<String, String> plan) {
    final selected = _deliveryPlan == plan['value'];
    return GestureDetector(
      onTap: () => setState(() => _deliveryPlan = plan['value']!),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: selected ? JT.primary.withValues(alpha: 0.06) : Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? JT.primary : JT.border, width: selected ? 1.5 : 1),
          boxShadow: selected ? [] : JT.cardShadow,
        ),
        child: Row(
          children: [
            Container(
              width: 20, height: 20,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: selected ? JT.primary : JT.border, width: 2),
                color: selected ? JT.primary : Colors.transparent,
              ),
              child: selected ? const Icon(Icons.check, color: Colors.white, size: 12) : null,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(plan['label']!, style: TextStyle(fontWeight: FontWeight.w400, color: JT.textPrimary, fontSize: 14)),
                  Text(plan['desc']!, style: TextStyle(fontSize: 11, color: JT.textSecondary)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
