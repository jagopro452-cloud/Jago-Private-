import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../services/auth_service.dart';

class SpinWheelScreen extends StatefulWidget {
  const SpinWheelScreen({super.key});
  @override
  State<SpinWheelScreen> createState() => _SpinWheelScreenState();
}

class _SpinWheelScreenState extends State<SpinWheelScreen>
    with SingleTickerProviderStateMixin {
  static const _blue = JT.primary;

  bool _loading = true;
  bool _spinning = false;
  bool _canSpin = true;
  List<dynamic> _items = [];
  Map<String, dynamic>? _result;

  late AnimationController _controller;
  late Animation<double> _animation;
  int _selectedIndex = 0;

  // Wheel colors
  final List<Color> _colors = [
    const Color(0xFF1565C0), const Color(0xFF0D47A1), const Color(0xFF1976D2),
    const Color(0xFF2196F3), const Color(0xFF42A5F5), const Color(0xFF1E88E5),
    const Color(0xFF0288D1), const Color(0xFF039BE5),
  ];

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(seconds: 4));
    _animation = CurvedAnimation(parent: _controller, curve: Curves.decelerate);
    _controller.addListener(() { setState(() {}); });
    _controller.addStatusListener((s) {
      if (s == AnimationStatus.completed) {
        setState(() => _spinning = false);
        if (_result != null) _showResult();
      }
    });
    _load();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/api/app/customer/spin-wheel'),
        headers: headers,
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (mounted) setState(() {
          _items = data['items'] ?? _defaultItems();
          _canSpin = data['canSpin'] ?? true;
          _loading = false;
        });
      } else {
        if (mounted) setState(() { _items = _defaultItems(); _loading = false; });
      }
    } catch (_) {
      if (mounted) setState(() { _items = _defaultItems(); _loading = false; });
    }
  }

  List<Map<String, dynamic>> _defaultItems() => [
    {'label': '50 Coins', 'reward_type': 'coins', 'reward_amount': 50},
    {'label': '₹10 Wallet', 'reward_type': 'wallet', 'reward_amount': 10},
    {'label': '100 Coins', 'reward_type': 'coins', 'reward_amount': 100},
    {'label': 'Try Again', 'reward_type': 'none', 'reward_amount': 0},
    {'label': '₹20 Wallet', 'reward_type': 'wallet', 'reward_amount': 20},
    {'label': '200 Coins', 'reward_type': 'coins', 'reward_amount': 200},
    {'label': '₹5 Wallet', 'reward_type': 'wallet', 'reward_amount': 5},
    {'label': 'Lucky!', 'reward_type': 'coins', 'reward_amount': 500},
  ];

  Future<void> _play() async {
    if (_spinning || !_canSpin || _items.isEmpty) return;
    setState(() { _spinning = true; _result = null; });

    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/customer/spin-wheel/play'),
        headers: headers,
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200) {
        _result = data['item'];
        _selectedIndex = _items.indexWhere(
          (it) => it['label'] == data['item']['label']);
        if (_selectedIndex < 0) _selectedIndex = 0;
      } else {
        if (mounted) {
          setState(() => _spinning = false);
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(data['message'] ?? 'Try again tomorrow!'),
            backgroundColor: Colors.orange,
          ));
          return;
        }
      }
    } catch (_) {
      if (mounted) setState(() => _spinning = false);
      return;
    }

    // Calculate final angle to land on selected item
    final sectorAngle = 2 * pi / _items.length;
    final targetAngle = 2 * pi - (_selectedIndex * sectorAngle) + (sectorAngle / 2);
    final spins = 5 + (targetAngle / (2 * pi));
    final totalAngle = spins * 2 * pi + targetAngle;

    _animation = Tween<double>(begin: 0, end: totalAngle).animate(
      CurvedAnimation(parent: _controller, curve: Curves.decelerate));
    _controller.reset();
    _controller.forward();
  }

  void _showResult() {
    if (_result == null) return;
    final rewardType = _result!['reward_type'] ?? 'none';
    final rewardAmount = _result!['reward_amount'];
    final label = _result!['label'] ?? 'Better luck next time!';

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('🎉', style: TextStyle(fontSize: 52)),
          const SizedBox(height: 8),
          const Text('Congratulations!', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w500)),
          const SizedBox(height: 8),
          Text(label,
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w500, color: _blue)),
          const SizedBox(height: 8),
          Text(
            rewardType == 'coins'
              ? '${rewardAmount?.toInt() ?? 0} Jago Coins meeru wallet ki add chesamu!'
              : rewardType == 'wallet'
                ? '₹${rewardAmount ?? 0} meeru Jago Wallet ki add chesamu!'
                : 'Better luck next time!',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.grey, fontSize: 13),
          ),
        ]),
        actions: [
          Center(
            child: ElevatedButton(
              onPressed: () {
                Navigator.pop(context);
                setState(() { _canSpin = false; });
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: _blue, foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 12),
              ),
              child: const Text('Awesome!', style: TextStyle(fontWeight: FontWeight.w500)),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.textPrimary,
      appBar: AppBar(
        backgroundColor: JT.textPrimary,
        foregroundColor: Colors.white,
        title: const Text('Daily Spin', style: TextStyle(fontWeight: FontWeight.w500)),
        elevation: 0,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: _blue))
          : _buildBody(),
    );
  }

  Widget _buildBody() {
    final size = MediaQuery.of(context).size.width * 0.82;
    return SingleChildScrollView(
      child: Column(children: [
        const SizedBox(height: 16),
        // Stars header
        const Text('⭐ Daily Spin & Win ⭐',
          style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w500)),
        const SizedBox(height: 6),
        const Text('Coins, Wallet Cash win cheyyavachu!',
          style: TextStyle(color: Colors.grey, fontSize: 13)),
        const SizedBox(height: 32),

        // Arrow indicator
        const Icon(Icons.arrow_drop_down, color: Colors.amber, size: 40),

        // Spin Wheel
        SizedBox(
          width: size, height: size,
          child: AnimatedBuilder(
            animation: _controller,
            builder: (ctx, _) {
              return Transform.rotate(
                angle: _animation.value,
                child: CustomPaint(
                  painter: _WheelPainter(_items, _colors),
                  child: const SizedBox.expand(),
                ),
              );
            },
          ),
        ),

        const SizedBox(height: 32),

        // Spin button
        if (_canSpin)
          GestureDetector(
            onTap: _spinning ? null : _play,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              width: 160, height: 56,
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [JT.primary, Color(0xFF56CCF2)]),
                borderRadius: BorderRadius.circular(28),
                boxShadow: [BoxShadow(color: _blue.withValues(alpha: 0.4), blurRadius: 20, spreadRadius: 2)],
              ),
              child: Center(
                child: _spinning
                  ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                  : const Text('SPIN NOW!', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w500, letterSpacing: 1.2)),
              ),
            ),
          )
        else
          Column(children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(16),
              ),
              child: const Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(Icons.timer_outlined, color: Colors.amber, size: 20),
                SizedBox(width: 8),
                Text('Today already played!', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w400)),
              ]),
            ),
            const SizedBox(height: 8),
            const Text('Roju okasari spin cheyavachu. Reppati kagi wait cheyyandi!',
              style: TextStyle(color: Colors.grey, fontSize: 12)),
          ]),

        const SizedBox(height: 32),

        // How it works
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 24),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.05),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Ela Ga?', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 15)),
            const SizedBox(height: 10),
            for (final tip in [
              '🎯 Roju okasari spin free ga available',
              '🪙 Jago Coins win cheste wallet ki credit avutayi',
              '💰 Wallet cash win cheste instantly add avutundi',
              '⭐ More rides → more daily rewards!',
            ])
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(tip, style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ),
          ]),
        ),
        const SizedBox(height: 40),
      ]),
    );
  }
}

class _WheelPainter extends CustomPainter {
  final List<dynamic> items;
  final List<Color> colors;

  _WheelPainter(this.items, this.colors);

  @override
  void paint(Canvas canvas, Size size) {
    if (items.isEmpty) return;
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2;
    final sectorAngle = 2 * pi / items.length;
    final textPainter = TextPainter(textDirection: TextDirection.ltr);

    for (int i = 0; i < items.length; i++) {
      final startAngle = i * sectorAngle - pi / 2;
      final color = colors[i % colors.length];

      // Draw sector
      final paint = Paint()..color = color..style = PaintingStyle.fill;
      canvas.drawArc(Rect.fromCircle(center: center, radius: radius),
        startAngle, sectorAngle, true, paint);

      // Draw border
      final borderPaint = Paint()
        ..color = Colors.white.withValues(alpha: 0.15)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5;
      canvas.drawArc(Rect.fromCircle(center: center, radius: radius),
        startAngle, sectorAngle, true, borderPaint);

      // Draw label
      final mid = startAngle + sectorAngle / 2;
      final textRadius = radius * 0.65;
      final tx = center.dx + textRadius * cos(mid);
      final ty = center.dy + textRadius * sin(mid);

      canvas.save();
      canvas.translate(tx, ty);
      canvas.rotate(mid + pi / 2);

      final label = (items[i]['label'] ?? '').toString();
      textPainter.text = TextSpan(
        text: label,
        style: TextStyle(
          color: Colors.white,
          fontSize: label.length > 8 ? 9 : 11,
          fontWeight: FontWeight.w500,
        ),
      );
      textPainter.layout(minWidth: 0, maxWidth: radius * 0.5);
      textPainter.paint(canvas, Offset(-textPainter.width / 2, -textPainter.height / 2));
      canvas.restore();
    }

    // Center circle
    canvas.drawCircle(center, radius * 0.12,
      Paint()..color = Colors.white..style = PaintingStyle.fill);
    canvas.drawCircle(center, radius * 0.12,
      Paint()..color = const Color(0xFF1565C0)..style = PaintingStyle.stroke..strokeWidth = 3);
  }

  @override
  bool shouldRepaint(_WheelPainter old) => true;
}
