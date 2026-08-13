import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import '../../services/auth_service.dart';
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../main.dart' show saveThemePreference;
import '../../services/localization_service.dart';
import '../auth/login_screen.dart';
import '../onboarding/language_select_screen.dart';
import '../performance/performance_screen.dart';
import '../kyc/kyc_documents_screen.dart';
import '../referral/referral_screen.dart';
import '../history/trips_history_screen.dart';
import './support_chat_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  String _name = '';
  String _phone = '';
  String _email = '';
  String _vehicleNumber = '';
  String _vehicleModel = '';
  String _vehicleCategory = '';
  String _driverStatus = '';
  String _referralCode = '';
  double _rating = 5.0;
  int _totalTrips = 0;
  int _cancelledTrips = 0;
  double _weeklyEarnings = 0;
  bool _loading = true;
  bool _savingName = false;

  // Color system
  static const Color _bg = Color(0xFFFFFFFF);
  static const Color _surface = Color(0xFFF7FAFF);
  static const Color _card = Color(0xFFF0F5FF);
  static const Color _border = Color(0xFFDDE8FF);
  static const Color _primary = Color(0xFF2F7BFF);
  static const Color _green = Color(0xFF00E676);
  static const Color _amber = Color(0xFFFFB300);
  static const Color _red = Color(0xFFFF3D57);
  static const Color _textSecondary = Color(0xFF6B7FA8);
  static const Color _textHint = Color(0xFF445577);

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    final data = await AuthService.getProfile();
    if (!mounted) return;
    if (data != null) {
      setState(() {
        _name = data.fullName;
        _phone = data.phone;
        _email = data.email ?? '';
        _vehicleNumber = data.vehicleNumber ?? '';
        _vehicleModel = data.vehicleModel ?? '';
        _vehicleCategory = data.vehicleCategory ?? '';
        _driverStatus = data.status ?? 'pending';
        _referralCode = data.referralCode ?? '';
        _rating = data.rating;
        _totalTrips = data.stats.completedTrips;
        _cancelledTrips = data.stats.cancelledTrips;
        _weeklyEarnings = data.stats.weeklyEarnings;
        _loading = false;
      });
    } else {
      setState(() => _loading = false);
    }
  }

  Future<String> _getSupportPhone() async {
    try {
      final r = await http.get(Uri.parse(ApiConfig.configs));
      if (r.statusCode == 200) {
        final data = jsonDecode(r.body);
        return data['configs']?['support_phone'] ?? '+916303000000';
      }
    } catch (_) {}
    return '+916303000000';
  }

  void _showEditNameSheet() {
    final ctrl = TextEditingController(text: _name);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: Container(
          decoration: BoxDecoration(
            color: _card,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
            border: Border(top: BorderSide(color: _primary.withValues(alpha: 0.3), width: 1)),
          ),
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 36),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
              width: 44, height: 4,
              decoration: BoxDecoration(color: _border, borderRadius: BorderRadius.circular(2)),
            ),
            const SizedBox(height: 24),
            Text('Edit Display Name',
              style: GoogleFonts.poppins(color: _primary, fontSize: 18, fontWeight: FontWeight.w400)),
            const SizedBox(height: 20),
            TextField(
              controller: ctrl,
              autofocus: true,
              style: GoogleFonts.poppins(color: const Color(0xFF1A1A2E), fontSize: 15),
              decoration: InputDecoration(
                hintText: 'Your full name',
                hintStyle: GoogleFonts.poppins(color: _textHint),
                filled: true,
                fillColor: _surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: _border)),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: _border)),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(color: _primary, width: 1.5)),
                prefixIcon: Icon(Icons.person_rounded, color: _textHint),
              ),
            ),
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              height: 54,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _primary,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                onPressed: () async {
                  final newName = ctrl.text.trim();
                  if (newName.isEmpty || newName == _name) {
                    Navigator.pop(context);
                    return;
                  }
                  Navigator.pop(context);
                  setState(() => _savingName = true);
                  try {
                    final headers = await AuthService.getHeaders();
                    final res = await http.put(
                      Uri.parse(ApiConfig.updateProfile),
                      headers: {...headers, 'Content-Type': 'application/json'},
                      body: jsonEncode({'fullName': newName}),
                    );
                    if (res.statusCode == 200 && mounted) {
                      setState(() { _name = newName; });
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Row(children: [
                            const Icon(Icons.check_circle_rounded, color: Colors.black, size: 18),
                            const SizedBox(width: 10),
                            Text('Name updated successfully', style: GoogleFonts.poppins(color: Colors.black, fontWeight: FontWeight.w400)),
                          ]),
                          backgroundColor: _green,
                          behavior: SnackBarBehavior.floating,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      );
                    }
                  } catch (_) {}
                  if (mounted) setState(() => _savingName = false);
                },
                child: Text('Save Changes',
                  style: GoogleFonts.poppins(color: Colors.black, fontSize: 15, fontWeight: FontWeight.w400)),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  Future<void> _deleteDriverAccount(bool permanent) async {
    final headers = await AuthService.getHeaders();
    try {
      final res = await http.delete(
        Uri.parse(ApiConfig.deleteAccount),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({'permanent': permanent}),
      );
      if (res.statusCode == 200 && mounted) {
        await AuthService.safeLogout();
        Navigator.pushAndRemoveUntil(context,
          MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
      } else if (mounted) {
        final data = jsonDecode(res.body);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(data['message'] ?? 'Delete failed', style: GoogleFonts.poppins()),
          backgroundColor: _red,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Network error. Please try again.', style: GoogleFonts.poppins()),
          backgroundColor: _red,
          behavior: SnackBarBehavior.floating,
        ));
      }
    }
  }

  void _showDeleteAccountSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => Container(
        decoration: BoxDecoration(
          color: _card,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          border: Border(top: BorderSide(color: _red.withValues(alpha: 0.3), width: 1)),
        ),
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 44),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 44, height: 4,
            decoration: BoxDecoration(color: _border, borderRadius: BorderRadius.circular(2)),
          ),
          const SizedBox(height: 20),
          Row(children: [
            Container(
              width: 40, height: 40,
              decoration: BoxDecoration(
                color: _red.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: _red.withValues(alpha: 0.3)),
              ),
              child: const Icon(Icons.warning_rounded, color: _red, size: 22),
            ),
            const SizedBox(width: 14),
            Text('Delete Account', style: GoogleFonts.poppins(
                color: const Color(0xFF1A1A2E), fontSize: 18, fontWeight: FontWeight.w400)),
          ]),
          const SizedBox(height: 8),
          Text('Choose how you want to remove your account.',
            style: GoogleFonts.poppins(color: _textSecondary, fontSize: 13)),
          const SizedBox(height: 22),
          // Deactivate option
          GestureDetector(
            onTap: () {
              Navigator.pop(context);
              showDialog(
                context: context,
                builder: (_) => AlertDialog(
                  backgroundColor: _card,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                    side: BorderSide(color: _amber.withValues(alpha: 0.3)),
                  ),
                  title: Text('Deactivate Account?',
                    style: GoogleFonts.poppins(color: const Color(0xFF1A1A2E), fontWeight: FontWeight.w400)),
                  content: Text('Your account will be deactivated. Your data is kept. Contact support to reactivate.',
                    style: GoogleFonts.poppins(color: _textSecondary, fontSize: 13)),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(context),
                        child: Text('Cancel', style: GoogleFonts.poppins(color: _textHint))),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: _amber,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                      onPressed: () { Navigator.pop(context); _deleteDriverAccount(false); },
                      child: Text('Deactivate', style: GoogleFonts.poppins(color: Colors.black, fontWeight: FontWeight.w500))),
                  ],
                ),
              );
            },
            child: Container(
              padding: const EdgeInsets.all(16),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: _amber.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: _amber.withValues(alpha: 0.25)),
              ),
              child: Row(children: [
                Icon(Icons.pause_circle_outline_rounded, color: _amber, size: 24),
                const SizedBox(width: 14),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Deactivate Account', style: GoogleFonts.poppins(
                      color: _amber, fontWeight: FontWeight.w500, fontSize: 14)),
                  const SizedBox(height: 2),
                  Text('Recoverable — contact support to reactivate',
                      style: GoogleFonts.poppins(color: _textSecondary, fontSize: 11)),
                ])),
                Icon(Icons.chevron_right_rounded, color: _amber.withValues(alpha: 0.5)),
              ]),
            ),
          ),
          // Delete permanently option
          GestureDetector(
            onTap: () {
              Navigator.pop(context);
              showDialog(
                context: context,
                builder: (_) => AlertDialog(
                  backgroundColor: _card,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                    side: BorderSide(color: _red.withValues(alpha: 0.3)),
                  ),
                  title: Text('Delete Permanently?',
                    style: GoogleFonts.poppins(color: _red, fontWeight: FontWeight.w400)),
                  content: Text('This will permanently delete all your data including earnings history, KYC documents, and personal information. This cannot be undone.',
                    style: GoogleFonts.poppins(color: _textSecondary, fontSize: 13)),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(context),
                        child: Text('Cancel', style: GoogleFonts.poppins(color: _textHint))),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: _red,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                      onPressed: () { Navigator.pop(context); _deleteDriverAccount(true); },
                      child: Text('Delete Forever', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w500))),
                  ],
                ),
              );
            },
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: _red.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: _red.withValues(alpha: 0.25)),
              ),
              child: Row(children: [
                const Icon(Icons.delete_forever_rounded, color: _red, size: 24),
                const SizedBox(width: 14),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Delete Account Permanently', style: GoogleFonts.poppins(
                      color: _red, fontWeight: FontWeight.w500, fontSize: 14)),
                  const SizedBox(height: 2),
                  Text('All data deleted forever — cannot be undone',
                      style: GoogleFonts.poppins(color: _textSecondary, fontSize: 11)),
                ])),
                Icon(Icons.chevron_right_rounded, color: _red.withValues(alpha: 0.5)),
              ]),
            ),
          ),
        ]),
      ),
    );
  }

  void _showSupportSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: BoxDecoration(
          color: _card,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          border: Border(top: BorderSide(color: _primary.withValues(alpha: 0.3), width: 1)),
        ),
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 36),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 44, height: 4,
            decoration: BoxDecoration(color: _border, borderRadius: BorderRadius.circular(2)),
          ),
          const SizedBox(height: 20),
          Row(children: [
            Container(
              width: 44, height: 44,
              decoration: BoxDecoration(
                color: _primary.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: _primary.withValues(alpha: 0.3)),
              ),
              child: const Icon(Icons.headset_mic_rounded, color: _primary, size: 22),
            ),
            const SizedBox(width: 14),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Support', style: GoogleFonts.poppins(
                  color: const Color(0xFF1A1A2E), fontSize: 18, fontWeight: FontWeight.w400)),
              Text('JAGO Pro Pilot support team always ready!',
                  style: GoogleFonts.poppins(color: _textSecondary, fontSize: 12)),
            ]),
          ]),
          const SizedBox(height: 22),
          _supportOption(
            icon: Icons.chat_bubble_rounded, color: _primary,
            title: 'Chat with Support', subtitle: 'Average response: 2 minutes',
            onTap: () {
              Navigator.pop(ctx);
              Navigator.push(context, MaterialPageRoute(builder: (_) => const DriverSupportChatScreen()));
            },
          ),
          const SizedBox(height: 12),
          _supportOption(
            icon: Icons.phone_rounded, color: _green,
            title: 'Call Support', subtitle: 'Available 24/7',
            onTap: () async {
              final phone = await _getSupportPhone();
              Navigator.pop(ctx);
              final uri = Uri(scheme: 'tel', path: phone);
              if (await canLaunchUrl(uri)) await launchUrl(uri);
            },
          ),
        ]),
      ),
    );
  }

  Widget _supportOption({
    required IconData icon, required Color color, required String title,
    required String subtitle, required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: color.withValues(alpha: 0.2)),
        ),
        child: Row(children: [
          Container(
            width: 48, height: 48,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              shape: BoxShape.circle,
              border: Border.all(color: color.withValues(alpha: 0.3)),
              boxShadow: [BoxShadow(color: color.withValues(alpha: 0.2), blurRadius: 12)],
            ),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(width: 16),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: GoogleFonts.poppins(
                color: const Color(0xFF1A1A2E), fontWeight: FontWeight.w500, fontSize: 14)),
            const SizedBox(height: 3),
            Text(subtitle, style: GoogleFonts.poppins(color: _textSecondary, fontSize: 12)),
          ]),
          const Spacer(),
          Icon(Icons.chevron_right_rounded, color: _textHint),
        ]),
      ),
    );
  }

  Color _statusColor() {
    switch (_driverStatus) {
      case 'approved': return _green;
      case 'pending': return _amber;
      case 'rejected': return _red;
      default: return _textHint;
    }
  }

  String _statusLabel() {
    switch (_driverStatus) {
      case 'approved': return 'Verified Pilot';
      case 'pending': return 'Verification Pending';
      case 'rejected': return 'Verification Rejected';
      default: return _driverStatus;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        backgroundColor: _bg,
        body: Center(
          child: CircularProgressIndicator(
            color: _primary, strokeWidth: 2, backgroundColor: _border,
          ),
        ),
      );
    }

    final sColor = _statusColor();

    return Scaffold(
      backgroundColor: _bg,
      body: CustomScrollView(
        slivers: [
          // Hero profile header
          SliverAppBar(
            expandedHeight: 290,
            pinned: true,
            backgroundColor: _bg,
            leading: IconButton(
              icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 20),
              onPressed: () => Navigator.pop(context),
            ),
            actions: [
              IconButton(
                onPressed: () {
                  saveThemePreference('light');
                  AuthService.getHeaders().then((headers) {
                    http.patch(
                      Uri.parse('${ApiConfig.baseUrl}/api/app/driver/theme'),
                      headers: {...headers, 'Content-Type': 'application/json'},
                      body: jsonEncode({'theme': 'light'}),
                    ).catchError((_) => http.Response('', 500));
                  });
                },
                icon: const Icon(Icons.settings_outlined,
                    color: Color(0xFF6B7FA8), size: 22),
              ),
              GestureDetector(
                onTap: _showEditNameSheet,
                child: Container(
                  margin: const EdgeInsets.only(right: 16),
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: _primary.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: _primary.withValues(alpha: 0.3)),
                  ),
                  child: const Icon(Icons.edit_rounded, color: _primary, size: 18),
                ),
              ),
            ],
            flexibleSpace: FlexibleSpaceBar(
              background: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Color(0xFF4FA9FF), Color(0xFF2F7BFF)],
                    begin: Alignment.topCenter, end: Alignment.bottomCenter,
                  ),
                ),
                child: SafeArea(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const SizedBox(height: 44),
                      // Avatar with neon glow ring
                      Stack(
                        children: [
                          Container(
                            width: 100, height: 100,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(color: _primary.withValues(alpha: 0.6), width: 2),
                              boxShadow: [
                                BoxShadow(color: _primary.withValues(alpha: 0.4), blurRadius: 24, spreadRadius: 2),
                                BoxShadow(color: _primary.withValues(alpha: 0.15), blurRadius: 50, spreadRadius: 6),
                              ],
                            ),
                            child: CircleAvatar(
                              backgroundColor: _card,
                              radius: 48,
                              child: Text(
                                _name.isNotEmpty ? _name[0].toUpperCase() : 'P',
                                style: GoogleFonts.poppins(
                                    color: _primary, fontSize: 40, fontWeight: FontWeight.w500),
                              ),
                            ),
                          ),
                          Positioned(
                            bottom: 2, right: 2,
                            child: GestureDetector(
                              onTap: _showEditNameSheet,
                              child: Container(
                                width: 30, height: 30,
                                decoration: BoxDecoration(
                                  color: _primary, shape: BoxShape.circle,
                                  border: Border.all(color: _bg, width: 2),
                                ),
                                child: const Icon(Icons.edit_rounded, color: Colors.black, size: 15),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      // Name
                      if (_savingName)
                        SizedBox(width: 22, height: 22,
                            child: CircularProgressIndicator(color: _primary, strokeWidth: 2))
                      else
                        Text(_name,
                          style: GoogleFonts.poppins(
                            color: Colors.white, fontSize: 22, fontWeight: FontWeight.w500,
                            letterSpacing: -0.5)),
                      const SizedBox(height: 4),
                      Text('+91-$_phone',
                        style: GoogleFonts.poppins(color: _textSecondary, fontSize: 13)),
                      const SizedBox(height: 12),
                      // Status badge
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                        decoration: BoxDecoration(
                          color: sColor.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: sColor.withValues(alpha: 0.35)),
                          boxShadow: [BoxShadow(color: sColor.withValues(alpha: 0.2), blurRadius: 12)],
                        ),
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          Icon(
                            _driverStatus == 'approved'
                                ? Icons.verified_rounded
                                : Icons.pending_rounded,
                            size: 14, color: sColor),
                          const SizedBox(width: 6),
                          Text(_statusLabel(),
                            style: GoogleFonts.poppins(
                                color: sColor, fontSize: 12, fontWeight: FontWeight.w500)),
                        ]),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),

          SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Stats row
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
                  child: Row(children: [
                    _statCard('Rating', '${_rating.toStringAsFixed(1)}', Icons.star_rounded, _amber),
                    const SizedBox(width: 10),
                    _statCard('Trips', '$_totalTrips', Icons.route_rounded, _green),
                    const SizedBox(width: 10),
                    _statCard('This Week', '₹${_weeklyEarnings.toStringAsFixed(0)}', Icons.currency_rupee_rounded, _primary),
                  ]),
                ),

                const SizedBox(height: 20),

                // Vehicle info card
                if (_vehicleNumber.isNotEmpty || _vehicleModel.isNotEmpty)
                  _sectionCard(
                    title: 'VEHICLE INFO',
                    icon: Icons.two_wheeler_rounded,
                    iconColor: _primary,
                    children: [
                      if (_vehicleNumber.isNotEmpty)
                        _infoRow(Icons.badge_rounded, 'Vehicle Number', _vehicleNumber.toUpperCase()),
                      if (_vehicleModel.isNotEmpty)
                        _infoRow(Icons.directions_car_rounded, 'Model', _vehicleModel),
                      if (_vehicleCategory.isNotEmpty)
                        _infoRow(Icons.category_rounded, 'Category', _vehicleCategory),
                    ],
                  ),

                if (_vehicleNumber.isNotEmpty || _vehicleModel.isNotEmpty)
                  const SizedBox(height: 14),

                // Account info card
                _sectionCard(
                  title: 'ACCOUNT',
                  icon: Icons.person_rounded,
                  iconColor: _green,
                  children: [
                    if (_email.isNotEmpty)
                      _infoRow(Icons.email_rounded, 'Email', _email),
                    if (_referralCode.isNotEmpty)
                      GestureDetector(
                        onTap: () {
                          Clipboard.setData(ClipboardData(text: _referralCode));
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Row(children: [
                                const Icon(Icons.copy_rounded, color: Colors.black, size: 16),
                                const SizedBox(width: 8),
                                Text('Referral code copied!',
                                    style: GoogleFonts.poppins(color: Colors.black, fontWeight: FontWeight.w400)),
                              ]),
                              backgroundColor: _primary,
                              behavior: SnackBarBehavior.floating,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                              duration: const Duration(seconds: 2),
                            ),
                          );
                        },
                        child: _infoRow(
                          Icons.card_giftcard_rounded, 'Referral Code',
                          _referralCode,
                          trailing: Icon(Icons.copy_rounded, size: 14, color: _primary),
                        ),
                      ),
                    _infoRow(Icons.cancel_outlined, 'Cancellations', '$_cancelledTrips trips cancelled'),
                  ],
                ),

                const SizedBox(height: 14),

                // Main menu
                _menuCard(children: [
                  _menuTile(Icons.bar_chart_rounded, 'Performance & Ratings', const Color(0xFF8B5CF6), () =>
                    Navigator.push(context, MaterialPageRoute(builder: (_) => const PerformanceScreen()))),
                  _divider(),
                  _menuTile(Icons.receipt_long_rounded, 'Trip History', _primary, () =>
                    Navigator.push(context, MaterialPageRoute(builder: (_) => const TripsHistoryScreen()))),
                  _divider(),
                  _menuTile(Icons.description_outlined, 'KYC Documents', _amber, () =>
                    Navigator.push(context, MaterialPageRoute(builder: (_) => const KycDocumentsScreen()))),
                  _divider(),
                  _menuTile(Icons.card_giftcard_rounded, 'Refer & Earn', _green, () =>
                    Navigator.push(context, MaterialPageRoute(builder: (_) => const ReferralScreen()))),
                ]),

                const SizedBox(height: 14),

                _menuCard(children: [
                  _buildDriverLanguageTile(),
                  _divider(),
                  ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    leading: Container(
                      width: 40, height: 40,
                      decoration: BoxDecoration(
                        color: const Color(0xFF8B5CF6).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(Icons.settings_outlined,
                          color: Color(0xFF8B5CF6), size: 20),
                    ),
                    title: Text('App Settings',
                      style: GoogleFonts.poppins(color: JT.textPrimary, fontSize: 14, fontWeight: FontWeight.w400)),
                    subtitle: Text('Preferences',
                      style: GoogleFonts.poppins(color: _textSecondary, fontSize: 12)),
                    trailing: const Icon(Icons.chevron_right, color: Color(0xFF6B7FA8)),
                  ),
                  _divider(),
                  _menuTile(Icons.headset_mic_rounded, 'Help & Support', _primary, _showSupportSheet),
                  _divider(),
                  _menuTile(Icons.privacy_tip_rounded, 'Privacy Policy', _textSecondary, () async {
                    const url = 'https://jagopro.org/privacy';
                    if (await canLaunchUrl(Uri.parse(url))) await launchUrl(Uri.parse(url));
                  }),
                  _divider(),
                  _menuTile(Icons.delete_forever_rounded, 'Delete Account', _red, _showDeleteAccountSheet),
                  _divider(),
                  _menuTile(Icons.logout_rounded, 'Logout', _red, () async {
                    final confirm = await showDialog<bool>(
                      context: context,
                      builder: (_) => AlertDialog(
                        backgroundColor: _card,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(20),
                          side: BorderSide(color: _red.withValues(alpha: 0.3)),
                        ),
                        title: Text('Logout', style: GoogleFonts.poppins(
                            color: Colors.white, fontWeight: FontWeight.w400)),
                        content: Text('Are you sure you want to logout?',
                          style: GoogleFonts.poppins(color: _textSecondary, fontSize: 14)),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(context, false),
                            child: Text('Cancel', style: GoogleFonts.poppins(color: _textHint))),
                          ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: _red,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
                            onPressed: () => Navigator.pop(context, true),
                            child: Text('Logout', style: GoogleFonts.poppins(
                                color: Colors.white, fontWeight: FontWeight.w500))),
                        ],
                      ),
                    );
                    if (confirm == true && mounted) {
                      if (await AuthService.hasActiveTripSession()) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                          content: Text('Complete the active trip before logging out.',
                            style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w500)),
                          backgroundColor: Colors.orange,
                          behavior: SnackBarBehavior.floating,
                        ));
                        return;
                      }
                      await AuthService.safeLogout();
                      Navigator.pushAndRemoveUntil(context,
                        MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
                    }
                  }),
                ]),

                const SizedBox(height: 36),
                Center(
                  child: Text('JAGO Pro Pilot v1.0.31 · MindWhile IT Solutions Pvt Ltd',
                    style: GoogleFonts.poppins(color: _textHint, fontSize: 11)),
                ),
                const SizedBox(height: 28),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _statCard(String label, String value, IconData icon, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 10),
        decoration: BoxDecoration(
          color: _card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: color.withValues(alpha: 0.25), width: 1),
          boxShadow: [BoxShadow(color: color.withValues(alpha: 0.1), blurRadius: 16)],
        ),
        child: Column(children: [
          Icon(icon, color: color, size: 22),
          const SizedBox(height: 8),
          Text(value, style: GoogleFonts.poppins(
              color: color, fontSize: 17, fontWeight: FontWeight.w500)),
          const SizedBox(height: 4),
          Text(label, style: GoogleFonts.poppins(color: _textHint, fontSize: 10),
            textAlign: TextAlign.center),
        ]),
      ),
    );
  }

  Widget _sectionCard({
    required String title, required IconData icon, required Color iconColor,
    required List<Widget> children,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        decoration: BoxDecoration(
          color: _card,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: _border, width: 1),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 10),
            child: Row(children: [
              Container(
                width: 28, height: 28,
                decoration: BoxDecoration(
                  color: iconColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: iconColor, size: 15),
              ),
              const SizedBox(width: 10),
              Text(title, style: GoogleFonts.poppins(
                color: _textHint, fontSize: 10, fontWeight: FontWeight.w400, letterSpacing: 1.5)),
            ]),
          ),
          Container(height: 1, color: _border),
          ...children,
          const SizedBox(height: 8),
        ]),
      ),
    );
  }

  Widget _infoRow(IconData icon, String label, String value, {Widget? trailing}) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Row(children: [
        Icon(icon, size: 18, color: _textHint),
        const SizedBox(width: 12),
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: GoogleFonts.poppins(color: _textHint, fontSize: 10, letterSpacing: 0.3)),
          const SizedBox(height: 2),
          Text(value, style: GoogleFonts.poppins(
              color: const Color(0xFF1A1A2E), fontSize: 13, fontWeight: FontWeight.w500)),
        ]),
        if (trailing != null) ...[const Spacer(), trailing],
      ]),
    );
  }

  Widget _buildDriverLanguageTile() {
    const textColor = Color(0xFF1A1A2E);
    final currentLang = L.supportedLanguages.firstWhere(
      (l) => l['code'] == L.lang,
      orElse: () => L.supportedLanguages.first,
    );
    return ListTile(
      onTap: () => Navigator.push(context,
        MaterialPageRoute(builder: (_) => const LanguageSelectScreen(fromProfile: true))),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: Container(
        width: 40, height: 40,
        decoration: BoxDecoration(
          color: _primary.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: _primary.withValues(alpha: 0.25)),
        ),
        child: const Icon(Icons.translate_rounded, color: _primary, size: 20),
      ),
      title: Text('Language / భాష', style: GoogleFonts.poppins(
          fontSize: 14, fontWeight: FontWeight.w400, color: textColor)),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('${currentLang['flag']} ${currentLang['nativeName']}',
            style: GoogleFonts.poppins(fontSize: 11, color: _textSecondary)),
          const SizedBox(width: 4),
          Icon(Icons.chevron_right_rounded, color: _textHint, size: 20),
        ],
      ),
    );
  }

  Widget _menuCard({required List<Widget> children}) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Container(
        decoration: BoxDecoration(
          color: _card,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: _border, width: 1),
        ),
        child: Column(children: children),
      ),
    );
  }

  Widget _menuTile(IconData icon, String label, Color color, VoidCallback onTap) {
    return ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: Container(
        width: 40, height: 40,
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withValues(alpha: 0.2)),
        ),
        child: Icon(icon, color: color, size: 20),
      ),
      title: Text(label, style: GoogleFonts.poppins(
          fontSize: 14, fontWeight: FontWeight.w400, color: const Color(0xFF1A1A2E))),
      trailing: Icon(Icons.chevron_right_rounded, color: _textHint, size: 20),
    );
  }

  Widget _divider() => Container(
    height: 1, color: _border,
    margin: const EdgeInsets.only(left: 68),
  );
}
