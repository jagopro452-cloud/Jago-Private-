import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

class RidePreferencesScreen extends StatefulWidget {
  const RidePreferencesScreen({super.key});
  @override
  State<RidePreferencesScreen> createState() => _RidePreferencesScreenState();
}

class _RidePreferencesScreenState extends State<RidePreferencesScreen> {
  bool _loading = true;
  bool _saving = false;
  bool _quietRide = false;
  bool _acPreferred = true;
  bool _musicOff = false;
  bool _wheelchairAccessible = false;
  bool _extraLuggage = false;
  String _preferredGender = 'any';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse('${ApiConfig.baseUrl}/api/app/customer/preferences'), headers: headers);
      if (res.statusCode == 200 && mounted) {
        final d = jsonDecode(res.body);
        setState(() {
          _quietRide = d['quietRide'] ?? false;
          _acPreferred = d['acPreferred'] ?? true;
          _musicOff = d['musicOff'] ?? false;
          _wheelchairAccessible = d['wheelchairAccessible'] ?? false;
          _extraLuggage = d['extraLuggage'] ?? false;
          _preferredGender = d['preferredGender'] ?? 'any';
        });
      }
    } catch (e) {
      debugPrint('Error loading preferences: $e');
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/customer/preferences'),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({
          'quietRide': _quietRide,
          'acPreferred': _acPreferred,
          'musicOff': _musicOff,
          'wheelchairAccessible': _wheelchairAccessible,
          'extraLuggage': _extraLuggage,
          'preferredGender': _preferredGender,
        }),
      );
      if (!mounted) return;
      final body = jsonDecode(res.body);
      
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Row(
          children: [
            Icon(res.statusCode == 200 ? Icons.check_circle_outline : Icons.error_outline, color: Colors.white, size: 20),
            const SizedBox(width: 12),
            Text(body['message'] ?? 'Saved Successfully', style: GoogleFonts.poppins()),
          ],
        ),
        behavior: SnackBarBehavior.floating,
        backgroundColor: res.statusCode == 200 ? const Color(0xFF10B981) : const Color(0xFFEF4444),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        margin: const EdgeInsets.all(20),
      ));
    } catch (e) {
      debugPrint('Error saving preferences: $e');
    }
    if (mounted) setState(() => _saving = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Color(0xFF1E293B), size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          'Ride Preferences',
          style: GoogleFonts.poppins(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: const Color(0xFF1E293B),
          ),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: TextButton(
              onPressed: _saving ? null : _save,
              child: _saving
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF2D8CFF)))
                  : Text(
                      'Save',
                      style: GoogleFonts.poppins(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: const Color(0xFF2D8CFF),
                      ),
                    ),
            ),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2D8CFF)))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              physics: const BouncingScrollPhysics(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildHeaderCard(),
                  const SizedBox(height: 32),
                  
                  _sectionHeader('Comfort Preferences'),
                  const SizedBox(height: 12),
                  _buildPrefCard('Quiet Ride', 'No unnecessary conversation', Icons.volume_off_rounded, _quietRide, (v) => setState(() => _quietRide = v)),
                  _buildPrefCard('AC Preferred', 'AC on during ride', Icons.ac_unit_rounded, _acPreferred, (v) => setState(() => _acPreferred = v)),
                  _buildPrefCard('Music Off', 'Prefer silence during ride', Icons.music_off_rounded, _musicOff, (v) => setState(() => _musicOff = v)),
                  
                  const SizedBox(height: 32),
                  _sectionHeader('Special Requirements'),
                  const SizedBox(height: 12),
                  _buildPrefCard('Wheelchair Accessible', 'Need accessible vehicle', Icons.accessible_rounded, _wheelchairAccessible, (v) => setState(() => _wheelchairAccessible = v)),
                  _buildPrefCard('Extra Luggage', 'Have large bags / extra luggage', Icons.luggage_rounded, _extraLuggage, (v) => setState(() => _extraLuggage = v)),
                  
                  const SizedBox(height: 32),
                  _sectionHeader('Driver Gender Preference'),
                  const SizedBox(height: 12),
                  _buildGenderSelector(),
                  
                  const SizedBox(height: 48),
                  JT.gradientButton(
                    label: 'Save Preferences',
                    onTap: () => _save(),
                    loading: _saving,
                  ),
                  const SizedBox(height: 24),
                ],
              ),
            ),
    );
  }

  Widget _buildHeaderCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF2D8CFF), Color(0xFF6366F1)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF2D8CFF).withValues(alpha: 0.2),
            blurRadius: 15,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.2),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.tune_rounded, color: Colors.white, size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Custom Experience',
                  style: GoogleFonts.poppins(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'We\'ll share these with your Pilot before every trip.',
                  style: GoogleFonts.poppins(
                    color: Colors.white.withValues(alpha: 0.8),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionHeader(String title) {
    return Text(
      title,
      style: GoogleFonts.poppins(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: const Color(0xFF1E293B),
        letterSpacing: -0.2,
      ),
    );
  }

  Widget _buildPrefCard(String title, String subtitle, IconData icon, bool val, Function(bool) onChanged) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: val ? const Color(0xFF2D8CFF).withValues(alpha: 0.3) : Colors.transparent,
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: val ? const Color(0xFF2D8CFF).withValues(alpha: 0.1) : const Color(0xFFF1F5F9),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: val ? const Color(0xFF2D8CFF) : const Color(0xFF94A3B8), size: 20),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: GoogleFonts.poppins(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: const Color(0xFF1E293B),
                    ),
                  ),
                  Text(
                    subtitle,
                    style: GoogleFonts.poppins(
                      fontSize: 12,
                      color: const Color(0xFF64748B),
                    ),
                  ),
                ],
              ),
            ),
            Switch.adaptive(
              value: val,
              activeThumbColor: const Color(0xFF2D8CFF),
              onChanged: onChanged,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGenderSelector() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              _genderOption('any', 'No Preference', Icons.people_rounded),
              const SizedBox(width: 12),
              _genderOption('female', 'Women Only', Icons.female_rounded),
              const SizedBox(width: 12),
              _genderOption('male', 'Men Only', Icons.male_rounded),
            ],
          ),
          if (_preferredGender == 'female') ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF1F2),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFFDA4AF).withValues(alpha: 0.3)),
              ),
              child: Row(
                children: [
                  const Icon(Icons.shield_rounded, color: Color(0xFFE11D48), size: 18),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'We\'ll prioritize matching you with a female Pilot for safety and comfort.',
                      style: GoogleFonts.poppins(
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                        color: const Color(0xFF9F1239),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _genderOption(String value, String label, IconData icon) {
    bool isSelected = _preferredGender == value;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _preferredGender = value),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 16),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFFF1F5FE) : const Color(0xFFF8FAFC),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: isSelected ? const Color(0xFF2D8CFF) : Colors.transparent,
              width: 1.5,
            ),
          ),
          child: Column(
            children: [
              Icon(
                icon,
                color: isSelected ? const Color(0xFF2D8CFF) : const Color(0xFF94A3B8),
                size: 22,
              ),
              const SizedBox(height: 8),
              Text(
                label,
                style: GoogleFonts.poppins(
                  fontSize: 11,
                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                  color: isSelected ? const Color(0xFF2D8CFF) : const Color(0xFF64748B),
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
