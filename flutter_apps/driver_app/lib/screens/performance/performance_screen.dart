import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../services/auth_service.dart';

class PerformanceScreen extends StatefulWidget {
  const PerformanceScreen({super.key});

  @override
  State<PerformanceScreen> createState() => _PerformanceScreenState();
}

class _PerformanceScreenState extends State<PerformanceScreen> {
  Map<String, dynamic>? _perf;
  Map<String, dynamic>? _weeklyData;
  Map<String, dynamic>? _dashboard;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final headers = await AuthService.getHeaders();
    final results = await Future.wait([
      http.get(Uri.parse(ApiConfig.performance), headers: headers),
      http.get(Uri.parse(ApiConfig.driverDashboard), headers: headers),
      http.get(Uri.parse(ApiConfig.weeklyEarnings), headers: headers),
    ]);
    if (mounted) {
      setState(() {
        if (results[0].statusCode == 200) _perf = jsonDecode(results[0].body);
        if (results[1].statusCode == 200) _dashboard = jsonDecode(results[1].body);
        if (results[2].statusCode == 200) _weeklyData = jsonDecode(results[2].body);
        _loading = false;
      });
    }
  }

  Color _levelColor(String? level) {
    switch (level) {
      case 'Gold': return Colors.amber;
      case 'Silver': return Colors.grey.shade400;
      default: return const Color(0xFFCD7F32);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.textPrimary,
      appBar: AppBar(
        backgroundColor: JT.textPrimary,
        title: const Text('My Performance', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w500)),
        leading: IconButton(icon: const Icon(Icons.arrow_back, color: Colors.white), onPressed: () => Navigator.pop(context)),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF3B82F6)))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(children: [
                _buildScoreCard(),
                const SizedBox(height: 16),
                if (_weeklyData != null) ...[_buildWeeklyChart(), const SizedBox(height: 16)],
                _buildGoalsCard(),
                const SizedBox(height: 16),
                _buildStatsGrid(),
                const SizedBox(height: 16),
                _buildRecentTrips(),
                const SizedBox(height: 16),
                _buildTipsCard(),
              ]),
            ),
    );
  }

  Widget _buildScoreCard() {
    final score = _perf?['performanceScore'] ?? 0;
    final level = _perf?['level'] ?? 'Bronze';
    final levelColor = _levelColor(level);
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF0C2050), Color(0xFF1E3A5F)]),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFF2563EB).withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Stack(
            alignment: Alignment.center,
            children: [
              SizedBox(
                width: 90, height: 90,
                child: CircularProgressIndicator(
                  value: score / 100,
                  strokeWidth: 8,
                  backgroundColor: const Color(0xFF1E3A5F),
                  valueColor: AlwaysStoppedAnimation(levelColor),
                ),
              ),
              Column(children: [
                Text('$score', style: TextStyle(color: levelColor, fontSize: 22, fontWeight: FontWeight.w500)),
                Text('Score', style: TextStyle(color: levelColor.withValues(alpha: 0.7), fontSize: 10)),
              ]),
            ],
          ),
          const SizedBox(width: 20),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Icon(Icons.star, color: levelColor, size: 18),
                  const SizedBox(width: 6),
                  Text(level, style: TextStyle(color: levelColor, fontWeight: FontWeight.w500, fontSize: 18)),
                  const SizedBox(width: 8),
                  const Text('Driver', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
                ]),
                const SizedBox(height: 8),
                Text('Rating: ${_perf?['overallRating'] ?? 5.0} ⭐', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 16)),
                const SizedBox(height: 4),
                Text('Acceptance: ${_perf?['acceptanceRate'] ?? 100}%', style: const TextStyle(color: Color(0xFF64748B), fontSize: 13)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWeeklyChart() {
    final days = (_weeklyData?['days'] as List?) ?? [];
    final total = (_weeklyData?['total'] ?? 0.0) as num;
    if (days.isEmpty) return const SizedBox();
    final maxGross = days.fold<double>(0, (m, d) {
      final g = (d['gross'] as num?)?.toDouble() ?? 0;
      return g > m ? g : m;
    });

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF091629),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF1E3A5F)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          const Text('This Week Earnings', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 15)),
          Text('₹${total.toStringAsFixed(0)}', style: const TextStyle(color: Color(0xFF3B82F6), fontWeight: FontWeight.w500, fontSize: 16)),
        ]),
        const SizedBox(height: 16),
        SizedBox(
          height: 80,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: days.asMap().entries.map((entry) {
              final d = entry.value;
              final gross = (d['gross'] as num?)?.toDouble() ?? 0;
              final trips = d['trips'] as int? ?? 0;
              final pct = maxGross > 0 ? (gross / maxGross) : 0.0;
              final isToday = entry.key == days.length - 1;
              return Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 3),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.center, mainAxisAlignment: MainAxisAlignment.end, children: [
                    if (gross > 0) Text('₹${gross.toInt()}',
                      style: TextStyle(color: isToday ? const Color(0xFF3B82F6) : Colors.white60, fontSize: 8, fontWeight: FontWeight.w400)),
                    const SizedBox(height: 2),
                    Container(
                      width: double.infinity,
                      height: gross > 0 ? (60 * pct).clamp(4, 60) : 4,
                      decoration: BoxDecoration(
                        color: isToday
                          ? const Color(0xFF3B82F6)
                          : gross > 0 ? const Color(0xFF1E3A5F).withValues(alpha: 0.9) : const Color(0xFF1E3A5F).withValues(alpha: 0.3),
                        borderRadius: BorderRadius.circular(4),
                        border: isToday ? Border.all(color: const Color(0xFF3B82F6), width: 1.5) : null,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(d['day']?.toString() ?? '', style: TextStyle(color: isToday ? const Color(0xFF3B82F6) : Colors.white38, fontSize: 9, fontWeight: FontWeight.w400)),
                    if (trips > 0)
                      Text('${trips}t', style: const TextStyle(color: Color(0xFF22C55E), fontSize: 8)),
                  ]),
                ),
              );
            }).toList(),
          ),
        ),
      ]),
    );
  }

  Widget _buildGoalsCard() {
    final todayTrips = _dashboard?['today']?['trips'] ?? 0;
    final dailyTarget = _dashboard?['dailyGoal']?['target'] ?? 10;
    final weekTrips = _dashboard?['week']?['trips'] ?? 0;
    final weekTarget = _dashboard?['weeklyGoal']?['target'] ?? 50;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: const Color(0xFF091629), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFF1E3A5F))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Goals', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 15)),
          const SizedBox(height: 14),
          _goalBar('Daily Goal', todayTrips, dailyTarget, const Color(0xFF3B82F6)),
          const SizedBox(height: 12),
          _goalBar('Weekly Goal', weekTrips, weekTarget, const Color(0xFF22C55E)),
        ],
      ),
    );
  }

  Widget _goalBar(String label, int done, int target, Color color) {
    final pct = (done / target).clamp(0.0, 1.0);
    return Column(
      children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text(label, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
          Text('$done / $target trips', style: TextStyle(color: color, fontWeight: FontWeight.w500, fontSize: 13)),
        ]),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(value: pct, backgroundColor: const Color(0xFF1E3A5F), valueColor: AlwaysStoppedAnimation(color), minHeight: 8),
        ),
        const SizedBox(height: 4),
        Align(alignment: Alignment.centerRight, child: Text(pct >= 1 ? '🎉 Completed!' : '${((1 - pct) * target - (done % 1)).round()} more to go', style: TextStyle(color: pct >= 1 ? const Color(0xFF22C55E) : const Color(0xFF475569), fontSize: 11))),
      ],
    );
  }

  Widget _buildStatsGrid() {
    final d = _dashboard;
    return Column(children: [
      Row(children: [
        _miniStat('Today Trips', '${d?['today']?['trips'] ?? 0}', Icons.today, const Color(0xFF3B82F6)),
        const SizedBox(width: 12),
        _miniStat('Today Earned', '₹${double.tryParse(d?['today']?['net']?.toString() ?? '0')?.toStringAsFixed(0) ?? '0'}', Icons.payments, const Color(0xFF22C55E)),
      ]),
      const SizedBox(height: 12),
      Row(children: [
        _miniStat('Month Trips', '${d?['month']?['trips'] ?? 0}', Icons.calendar_month, const Color(0xFF8B5CF6)),
        const SizedBox(width: 12),
        _miniStat('Month Earned', '₹${double.tryParse(d?['month']?['net']?.toString() ?? '0')?.toStringAsFixed(0) ?? '0'}', Icons.account_balance_wallet, Colors.orange),
      ]),
    ]);
  }

  Widget _miniStat(String label, String value, IconData icon, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: const Color(0xFF091629), borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFF1E3A5F))),
        child: Row(children: [
          Container(width: 36, height: 36, decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)), child: Icon(icon, color: color, size: 18)),
          const SizedBox(width: 10),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 16)),
            Text(label, style: const TextStyle(color: Color(0xFF64748B), fontSize: 10)),
          ]),
        ]),
      ),
    );
  }

  Widget _buildRecentTrips() {
    final trips = (_dashboard?['recentTrips'] as List?) ?? [];
    if (trips.isEmpty) return const SizedBox();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: const Color(0xFF091629), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFF1E3A5F))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Recent Activity', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 15)),
        const SizedBox(height: 12),
        ...trips.take(3).map((t) => Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Row(children: [
            Container(width: 36, height: 36, decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(10)), child: const Icon(Icons.directions_car, color: Color(0xFF3B82F6), size: 18)),
            const SizedBox(width: 10),
            Expanded(child: Text(t['pickupAddress']?.toString().substring(0, (t['pickupAddress']?.toString().length ?? 0).clamp(0, 30)) ?? 'Trip', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12))),
            Text('₹${double.tryParse(t['actualFare']?.toString() ?? t['estimatedFare']?.toString() ?? '0')?.toStringAsFixed(0)}', style: const TextStyle(color: Color(0xFF3B82F6), fontWeight: FontWeight.w500)),
          ]),
        )),
      ]),
    );
  }

  Widget _buildTipsCard() {
    final score = _perf?['performanceScore'] ?? 0;
    final tips = score >= 90
        ? ['🏆 Excellent! Keep up the great work', 'Share your referral code to earn more', 'You qualify for Gold rewards!']
        : score >= 70
            ? ['⭐ Good performance! Aim for Gold level', 'Maintain 90%+ acceptance for Gold badge', 'Complete 10+ trips daily for bonus']
            : ['📈 Accept more trips to improve score', 'Avoid cancellations after accepting', 'Keep customers happy — polite service!'];
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: const Color(0xFF0C2050).withValues(alpha: 0.5), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFF2563EB).withValues(alpha: 0.3))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(children: [Icon(Icons.tips_and_updates, color: Color(0xFF3B82F6), size: 18), SizedBox(width: 8), Text('Tips for You', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 14))]),
          const SizedBox(height: 10),
          ...tips.map((tip) => Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Text(tip, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
          )),
        ],
      ),
    );
  }
}
