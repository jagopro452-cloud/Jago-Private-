import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../services/auth_service.dart';
import '../break_mode/break_mode_screen.dart';

class FatigueAlertScreen extends StatefulWidget {
  const FatigueAlertScreen({super.key});
  @override
  State<FatigueAlertScreen> createState() => _FatigueAlertScreenState();
}

class _FatigueAlertScreenState extends State<FatigueAlertScreen> {
  bool _loading = true;
  Map<String, dynamic> _data = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse('${ApiConfig.baseUrl}/api/app/driver/fatigue-status'), headers: headers);
      if (res.statusCode == 200 && mounted) setState(() => _data = jsonDecode(res.body));
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    final level = _data['fatigueLevel'] ?? 'low';
    final hrs = _data['hoursOnline'] ?? '0';
    final trips = _data['tripsToday'] ?? 0;
    final rec = _data['recommendation'] ?? '';
    final suggestBreak = _data['suggestBreak'] ?? false;

    final (levelColor, levelBg, levelIcon) = level == 'high'
        ? (Colors.red, Colors.red.shade50, Icons.warning_rounded)
        : level == 'medium'
        ? (Colors.orange, Colors.orange.shade50, Icons.info_rounded)
        : (Colors.green, Colors.green.shade50, Icons.check_circle_rounded);

    return Scaffold(
      backgroundColor: const Color(0xFF060d1e),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0d1b2e),
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('Fatigue Alert', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500)),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
          : Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  // Status card
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: levelBg,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: levelColor.withValues(alpha: 0.3)),
                    ),
                    child: Column(
                      children: [
                        Icon(levelIcon, color: levelColor, size: 48),
                        const SizedBox(height: 12),
                        Text(
                          level == 'high' ? 'High Fatigue Detected' : level == 'medium' ? 'Moderate Fatigue' : 'You\'re doing great!',
                          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w500, color: levelColor),
                        ),
                        const SizedBox(height: 8),
                        Text(rec, textAlign: TextAlign.center, style: TextStyle(color: levelColor.withValues(alpha: 0.8), height: 1.4)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  // Stats
                  Row(children: [
                    _statCard('Hours Online', '$hrs hrs', Icons.schedule, const Color(0xFF2563EB)),
                    const SizedBox(width: 12),
                    _statCard('Trips Today', '$trips', Icons.directions_car, Colors.green),
                  ]),
                  const SizedBox(height: 20),
                  // Tips
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: const Color(0xFF0d1b2e), borderRadius: BorderRadius.circular(16)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(children: [
                          Icon(Icons.lightbulb_outline, color: Colors.amber, size: 18),
                          SizedBox(width: 8),
                          Text('Safety Tips', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w500)),
                        ]),
                        const SizedBox(height: 12),
                        _tipRow('Drink water regularly during rides'),
                        _tipRow('Take a 10-min break every 2 hours'),
                        _tipRow('Eat proper meals — don\'t skip!'),
                        _tipRow('Stop if you feel drowsy even for a moment'),
                      ],
                    ),
                  ),
                  const Spacer(),
                  if (suggestBreak) ...[
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BreakModeScreen())),
                        icon: const Icon(Icons.coffee),
                        label: const Text('Take a Break Now', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF2563EB),
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          padding: const EdgeInsets.symmetric(vertical: 16),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: _load,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        side: const BorderSide(color: Colors.grey),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: const Text('Refresh Status'),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _statCard(String label, String val, IconData icon, Color color) => Expanded(
    child: Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: const Color(0xFF0d1b2e), borderRadius: BorderRadius.circular(16)),
      child: Column(children: [
        Icon(icon, color: color, size: 28),
        const SizedBox(height: 8),
        Text(val, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w500)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ]),
    ),
  );

  Widget _tipRow(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(children: [
      const Icon(Icons.check, color: Color(0xFF2563EB), size: 16),
      const SizedBox(width: 8),
      Expanded(child: Text(text, style: const TextStyle(color: Colors.grey, fontSize: 13))),
    ]),
  );
}
