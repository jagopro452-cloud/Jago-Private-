import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../config/jago_theme.dart';
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
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: const Text('Please check the box to agree before continuing.'),
        backgroundColor: JT.error,
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
      backgroundColor: JT.bg,
      body: SafeArea(
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: JT.spacing24, vertical: JT.spacing20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(height: JT.spacing16),
              Text('Before you begin', style: JT.h2),
              SizedBox(height: JT.spacing8),
              Text('Please review our terms to continue using Jago.',
                  style: JT.body),
              SizedBox(height: JT.spacing32),

              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: JT.surfaceAlt,
                    borderRadius: BorderRadius.circular(JT.radiusLg),
                    border: Border.all(color: JT.borderLight),
                  ),
                  child: SingleChildScrollView(
                    padding: EdgeInsets.all(JT.spacing20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _sectionTitle('Terms of Service'),
                        _bodyText('By using Jago, you agree to use the service lawfully and only for legitimate transportation needs. You must provide accurate pickup and destination information. Misuse or abuse of the platform will result in account suspension.'),
                        SizedBox(height: JT.spacing16),
                        _sectionTitle('Payments & Cancellations'),
                        _bodyText('Wallet balance deducted for rides is non-refundable except in cases of driver no-show or technical failure. Cancelling after a driver is assigned will incur a small cancellation fee. Unused wallet balance can be refunded on account closure upon request.'),
                        SizedBox(height: JT.spacing16),
                        _sectionTitle('Safety'),
                        _bodyText('Always verify the vehicle number and driver details before boarding. Use the SOS feature in emergencies. Share your ride with trusted contacts using the ride-share link for your safety.'),
                        SizedBox(height: JT.spacing16),
                        _sectionTitle('Data & Privacy'),
                        _bodyText('We collect your location, trip history, and device information to provide and improve our services. Your phone number is used for ride coordination and support. We never sell your personal data to third parties.'),
                        SizedBox(height: JT.spacing20),
                        Row(children: [
                          GestureDetector(
                            onTap: () => _openUrl('https://jagopro.in/privacy-policy'),
                            child: Text('Privacy Policy', style: JT.smallText.copyWith(color: JT.primary, decoration: TextDecoration.underline)),
                          ),
                          SizedBox(width: JT.spacing16),
                          GestureDetector(
                            onTap: () => _openUrl('https://jagopro.in/terms'),
                            child: Text('Full Terms', style: JT.smallText.copyWith(color: JT.primary, decoration: TextDecoration.underline)),
                          ),
                        ]),
                      ],
                    ),
                  ),
                ),
              ),

              SizedBox(height: JT.spacing20),
              GestureDetector(
                onTap: () => setState(() => _agreed = !_agreed),
                child: Row(children: [
                  AnimatedContainer(
                    duration: JT.animationFast,
                    width: 22, height: 22,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(6),
                      color: _agreed ? JT.primary : Colors.transparent,
                      border: Border.all(color: _agreed ? JT.primary : JT.textTertiary, width: 2),
                    ),
                    child: _agreed ? const Icon(Icons.check, size: 14, color: Colors.white) : null,
                  ),
                  SizedBox(width: JT.spacing12),
                  Expanded(child: Text('I have read and agree to the Terms of Service and Privacy Policy',
                    style: JT.smallText)),
                ]),
              ),
              SizedBox(height: JT.spacing20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _saving ? null : _accept,
                  child: _saving
                      ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                      : Text('Accept & Continue', style: JT.btnText),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sectionTitle(String text) => Padding(
    padding: EdgeInsets.only(bottom: JT.spacing6),
    child: Text(text, style: JT.subtitle1),
  );

  Widget _bodyText(String text) => Text(text,
    style: JT.smallText.copyWith(height: 1.6));
}
