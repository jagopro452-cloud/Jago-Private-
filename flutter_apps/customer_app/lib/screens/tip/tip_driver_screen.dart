import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

class TipDriverScreen extends StatefulWidget {
  final String tripId;
  final String driverName;
  const TipDriverScreen({super.key, required this.tripId, required this.driverName});
  @override
  State<TipDriverScreen> createState() => _TipDriverScreenState();
}

class _TipDriverScreenState extends State<TipDriverScreen> {
  int? _selectedTip;
  bool _sending = false;
  bool _done = false;
  String _doneMsg = '';

  final _tips = [10, 20, 30, 50];

  Future<void> _sendTip(int amount) async {
    setState(() => _sending = true);
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/tip-driver'),
        headers: headers,
        body: jsonEncode({'tripId': widget.tripId, 'amount': amount}),
      );
      if (!mounted) return;
      final body = jsonDecode(res.body);
      if (res.statusCode == 200) {
        setState(() { _done = true; _doneMsg = body['message'] ?? 'Tip sent!'; });
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(body['message'] ?? 'Failed'), backgroundColor: JT.error));
      }
    } catch (_) {}
    if (mounted) setState(() => _sending = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.surfaceAlt,
      appBar: AppBar(
        backgroundColor: JT.bg,
        foregroundColor: JT.textPrimary,
        elevation: 0,
        title: Text('Tip Your Driver', style: JT.h4),
      ),
      body: _done ? _doneScreen() : _tipScreen(),
    );
  }

  Widget _tipScreen() => Padding(
    padding: EdgeInsets.all(JT.spacing24),
    child: Column(
      children: [
        SizedBox(height: JT.spacing24),
        Container(
          padding: EdgeInsets.all(JT.spacing20),
          decoration: BoxDecoration(color: JT.bg, shape: BoxShape.circle,
            boxShadow: JT.shadowMd),
          child: Icon(Icons.person, size: 60, color: JT.primary),
        ),
        SizedBox(height: JT.spacing16),
        Text(widget.driverName, style: JT.h3),
        SizedBox(height: JT.spacing4),
        Text('Great service? Show your appreciation!', style: JT.body),
        SizedBox(height: JT.spacing32),
        Text('Select tip amount', style: JT.h5),
        SizedBox(height: JT.spacing16),
        Row(
          children: _tips.map((t) => Expanded(
            child: GestureDetector(
              onTap: () => setState(() => _selectedTip = t),
              child: Container(
                margin: EdgeInsets.symmetric(horizontal: JT.spacing4),
                padding: EdgeInsets.symmetric(vertical: JT.spacing16),
                decoration: BoxDecoration(
                  color: _selectedTip == t ? JT.primary : JT.bg,
                  borderRadius: BorderRadius.circular(JT.radiusMd + 2),
                  border: Border.all(color: _selectedTip == t ? JT.primary : JT.border),
                  boxShadow: JT.shadowXs,
                ),
                child: Column(
                  children: [
                    Text('₹$t', style: JT.h4.copyWith(
                        color: _selectedTip == t ? Colors.white : JT.textPrimary)),
                  ],
                ),
              ),
            ),
          )).toList(),
        ),
        SizedBox(height: JT.spacing12),
        Container(
          padding: EdgeInsets.all(JT.spacing12 + 2),
          decoration: BoxDecoration(color: JT.warningLight, borderRadius: BorderRadius.circular(JT.radiusMd), border: Border.all(color: JT.warning.withValues(alpha: 0.3))),
          child: Row(children: [
            Icon(Icons.stars, color: JT.warning, size: 18),
            SizedBox(width: JT.spacing8),
            Expanded(child: Text('You earn 10x Jago Coins for every rupee tipped!', style: JT.caption.copyWith(color: JT.warning))),
          ]),
        ),
        const Spacer(),
        if (_selectedTip != null)
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _sending ? null : () => _sendTip(_selectedTip!),
              style: ElevatedButton.styleFrom(
                backgroundColor: JT.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(JT.radiusMd + 2)),
                padding: EdgeInsets.symmetric(vertical: JT.spacing16),
              ),
              child: _sending
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text('Send ₹$_selectedTip Tip', style: JT.btnText),
            ),
          ),
        SizedBox(height: JT.spacing12),
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text('Skip', style: JT.body),
        ),
      ],
    ),
  );

  Widget _doneScreen() => Center(
    child: Padding(
      padding: EdgeInsets.all(JT.spacing32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: EdgeInsets.all(JT.spacing24),
            decoration: BoxDecoration(color: JT.successLight, shape: BoxShape.circle),
            child: Icon(Icons.favorite, color: JT.success, size: 64),
          ),
          SizedBox(height: JT.spacing24),
          Text('Tip Sent!', style: JT.h1.copyWith(color: JT.success)),
          SizedBox(height: JT.spacing12),
          Text(_doneMsg, textAlign: TextAlign.center, style: JT.subtitle2.copyWith(height: 1.5)),
          SizedBox(height: JT.spacing32),
          ElevatedButton(
            onPressed: () => Navigator.pop(context),
            style: ElevatedButton.styleFrom(
              backgroundColor: JT.primary,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(JT.radiusMd)),
              padding: EdgeInsets.symmetric(horizontal: JT.spacing40, vertical: JT.spacing12 + 2),
            ),
            child: Text('Done', style: JT.btnText),
          ),
        ],
      ),
    ),
  );
}
