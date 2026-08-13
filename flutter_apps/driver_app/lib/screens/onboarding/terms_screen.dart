import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../auth/login_screen.dart';

class TermsScreen extends StatefulWidget {
  const TermsScreen({super.key});
  @override
  State<TermsScreen> createState() => _TermsScreenState();
}

class _TermsScreenState extends State<TermsScreen> {
  bool _agreed = false;
  bool _saving = false;

  Future<void> _accept() async {
    if (!_agreed) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Please check the box to agree before continuing.'),
        backgroundColor: Color(0xFFDC2626),
        behavior: SnackBarBehavior.floating,
      ));
      return;
    }
    setState(() => _saving = true);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('terms_accepted', true);
    if (!mounted) return;
    Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const LoginScreen()));
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0B0B0B),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 16),
              Text('Before you begin', style: GoogleFonts.poppins(fontSize: 26, fontWeight: FontWeight.w500, color: Colors.white)),
              const SizedBox(height: 8),
              Text('Please review our terms to continue using JAGO Pro Pilot.',
                  style: GoogleFonts.poppins(fontSize: 14, color: const Color(0xFF94A3B8))),
              const SizedBox(height: 32),

              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: const Color(0xFF1A1A1A),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFF2A2A2A)),
                  ),
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _sectionTitle('Terms of Service'),
                        _body('By using the JAGO Pro Pilot app, you agree to drive lawfully and safely. You must maintain a valid driving licence, vehicle registration, and insurance at all times. You are an independent contractor, not an employee of MindWhile IT Solutions Pvt Ltd.'),
                        const SizedBox(height: 16),
                        _sectionTitle('Earnings & Payments'),
                        _body('Earnings are credited to your in-app wallet after platform commission is deducted. Withdrawals are subject to a minimum balance and processing time of 1–3 business days. Fraudulent trips or manipulated earnings will result in immediate account suspension.'),
                        const SizedBox(height: 16),
                        _sectionTitle('Cancellation Policy'),
                        _body('Excessive cancellations (3+ per day) will result in an automatic penalty deduction from your wallet. Repeated violations may lead to temporary or permanent deactivation.'),
                        const SizedBox(height: 16),
                        _sectionTitle('Data & Privacy'),
                        _body('We collect your location, trip data, and device information to provide ride services. Your personal data is never sold to third parties. Location is shared with customers only during active trips.'),
                        const SizedBox(height: 16),
                        _sectionTitle('Account Suspension'),
                        _body('JAGO reserves the right to suspend accounts for customer complaints, fraudulent activity, or violations of these terms. Appeals can be raised via in-app support.'),
                        const SizedBox(height: 20),
                        Row(children: [
                          GestureDetector(
                            onTap: () => _openUrl('https://jagopro.in/privacy-policy'),
                            child: Text('Privacy Policy', style: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF2F80ED), decoration: TextDecoration.underline)),
                          ),
                          const SizedBox(width: 16),
                          GestureDetector(
                            onTap: () => _openUrl('https://jagopro.in/terms'),
                            child: Text('Full Terms of Service', style: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF2F80ED), decoration: TextDecoration.underline)),
                          ),
                        ]),
                      ],
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 20),
              GestureDetector(
                onTap: () => setState(() => _agreed = !_agreed),
                child: Row(children: [
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    width: 22, height: 22,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(6),
                      color: _agreed ? const Color(0xFF2F80ED) : Colors.transparent,
                      border: Border.all(color: _agreed ? const Color(0xFF2F80ED) : const Color(0xFF4B5563), width: 2),
                    ),
                    child: _agreed ? const Icon(Icons.check, size: 14, color: Colors.white) : null,
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: Text('I have read and agree to the Terms of Service and Privacy Policy',
                    style: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFFD1D5DB)))),
                ]),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _saving ? null : _accept,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF2F80ED),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    disabledBackgroundColor: const Color(0xFF374151),
                  ),
                  child: _saving
                      ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                      : Text('Accept & Continue', style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w500)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sectionTitle(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(text, style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w500, color: Colors.white)),
  );

  Widget _body(String text) => Text(text,
    style: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF9CA3AF), height: 1.6));
}
