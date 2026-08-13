import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../services/auth_service.dart';
import '../break_mode/break_mode_screen.dart';

class FatigueScreen extends StatefulWidget {
  const FatigueScreen({super.key});
  @override
  State<FatigueScreen> createState() => _FatigueScreenState();
}

class _FatigueScreenState extends State<FatigueScreen> {
  bool _loading = true;
  double _hoursToday = 0;
  int _tripsToday = 0;
  double _hoursWeek = 0;
  int _tripsWeek = 0;
  double _safetyScore = 100;
  bool _onBreak = false;
  String _recommendation = '';
  Timer? _timer;

  static const Color _bg = Color(0xFF0F1724);
  static const Color _card = Color(0xFF1A2332);
  static const Color _blue = Color(0xFF3B82F6);
  static const Color _green = Color(0xFF10B981);
  static const Color _orange = Color(0xFFF59E0B);
  static const Color _red = Color(0xFFEF4444);

  @override
  void initState() {
    super.initState();
    _loadData();
    _timer = Timer.periodic(const Duration(minutes: 5), (_) => _loadData());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _loadData() async {
    try {
      final headers = await AuthService.getHeaders();
      final responses = await Future.wait([
        http.get(Uri.parse('${ApiConfig.baseUrl}/api/app/driver/fatigue-status'), headers: headers),
        http.get(Uri.parse('${ApiConfig.baseUrl}/api/app/driver/dashboard'), headers: headers),
        http.get(Uri.parse('${ApiConfig.baseUrl}/api/app/driver/break'), headers: headers),
      ]);
      if (responses[0].statusCode == 200) {
        final data = jsonDecode(responses[0].body);
        final hrs = double.tryParse(data['hoursOnline']?.toString() ?? '0') ?? 0;
        final trips = (data['tripsToday'] as num?)?.toInt() ?? 0;
        final level = data['fatigueLevel'] ?? 'low';
        final rec = data['recommendation'] ?? 'You are driving safely. Stay hydrated!';
        double score = level == 'high' ? 30 : level == 'medium' ? 60 : 100;
        if (mounted) setState(() {
          _hoursToday = hrs;
          _tripsToday = trips;
          _safetyScore = score;
          _recommendation = rec;
        });
      }
      if (responses[1].statusCode == 200) {
        final data = jsonDecode(responses[1].body);
        final weekTrips = (data['week']?['trips'] as num?)?.toInt() ?? 0;
        final weekHrs = (weekTrips * 0.35).clamp(0, 70).toDouble();
        if (mounted) setState(() {
          _tripsWeek = weekTrips;
          _hoursWeek = weekHrs;
        });
      }
      if (responses[2].statusCode == 200) {
        final data = jsonDecode(responses[2].body);
        if (mounted) setState(() => _onBreak = data['onBreak'] == true);
      }
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  Color get _scoreColor {
    if (_safetyScore >= 80) return _green;
    if (_safetyScore >= 50) return _orange;
    return _red;
  }

  String get _scoreLabel {
    if (_safetyScore >= 80) return 'Safe';
    if (_safetyScore >= 50) return 'Caution';
    return 'Danger';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _bg,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text('Safety & Fatigue', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w400, fontSize: 18)),
        centerTitle: false,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF3B82F6)))
          : RefreshIndicator(
              onRefresh: _loadData,
              color: _blue,
              backgroundColor: _card,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  _buildSafetyScore(),
                  const SizedBox(height: 16),
                  _buildRecommendation(),
                  const SizedBox(height: 16),
                  _buildStatsGrid(),
                  const SizedBox(height: 16),
                  _buildSafetyTips(),
                  const SizedBox(height: 16),
                  _buildBreakButton(),
                  const SizedBox(height: 24),
                ]),
              ),
            ),
    );
  }

  Widget _buildSafetyScore() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _scoreColor.withValues(alpha: 0.3), width: 1.5),
      ),
      child: Column(children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          const Text('Safety Score', style: TextStyle(color: Colors.white70, fontSize: 14, fontWeight: FontWeight.w400)),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(color: _scoreColor.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(20)),
            child: Text(_scoreLabel, style: TextStyle(color: _scoreColor, fontWeight: FontWeight.w400, fontSize: 12)),
          ),
        ]),
        const SizedBox(height: 20),
        Stack(alignment: Alignment.center, children: [
          SizedBox(
            width: 120, height: 120,
            child: CircularProgressIndicator(
              value: _safetyScore / 100,
              strokeWidth: 10,
              backgroundColor: Colors.white.withValues(alpha: 0.08),
              valueColor: AlwaysStoppedAnimation(_scoreColor),
            ),
          ),
          Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Text('${_safetyScore.toInt()}', style: TextStyle(color: _scoreColor, fontSize: 36, fontWeight: FontWeight.w500)),
            Text('/100', style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 12)),
          ]),
        ]),
        const SizedBox(height: 16),
        LinearProgressIndicator(
          value: _safetyScore / 100,
          backgroundColor: Colors.white.withValues(alpha: 0.06),
          valueColor: AlwaysStoppedAnimation(_scoreColor),
          minHeight: 6,
          borderRadius: BorderRadius.circular(3),
        ),
        const SizedBox(height: 8),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text('0', style: TextStyle(color: Colors.white.withValues(alpha: 0.3), fontSize: 10)),
          Text('50', style: TextStyle(color: Colors.white.withValues(alpha: 0.3), fontSize: 10)),
          Text('100', style: TextStyle(color: Colors.white.withValues(alpha: 0.3), fontSize: 10)),
        ]),
      ]),
    );
  }

  Widget _buildRecommendation() {
    final icon = _safetyScore >= 80 ? Icons.check_circle_rounded
        : _safetyScore >= 50 ? Icons.warning_rounded
        : Icons.dangerous_rounded;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _scoreColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _scoreColor.withValues(alpha: 0.25)),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, color: _scoreColor, size: 22),
        const SizedBox(width: 12),
        Expanded(child: Text(_recommendation,
          style: TextStyle(color: Colors.white.withValues(alpha: 0.9), fontSize: 13, height: 1.5))),
      ]),
    );
  }

  Widget _buildStatsGrid() {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Today\'s Activity', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 15)),
      const SizedBox(height: 12),
      Row(children: [
        Expanded(child: _statCard('Hours Driven', '${_hoursToday.toStringAsFixed(1)}h', Icons.timer_rounded,
            _hoursToday >= 8 ? _red : _hoursToday >= 6 ? _orange : _green,
            '${((14 - _hoursToday).clamp(0, 14)).toStringAsFixed(1)}h left')),
        const SizedBox(width: 12),
        Expanded(child: _statCard('Trips Today', '$_tripsToday', Icons.route_rounded, _blue, '$_tripsWeek this week')),
      ]),
      const SizedBox(height: 12),
      Row(children: [
        Expanded(child: _statCard('Weekly Hours', '${_hoursWeek.toStringAsFixed(1)}h', Icons.date_range_rounded,
            _hoursWeek >= 48 ? _red : _orange, 'Max 60h/week recommended')),
        const SizedBox(width: 12),
        Expanded(child: _statCard('Status', _onBreak ? 'On Break' : 'Active',
            _onBreak ? Icons.free_breakfast_rounded : Icons.directions_car_rounded,
            _onBreak ? _green : _blue, _onBreak ? 'Resting now' : 'Available for trips')),
      ]),
    ]);
  }

  Widget _statCard(String label, String value, IconData icon, Color color, String sub) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: _card, borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.2), width: 1)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(width: 36, height: 36,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, color: color, size: 18)),
          const Spacer(),
        ]),
        const SizedBox(height: 12),
        Text(value, style: TextStyle(color: color, fontSize: 20, fontWeight: FontWeight.w500)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 11, fontWeight: FontWeight.w400)),
        const SizedBox(height: 4),
        Text(sub, style: TextStyle(color: Colors.white.withValues(alpha: 0.3), fontSize: 10), maxLines: 1, overflow: TextOverflow.ellipsis),
      ]),
    );
  }

  Widget _buildSafetyTips() {
    final tips = [
      ('💧', 'Stay Hydrated', 'Drink water every 30 minutes'),
      ('👁️', 'Eye Breaks', 'Look 20 feet away for 20 seconds every 20 minutes'),
      ('🕐', 'Rest Stops', 'Take 10-min breaks every 2 hours of driving'),
      ('🌙', 'Night Safety', 'Drive slower at night, use high-beam carefully'),
      ('🚫', 'No Phone', 'Never use phone while driving'),
    ];
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Text('Safety Tips', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 15)),
      const SizedBox(height: 12),
      ...tips.map((t) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(color: _card, borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.white.withValues(alpha: 0.06))),
        child: Row(children: [
          Text(t.$1, style: const TextStyle(fontSize: 20)),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(t.$2, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 13)),
            const SizedBox(height: 2),
            Text(t.$3, style: TextStyle(color: Colors.white.withValues(alpha: 0.45), fontSize: 11)),
          ])),
        ]),
      )),
    ]);
  }

  Widget _buildBreakButton() {
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: ElevatedButton.icon(
        onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BreakModeScreen())),
        icon: const Icon(Icons.free_breakfast_rounded),
        label: Text(_onBreak ? 'Manage Break' : 'Take a Break', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w400)),
        style: ElevatedButton.styleFrom(
          backgroundColor: _onBreak ? _green : _blue,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          elevation: 0,
        ),
      ),
    );
  }
}
