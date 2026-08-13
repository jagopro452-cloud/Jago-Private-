import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../config/jago_theme.dart';
import 'register_screen.dart';

class RejectionScreen extends StatelessWidget {
  final String? reason;
  final List<dynamic> rejectedDocs;

  const RejectionScreen({super.key, this.reason, this.rejectedDocs = const []});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bg,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text('Application Rejected', style: TextStyle(color: JT.textPrimary)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Center(child: Icon(Icons.error_outline, size: 80, color: Color(0xFFEF4444))),
            const SizedBox(height: 24),
            Text('Your application was not approved', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w500, color: JT.textPrimary)),
            const SizedBox(height: 8),
            Text(
              reason ?? 'Please review the comments below and re-upload the necessary documents.',
              style: TextStyle(color: JT.textSecondary, fontSize: 15),
            ),
            const SizedBox(height: 32),
            Text('Rejected Documents', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: JT.textPrimary)),
            const SizedBox(height: 16),
            ...rejectedDocs.map((doc) => _buildRejectedDocCard(doc)).toList(),
            const SizedBox(height: 40),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                onPressed: () => Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const RegisterScreen())),
                style: ElevatedButton.styleFrom(backgroundColor: JT.primary, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
                child: const Text('Re-upload Documents', style: TextStyle(fontWeight: FontWeight.w500)),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: OutlinedButton(
                onPressed: () => _launchWhatsApp(),
                style: OutlinedButton.styleFrom(side: BorderSide(color: JT.border), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
                child: Text('Contact Support', style: TextStyle(color: JT.textPrimary)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRejectedDocCard(dynamic doc) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFEF4444).withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFEF4444).withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(doc['docType']?.toString().toUpperCase() ?? 'DOCUMENT', style: TextStyle(color: JT.textPrimary, fontWeight: FontWeight.w500)),
          const SizedBox(height: 4),
          Text(doc['adminNote'] ?? 'No reason provided', style: const TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
        ],
      ),
    );
  }

  void _launchWhatsApp() async {
    final url = Uri.parse('https://wa.me/916303000000');
    if (await canLaunchUrl(url)) {
      await launchUrl(url);
    }
  }
}
