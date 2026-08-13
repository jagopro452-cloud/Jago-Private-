import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'package:shimmer/shimmer.dart';
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../services/error_reporting.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});
  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen>
    with SingleTickerProviderStateMixin {
  Map<String, dynamic>? _wallet;
  bool _loading = true;
  bool _paying = false;
  double? _pendingAmount;
  late AnimationController _headerCtrl;
  late Animation<double> _headerFade;

  late Razorpay _razorpay;

  @override
  void initState() {
    super.initState();
    _headerCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 700));
    _headerFade = CurvedAnimation(parent: _headerCtrl, curve: Curves.easeOut);

    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _handlePaymentSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _handlePaymentError);
    _razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, _handleExternalWallet);
    _fetchWallet();
  }

  @override
  void dispose() {
    _headerCtrl.dispose();
    _razorpay.clear();
    super.dispose();
  }

  Future<void> _fetchWallet() async {
    final headers = await AuthService.getHeaders();
    try {
      final res = await http.get(Uri.parse(ApiConfig.wallet), headers: headers);
      if (res.statusCode == 200) {
        if (mounted) {
          setState(() {
            _wallet = jsonDecode(res.body);
            _loading = false;
          });
          _headerCtrl.forward();
        }
      } else {
        if (mounted) setState(() => _loading = false);
      }
    } catch (e, st) {
      reportSilentFailure('WalletScreen._fetchWallet', e, st);
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _startRazorpayPayment(double amount) async {
    setState(() => _paying = true);
    _pendingAmount = amount;
    try {
      final headers = await AuthService.getHeaders();
      final profileData = await AuthService.getProfile();
      final res = await http.post(
        Uri.parse(ApiConfig.walletCreateOrder),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({'amount': amount}),
      );
      final body = jsonDecode(res.body);
      if (res.statusCode != 200) {
        if (mounted) setState(() => _paying = false);
        if (mounted) {
          _showSnack(
              body['message'] ?? 'Failed to create order', JT.primaryDark);
        }
        return;
      }
      final order = body['order'];
      final keyId = body['keyId'] as String;
      final phone = profileData?['phone'] ?? '';
      final email = profileData?['email'] ?? 'customer@jago.com';

      final options = {
        'key': keyId,
        'amount': (amount * 100).toInt(),
        'name': 'Jago Rides',
        'description': 'Wallet Recharge',
        'order_id': order['id'],
        'prefill': {'contact': '+91$phone', 'email': email},
        'theme': {'color': '#2F80ED'},
        'modal': {'confirm_close': true},
      };
      _razorpay.open(options);
    } catch (e) {
      if (mounted) setState(() => _paying = false);
      if (mounted)
        _showSnack('Network error. Please try again.', JT.primaryDark);
    }
  }

  void _handlePaymentSuccess(PaymentSuccessResponse response) async {
    if (mounted) setState(() => _paying = false);
    await _verifyWalletPayment(
      orderId: response.orderId,
      paymentId: response.paymentId,
      signature: response.signature,
      amount: _pendingAmount,
      attempt: 1,
    );
  }

  /// Verifies a wallet top-up with the server, retrying automatically on
  /// network/timeout failure (the money has already left the user's
  /// account/card via Razorpay at this point, so we exhaust retries before
  /// asking the user to contact support) and always keeping the Razorpay
  /// payment ID visible so a support conversation has something concrete to
  /// reconcile against.
  Future<void> _verifyWalletPayment({
    required String? orderId,
    required String? paymentId,
    required String? signature,
    required double? amount,
    required int attempt,
  }) async {
    const maxAttempts = 3;
    try {
      final headers = await AuthService.getHeaders();
      final res = await http
          .post(
            Uri.parse(ApiConfig.walletVerifyPayment),
            headers: {...headers, 'Content-Type': 'application/json'},
            body: jsonEncode({
              'razorpayOrderId': orderId,
              'razorpayPaymentId': paymentId,
              'razorpaySignature': signature,
              'amount': amount,
            }),
          )
          .timeout(const Duration(seconds: 10));
      final body = jsonDecode(res.body);
      if (!mounted) return;
      if (res.statusCode == 200) {
        _showSnack(
            body['message'] ?? '₹${amount?.toStringAsFixed(0)} added to wallet!',
            JT.primary);
        _fetchWallet();
        return;
      }
      // Server explicitly rejected verification (e.g. signature mismatch) -
      // retrying won't help, this is not a transient failure.
      _showSnack(body['message'] ?? 'Payment verification failed', JT.primaryDark);
    } catch (e, st) {
      reportSilentFailure('WalletScreen._verifyWalletPayment (attempt $attempt)', e, st);
      if (attempt < maxAttempts) {
        await Future.delayed(Duration(seconds: attempt * 2));
        if (!mounted) return;
        return _verifyWalletPayment(
          orderId: orderId,
          paymentId: paymentId,
          signature: signature,
          amount: amount,
          attempt: attempt + 1,
        );
      }
      if (!mounted) return;
      _showRetryableSnack(
        'Payment done (ref: ${paymentId ?? "unknown"}) but verification failed after $maxAttempts attempts.',
        onRetry: () => _verifyWalletPayment(
          orderId: orderId,
          paymentId: paymentId,
          signature: signature,
          amount: amount,
          attempt: 1,
        ),
      );
    }
  }

  void _showRetryableSnack(String message, {required VoidCallback onRetry}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: JT.primaryDark,
        duration: const Duration(seconds: 8),
        action: SnackBarAction(
          label: 'RETRY',
          textColor: Colors.white,
          onPressed: onRetry,
        ),
      ),
    );
  }

  void _handlePaymentError(PaymentFailureResponse response) {
    if (mounted) {
      setState(() => _paying = false);
      _showSnack(response.message ?? 'Payment failed. Please try again.',
          JT.primaryDark);
    }
  }

  void _handleExternalWallet(ExternalWalletResponse response) {
    if (mounted) {
      setState(() => _paying = false);
      _showSnack('External wallet: ${response.walletName}', JT.primary);
    }
  }

  void _showSnack(String msg, Color color) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content:
          Text(msg, style: GoogleFonts.poppins(fontWeight: FontWeight.w500)),
      backgroundColor: color,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ));
  }

  void _showAddMoneySheet() {
    double? selectedPreset;
    final customCtrl = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          padding: EdgeInsets.fromLTRB(24, 16, 24, MediaQuery.of(ctx).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                        color: const Color(0xFFE5E7EB), borderRadius: BorderRadius.circular(2)),
                  ),
                ),
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Add Money',
                        style: GoogleFonts.poppins(
                            fontSize: 20,
                            fontWeight: FontWeight.w600,
                            color: const Color(0xFF111827))),
                    IconButton(
                      icon: const Icon(Icons.close_rounded,
                          color: Color(0xFF9CA3AF)),
                      onPressed: () => Navigator.pop(ctx),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Row(children: [
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                        color: const Color(0xFFEEF2FF),
                        borderRadius: BorderRadius.circular(8)),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.verified_rounded,
                          color: Color(0xFF2D8CFF), size: 14),
                      const SizedBox(width: 5),
                      Text('Secured by Razorpay',
                          style: GoogleFonts.poppins(
                              fontSize: 11,
                              color: const Color(0xFF2D8CFF),
                              fontWeight: FontWeight.w400)),
                    ]),
                  ),
                ]),
                const SizedBox(height: 24),
                Text('Quick Add',
                    style: GoogleFonts.poppins(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: const Color(0xFF9CA3AF),
                        letterSpacing: 0.5)),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [100, 200, 500, 1000, 2000].map((amt) {
                    final sel = selectedPreset == amt.toDouble();
                    return GestureDetector(
                      onTap: () => setModalState(() {
                        selectedPreset = amt.toDouble();
                        customCtrl.text = amt.toString();
                      }),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 20, vertical: 11),
                        decoration: BoxDecoration(
                          color: sel ? const Color(0xFF7C3AED) : const Color(0xFFF9FAFB),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: sel ? const Color(0xFF7C3AED) : const Color(0xFFE5E7EB)),
                          boxShadow: sel ? [BoxShadow(color: const Color(0xFF7C3AED).withValues(alpha: 0.2), blurRadius: 10)] : [],
                        ),
                        child: Text('₹$amt',
                            style: GoogleFonts.poppins(
                                fontWeight: FontWeight.w500,
                                fontSize: 14,
                                color: sel
                                    ? Colors.white
                                    : const Color(0xFF374151))),
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 24),
                Text('Custom Amount',
                    style: GoogleFonts.poppins(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: const Color(0xFF9CA3AF),
                        letterSpacing: 0.5)),
                const SizedBox(height: 10),
                Container(
                  decoration: BoxDecoration(
                      color: const Color(0xFFF9FAFB),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFE5E7EB))),
                  child: Row(children: [
                    Padding(
                      padding: const EdgeInsets.only(left: 16),
                      child: Text('₹',
                          style: GoogleFonts.poppins(
                              fontSize: 20,
                              fontWeight: FontWeight.w500,
                              color: const Color(0xFF111827))),
                    ),
                    Expanded(
                      child: TextField(
                        controller: customCtrl,
                        keyboardType: TextInputType.number,
                        onChanged: (_) =>
                            setModalState(() => selectedPreset = null),
                        style: GoogleFonts.poppins(
                            fontSize: 16,
                            fontWeight: FontWeight.w500,
                            color: const Color(0xFF111827)),
                        decoration: InputDecoration(
                          hintText: 'Enter amount (min ₹10)',
                          hintStyle: GoogleFonts.poppins(
                              color: const Color(0xFF9CA3AF), fontSize: 14),
                          border: InputBorder.none,
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 16),
                        ),
                      ),
                    ),
                  ]),
                ),
                const SizedBox(height: 32),
                SizedBox(
                  width: double.infinity,
                  height: 56,
                  child: ElevatedButton(
                    onPressed: _paying
                        ? null
                        : () {
                            final raw = customCtrl.text.trim();
                            final amt = double.tryParse(raw);
                            if (amt == null || amt < 10) {
                              _showSnack(
                                  'Minimum amount is ₹10', const Color(0xFFEF4444));
                              return;
                            }
                            Navigator.pop(ctx);
                            _startRazorpayPayment(amt);
                          },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF7C3AED),
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16)),
                      elevation: 0,
                    ),
                    child: Text('Add Money',
                        style: GoogleFonts.poppins(
                            fontWeight: FontWeight.w600, fontSize: 16)),
                  ),
                ),
                const SizedBox(height: 8),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final balance = _wallet?['balance'] ?? _wallet?['walletBalance'] ?? 0;
    final balanceDouble = balance is num
        ? balance.toDouble()
        : double.tryParse(balance.toString()) ?? 0.0;
    final transactions = (_wallet?['transactions'] as List?) ??
        (_wallet?['history'] as List?) ??
        [];

    const Color lavenderBg = Color(0xFFF5F3FF); // Very soft lavender background

    return Scaffold(
      backgroundColor: lavenderBg,
      body: _loading
          ? _buildWalletSkeleton()
          : CustomScrollView(
              physics: const BouncingScrollPhysics(),
              slivers: [
                SliverToBoxAdapter(child: _buildHeader(balanceDouble)),
                SliverToBoxAdapter(child: _buildPaymentMethods()),
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 28, 24, 16),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Transaction History',
                          style: GoogleFonts.poppins(
                            fontWeight: FontWeight.w600,
                            fontSize: 18,
                            color: const Color(0xFF1F2937),
                          ),
                        ),
                        Text(
                          '${transactions.length} records',
                          style: GoogleFonts.poppins(
                            fontSize: 13,
                            color: const Color(0xFF9CA3AF),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (transactions.isEmpty)
                  SliverToBoxAdapter(child: _buildEmpty())
                else
                  SliverPadding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    sliver: SliverList(
                      delegate: SliverChildBuilderDelegate(
                        (_, i) => _buildTransactionItem(transactions[i]),
                        childCount: transactions.length,
                      ),
                    ),
                  ),
                const SliverToBoxAdapter(child: SizedBox(height: 40)),
              ],
            ),
    );
  }

  Widget _buildWalletSkeleton() {
    Widget box(double w, double h, {double r = 8}) => Container(
          width: w,
          height: h,
          decoration: BoxDecoration(
              color: Colors.white, borderRadius: BorderRadius.circular(r)),
        );
    return Shimmer.fromColors(
        baseColor: const Color(0xFFE5E7EB),
        highlightColor: const Color(0xFFF3F4F6),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            // Header balance card skeleton
            Container(
              height: 160,
              decoration: BoxDecoration(
                  color: Colors.white, borderRadius: BorderRadius.circular(20)),
            ),
            const SizedBox(height: 20),
            // Add money button skeleton
            box(double.infinity, 52, r: 14),
            const SizedBox(height: 24),
            // Transactions header
            box(160, 18, r: 6),
            const SizedBox(height: 16),
            // Transaction rows
            ...List.generate(
                5,
                (_) => Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Row(children: [
                        box(40, 40, r: 10),
                        const SizedBox(width: 12),
                        Expanded(
                            child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                              box(120, 13, r: 5),
                              const SizedBox(height: 6),
                              box(80, 11, r: 5),
                            ])),
                        box(60, 16, r: 6),
                      ]),
                    )),
          ]),
        ),
      );
    }

  Widget _buildHeader(double balance) {
    return FadeTransition(
      opacity: _headerFade,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
        child: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(2),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(36),
                boxShadow: [
                  BoxShadow(color: Colors.purple.withValues(alpha: 0.06), blurRadius: 20, offset: const Offset(0, 12)),
                ],
              ),
              child: Container(
                padding: const EdgeInsets.fromLTRB(28, 32, 28, 28),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(34),
                  border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFFEEF2FF),
                            borderRadius: BorderRadius.circular(16),
                          ),
                          child: const Icon(Icons.wallet_rounded, color: Color(0xFF2D8CFF), size: 24),
                        ),
                        const SizedBox(width: 14),
                        Text('My Wallet',
                            style: GoogleFonts.poppins(
                                color: const Color(0xFF111827),
                                fontSize: 18,
                                fontWeight: FontWeight.w600)),
                      ],
                    ),
                    const SizedBox(height: 32),
                    Text('₹${balance.toStringAsFixed(2)}',
                        style: GoogleFonts.poppins(
                            color: const Color(0xFF111827),
                            fontSize: 48,
                            fontWeight: FontWeight.w500,
                            letterSpacing: -1)),
                    const SizedBox(height: 4),
                    Text('Available Balance',
                        style: GoogleFonts.poppins(
                            color: const Color(0xFF6B7280), fontSize: 14, fontWeight: FontWeight.w400)),
                    const SizedBox(height: 36),
                    Container(
                      width: double.infinity,
                      height: 72,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(color: const Color(0xFFF1F5F9), width: 1),
                      ),
                      child: Center(
                        child: GestureDetector(
                          onTap: _paying ? null : _showAddMoneySheet,
                          child: Container(
                            width: 220,
                            height: 48,
                            decoration: BoxDecoration(
                              gradient: const LinearGradient(
                                colors: [Color(0xFF7C3AED), Color(0xFFA78BFA)],
                                begin: Alignment.centerLeft,
                                end: Alignment.centerRight,
                              ),
                              borderRadius: BorderRadius.circular(24),
                              boxShadow: [
                                BoxShadow(color: const Color(0xFF7C3AED).withValues(alpha: 0.3), blurRadius: 15, offset: const Offset(0, 6)),
                              ],
                            ),
                            child: _paying
                              ? const Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)))
                              : Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    const Icon(Icons.add_circle_rounded, color: Colors.white, size: 20),
                                    const SizedBox(width: 10),
                                    Text('Add Money',
                                        style: GoogleFonts.poppins(
                                            color: Colors.white,
                                            fontWeight: FontWeight.w600,
                                            fontSize: 16)),
                                  ],
                                ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPaymentMethods() {
    final methods = [
      { 'label': 'UPI', 'icon': Icons.qr_code_scanner_rounded, 'color': const Color(0xFF2D8CFF), 'bg': const Color(0xFFF0F7FF) },
      { 'label': 'Cards', 'icon': Icons.credit_card_rounded, 'color': const Color(0xFF7C3AED), 'bg': const Color(0xFFF5F3FF) },
      { 'label': 'Net Banking', 'icon': Icons.account_balance_rounded, 'color': const Color(0xFF10B981), 'bg': const Color(0xFFECFDF5) },
      { 'label': 'Wallets', 'icon': Icons.account_balance_wallet_rounded, 'color': const Color(0xFFF59E0B), 'bg': const Color(0xFFFFFBEB) },
    ];

    return Container(
      margin: const EdgeInsets.fromLTRB(20, 24, 20, 0),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(32),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 15, offset: const Offset(0, 8)),
        ],
        border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Payment Methods',
              style: GoogleFonts.poppins(
                  fontSize: 16, fontWeight: FontWeight.w600, color: const Color(0xFF1F2937))),
          const SizedBox(height: 2),
          Text('Powered by Razorpay — all methods accepted',
              style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF9CA3AF))),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: methods.map((m) {
              return Column(
                children: [
                  Container(
                    width: 64, height: 64,
                    decoration: BoxDecoration(
                      color: m['bg'] as Color,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Icon(m['icon'] as IconData, color: m['color'] as Color, size: 26),
                  ),
                  const SizedBox(height: 10),
                  Text(m['label'] as String,
                      style: GoogleFonts.poppins(fontSize: 12, fontWeight: FontWeight.w500, color: const Color(0xFF374151))),
                ],
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildEmpty() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(32),
        border: Border.all(color: const Color(0xFFF1F5F9), width: 1.5),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 140, height: 100,
            decoration: BoxDecoration(
              color: const Color(0xFFF5F3FF),
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Center(
              child: Icon(Icons.receipt_long_rounded, size: 48, color: Color(0xFF7C3AED)),
            ),
          ),
          const SizedBox(height: 24),
          Text('No transactions yet',
              style: GoogleFonts.poppins(
                  color: const Color(0xFF1F2937),
                  fontSize: 18,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Text('Your recent transactions will appear here.',
              textAlign: TextAlign.center,
              style: GoogleFonts.poppins(
                  color: const Color(0xFF6B7280), fontSize: 14, height: 1.5)),
        ],
      ),
    );
  }

  Widget _buildTransactionItem(Map<String, dynamic> t) {
    final isCredit = t['type'] == 'credit';
    final method = (t['paymentMethod'] ?? t['payment_method'] ?? '')
        .toString()
        .toLowerCase();
    final isRazorpay = method.contains('razorpay');
    final accent = isCredit ? const Color(0xFF10B981) : const Color(0xFFEF4444);
    final date = t['date'] ?? t['created_at'] ?? t['createdAt'] ?? '';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 8, offset: const Offset(0, 4)),
        ],
        border: Border.all(color: const Color(0xFFF1F5F9), width: 1),
      ),
      child: Row(children: [
        Container(
          width: 48, height: 48,
          decoration: BoxDecoration(
            color: accent.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Icon(
            isCredit ? Icons.add_rounded : Icons.remove_rounded,
            color: accent,
            size: 24,
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(t['description'] ?? 'Transaction',
                  style: GoogleFonts.poppins(
                      fontWeight: FontWeight.w500,
                      fontSize: 14,
                      color: const Color(0xFF111827)),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis),
              const SizedBox(height: 2),
              Row(children: [
                if (isRazorpay) ...[
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                    decoration: BoxDecoration(
                        color: const Color(0xFFEEF2FF),
                        borderRadius: BorderRadius.circular(4)),
                    child: Text('Razorpay',
                        style: GoogleFonts.poppins(
                            fontSize: 9,
                            color: const Color(0xFF4F46E5),
                            fontWeight: FontWeight.w600)),
                  ),
                  const SizedBox(width: 6),
                ],
                Text(date,
                    style: GoogleFonts.poppins(
                        color: const Color(0xFF9CA3AF), fontSize: 11)),
              ]),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Text(
          '${isCredit ? '+' : '-'}₹${t['amount']}',
          style: GoogleFonts.poppins(
              fontWeight: FontWeight.w600, fontSize: 16, color: accent),
        ),
      ]),
    );
  }
}
