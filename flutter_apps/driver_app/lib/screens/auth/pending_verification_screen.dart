import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import 'register_screen.dart';
import '../home/home_screen.dart';
import 'login_screen.dart';

class PendingVerificationScreen extends StatefulWidget {
  const PendingVerificationScreen({super.key});

  @override
  State<PendingVerificationScreen> createState() => _PendingVerificationScreenState();
}

class _PendingVerificationScreenState extends State<PendingVerificationScreen> {
  Timer? _timer;
  Map<String, dynamic>? _data;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _fetchStatus();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _fetchStatus());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _fetchStatus() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/verification-status'),
        headers: headers,
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (mounted) {
          setState(() {
            _data = data;
            _loading = false;
          });
          if (data['verificationStatus'] == 'approved') {
            _timer?.cancel();
          }
        }
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final status = _data?['verificationStatus'] ?? 'pending';
    final name = _data?['fullName'] ?? _data?['full_name'] ?? 'Pilot';
    final docs = (_data?['documents'] as List?) ?? [];
    final rejectionNote = _data?['rejectionNote'] ?? _data?['rejection_note'];

    return Scaffold(
      backgroundColor: JT.bg,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text('Verification', style: TextStyle(fontWeight: FontWeight.w500, color: JT.textPrimary)),
        actions: [
          IconButton(
            icon: Icon(Icons.logout, color: JT.textPrimary),
            onPressed: () async {
              await AuthService.logout();
              if (!mounted) return;
              Navigator.pushAndRemoveUntil(context, MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
            },
          )
        ],
      ),
      body: _loading
        ? Center(child: CircularProgressIndicator(color: JT.primary))
        : SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                const SizedBox(height: 20),
                Center(child: JT.logoBlue(height: 60)),
                const SizedBox(height: 32),
                Text(
                  status == 'approved' ? 'Account Approved!' : (status == 'rejected' ? 'Verification Rejected' : 'Account Under Review'),
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.w500, color: JT.textPrimary),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  'Hello $name, your account is currently being verified by our team.',
                  style: TextStyle(color: JT.textSecondary),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                if (status == 'approved')
                  _buildStatusBanner(
                    'Your account has been approved. You can now start earning!',
                    const Color(0xFF22C55E),
                    () => Navigator.pushAndRemoveUntil(context, MaterialPageRoute(builder: (_) => const HomeScreen()), (_) => false),
                    'Start Driving!',
                  )
                else if (status == 'rejected')
                  _buildStatusBanner(
                    'Reason: ${rejectionNote ?? "Please re-upload documents"}',
                    const Color(0xFFEF4444),
                    () => Navigator.push(context, MaterialPageRoute(builder: (_) => const RegisterScreen())),
                    'Re-upload Documents',
                  ),
                const SizedBox(height: 32),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Document Status', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: JT.textPrimary)),
                ),
                const SizedBox(height: 16),
                ...docs.map((doc) => _buildDocTile(doc)).toList(),
              ],
            ),
          ),
    );
  }

  Widget _buildStatusBanner(String message, Color color, VoidCallback onTap, String btnText) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Column(
        children: [
          Text(message, style: TextStyle(color: color, fontWeight: FontWeight.w500), textAlign: TextAlign.center),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: onTap,
              style: ElevatedButton.styleFrom(backgroundColor: color, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
              child: Text(btnText),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildDocTile(Map<String, dynamic> doc) {
    final type = doc['docType'];
    final status = doc['status'];
    final note = doc['adminNote'];

    final labels = {
      'dl_front': 'DL Front',
      'dl_back': 'DL Back',
      'rc': 'RC Book',
      'aadhar_front': 'Aadhar Front',
      'aadhar_back': 'Aadhar Back',
      'insurance': 'Insurance',
      'selfie': 'Selfie',
      'vehicle_photo': 'Vehicle Photo',
    };

    Color statusColor = Colors.orange;
    if (status == 'approved') statusColor = const Color(0xFF22C55E);
    if (status == 'rejected') statusColor = const Color(0xFFEF4444);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(color: JT.surfaceAlt, borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: Icon(Icons.description, color: statusColor),
        title: Text(labels[type] ?? type, style: TextStyle(color: JT.textPrimary, fontWeight: FontWeight.w400)),
        subtitle: note != null ? Text(note, style: TextStyle(color: Colors.red.shade300, fontSize: 12)) : null,
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(8)),
          child: Text(
            status.toString().toUpperCase(),
            style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.w500),
          ),
        ),
      ),
    );
  }
}
