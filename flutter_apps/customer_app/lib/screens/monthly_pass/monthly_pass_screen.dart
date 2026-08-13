import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

class MonthlyPassScreen extends StatefulWidget {
  const MonthlyPassScreen({super.key});
  @override
  State<MonthlyPassScreen> createState() => _MonthlyPassScreenState();
}

class _MonthlyPassScreenState extends State<MonthlyPassScreen> {
  bool _loading = true;
  Map<String, dynamic>? _activePlan;
  List _plans = [];
  bool _buying = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse('${ApiConfig.baseUrl}/api/app/customer/monthly-pass'), headers: headers);
      if (res.statusCode == 200 && mounted) {
        final d = jsonDecode(res.body);
        setState(() {
          _activePlan = d['activePlan'];
          _plans = d['availablePlans'] ?? [];
        });
      }
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _buy(String planName) async {
    setState(() => _buying = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/customer/monthly-pass/buy'),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({'planName': planName}),
      );
      final body = jsonDecode(res.body);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(body['message'] ?? 'Failed'),
        backgroundColor: res.statusCode == 200 ? JT.success : JT.error,
        duration: const Duration(seconds: 4),
      ));
      if (res.statusCode == 200) _load();
    } catch (_) {}
    if (mounted) setState(() => _buying = false);
  }

  @override
  Widget build(BuildContext context) {
    final planColors = [JT.primary, const Color(0xFF7C3AED), JT.error];

    return Scaffold(
      backgroundColor: JT.surfaceAlt,
      appBar: AppBar(
        backgroundColor: JT.bg,
        foregroundColor: JT.textPrimary,
        elevation: 0,
        title: Text('Monthly Pass', style: JT.h4),
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: JT.primary))
          : SingleChildScrollView(
              padding: EdgeInsets.all(JT.spacing16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Active plan
                  if (_activePlan != null) ...[
                    Container(
                      padding: EdgeInsets.all(JT.spacing20),
                      decoration: BoxDecoration(
                        gradient: JT.grad,
                        borderRadius: BorderRadius.circular(JT.radiusLg),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(children: [
                            Icon(Icons.verified, color: JT.warning),
                            SizedBox(width: JT.spacing8),
                            Text(_activePlan!['planName'] ?? '', style: JT.h4.copyWith(color: Colors.white)),
                          ]),
                          SizedBox(height: JT.spacing12),
                          Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
                            _statBox('Rides Used', '${_activePlan!['ridesUsed']}'),
                            _statBox('Remaining', '${(_activePlan!['ridesTotal'] ?? 0) - (_activePlan!['ridesUsed'] ?? 0)}'),
                            _statBox('Days Left', _daysLeft()),
                          ]),
                          SizedBox(height: JT.spacing12),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(JT.radiusSm),
                            child: LinearProgressIndicator(
                              value: ((_activePlan!['ridesUsed'] ?? 0) / (_activePlan!['ridesTotal'] ?? 30)).clamp(0.0, 1.0),
                              backgroundColor: Colors.white.withValues(alpha: 0.3),
                              valueColor: AlwaysStoppedAnimation(JT.warning),
                              minHeight: 8,
                            ),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(height: JT.spacing16),
                  ],
                  // Header
                  Container(
                    padding: EdgeInsets.all(JT.spacing16),
                    decoration: BoxDecoration(color: JT.warningLight, borderRadius: BorderRadius.circular(JT.radiusMd), border: Border.all(color: JT.warning.withValues(alpha: 0.3))),
                    child: Row(children: [
                      Icon(Icons.info_outline, color: JT.warning),
                      SizedBox(width: JT.spacing8),
                      Expanded(child: Text('Save up to 35% on rides with Monthly Pass!\nBonus Jago Coins on every purchase.',
                          style: JT.smallText)),
                    ]),
                  ),
                  SizedBox(height: JT.spacing16),
                  Text('Choose Your Plan', style: JT.h4),
                  SizedBox(height: JT.spacing12),
                  ..._plans.asMap().entries.map((e) {
                    final p = e.value;
                    final color = planColors[e.key % planColors.length];
                    return Container(
                      margin: EdgeInsets.only(bottom: JT.spacing12),
                      decoration: BoxDecoration(
                        color: JT.bg,
                        borderRadius: BorderRadius.circular(JT.radiusLg),
                        border: Border.all(color: color.withValues(alpha: 0.3)),
                        boxShadow: [BoxShadow(color: color.withValues(alpha: 0.08), blurRadius: 12)],
                      ),
                      child: Padding(
                        padding: EdgeInsets.all(JT.spacing16),
                        child: Row(children: [
                          Expanded(child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(children: [
                                Icon(Icons.confirmation_number_outlined, color: color, size: 20),
                                SizedBox(width: JT.spacing6),
                                Text(p['name'], style: JT.h5.copyWith(color: color)),
                              ]),
                              SizedBox(height: JT.spacing4),
                              Text('${p['rides']} rides for 30 days', style: JT.smallText),
                              SizedBox(height: JT.spacing4),
                              Container(
                                padding: EdgeInsets.symmetric(horizontal: JT.spacing8, vertical: 3),
                                decoration: BoxDecoration(color: JT.successLight, borderRadius: BorderRadius.circular(JT.spacing6)),
                                child: Text('Save ${p['discount']}', style: JT.caption.copyWith(color: JT.success, fontWeight: FontWeight.w500)),
                              ),
                            ],
                          )),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text('₹${p['price']}', style: JT.h3.copyWith(color: color)),
                              SizedBox(height: JT.spacing8),
                              ElevatedButton(
                                onPressed: _buying ? null : () => _buy(p['name']),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: color,
                                  foregroundColor: Colors.white,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(JT.radiusSm + 2)),
                                  padding: EdgeInsets.symmetric(horizontal: JT.spacing16, vertical: JT.spacing8 + 2),
                                ),
                                child: _buying ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Buy'),
                              ),
                            ],
                          ),
                        ]),
                      ),
                    );
                  }),
                  SizedBox(height: JT.spacing16),
                  Container(
                    padding: EdgeInsets.all(JT.spacing16),
                    decoration: BoxDecoration(color: JT.bgSoft, borderRadius: BorderRadius.circular(JT.radiusMd)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Pass Terms', style: JT.subtitle1),
                        SizedBox(height: JT.spacing8),
                        Text('• Payment via Jago Wallet balance\n• Pass valid for 30 days from purchase\n• Rides within city limits only\n• Non-refundable after first ride\n• Bonus Jago Coins credited instantly', style: JT.caption.copyWith(height: 1.8)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _statBox(String label, String val) => Column(children: [
    Text(val, style: JT.h3.copyWith(color: Colors.white)),
    Text(label, style: JT.caption.copyWith(color: Colors.white70)),
  ]);

  String _daysLeft() {
    if (_activePlan?['validUntil'] == null) return '0';
    try {
      final d = DateTime.parse(_activePlan!['validUntil']);
      final diff = d.difference(DateTime.now()).inDays;
      return '$diff';
    } catch (_) { return '?'; }
  }
}
