import 'dart:convert';
import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';
import 'package:http/http.dart' as http;
import 'package:shimmer/shimmer.dart';
import '../../services/auth_service.dart';
import '../../services/localization_service.dart';
import '../../src/core/config/api_config.dart';
import '../../main.dart' show saveThemePreference, themeNotifier;
import '../auth/login_screen.dart';
import '../saved_places/saved_places_screen.dart';
import '../preferences/ride_preferences_screen.dart';
import '../lost_found/lost_found_screen.dart';
import '../safety/emergency_contacts_screen.dart';
import '../referral/referral_screen.dart';
import '../offers/offers_screen.dart';
import './support_chat_screen.dart';
import 'package:google_fonts/google_fonts.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  String _name = '';
  String _phone = '';
  String _email = '';
  double _rating = 5.0;
  double _walletBalance = 0;
  int _loyaltyPoints = 0;
  int _completedTrips = 0;
  double _totalSpent = 0;
  bool _loading = true;
  bool _editing = false;
  bool _saving = false;
  late TextEditingController _nameCtrl;
  late TextEditingController _emailCtrl;

  @override
  void initState() {
    super.initState();
    _nameCtrl = TextEditingController();
    _emailCtrl = TextEditingController();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    final data = await AuthService.getProfile();
    if (!mounted) return;
    setState(() {
      _name = data?['fullName'] ?? data?['name'] ?? 'User';
      _phone = data?['phone'] ?? '';
      _email = data?['email'] ?? '';
      _rating = (data?['rating'] ?? 5.0).toDouble();
      _walletBalance = (data?['walletBalance'] ?? 0).toDouble();
      _loyaltyPoints = (data?['loyaltyPoints'] ?? 0).toInt();
      final stats = data?['stats'] as Map<String, dynamic>? ?? {};
      _completedTrips = (stats['completedTrips'] ?? 0).toInt();
      _totalSpent = (stats['totalSpent'] ?? 0).toDouble();
      _nameCtrl.text = _name;
      _emailCtrl.text = _email;
      _loading = false;
    });
  }

  Future<void> _saveProfile() async {
    if (mounted) setState(() => _saving = true);
    final res = await AuthService.updateProfile(
      fullName: _nameCtrl.text.trim(),
      email: _emailCtrl.text.trim(),
    );
    if (!mounted) return;
    setState(() => _saving = false);
    if (res['success'] == true) {
      setState(() {
        _name = _nameCtrl.text.trim();
        _email = _emailCtrl.text.trim();
        _editing = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Profile updated successfully'),
          backgroundColor: JT.primary));
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(res['message'] ?? 'Update failed'),
          backgroundColor: Colors.red));
    }
  }

  Future<void> _deleteAccount(bool permanent) async {
    final headers = await AuthService.getHeaders();
    try {
      final res = await http.delete(
        Uri.parse(ApiConfig.deleteAccount),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({'permanent': permanent}),
      );
      if (res.statusCode == 200 && mounted) {
        await AuthService.logout();
        Navigator.pushAndRemoveUntil(context,
          MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
      } else if (mounted) {
        final data = jsonDecode(res.body);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(data['message'] ?? 'Delete failed'),
          backgroundColor: Colors.red));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Network error. Please try again.'),
          backgroundColor: Colors.red));
      }
    }
  }

  Widget _buildProfileSkeleton() {
    Widget box(double w, double h, {double r = 8}) => Container(
      width: w,
      height: h,
      decoration: BoxDecoration(
          color: Colors.white, borderRadius: BorderRadius.circular(r)),
    );
    return Shimmer.fromColors(
        baseColor: const Color(0xFFE5E7EB),
        highlightColor: const Color(0xFFF3F4F6),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            // Avatar + name
            Center(child: Column(children: [
              box(80, 80, r: 40),
              const SizedBox(height: 12),
              box(140, 18, r: 6),
              const SizedBox(height: 6),
              box(100, 13, r: 5),
            ])),
            const SizedBox(height: 24),
            // Stats row
            Row(children: List.generate(3, (_) => Expanded(child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6),
              child: box(double.infinity, 64, r: 12),
            )))),
            const SizedBox(height: 24),
            // Menu sections
            ...List.generate(4, (_) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: box(double.infinity, 120, r: 14),
            )),
          ]),
        ),
      );
    }

  void _showSettingsSheet(Color cardBg, Color textColor, Color subColor) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: cardBg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Center(child: Container(width: 36, height: 4, decoration: BoxDecoration(
              color: JT.border, borderRadius: BorderRadius.circular(2)))),
            const SizedBox(height: 16),
            Text('Settings', style: JT.h3),
            const SizedBox(height: 20),
            Text('Appearance', style: JT.caption),
            const SizedBox(height: 8),
            ValueListenableBuilder<ThemeMode>(
              valueListenable: themeNotifier,
              builder: (_, mode, __) => Row(children: [
                _themeChip(ctx, 'Light', Icons.light_mode_rounded,
                    mode == ThemeMode.light, () => saveThemePreference('light')),
                const SizedBox(width: 8),
                _themeChip(ctx, 'Dark', Icons.dark_mode_rounded,
                    mode == ThemeMode.dark, () => saveThemePreference('dark')),
                const SizedBox(width: 8),
                _themeChip(ctx, 'System', Icons.brightness_auto_rounded,
                    mode == ThemeMode.system, () => saveThemePreference('system')),
              ]),
            ),
            const SizedBox(height: 24),
            Text('App Version', style: JT.caption),
            const SizedBox(height: 6),
            Text('v2.01 • MindWhile IT Solutions', style: JT.body),
          ]),
        ),
      ),
    );
  }

  Widget _themeChip(BuildContext ctx, String label, IconData icon, bool selected, VoidCallback onTap) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: selected ? JT.primary : JT.surfaceAlt,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: selected ? JT.primary : JT.border),
          ),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 20, color: selected ? Colors.white : JT.textSecondary),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(
              fontSize: 12, fontWeight: FontWeight.w400,
              color: selected ? Colors.white : JT.textSecondary,
            )),
          ]),
        ),
      ),
    );
  }

  void _showDeleteAccountDialog(Color cardBg, Color textColor, Color subColor) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: cardBg,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: Row(children: [
          const Icon(Icons.warning_rounded, color: Colors.red, size: 22),
          const SizedBox(width: 8),
          Text('Delete Account', style: TextStyle(color: textColor, fontWeight: FontWeight.w400)),
        ]),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text('Choose how you want to delete your account:',
            style: TextStyle(color: subColor, fontSize: 13)),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () {
              Navigator.pop(context);
              showDialog(
                context: context,
                builder: (_) => AlertDialog(
                  backgroundColor: cardBg,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                  title: Text('Deactivate Account?', style: TextStyle(color: textColor, fontWeight: FontWeight.w500)),
                  content: Text('Your account will be deactivated. You can reactivate it by contacting support.',
                    style: TextStyle(color: subColor, fontSize: 13)),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(context), child: Text('Cancel', style: TextStyle(color: subColor))),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: Colors.orange),
                      onPressed: () { Navigator.pop(context); _deleteAccount(false); },
                      child: const Text('Deactivate', style: TextStyle(color: Colors.white))),
                  ],
                ),
              );
            },
            icon: const Icon(Icons.pause_circle_outline, color: Colors.orange),
            label: const Text('Deactivate (Recoverable)', style: TextStyle(color: Colors.orange)),
            style: OutlinedButton.styleFrom(side: const BorderSide(color: Colors.orange)),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () {
              Navigator.pop(context);
              showDialog(
                context: context,
                builder: (_) => AlertDialog(
                  backgroundColor: cardBg,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                  title: const Text('Permanently Delete?', style: TextStyle(color: Colors.red, fontWeight: FontWeight.w500)),
                  content: Text('This will permanently delete all your data including trip history, wallet balance, and personal information. This cannot be undone.',
                    style: TextStyle(color: subColor, fontSize: 13)),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(context), child: Text('Cancel', style: TextStyle(color: subColor))),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
                      onPressed: () { Navigator.pop(context); _deleteAccount(true); },
                      child: const Text('Delete Forever', style: TextStyle(color: Colors.white))),
                  ],
                ),
              );
            },
            icon: const Icon(Icons.delete_forever, color: Colors.red),
            label: const Text('Permanently Delete', style: TextStyle(color: Colors.red)),
            style: OutlinedButton.styleFrom(side: const BorderSide(color: Colors.red)),
          ),
        ]),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('Cancel', style: TextStyle(color: subColor))),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _emailCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scaffoldBg = Colors.white; // Pure white base
    final cardBg = Colors.white;
    final textColor = const Color(0xFF1E293B);
    final subColor = const Color(0xFF64748B);
    final accentColor = const Color(0xFF7C3AED); // Premium Purple

    return Scaffold(
      backgroundColor: scaffoldBg,
      body: _loading
          ? _buildProfileSkeleton()
          : SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              child: Column(children: [
                const SizedBox(height: 12),
                // Header Area with Actions
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('My Profile', 
                        style: GoogleFonts.poppins(
                          fontSize: 20, 
                          fontWeight: FontWeight.w600, 
                          color: textColor
                        )
                      ),
                      if (!_editing)
                        GestureDetector(
                          onTap: () => setState(() => _editing = true),
                          child: Row(
                            children: [
                              Icon(Icons.edit_rounded, color: accentColor, size: 18),
                              const SizedBox(width: 4),
                              Text('Edit', 
                                style: GoogleFonts.poppins(
                                  color: accentColor, 
                                  fontWeight: FontWeight.w500,
                                  fontSize: 15
                                )
                              ),
                            ],
                          ),
                        )
                      else
                        Row(
                          children: [
                            TextButton(
                              onPressed: () => setState(() {
                                _editing = false;
                                _nameCtrl.text = _name;
                                _emailCtrl.text = _email;
                              }),
                              child: Text('Cancel', style: GoogleFonts.poppins(color: subColor)),
                            ),
                            const SizedBox(width: 8),
                            GestureDetector(
                              onTap: _saving ? null : _saveProfile,
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                                decoration: BoxDecoration(
                                  color: accentColor,
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: _saving
                                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                                    : Text('Save', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13)),
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),

                // Avatar and Basic Info
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
                  child: Column(children: [
                    Stack(
                      alignment: Alignment.bottomRight,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: Colors.white,
                            boxShadow: [
                              BoxShadow(color: accentColor.withValues(alpha: 0.1), blurRadius: 20, offset: const Offset(0, 8)),
                            ],
                          ),
                          child: CircleAvatar(
                            radius: 54,
                            backgroundColor: scaffoldBg,
                            child: Text(
                              _name.isNotEmpty ? _name[0].toUpperCase() : 'U',
                              style: GoogleFonts.poppins(
                                  color: accentColor,
                                  fontSize: 42,
                                  fontWeight: FontWeight.w600),
                            ),
                          ),
                        ),
                        if (_editing)
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                                color: accentColor,
                                shape: BoxShape.circle,
                                border: Border.all(color: Colors.white, width: 3)),
                            child: const Icon(Icons.camera_alt_rounded,
                                color: Colors.white, size: 16),
                          ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    if (_editing) ...[
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Column(children: [
                          _editField('Full Name', _nameCtrl, textColor),
                          const SizedBox(height: 12),
                          _editField('Email Address', _emailCtrl, textColor,
                              keyboard: TextInputType.emailAddress),
                        ]),
                      ),
                    ] else ...[
                      Text(_name,
                          style: GoogleFonts.poppins(
                              fontSize: 24,
                              fontWeight: FontWeight.w600,
                              color: textColor,
                              letterSpacing: -0.5)),
                      const SizedBox(height: 6),
                      Text('+91 $_phone',
                          style: GoogleFonts.poppins(color: subColor, fontSize: 15, fontWeight: FontWeight.w400)),
                      const SizedBox(height: 8),
                      Row(mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                        const Icon(Icons.star_rounded,
                            color: Colors.amber, size: 20),
                        const SizedBox(width: 4),
                        Text(_rating.toStringAsFixed(1),
                            style: GoogleFonts.poppins(
                                fontWeight: FontWeight.w600,
                                color: textColor,
                                fontSize: 15)),
                        Text(' rating',
                            style: GoogleFonts.poppins(color: subColor, fontSize: 14)),
                      ]),
                    ],
                  ]),
                ),

                // Stats Section
                Container(
                  margin: const EdgeInsets.symmetric(horizontal: 24),
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Row(children: [
                    _statItem('Wallet', '₹${_walletBalance.toStringAsFixed(0)}',
                        Icons.account_balance_wallet_rounded,
                        const Color(0xFF3B82F6)),
                    _statItem('Loyalty', '$_loyaltyPoints pts',
                        Icons.stars_rounded, Colors.amber),
                    _statItem('Trips', '$_completedTrips',
                         Icons.directions_car_rounded,
                        const Color(0xFF10B981)),
                    _statItem('Spent', '₹${_totalSpent.toStringAsFixed(0)}',
                        Icons.payments_rounded, const Color(0xFF8B5CF6)),
                  ]),
                ),
                
                const SizedBox(height: 24),

                // Menu Items
                Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: const Border(top: BorderSide(color: Color(0xFFF1F5F9)), bottom: BorderSide(color: Color(0xFFF1F5F9))),
                  ),
                  child: Column(children: [
                    _premiumTile(Icons.local_offer_rounded, 'Offers',
                        const Color(0xFFF59E0B), () => Navigator.push(context, MaterialPageRoute(
                            builder: (_) => const OffersScreen()))),
                    _premiumTile(Icons.place_rounded, 'Saved Places',
                        const Color(0xFF3B82F6), () => Navigator.push(context, MaterialPageRoute(
                            builder: (_) => const SavedPlacesScreen()))),
                    _premiumTile(Icons.tune_rounded, 'Ride Preferences',
                        const Color(0xFF6366F1), () => Navigator.push(context, MaterialPageRoute(
                            builder: (_) => const RidePreferencesScreen()))),
                    // _premiumTile(Icons.card_membership_rounded, 'Monthly Pass',
                    //     const Color(0xFFF59E0B), () => Navigator.push(context, MaterialPageRoute(
                    //         builder: (_) => const MonthlyPassScreen()))),
                    _premiumTile(Icons.wallet_giftcard_rounded, 'Refer & Earn',
                        const Color(0xFFEC4899), () => Navigator.push(context, MaterialPageRoute(
                            builder: (_) => const ReferralScreen()))),
                    _premiumTile(Icons.search_rounded, 'Lost & Found', 
                        const Color(0xFF7C3AED), () => Navigator.push(context, MaterialPageRoute(
                            builder: (_) => const LostFoundScreen()))),
                    _premiumTile(Icons.security_rounded, 'Emergency Contacts', 
                        const Color(0xFFEF4444), () => Navigator.push(context, MaterialPageRoute(
                            builder: (_) => const EmergencyContactsScreen()))),
                    _premiumTile(Icons.headset_mic_rounded, 'Help & Support',
                        const Color(0xFF06B6D4), () {
                          Navigator.push(context, MaterialPageRoute(builder: (_) => const SupportChatScreen()));
                        }),
                    _premiumTile(Icons.settings_rounded, 'Settings', 
                        const Color(0xFF64748B), () => _showSettingsSheet(cardBg, textColor, subColor), isLast: true),
                  ]),
                ),

                const SizedBox(height: 24),

                // Account Management
                Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: const Border(bottom: BorderSide(color: Color(0xFFF1F5F9))),
                  ),
                  child: Column(children: [
                    _premiumTile(Icons.language_rounded, 'Language', 
                        accentColor, () => _showProfileLanguageSheet(cardBg, textColor, subColor)),
                    _premiumTile(Icons.delete_forever_rounded, 'Delete Account', 
                        Colors.red, () => _showDeleteAccountDialog(cardBg, textColor, subColor)),
                    _premiumTile(Icons.logout_rounded, 'Logout', 
                        Colors.red, () async {
                          final ok = await showDialog<bool>(
                            context: context,
                            builder: (_) => AlertDialog(
                              backgroundColor: cardBg,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                              title: Text('Logout?', style: GoogleFonts.poppins(color: textColor, fontWeight: FontWeight.w600)),
                              content: Text('Are you sure you want to logout from Jago?', style: GoogleFonts.poppins(color: subColor)),
                              actions: [
                                TextButton(onPressed: () => Navigator.pop(context, false), child: Text('Cancel', style: GoogleFonts.poppins(color: subColor))),
                                TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Logout', style: TextStyle(color: Colors.red, fontWeight: FontWeight.w600))),
                              ],
                            ),
                          );
                          if (ok == true) {
                            await AuthService.logout();
                            if (!mounted) return;
                            Navigator.pushAndRemoveUntil(context, MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
                          }
                        }, isLast: true),
                  ]),
                ),

                const SizedBox(height: 32),
                Text('v2.01 • MindWhile IT Solutions',
                    style: GoogleFonts.poppins(color: subColor, fontSize: 11, fontWeight: FontWeight.w400)),
                const SizedBox(height: 48),
              ]),
            ),
    );
  }

  Widget _statItem(String label, String value, IconData icon, Color color) {
    return Expanded(
      child: Column(children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(14)),
          child: Icon(icon, color: color, size: 22),
        ),
        const SizedBox(height: 10),
        Text(value,
            style: GoogleFonts.poppins(
                fontWeight: FontWeight.w600,
                fontSize: 14,
                color: const Color(0xFF1E293B))),
        Text(label,
            style: GoogleFonts.poppins(fontSize: 10, color: const Color(0xFF94A3B8), fontWeight: FontWeight.w500)),
      ]),
    );
  }

  Widget _premiumTile(IconData icon, String label, Color color, VoidCallback onTap, {bool isLast = false}) {
    return Column(children: [
      ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(12)),
          child: Icon(icon, color: color, size: 20),
        ),
        title: Text(label,
            style: GoogleFonts.poppins(
                fontSize: 15,
                fontWeight: FontWeight.w500,
                color: const Color(0xFF334155))),
        trailing: const Icon(Icons.chevron_right_rounded, color: Color(0xFFCBD5E1), size: 24),
        onTap: onTap,
      ),
      if (!isLast)
        Padding(
          padding: const EdgeInsets.only(left: 72),
          child: Divider(height: 1, color: const Color(0xFFF1F5F9)),
        ),
    ]);
  }

  Widget _editField(String label, TextEditingController ctrl, Color textColor,
      {TextInputType keyboard = TextInputType.text}) {
    const fieldBg = Color(0xFFF5F7FA);
    const borderColor = Color(0xFFE5E9F0);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label,
          style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w400,
              color: textColor.withValues(alpha: 0.5),
              letterSpacing: 0.8)),
      const SizedBox(height: 4),
      Container(
        decoration: BoxDecoration(
            color: fieldBg,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: borderColor)),
        child: TextField(
          controller: ctrl,
          keyboardType: keyboard,
          style: TextStyle(color: textColor, fontSize: 15),
          decoration: InputDecoration(
            border: InputBorder.none,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          ),
        ),
      ),
    ]);
  }

  void _showProfileLanguageSheet(Color cardBg, Color textColor, Color subColor) {
    showModalBottomSheet(
      context: context,
      backgroundColor: cardBg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      isScrollControlled: true,
      builder: (_) => StatefulBuilder(
        builder: (ctx, setS) => DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.65,
          builder: (_, controller) => Padding(
            padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(child: Container(width: 40, height: 4,
                  decoration: BoxDecoration(color: subColor.withValues(alpha: 0.3), borderRadius: BorderRadius.circular(2)))),
                const SizedBox(height: 16),
                Row(children: [
                  const Icon(Icons.translate_rounded, color: JT.primary, size: 22),
                  const SizedBox(width: 10),
                  Text(L.tr('choose_language'),
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w400, color: textColor)),
                ]),
                const SizedBox(height: 6),
                Text('App language will change immediately',
                  style: TextStyle(fontSize: 12, color: subColor)),
                const SizedBox(height: 16),
                Expanded(child: ListView(
                  controller: controller,
                  children: L.supportedLanguages.map((lang) {
                    final isSelected = L.lang == lang['code'];
                    return GestureDetector(
                      onTap: () async {
                        await L.setLanguage(lang['code']!);
                        setS(() {});
                        if (mounted) {
                          Navigator.pop(ctx);
                          setState(() {});
                        }
                      },
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                        decoration: BoxDecoration(
                          color: isSelected
                            ? JT.primary.withValues(alpha: 0.08)
                            : JT.primary.withValues(alpha: 0.02),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: isSelected ? JT.primary : subColor.withValues(alpha: 0.15),
                            width: isSelected ? 1.5 : 1,
                          ),
                        ),
                        child: Row(children: [
                          Text(lang['flag']!, style: const TextStyle(fontSize: 24)),
                          const SizedBox(width: 14),
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(lang['name']!,
                              style: TextStyle(fontWeight: FontWeight.w500, fontSize: 15,
                                color: isSelected ? JT.primary : textColor)),
                            Text(lang['nativeName']!,
                              style: TextStyle(fontSize: 12, color: subColor)),
                          ])),
                          if (isSelected)
                            Container(
                              padding: const EdgeInsets.all(4),
                              decoration: BoxDecoration(
                                color: JT.primary,
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: const Icon(Icons.check, color: Colors.white, size: 14),
                            ),
                        ]),
                      ),
                    );
                  }).toList(),
                )),
              ],
            ),
          ),
        ),
      ),
    );
  }

}
