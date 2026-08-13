import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

class EarningsScreen extends StatefulWidget {
  const EarningsScreen({super.key});
  @override
  State<EarningsScreen> createState() => _EarningsScreenState();
}

class _EarningsScreenState extends State<EarningsScreen>
    with SingleTickerProviderStateMixin {
  String _period = 'today';
  bool _loading = true;
  bool _weekLoading = true;
  Map<String, dynamic> _stats = {};
  List<Map<String, dynamic>> _weekDays = [];
  double _weekTotal = 0;

  late AnimationController _fadeCtrl;
  late Animation<double> _fadeAnim;

  final _tabs = [
    {'label': 'Today', 'value': 'today'},
    {'label': 'Week', 'value': 'week'},
    {'label': 'Month', 'value': 'month'},
    {'label': 'All Time', 'value': 'all'},
  ];

  @override
  void initState() {
    super.initState();
    _fadeCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 600));
    _fadeAnim = CurvedAnimation(parent: _fadeCtrl, curve: Curves.easeOut);
    _loadStats();
    _loadWeekly();
  }

  @override
  void dispose() {
    _fadeCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadStats() async {
    if (mounted) setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse(
            '${ApiConfig.baseUrl}/api/app/driver/earnings?period=$_period'),
        headers: headers,
      );
      if (res.statusCode == 200 && mounted) {
        setState(() => _stats = jsonDecode(res.body));
        _fadeCtrl.forward(from: 0);
      }
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _loadWeekly() async {
    if (mounted) setState(() => _weekLoading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/weekly-earnings'),
        headers: headers,
      );
      if (res.statusCode == 200 && mounted) {
        final d = jsonDecode(res.body);
        setState(() {
          _weekDays = List<Map<String, dynamic>>.from(d['days'] ?? []);
          _weekTotal = (d['total'] ?? 0).toDouble();
        });
      }
    } catch (_) {}
    if (mounted) setState(() => _weekLoading = false);
  }

  @override
  Widget build(BuildContext context) {
    final gross = (_stats['grossFare'] ?? 0).toDouble();
    final commission = (_stats['commission'] ?? 0).toDouble();
    final gst = (_stats['gst'] ?? 0).toDouble();
    final net = (_stats['netEarnings'] ?? 0).toDouble();
    final completed = _stats['completedTrips'] ?? 0;
    final cancelled = _stats['cancelledTrips'] ?? 0;
    final maxWeek = _weekDays.isEmpty
        ? 1.0
        : _weekDays
            .map((d) => (d['gross'] as num).toDouble())
            .reduce((a, b) => a > b ? a : b)
            .clamp(1.0, double.infinity);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
        backgroundColor: JT.bg,
        body: RefreshIndicator(
          onRefresh: () async {
            _loadStats();
            _loadWeekly();
          },
          color: JT.primary,
          backgroundColor: JT.surface,
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(child: _buildHeader()),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
                  child: _buildTabs(),
                ),
              ),
              if (_loading)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.all(60),
                    child: Center(
                      child: Column(
                        children: [
                          SizedBox(
                            width: 40, height: 40,
                            child: CircularProgressIndicator(
                              color: JT.primary,
                              strokeWidth: 2.5,
                              backgroundColor: JT.border,
                            ),
                          ),
                          const SizedBox(height: 16),
                          Text('Loading earnings...',
                              style: GoogleFonts.poppins(color: JT.iconInactive, fontSize: 13)),
                        ],
                      ),
                    ),
                  ),
                )
              else
                SliverToBoxAdapter(
                  child: FadeTransition(
                    opacity: _fadeAnim,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(children: [
                        _bigEarningCard(net),
                        const SizedBox(height: 14),
                        Row(children: [
                          Expanded(
                              child: _statCard('Gross Fare',
                                  '₹${gross.toStringAsFixed(0)}',
                                  Icons.monetization_on_rounded, JT.warning)),
                          const SizedBox(width: 12),
                          Expanded(
                              child: _statCard('Commission',
                                  '-₹${commission.toStringAsFixed(0)}',
                                  Icons.percent_rounded, JT.error)),
                        ]),
                        const SizedBox(height: 12),
                        Row(children: [
                          Expanded(
                              child: _statCard('GST',
                                  '-₹${gst.toStringAsFixed(0)}',
                                  Icons.receipt_long_rounded, JT.error)),
                          const SizedBox(width: 12),
                          Expanded(
                              child: _statCard('Completed',
                                  '$completed trips',
                                  Icons.check_circle_rounded, JT.success)),
                        ]),
                        const SizedBox(height: 12),
                        Row(children: [
                          Expanded(
                              child: _statCard('Cancelled',
                                  '$cancelled trips',
                                  Icons.cancel_rounded, JT.error)),
                          const SizedBox(width: 12),
                          const Expanded(child: SizedBox()),
                        ]),
                      ]),
                    ),
                  ),
                ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                  child: _buildWeeklyChart(maxWeek),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      decoration: BoxDecoration(
        gradient: JT.grad,
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          child: Row(children: [
            GestureDetector(
              onTap: () => Navigator.pop(context),
              child: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.3), width: 1),
                ),
                child: const Icon(Icons.arrow_back_ios_new_rounded,
                    color: Colors.white, size: 18),
              ),
            ),
            const SizedBox(width: 16),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('My Earnings',
                  style: GoogleFonts.poppins(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w500)),
              Text('Track your income & trips',
                  style: GoogleFonts.poppins(
                      color: Colors.white.withValues(alpha: 0.75), fontSize: 12)),
            ]),
            const Spacer(),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.white.withValues(alpha: 0.4)),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Container(
                  width: 7, height: 7,
                  decoration: const BoxDecoration(
                    color: Colors.white, shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text('LIVE',
                    style: GoogleFonts.poppins(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w400,
                        letterSpacing: 1)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _buildTabs() {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: JT.bgSoft,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.border, width: 1),
      ),
      child: Row(
        children: _tabs.map((t) {
          final active = _period == t['value'];
          return Expanded(
            child: GestureDetector(
              onTap: () {
                setState(() => _period = t['value']!);
                _loadStats();
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 220),
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  gradient: active ? JT.grad : null,
                  color: active ? null : Colors.transparent,
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: active ? JT.btnShadow : [],
                ),
                child: Text(t['label']!,
                    textAlign: TextAlign.center,
                    style: GoogleFonts.poppins(
                        color: active ? Colors.white : JT.iconInactive,
                        fontSize: 12,
                        fontWeight: active ? FontWeight.w500 : FontWeight.w400)),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _bigEarningCard(double net) {
    final periodLabel = _period == 'today'
        ? 'Today'
        : _period == 'week'
            ? 'This Week'
            : _period == 'month'
                ? 'This Month'
                : 'All Time';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        gradient: JT.grad,
        borderRadius: BorderRadius.circular(24),
        boxShadow: JT.btnShadow,
      ),
      child: Column(children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.2),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white.withValues(alpha: 0.4)),
          ),
          child: const Icon(Icons.account_balance_wallet_rounded, color: Colors.white, size: 30),
        ),
        const SizedBox(height: 16),
        Text('Net Earnings',
            style: GoogleFonts.poppins(color: Colors.white.withValues(alpha: 0.8), fontSize: 13, fontWeight: FontWeight.w400)),
        const SizedBox(height: 8),
        Text('₹${net.toStringAsFixed(2)}',
            style: GoogleFonts.poppins(
                color: Colors.white,
                fontSize: 44,
                fontWeight: FontWeight.w500,
                height: 1.0,
                letterSpacing: -1.5)),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.2),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
          ),
          child: Text(periodLabel,
              style: GoogleFonts.poppins(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w400)),
        ),
      ]),
    );
  }

  Widget _statCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: JT.bgSoft,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: color.withValues(alpha: 0.2), width: 1),
        boxShadow: JT.cardShadow,
      ),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: color.withValues(alpha: 0.2)),
          ),
          child: Icon(icon, color: color, size: 18),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label,
                  style: GoogleFonts.poppins(
                      color: JT.iconInactive,
                      fontSize: 10,
                      fontWeight: FontWeight.w400,
                      letterSpacing: 0.5)),
              const SizedBox(height: 4),
              Text(value,
                  style: GoogleFonts.poppins(
                      color: JT.textPrimary,
                      fontSize: 15,
                      fontWeight: FontWeight.w400)),
            ],
          ),
        ),
      ]),
    );
  }

  Widget _buildWeeklyChart(double maxWeek) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: JT.bgSoft,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: JT.border, width: 1),
        boxShadow: JT.cardShadow,
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Weekly Earnings',
                style: GoogleFonts.poppins(
                    color: JT.textPrimary,
                    fontSize: 15,
                    fontWeight: FontWeight.w500)),
            Text('Last 7 days overview',
                style: GoogleFonts.poppins(
                    color: JT.textSecondary, fontSize: 11)),
          ]),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
            decoration: BoxDecoration(
              gradient: JT.grad,
              borderRadius: BorderRadius.circular(12),
              boxShadow: JT.btnShadow,
            ),
            child: Text('₹${_weekTotal.toStringAsFixed(0)}',
                style: GoogleFonts.poppins(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.w500)),
          ),
        ]),
        const SizedBox(height: 28),
        if (_weekLoading)
          Center(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: CircularProgressIndicator(
                color: JT.primary,
                strokeWidth: 2,
                backgroundColor: JT.border,
              ),
            ),
          )
        else if (_weekDays.isEmpty)
          Center(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Text('No weekly data',
                  style: GoogleFonts.poppins(color: JT.iconInactive, fontSize: 13)),
            ),
          )
        else
          SizedBox(
            height: 140,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: _weekDays.map((d) {
                final val = (d['gross'] as num).toDouble();
                final frac = val / maxWeek;
                final today = DateTime.now();
                final isToday =
                    d['date'] == today.toIso8601String().substring(0, 10);
                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 3),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        if (val > 0)
                          Text('₹${val.toInt()}',
                              style: GoogleFonts.poppins(
                                  color: isToday ? JT.primary : JT.textSecondary,
                                  fontSize: 8,
                                  fontWeight: FontWeight.w500)),
                        const SizedBox(height: 5),
                        Container(
                          height: (frac * 95).clamp(4.0, 95.0),
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: isToday
                                  ? [JT.secondary.withValues(alpha: 0.6), JT.primary]
                                  : [JT.border, JT.secondary.withValues(alpha: 0.4)],
                              begin: Alignment.bottomCenter,
                              end: Alignment.topCenter,
                            ),
                            borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
                            boxShadow: isToday ? JT.btnShadow : [],
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(d['day'] as String,
                            style: GoogleFonts.poppins(
                                color: isToday ? JT.primary : JT.textSecondary,
                                fontSize: 10,
                                fontWeight: isToday ? FontWeight.w400 : FontWeight.w500)),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
      ]),
    );
  }
}
