import 'dart:convert';
import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../services/auth_service.dart';

class ReferralScreen extends StatefulWidget {
  const ReferralScreen({super.key});
  @override
  State<ReferralScreen> createState() => _ReferralScreenState();
}

class _ReferralScreenState extends State<ReferralScreen> {
  bool _loading = true;
  String _code = '';
  int _totalReferrals = 0;
  double _totalEarned = 0;
  List<dynamic> _referrals = [];

  static const Color _blue = Color(0xFF2F7BFF);

  @override
  void initState() {
    super.initState();
    _fetchReferral();
  }

  Future<void> _fetchReferral() async {
    final headers = await AuthService.getHeaders();
    try {
      final res = await http.get(
        Uri.parse(ApiConfig.referral),
        headers: headers,
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (mounted) setState(() {
          _code = data['referralCode']?.toString() ?? '';
          _totalReferrals = int.tryParse(data['totalReferrals']?.toString() ?? '0') ?? 0;
          _totalEarned = double.tryParse(data['totalEarned']?.toString() ?? '0') ?? 0;
          _referrals = List<dynamic>.from(data['referrals'] ?? []);
          _loading = false;
        });
      } else {
        if (mounted) setState(() => _loading = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _copyCode() {
    if (_code.isEmpty) return;
    Clipboard.setData(ClipboardData(text: _code));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Referral code copied!'),
        backgroundColor: _blue,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }

  void _shareCode() {
    if (_code.isEmpty) return;
    final shareText = 'Jago download చేయండి! నా referral code: $_code\n'
        'Download: https://jagopro.org/download';
    Clipboard.setData(ClipboardData(text: shareText));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Share text copied to clipboard!'),
        backgroundColor: Colors.green,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    
    final bg = JT.bgSoft;
    final cardBg = Colors.white;
    final textColor = JT.textPrimary;
    final subColor = JT.textSecondary;

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        backgroundColor: _blue,
        foregroundColor: Colors.white,
        title: const Text('Refer & Earn', style: TextStyle(fontWeight: FontWeight.w500)),
        elevation: 0,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: JT.primary))
          : RefreshIndicator(
              onRefresh: _fetchReferral,
              color: _blue,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Hero banner
                    Container(
                      width: double.infinity,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [JT.primary, Color(0xFF0052CC)],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        children: [
                          const Icon(Icons.card_giftcard_rounded, color: Colors.white, size: 50),
                          const SizedBox(height: 12),
                          const Text('Friends కి Jago చెప్పండి!',
                              style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w500)),
                          const SizedBox(height: 6),
                          const Text(
                            'ప్రతి successful referral కి మీకు reward లభిస్తుంది',
                            style: TextStyle(color: Colors.white70, fontSize: 13),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 20),
                          // Referral code box
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Colors.white30),
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  _code.isEmpty ? '—' : _code,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 22,
                                    fontWeight: FontWeight.w500,
                                    letterSpacing: 3,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                GestureDetector(
                                  onTap: _copyCode,
                                  child: const Icon(Icons.copy_rounded, color: Colors.white70, size: 22),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 16),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: _copyCode,
                                  icon: const Icon(Icons.copy, size: 16),
                                  label: const Text('Copy Code'),
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: Colors.white,
                                    side: const BorderSide(color: Colors.white60),
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: ElevatedButton.icon(
                                  onPressed: _shareCode,
                                  icon: const Icon(Icons.share, size: 16),
                                  label: const Text('Share'),
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: Colors.white,
                                    foregroundColor: _blue,
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Stats row
                    Row(
                      children: [
                        Expanded(child: _statCard('Total Referrals', '$_totalReferrals', Icons.people_alt_rounded, Colors.purple, cardBg, textColor, subColor)),
                        const SizedBox(width: 12),
                        Expanded(child: _statCard('Total Earned', '₹${_totalEarned.toStringAsFixed(0)}', Icons.currency_rupee_rounded, Colors.green, cardBg, textColor, subColor)),
                      ],
                    ),
                    const SizedBox(height: 20),

                    // How it works
                    Text('ఎలా పని చేస్తుంది?', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: textColor)),
                    const SizedBox(height: 12),
                    Container(
                      decoration: BoxDecoration(color: cardBg, borderRadius: BorderRadius.circular(16)),
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          _howStep('1', 'మీ referral code share చేయండి', Icons.share_rounded, _blue),
                          _dividerLine(cardBg),
                          _howStep('2', 'Friend Jago download చేసి signup చేయాలి', Icons.person_add_alt_1_rounded, Colors.purple),
                          _dividerLine(cardBg),
                          _howStep('3', 'First trip complete అవగానే reward!', Icons.star_rounded, Colors.amber),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),

                    // History
                    if (_referrals.isNotEmpty) ...[
                      Text('Referral History', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: textColor)),
                      const SizedBox(height: 12),
                      Container(
                        decoration: BoxDecoration(color: cardBg, borderRadius: BorderRadius.circular(16)),
                        child: ListView.separated(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          itemCount: _referrals.length,
                          separatorBuilder: (_, __) => Divider(height: 1, color: JT.border),
                          itemBuilder: (_, i) {
                            final r = _referrals[i] as Map<String, dynamic>;
                            final status = r['status']?.toString() ?? 'pending';
                            final amount = double.tryParse(r['reward_amount']?.toString() ?? '0') ?? 0;
                            final type = r['referral_type']?.toString() ?? 'customer';
                            Color statusColor = status == 'paid' ? Colors.green : status == 'expired' ? Colors.red : Colors.orange;
                            return ListTile(
                              leading: CircleAvatar(
                                backgroundColor: (type == 'driver' ? Colors.blue : Colors.purple).withValues(alpha: 0.1),
                                child: Icon(type == 'driver' ? Icons.drive_eta : Icons.person, color: type == 'driver' ? Colors.blue : Colors.purple, size: 20),
                              ),
                              title: Text(type == 'driver' ? 'Driver Referral' : 'Customer Referral',
                                  style: TextStyle(fontWeight: FontWeight.w400, color: textColor, fontSize: 14)),
                              subtitle: Text(status.toUpperCase(),
                                  style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.w500)),
                              trailing: Text('₹${amount.toStringAsFixed(0)}',
                                  style: TextStyle(color: amount > 0 ? Colors.green : subColor, fontWeight: FontWeight.w500, fontSize: 15)),
                            );
                          },
                        ),
                      ),
                    ],
                    const SizedBox(height: 40),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _statCard(String label, String value, IconData icon, Color color, Color cardBg, Color textColor, Color subColor) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: cardBg, borderRadius: BorderRadius.circular(16)),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w500, color: textColor)),
              Text(label, style: TextStyle(fontSize: 11, color: subColor)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _howStep(String num, String text, IconData icon, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          Container(
            width: 32, height: 32,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), shape: BoxShape.circle),
            child: Center(child: Text(num, style: TextStyle(color: color, fontWeight: FontWeight.w500, fontSize: 14))),
          ),
          const SizedBox(width: 14),
          Icon(icon, color: color, size: 22),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 13))),
        ],
      ),
    );
  }

  Widget _dividerLine(Color cardBg) => Container(
    margin: const EdgeInsets.only(left: 46),
    height: 1,
    color: Colors.grey.withValues(alpha: 0.15),
  );
}
