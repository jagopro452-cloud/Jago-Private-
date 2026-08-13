import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

class OffersScreen extends StatefulWidget {
  const OffersScreen({super.key});

  @override
  State<OffersScreen> createState() => _OffersScreenState();
}

class _OffersScreenState extends State<OffersScreen> {
  List<dynamic> _offers = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final response =
          await http.get(Uri.parse(ApiConfig.customerOffers), headers: headers);
      if (!mounted) return;
      if (response.statusCode == 200) {
        setState(() {
          _offers = jsonDecode(response.body) as List<dynamic>;
          _loading = false;
        });
      } else {
        setState(() => _loading = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool _isPercent(String? type) =>
      type == 'percentage' || type == 'percent';

  Color _accentFor(String? type) =>
      _isPercent(type) ? const Color(0xFF7C3AED) : const Color(0xFF0F9F73);

  LinearGradient _heroGradient(String? type) => _isPercent(type)
      ? const LinearGradient(
          colors: [Color(0xFF8B5CF6), Color(0xFF5B21B6)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        )
      : const LinearGradient(
          colors: [Color(0xFF0F9F73), Color(0xFF0B6B57)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        );

  IconData _iconFor(String? type) =>
      _isPercent(type) ? Icons.percent_rounded : Icons.sell_rounded;

  String _discountLabel(dynamic offer) {
    final type = offer['discountType']?.toString();
    final raw =
        (offer['discountValue'] ?? offer['discountAmount'])?.toString() ?? '0';
    final val = double.tryParse(raw) ?? 0;
    if (_isPercent(type)) return '${val.toStringAsFixed(val % 1 == 0 ? 0 : 1)}% OFF';
    return 'Rs.${val.toStringAsFixed(val % 1 == 0 ? 0 : 1)} OFF';
  }

  String _formatMoney(dynamic raw) {
    final value = double.tryParse(raw?.toString() ?? '0') ?? 0;
    return 'Rs.${value.toStringAsFixed(value % 1 == 0 ? 0 : 1)}';
  }

  void _copyCode(String code) {
    Clipboard.setData(ClipboardData(text: code));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Coupon code "$code" copied', style: JT.body.copyWith(color: Colors.white)),
        backgroundColor: JT.success,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4F8FF),
      appBar: AppBar(
        elevation: 0,
        backgroundColor: const Color(0xFFF4F8FF),
        surfaceTintColor: Colors.transparent,
        leading: IconButton(
          onPressed: () => Navigator.pop(context),
          icon: const Icon(Icons.arrow_back_ios_rounded,
              size: 20, color: JT.textPrimary),
        ),
        title: Text('Offers & Coupons', style: JT.h4),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: JT.primary))
          : RefreshIndicator(
              onRefresh: _load,
              color: JT.primary,
              child: _offers.isEmpty
                  ? ListView(children: [_buildEmptyState()])
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                      itemCount: _offers.length + 2,
                      itemBuilder: (context, index) {
                        if (index == 0) return _buildHeroBanner();
                        if (index == 1) return const SizedBox(height: 18);
                        return _buildOfferCard(_offers[index - 2]);
                      },
                    ),
            ),
    );
  }

  Widget _buildHeroBanner() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF0F172A), Color(0xFF1D4ED8)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(28),
        boxShadow: [
          BoxShadow(
            color: JT.primary.withValues(alpha: 0.22),
            blurRadius: 26,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.15),
                  ),
                ),
                child: const Icon(Icons.local_offer_rounded,
                    color: Color(0xFFF8C84A), size: 28),
              ),
              const Spacer(),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.14),
                  ),
                ),
                child: Text(
                  '${_offers.length} Active',
                  style: JT.smallText.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Text(
            'Save more on every ride',
            style: JT.h3.copyWith(color: Colors.white, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Text(
            'Copy a coupon here and paste it on the booking page before you confirm your trip.',
            style: JT.body.copyWith(
              color: Colors.white.withValues(alpha: 0.82),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOfferCard(dynamic offer) {
    final name = offer['name']?.toString() ?? 'Special Offer';
    final code = (offer['code'] ?? offer['couponCode'])?.toString() ?? '';
    final type = offer['discountType']?.toString();
    final minAmount = double.tryParse(
          (offer['minTripAmount'] ?? offer['min_trip_amount'])?.toString() ?? '0',
        ) ??
        0;
    final maxDiscount = double.tryParse(
      (offer['maxDiscountAmount'] ?? offer['maxDiscount'])?.toString() ?? '0',
    );
    final expiry = (offer['endDate'] ?? offer['expiryDate'])?.toString();
    final accent = _accentFor(type);
    final heroGradient = _heroGradient(type);

    final expiryMeta = _expiryMeta(expiry);

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(26),
        boxShadow: JT.shadowMd,
      ),
      child: Column(
        children: [
          Container(
            decoration: BoxDecoration(
              gradient: heroGradient,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(26)),
            ),
            padding: const EdgeInsets.all(18),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 58,
                  height: 58,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.16),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.16),
                    ),
                  ),
                  child: Icon(_iconFor(type), color: Colors.white, size: 30),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: JT.h5.copyWith(
                          color: Colors.white,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _discountLabel(offer),
                        style: JT.body.copyWith(
                          color: Colors.white.withValues(alpha: 0.9),
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (minAmount > 0)
                      _metaChip(
                        icon: Icons.payments_outlined,
                        label: 'Min ${_formatMoney(minAmount)}',
                        bg: JT.primaryLight,
                        fg: JT.primaryDark,
                      ),
                    if (maxDiscount != null && maxDiscount > 0)
                      _metaChip(
                        icon: Icons.shield_outlined,
                        label: 'Max ${_formatMoney(maxDiscount)}',
                        bg: const Color(0xFFFFF3E8),
                        fg: const Color(0xFFC26A18),
                      ),
                    _metaChip(
                      icon: expiryMeta.icon,
                      label: expiryMeta.label,
                      bg: expiryMeta.bg,
                      fg: expiryMeta.fg,
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FBFF),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(
                      color: accent.withValues(alpha: 0.18),
                    ),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Coupon Code',
                              style: JT.caption.copyWith(
                                color: JT.textSecondary,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              code,
                              style: JT.h5.copyWith(
                                color: accent,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 1.1,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      ElevatedButton.icon(
                        onPressed: () => _copyCode(code),
                        icon: const Icon(Icons.copy_rounded, size: 16),
                        label: const Text('Copy'),
                        style: ElevatedButton.styleFrom(
                          elevation: 0,
                          foregroundColor: Colors.white,
                          backgroundColor: accent,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 12,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _metaChip({
    required IconData icon,
    required String label,
    required Color bg,
    required Color fg,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: fg),
          const SizedBox(width: 6),
          Text(
            label,
            style: JT.captionBold.copyWith(
              color: fg,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  _ExpiryMeta _expiryMeta(String? expiry) {
    if (expiry == null || expiry.isEmpty) {
      return const _ExpiryMeta(
        label: 'No expiry',
        icon: Icons.event_available_rounded,
        bg: Color(0xFFEEF9F3),
        fg: Color(0xFF0F9F73),
      );
    }

    try {
      final dt = DateTime.parse(expiry);
      final now = DateTime.now();
      final days = dt.difference(now).inDays;

      if (days < 0) {
        return const _ExpiryMeta(
          label: 'Expired',
          icon: Icons.event_busy_rounded,
          bg: Color(0xFFFEE2E2),
          fg: Color(0xFFDC2626),
        );
      }
      if (days == 0) {
        return const _ExpiryMeta(
          label: 'Expires today',
          icon: Icons.alarm_rounded,
          bg: Color(0xFFFFF1E6),
          fg: Color(0xFFEA580C),
        );
      }
      if (days == 1) {
        return const _ExpiryMeta(
          label: 'Expires tomorrow',
          icon: Icons.update_rounded,
          bg: Color(0xFFFFF1E6),
          fg: Color(0xFFEA580C),
        );
      }
      return _ExpiryMeta(
        label: 'Expires in $days days',
        icon: Icons.calendar_today_rounded,
        bg: const Color(0xFFEEF4FF),
        fg: JT.primaryDark,
      );
    } catch (_) {
      return const _ExpiryMeta(
        label: 'Expiry unknown',
        icon: Icons.help_outline_rounded,
        bg: Color(0xFFF3F4F6),
        fg: Color(0xFF6B7280),
      );
    }
  }

  Widget _buildEmptyState() {
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.72,
      child: Center(
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 20),
          padding: const EdgeInsets.all(28),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(28),
            boxShadow: JT.shadowMd,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 82,
                height: 82,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFFE8F2FF), Color(0xFFDDEBFF)],
                  ),
                  borderRadius: BorderRadius.circular(24),
                ),
                child: const Icon(
                  Icons.local_offer_outlined,
                  size: 42,
                  color: JT.primaryDark,
                ),
              ),
              const SizedBox(height: 18),
              Text(
                'No active offers right now',
                style: JT.h5.copyWith(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              Text(
                'New coupon campaigns vachinappudu ikkade premium ga chupistam. Konchem tarvata malli check cheyyandi.',
                textAlign: TextAlign.center,
                style: JT.body,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ExpiryMeta {
  final String label;
  final IconData icon;
  final Color bg;
  final Color fg;

  const _ExpiryMeta({
    required this.label,
    required this.icon,
    required this.bg,
    required this.fg,
  });
}
