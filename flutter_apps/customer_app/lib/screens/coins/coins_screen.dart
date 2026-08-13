import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

class CoinsScreen extends StatefulWidget {
  const CoinsScreen({super.key});
  @override
  State<CoinsScreen> createState() => _CoinsScreenState();
}

class _CoinsScreenState extends State<CoinsScreen> {
  bool _loading = true;
  Map<String, dynamic> _data = {};
  bool _redeeming = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse('${ApiConfig.baseUrl}/api/app/customer/coins'), headers: headers);
      if (res.statusCode == 200 && mounted) setState(() => _data = jsonDecode(res.body));
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _redeem(int coins) async {
    setState(() => _redeeming = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/customer/redeem-coins'),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({'coins': coins}),
      );
      final body = jsonDecode(res.body);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(body['message'] ?? (res.statusCode == 200 ? 'Success!' : 'Failed')),
        backgroundColor: res.statusCode == 200 ? JT.success : JT.error,
      ));
      if (res.statusCode == 200) _load();
    } catch (_) {}
    if (mounted) setState(() => _redeeming = false);
  }

  @override
  Widget build(BuildContext context) {
    final balance = _data['balance'] ?? 0;
    final rupeeValue = _data['rupeeValue'] ?? 0;
    final history = (_data['history'] as List?) ?? [];
    final tips = (_data['howItWorks'] as List?) ?? [];

    return Scaffold(
      backgroundColor: JT.surfaceAlt,
      appBar: AppBar(
        backgroundColor: JT.bg,
        foregroundColor: JT.textPrimary,
        elevation: 0,
        title: Row(children: [
          Container(
            padding: EdgeInsets.all(JT.spacing6),
            decoration: BoxDecoration(color: JT.primary.withValues(alpha: 0.1), shape: BoxShape.circle),
            child: Icon(Icons.monetization_on, color: JT.primary, size: 20),
          ),
          SizedBox(width: JT.spacing8),
          Text('Jago Coins', style: JT.h4),
        ]),
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: JT.primary))
          : SingleChildScrollView(
              padding: EdgeInsets.all(JT.spacing16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Balance card
                  Container(
                    width: double.infinity,
                    padding: EdgeInsets.all(JT.spacing24),
                    decoration: BoxDecoration(
                      gradient: JT.grad,
                      borderRadius: BorderRadius.circular(JT.radiusXl),
                    ),
                    child: Column(
                      children: [
                        Icon(Icons.stars_rounded, color: JT.warning, size: 48),
                        SizedBox(height: JT.spacing8),
                        Text('$balance', style: JT.h1.copyWith(color: Colors.white, fontSize: 52)),
                        Text('Jago Coins', style: JT.h5.copyWith(color: Colors.white70)),
                        SizedBox(height: JT.spacing8),
                        Container(
                          padding: EdgeInsets.symmetric(horizontal: JT.spacing16, vertical: JT.spacing6),
                          decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(JT.radiusXl)),
                          child: Text('= ₹$rupeeValue cashback', style: JT.subtitle1.copyWith(color: Colors.white)),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: JT.spacing16),
                  // Redeem section
                  if (balance >= 100) ...[
                    Container(
                      padding: EdgeInsets.all(JT.spacing16),
                      decoration: JT.cardStyle,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Redeem Coins', style: JT.h5),
                          SizedBox(height: JT.spacing12),
                          Row(
                            children: [100, 200, 500].where((v) => v <= balance).map((v) => Expanded(
                              child: Padding(
                                padding: EdgeInsets.symmetric(horizontal: JT.spacing4),
                                child: ElevatedButton(
                                  onPressed: _redeeming ? null : () => _redeem(v),
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: JT.primary,
                                    foregroundColor: Colors.white,
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(JT.radiusSm + 2)),
                                    padding: EdgeInsets.symmetric(vertical: JT.spacing12),
                                  ),
                                  child: Column(
                                    children: [
                                      Text('$v coins', style: JT.caption.copyWith(color: Colors.white)),
                                      Text('= ₹${v ~/ 10}', style: JT.subtitle2.copyWith(color: Colors.white)),
                                    ],
                                  ),
                                ),
                              ),
                            )).toList(),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(height: JT.spacing16),
                  ],
                  // How it works
                  Container(
                    padding: EdgeInsets.all(JT.spacing16),
                    decoration: BoxDecoration(color: JT.bg, borderRadius: BorderRadius.circular(JT.radiusLg)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('How Jago Coins work', style: JT.h5),
                        SizedBox(height: JT.spacing12),
                        ...tips.map((t) => Padding(
                          padding: EdgeInsets.only(bottom: JT.spacing8),
                          child: Row(children: [
                            Icon(Icons.check_circle, color: JT.primary, size: 18),
                            SizedBox(width: JT.spacing8),
                            Expanded(child: Text(t.toString(), style: JT.smallText)),
                          ]),
                        )),
                      ],
                    ),
                  ),
                  SizedBox(height: JT.spacing16),
                  // History
                  if (history.isNotEmpty) ...[
                    Text('Transaction History', style: JT.h5),
                    SizedBox(height: JT.spacing8),
                    ...history.take(20).map((h) {
                      final amt = (h['amount'] as num?) ?? 0;
                      final isPositive = amt > 0;
                      return Container(
                        margin: EdgeInsets.only(bottom: JT.spacing8),
                        padding: EdgeInsets.all(JT.spacing12),
                        decoration: BoxDecoration(color: JT.bg, borderRadius: BorderRadius.circular(JT.radiusMd)),
                        child: Row(children: [
                          Container(
                            padding: EdgeInsets.all(JT.spacing8),
                            decoration: BoxDecoration(
                              color: (isPositive ? JT.success : JT.error).withValues(alpha: 0.1),
                              shape: BoxShape.circle,
                            ),
                            child: Icon(isPositive ? Icons.add : Icons.remove,
                                color: isPositive ? JT.success : JT.error, size: 16),
                          ),
                          SizedBox(width: JT.spacing12),
                          Expanded(child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(h['description'] ?? h['type'] ?? '', style: JT.smallText),
                              Text(h['createdAt']?.toString().substring(0, 10) ?? '',
                                  style: JT.caption),
                            ],
                          )),
                          Text(
                            '${isPositive ? '+' : ''}$amt coins',
                            style: JT.subtitle1.copyWith(
                              color: isPositive ? JT.success : JT.error,
                            ),
                          ),
                        ]),
                      );
                    }),
                  ],
                ],
              ),
            ),
    );
  }
}
