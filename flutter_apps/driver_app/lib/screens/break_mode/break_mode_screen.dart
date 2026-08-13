import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../services/auth_service.dart';

class BreakModeScreen extends StatefulWidget {
  const BreakModeScreen({super.key});
  @override
  State<BreakModeScreen> createState() => _BreakModeScreenState();
}

class _BreakModeScreenState extends State<BreakModeScreen> {
  bool _loading = true;
  bool _onBreak = false;
  int _minutesLeft = 0;
  String? _breakUntil;
  bool _settingBreak = false;
  int _selectedMinutes = 15;
  Timer? _timer;

  final _options = [5, 10, 15, 20, 30, 45, 60];

  @override
  void initState() {
    super.initState();
    _checkBreak();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _checkBreak() async {
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse('${ApiConfig.baseUrl}/api/app/driver/break'), headers: headers);
      if (res.statusCode == 200 && mounted) {
        final d = jsonDecode(res.body);
        setState(() {
          _onBreak = d['onBreak'] ?? false;
          _minutesLeft = d['minutesLeft'] ?? 0;
          _breakUntil = d['breakUntil'];
        });
        if (_onBreak) _startCountdown();
      }
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  void _startCountdown() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(minutes: 1), (t) {
      if (!mounted) { t.cancel(); return; }
      if (_minutesLeft <= 1) {
        t.cancel();
        setState(() { _onBreak = false; _minutesLeft = 0; });
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Break ended! You are now online.'), backgroundColor: Colors.green));
      } else {
        setState(() => _minutesLeft--);
      }
    });
  }

  Future<void> _startBreak() async {
    setState(() => _settingBreak = true);
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/break'),
        headers: headers,
        body: jsonEncode({'minutes': _selectedMinutes}),
      );
      if (!mounted) return;
      if (res.statusCode == 200) {
        final d = jsonDecode(res.body);
        setState(() {
          _onBreak = true;
          _minutesLeft = _selectedMinutes;
          _breakUntil = d['breakUntil'];
        });
        _startCountdown();
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Break started for $_selectedMinutes minutes. Auto go-online after break.'),
          backgroundColor: Colors.blue,
        ));
      }
    } catch (_) {}
    if (mounted) setState(() => _settingBreak = false);
  }

  Future<void> _endBreak() async {
    setState(() => _settingBreak = true);
    try {
      final headers = await AuthService.getHeaders();
      await http.delete(Uri.parse('${ApiConfig.baseUrl}/api/app/driver/break'), headers: headers);
      _timer?.cancel();
      if (!mounted) return;
      setState(() { _onBreak = false; _minutesLeft = 0; });
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Back online!'), backgroundColor: Colors.green));
    } catch (_) {}
    if (mounted) setState(() => _settingBreak = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF060d1e),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0d1b2e),
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('Break Mode', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500)),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
          : _onBreak ? _onBreakView() : _setBreakView(),
    );
  }

  Widget _onBreakView() => Padding(
    padding: const EdgeInsets.all(24),
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          width: 180,
          height: 180,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: const Color(0xFF2563EB), width: 4),
            color: const Color(0xFF0d1b2e),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.coffee, color: Colors.amber, size: 40),
              const SizedBox(height: 8),
              Text('$_minutesLeft', style: const TextStyle(color: Colors.white, fontSize: 52, fontWeight: FontWeight.w500)),
              const Text('min left', style: TextStyle(color: Colors.grey, fontSize: 14)),
            ],
          ),
        ),
        const SizedBox(height: 32),
        const Text('You\'re on break', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w500)),
        const SizedBox(height: 8),
        const Text('No new trips will be assigned.\nWe\'ll auto go-online after break.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
        if (_breakUntil != null) ...[
          const SizedBox(height: 12),
          Text('Back at: ${_breakUntil!.substring(11, 16)}', style: const TextStyle(color: Color(0xFF2563EB), fontWeight: FontWeight.w500)),
        ],
        const SizedBox(height: 40),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: _settingBreak ? null : _endBreak,
            icon: const Icon(Icons.play_arrow),
            label: _settingBreak
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('End Break Now', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.green,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _setBreakView() => Padding(
    padding: const EdgeInsets.all(24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(color: const Color(0xFF0d1b2e), borderRadius: BorderRadius.circular(20)),
          child: const Row(children: [
            Icon(Icons.coffee_outlined, color: Colors.amber, size: 32),
            SizedBox(width: 16),
            Expanded(child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Taking a break?', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w500)),
                SizedBox(height: 4),
                Text('Set your break time. No rides assigned during break.', style: TextStyle(color: Colors.grey, fontSize: 13)),
              ],
            )),
          ]),
        ),
        const SizedBox(height: 32),
        const Text('How long?', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w500)),
        const SizedBox(height: 16),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: _options.map((m) => GestureDetector(
            onTap: () => setState(() => _selectedMinutes = m),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              decoration: BoxDecoration(
                color: _selectedMinutes == m ? const Color(0xFF2563EB) : const Color(0xFF0d1b2e),
                borderRadius: BorderRadius.circular(30),
                border: Border.all(color: _selectedMinutes == m ? const Color(0xFF2563EB) : Colors.grey.shade800),
              ),
              child: Text('$m min', style: TextStyle(
                color: _selectedMinutes == m ? Colors.white : Colors.grey,
                fontWeight: FontWeight.w500,
              )),
            ),
          )).toList(),
        ),
        const Spacer(),
        // What happens
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: const Color(0xFF0d1b2e), borderRadius: BorderRadius.circular(16)),
          child: Column(
            children: const [
              _InfoRow(icon: Icons.block, text: 'No new trip requests during break'),
              SizedBox(height: 8),
              _InfoRow(icon: Icons.play_circle_outline, text: 'Auto go-online after break ends'),
              SizedBox(height: 8),
              _InfoRow(icon: Icons.timer_off_outlined, text: 'End break early anytime'),
            ],
          ),
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: _settingBreak ? null : _startBreak,
            icon: const Icon(Icons.coffee),
            label: _settingBreak
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text('Start $_selectedMinutes min Break', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF2563EB),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
          ),
        ),
      ],
    ),
  );
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String text;
  const _InfoRow({required this.icon, required this.text});
  @override
  Widget build(BuildContext context) => Row(children: [
    Icon(icon, color: const Color(0xFF2563EB), size: 18),
    const SizedBox(width: 10),
    Text(text, style: const TextStyle(color: Colors.grey, fontSize: 13)),
  ]);
}
