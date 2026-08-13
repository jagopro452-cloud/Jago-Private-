import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:razorpay_flutter/razorpay_flutter.dart';
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../services/socket_service.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});
  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> with SingleTickerProviderStateMixin {
  final SocketService _socket = SocketService();
  Map<String, dynamic>? _wallet;
  bool _loading = true;
  late TabController _tabController;
  late Razorpay _razorpay;
  double _pendingAmount = 0;
  StreamSubscription<Map<String, dynamic>>? _walletSub;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _onPaymentSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _onPaymentError);
    _razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, _onExternalWallet);
    _walletSub = _socket.onWalletUpdated.listen((_) {
      _fetchWallet();
    });
    _fetchWallet();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _razorpay.clear();
    _walletSub?.cancel();
    super.dispose();
  }

  Future<void> _fetchWallet() async {
    final headers = await AuthService.getHeaders();
    try {
      final res = await http.get(
        Uri.parse(ApiConfig.driverWallet),
        headers: headers,
      );
      if (res.statusCode == 200) {
        if (mounted) setState(() { _wallet = jsonDecode(res.body); _loading = false; });
      } else {
        if (mounted) setState(() => _loading = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _showRechargeSheet() {
    double selectedAmount = 200;
    final customCtrl = TextEditingController();
    bool isCustom = false;
    bool paying = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: JT.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: EdgeInsets.only(
            left: 24, right: 24, top: 24,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 32,
          ),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            // Handle
            Center(
              child: Container(
                width: 40, height: 4,
                decoration: BoxDecoration(color: JT.border, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const SizedBox(height: 20),
            Row(children: [
              Container(
                width: 44, height: 44,
                decoration: BoxDecoration(
                  color: JT.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: JT.primary.withValues(alpha: 0.3)),
                ),
                child: Icon(Icons.account_balance_wallet, color: JT.primary, size: 22)),
              const SizedBox(width: 14),
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Recharge Wallet', style: GoogleFonts.poppins(
                    color: JT.textPrimary, fontSize: 18, fontWeight: FontWeight.w400)),
                Text('Current: ₹${(_wallet?['walletBalance'] ?? 0).toStringAsFixed(2)}',
                    style: GoogleFonts.poppins(color: JT.textSecondary, fontSize: 12)),
              ]),
              const Spacer(),
              IconButton(
                icon: Icon(Icons.close_rounded, color: JT.iconInactive),
                onPressed: () => Navigator.pop(ctx),
              ),
            ]),
            const SizedBox(height: 24),

            Text('SELECT AMOUNT', style: GoogleFonts.poppins(
                color: JT.iconInactive, fontSize: 10, fontWeight: FontWeight.w400, letterSpacing: 1.5)),
            const SizedBox(height: 12),

            // Quick amount chips
            Wrap(spacing: 10, runSpacing: 10, children: [
              for (final amt in [100.0, 200.0, 500.0, 1000.0])
                GestureDetector(
                  onTap: () => setSheet(() { selectedAmount = amt; isCustom = false; customCtrl.clear(); }),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 11),
                    decoration: BoxDecoration(
                      gradient: (!isCustom && selectedAmount == amt) ? JT.grad : null,
                      color: (!isCustom && selectedAmount == amt) ? null : JT.bgSoft,
                      borderRadius: BorderRadius.circular(26),
                      border: Border.all(
                        color: (!isCustom && selectedAmount == amt) ? JT.primary : JT.border,
                        width: (!isCustom && selectedAmount == amt) ? 1.5 : 1),
                      boxShadow: (!isCustom && selectedAmount == amt) ? JT.btnShadow : [],
                    ),
                    child: Text('₹${amt.toInt()}',
                      style: GoogleFonts.poppins(
                        color: (!isCustom && selectedAmount == amt) ? Colors.white : JT.textSecondary,
                        fontWeight: FontWeight.w500, fontSize: 15)),
                  ),
                ),
              GestureDetector(
                onTap: () => setSheet(() => isCustom = true),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 11),
                  decoration: BoxDecoration(
                    color: isCustom ? JT.warning.withValues(alpha: 0.12) : JT.bgSoft,
                    borderRadius: BorderRadius.circular(26),
                    border: Border.all(
                      color: isCustom ? JT.warning : JT.border,
                      width: isCustom ? 1.5 : 1),
                    boxShadow: isCustom ? [
                      BoxShadow(color: JT.warning.withValues(alpha: 0.2), blurRadius: 12),
                    ] : [],
                  ),
                  child: Text('Custom',
                    style: GoogleFonts.poppins(
                      color: isCustom ? JT.warning : JT.textSecondary,
                      fontWeight: FontWeight.w500, fontSize: 15)),
                ),
              ),
            ]),
            const SizedBox(height: 16),

            if (isCustom) ...[
              TextField(
                controller: customCtrl,
                keyboardType: TextInputType.number,
                autofocus: true,
                onChanged: (v) => setSheet(() { selectedAmount = double.tryParse(v) ?? 0; }),
                style: GoogleFonts.poppins(color: JT.textPrimary, fontSize: 18, fontWeight: FontWeight.w400),
                decoration: InputDecoration(
                  hintText: 'Enter amount',
                  hintStyle: GoogleFonts.poppins(color: JT.iconInactive),
                  prefixText: '₹ ',
                  prefixStyle: GoogleFonts.poppins(color: JT.primary, fontWeight: FontWeight.w400, fontSize: 18),
                  filled: true,
                  fillColor: JT.bgSoft,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: JT.border)),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: JT.border)),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: JT.primary, width: 1.5)),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                ),
              ),
              const SizedBox(height: 16),
            ],

            // Summary info
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: JT.primary.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: JT.primary.withValues(alpha: 0.25))),
              child: Row(children: [
                Icon(Icons.info_outline_rounded, color: JT.primary, size: 16),
                const SizedBox(width: 10),
                Text('You will be charged ₹${selectedAmount.toInt()} via Razorpay',
                  style: GoogleFonts.poppins(color: JT.textSecondary, fontSize: 13)),
              ]),
            ),
            const SizedBox(height: 20),

            SizedBox(
              width: double.infinity,
              child: GestureDetector(
                onTap: (paying || selectedAmount < 1) ? null : () async {
                  setSheet(() => paying = true);
                  final amt = isCustom ? (double.tryParse(customCtrl.text.trim()) ?? 0) : selectedAmount;
                  if (amt < 1) {
                    setSheet(() => paying = false);
                    _showSnack('Please enter a valid amount', error: true);
                    return;
                  }
                  Navigator.pop(ctx);
                  await _initiateRecharge(amt);
                },
                child: Container(
                  height: 56,
                  decoration: BoxDecoration(
                    gradient: JT.grad,
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: JT.btnShadow,
                  ),
                  child: Center(
                    child: paying
                      ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                      : Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                          const Icon(Icons.payment_rounded, color: Colors.white, size: 20),
                          const SizedBox(width: 10),
                          Text(
                            'Pay ₹${(isCustom ? (double.tryParse(customCtrl.text.trim()) ?? 0) : selectedAmount).toInt()} via Razorpay',
                            style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w400, fontSize: 15)),
                        ]),
                  ),
                ),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  Future<void> _initiateRecharge(double amount) async {
    try {
      final rechargeHeaders = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/wallet/create-order'),
        headers: {...rechargeHeaders, 'Content-Type': 'application/json'},
        body: jsonEncode({'amount': amount}),
      );
      if (res.statusCode != 200) {
        _showSnack('Failed to create payment order. Try again.', error: true);
        return;
      }
      final data = jsonDecode(res.body);
      final order = data['order'];
      final keyId = data['keyId'] ?? '';

      String driverPhone = '';
      try {
        final profRes = await http.get(
          Uri.parse('${ApiConfig.baseUrl}/api/app/driver/profile'),
          headers: rechargeHeaders,
        );
        if (profRes.statusCode == 200) {
          driverPhone = jsonDecode(profRes.body)['phone']?.toString() ?? '';
        }
      } catch (_) {}

      _pendingAmount = amount;
      _razorpay.open({
        'key': keyId,
        'amount': order['amount'],
        'currency': 'INR',
        'order_id': order['id'],
        'name': 'JAGO Pro Pilot',
        'description': 'Wallet Recharge ₹${amount.toInt()}',
        'timeout': 300,
        'prefill': {'contact': driverPhone, 'email': ''},
        'theme': {'color': '#2F7BFF'},
      });
    } catch (e) {
      _showSnack('Payment error: $e', error: true);
    }
  }

  void _onPaymentSuccess(PaymentSuccessResponse response) async {
    _showSnack('Processing payment...', error: false);
    try {
      final verifyHeaders = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/wallet/verify-payment'),
        headers: {...verifyHeaders, 'Content-Type': 'application/json'},
        body: jsonEncode({
          'razorpayOrderId': response.orderId,
          'razorpayPaymentId': response.paymentId,
          'razorpaySignature': response.signature,
          'amount': _pendingAmount,
        }),
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200 || res.statusCode == 409) {
        final newBal = data['newBalance']?.toStringAsFixed(2) ?? _pendingAmount.toStringAsFixed(2);
        final autoUnlocked = data['autoUnlocked'] == true;
        _showSuccessDialog(_pendingAmount, double.tryParse(newBal) ?? 0, autoUnlocked);
        _fetchWallet();
      } else {
        _showSnack(data['message'] ?? 'Verification failed. Contact support.', error: true);
      }
    } catch (e) {
      _showSnack('Verification error. Contact support with payment ID: ${response.paymentId}', error: true);
    }
  }

  void _onPaymentError(PaymentFailureResponse response) {
    if (response.code != 0) {
      _showSnack('Payment failed: ${response.message ?? 'Unknown error'}', error: true);
    }
  }

  void _onExternalWallet(ExternalWalletResponse response) {}

  void _showSuccessDialog(double amount, double newBalance, bool autoUnlocked) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        backgroundColor: JT.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
          side: BorderSide(color: JT.success.withValues(alpha: 0.3), width: 1),
        ),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 80, height: 80,
            decoration: BoxDecoration(
              color: JT.success.withValues(alpha: 0.1),
              shape: BoxShape.circle,
              border: Border.all(color: JT.success.withValues(alpha: 0.4)),
            ),
            child: Icon(Icons.check_rounded, color: JT.success, size: 44)),
          const SizedBox(height: 18),
          Text('Recharge Successful!',
            style: GoogleFonts.poppins(color: JT.textPrimary, fontSize: 18, fontWeight: FontWeight.w400)),
          const SizedBox(height: 8),
          Text('₹${amount.toInt()} added to your wallet',
            style: GoogleFonts.poppins(color: JT.textSecondary, fontSize: 14), textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text('New balance: ₹${newBalance.toStringAsFixed(2)}',
            style: GoogleFonts.poppins(color: JT.primary, fontSize: 16, fontWeight: FontWeight.w400)),
          if (autoUnlocked) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: JT.success.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: JT.success.withValues(alpha: 0.3)),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(Icons.lock_open_rounded, color: JT.success, size: 16),
                const SizedBox(width: 8),
                Text('Account Unlocked!', style: GoogleFonts.poppins(color: JT.success, fontSize: 13, fontWeight: FontWeight.w500)),
              ]),
            ),
          ],
          const SizedBox(height: 22),
          SizedBox(
            width: double.infinity,
            child: GestureDetector(
              onTap: () => Navigator.pop(context),
              child: Container(
                height: 52,
                decoration: BoxDecoration(
                  gradient: JT.grad,
                  borderRadius: BorderRadius.circular(14),
                  boxShadow: JT.btnShadow,
                ),
                child: Center(
                  child: Text('Done', style: GoogleFonts.poppins(
                      color: Colors.white, fontWeight: FontWeight.w400, fontSize: 15)),
                ),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  void _showSnack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg, style: GoogleFonts.poppins(fontWeight: FontWeight.w400)),
      backgroundColor: error ? JT.error : JT.success,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ));
  }

  void _showWithdrawDialog() {
    final amountCtrl = TextEditingController();
    final bankNameCtrl = TextEditingController();
    final accountCtrl = TextEditingController();
    final ifscCtrl = TextEditingController();
    final holderCtrl = TextEditingController();
    final upiCtrl = TextEditingController();
    String method = 'bank';
    bool loading = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: JT.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Padding(
          padding: EdgeInsets.only(
            left: 24, right: 24, top: 24,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 32,
          ),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40, height: 4,
                    decoration: BoxDecoration(color: JT.border, borderRadius: BorderRadius.circular(2)),
                  ),
                ),
                const SizedBox(height: 20),
                Row(children: [
                  Icon(Icons.account_balance_wallet_rounded, color: JT.warning, size: 22),
                  const SizedBox(width: 10),
                  Text('Withdraw Funds', style: GoogleFonts.poppins(
                      color: JT.textPrimary, fontSize: 18, fontWeight: FontWeight.w400)),
                  const Spacer(),
                  IconButton(icon: Icon(Icons.close_rounded, color: JT.iconInactive),
                      onPressed: () => Navigator.pop(ctx)),
                ]),
                const SizedBox(height: 4),
                Text('Available: ₹${(_wallet?['walletBalance'] ?? _wallet?['balance'] ?? 0).toStringAsFixed(2)}',
                  style: GoogleFonts.poppins(color: JT.primary, fontSize: 13, fontWeight: FontWeight.w400)),
                const SizedBox(height: 18),

                _buildField(amountCtrl, 'Amount (min ₹100)', keyboardType: TextInputType.number, prefix: '₹'),
                const SizedBox(height: 14),

                Text('PAYMENT METHOD', style: GoogleFonts.poppins(
                    color: JT.iconInactive, fontSize: 10, fontWeight: FontWeight.w400, letterSpacing: 1.5)),
                const SizedBox(height: 10),
                Row(children: [
                  _methodBtn(ctx, setModalState, 'Bank Transfer', 'bank', method, (v) => setModalState(() => method = v)),
                  const SizedBox(width: 10),
                  _methodBtn(ctx, setModalState, 'UPI', 'upi', method, (v) => setModalState(() => method = v)),
                ]),
                const SizedBox(height: 16),

                if (method == 'bank') ...[
                  _buildField(holderCtrl, 'Account Holder Name'),
                  const SizedBox(height: 10),
                  _buildField(bankNameCtrl, 'Bank Name'),
                  const SizedBox(height: 10),
                  _buildField(accountCtrl, 'Account Number', keyboardType: TextInputType.number),
                  const SizedBox(height: 10),
                  _buildField(ifscCtrl, 'IFSC Code'),
                ] else ...[
                  _buildField(upiCtrl, 'UPI ID (e.g. name@bank)'),
                ],

                const SizedBox(height: 22),
                SizedBox(
                  width: double.infinity,
                  child: GestureDetector(
                    onTap: loading ? null : () async {
                      final amt = double.tryParse(amountCtrl.text.trim());
                      if (amt == null || amt < 100) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text('Enter a valid amount (min ₹100)', style: GoogleFonts.poppins()),
                            backgroundColor: JT.error,
                          ));
                        return;
                      }
                      if (method == 'bank' && (holderCtrl.text.isEmpty || accountCtrl.text.isEmpty || ifscCtrl.text.isEmpty)) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Fill all bank details', style: GoogleFonts.poppins()), backgroundColor: JT.error));
                        return;
                      }
                      if (method == 'upi' && upiCtrl.text.isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Enter UPI ID', style: GoogleFonts.poppins()), backgroundColor: JT.error));
                        return;
                      }
                      setModalState(() => loading = true);
                      try {
                        final wdHeaders = await AuthService.getHeaders();
                        final body = method == 'upi'
                          ? {'amount': amt, 'method': 'upi', 'upiId': upiCtrl.text.trim()}
                          : {
                              'amount': amt, 'method': 'bank',
                              'bankName': bankNameCtrl.text.trim(),
                              'accountNumber': accountCtrl.text.trim(),
                              'ifscCode': ifscCtrl.text.trim(),
                              'accountHolderName': holderCtrl.text.trim(),
                            };
                        final res = await http.post(
                          Uri.parse(ApiConfig.driverWithdrawRequest),
                          headers: {...wdHeaders, 'Content-Type': 'application/json'},
                          body: jsonEncode(body),
                        );
                        final data = jsonDecode(res.body);
                        if (mounted) Navigator.pop(ctx);
                        if (res.statusCode == 200) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(data['message'] ?? 'Withdrawal requested', style: GoogleFonts.poppins()),
                              backgroundColor: JT.success,
                            ));
                          _fetchWallet();
                        } else {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(data['message'] ?? 'Request failed', style: GoogleFonts.poppins()),
                              backgroundColor: JT.error,
                            ));
                        }
                      } catch (e) {
                        setModalState(() => loading = false);
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Network error. Try again.', style: GoogleFonts.poppins()), backgroundColor: JT.error));
                      }
                    },
                    child: Container(
                      height: 56,
                      decoration: BoxDecoration(
                        color: loading ? JT.border : null,
                        gradient: loading ? null : JT.grad,
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: loading ? [] : JT.btnShadow,
                      ),
                      child: Center(
                        child: loading
                          ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                          : Text('Submit Withdrawal Request', style: GoogleFonts.poppins(
                              color: Colors.white, fontWeight: FontWeight.w400, fontSize: 15)),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _methodBtn(BuildContext ctx, StateSetter setModalState, String label, String value, String current, ValueChanged<String> onTap) {
    final active = current == value;
    return Expanded(
      child: GestureDetector(
        onTap: () => onTap(value),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            gradient: active ? JT.grad : null,
            color: active ? null : JT.bgSoft,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: active ? JT.primary : JT.border,
              width: active ? 1.5 : 1,
            ),
            boxShadow: active ? JT.btnShadow : [],
          ),
          child: Center(child: Text(label, style: GoogleFonts.poppins(
              color: active ? Colors.white : JT.textSecondary, fontWeight: FontWeight.w500, fontSize: 13))),
        ),
      ),
    );
  }

  Widget _buildField(TextEditingController ctrl, String hint,
      {TextInputType keyboardType = TextInputType.text, String? prefix}) {
    return TextField(
      controller: ctrl,
      keyboardType: keyboardType,
      style: GoogleFonts.poppins(color: JT.textPrimary, fontSize: 15),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: GoogleFonts.poppins(color: JT.iconInactive),
        prefixText: prefix != null ? '$prefix ' : null,
        prefixStyle: GoogleFonts.poppins(color: JT.primary, fontWeight: FontWeight.w500),
        filled: true,
        fillColor: JT.bgSoft,
        border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: JT.border)),
        enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: JT.border)),
        focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(color: JT.primary, width: 1.5)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final balance = (_wallet?['walletBalance'] ?? _wallet?['balance'] ?? 0).toDouble();
    final isLocked = _wallet?['isLocked'] ?? false;
    final isNegative = balance < 0;
    final absBalance = balance.abs();
    final history = (_wallet?['history'] ?? _wallet?['transactions'] ?? []) as List;
    final withdrawals = (_wallet?['withdrawRequests'] ?? []) as List;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
        backgroundColor: JT.bg,
        body: Column(children: [
          // Header + balance card combined
          Container(
            decoration: BoxDecoration(
              gradient: JT.grad,
            ),
            child: SafeArea(
              bottom: false,
              child: Column(
                children: [
                  // App bar row
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                    child: Row(children: [
                      GestureDetector(
                        onTap: () => Navigator.pop(context),
                        child: Container(
                          width: 44, height: 44,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
                          ),
                          child: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 18),
                        ),
                      ),
                      const SizedBox(width: 14),
                      Text('Wallet', style: GoogleFonts.poppins(
                          color: Colors.white, fontSize: 20, fontWeight: FontWeight.w400)),
                      const Spacer(),
                      GestureDetector(
                        onTap: () { setState(() => _loading = true); _fetchWallet(); },
                        child: Container(
                          width: 44, height: 44,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
                          ),
                          child: const Icon(Icons.refresh_rounded, color: Colors.white, size: 20),
                        ),
                      ),
                    ]),
                  ),

                  if (_loading)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 40),
                      child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                    )
                  else ...[
                    // Balance display
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 24, 20, 0),
                      child: Column(children: [
                        Container(
                          width: 72, height: 72,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.2),
                            shape: BoxShape.circle,
                            border: Border.all(
                                color: Colors.white.withValues(alpha: 0.4)),
                          ),
                          child: Icon(
                            isLocked ? Icons.lock_rounded : Icons.account_balance_wallet_rounded,
                            color: Colors.white, size: 34,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text('₹${balance.toStringAsFixed(2)}',
                          style: GoogleFonts.poppins(
                            fontSize: 40, fontWeight: FontWeight.w500,
                            color: Colors.white, letterSpacing: -1.5)),
                        const SizedBox(height: 6),
                        Text(
                          isNegative
                              ? 'You need to pay â‚¹${absBalance.toStringAsFixed(2)}'
                              : 'You will receive â‚¹${absBalance.toStringAsFixed(2)}',
                          style: GoogleFonts.poppins(
                            color: Colors.transparent,
                            fontSize: 0,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          isNegative
                              ? 'You need to pay Rs ${absBalance.toStringAsFixed(2)}'
                              : 'You will receive Rs ${absBalance.toStringAsFixed(2)}',
                          style: GoogleFonts.poppins(
                            color: Colors.white.withValues(alpha: 0.92),
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          isLocked ? 'Account Locked — Recharge to unlock' : 'Available Balance',
                          style: GoogleFonts.poppins(
                            color: Colors.white.withValues(alpha: 0.8),
                            fontSize: 13, fontWeight: FontWeight.w400,
                          )),
                        const SizedBox(height: 20),

                        // Recharge button
                        SizedBox(
                          width: double.infinity,
                          height: 52,
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.white,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                              elevation: 0,
                            ),
                            icon: Icon(Icons.add_circle_rounded, color: JT.primary, size: 22),
                            label: Text('Recharge Wallet',
                                style: GoogleFonts.poppins(
                                    color: JT.primary, fontWeight: FontWeight.w400, fontSize: 15)),
                            onPressed: _showRechargeSheet,
                          ),
                        ),

                        // Withdraw button
                        if (!isLocked && balance >= 100) ...[
                          const SizedBox(height: 10),
                          SizedBox(
                            width: double.infinity,
                            height: 48,
                            child: OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(
                                side: BorderSide(color: Colors.white.withValues(alpha: 0.5), width: 1.5),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                              ),
                              icon: const Icon(Icons.arrow_upward_rounded, color: Colors.white, size: 18),
                              label: Text('Request Withdrawal',
                                  style: GoogleFonts.poppins(
                                      color: Colors.white, fontWeight: FontWeight.w500)),
                              onPressed: _showWithdrawDialog,
                            ),
                          ),
                        ],

                        // Locked warning
                        if (isLocked) ...[
                          const SizedBox(height: 14),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(color: Colors.white.withValues(alpha: 0.3))),
                            child: Row(children: [
                              const Icon(Icons.info_outline_rounded, color: Colors.white, size: 16),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text('Wallet is negative. Recharge to unlock your account and go online.',
                                  style: GoogleFonts.poppins(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w500))),
                            ]),
                          ),
                        ],

                        const SizedBox(height: 20),
                      ]),
                    ),

                    // Tab bar
                    TabBar(
                      controller: _tabController,
                      indicatorColor: Colors.white,
                      indicatorWeight: 2,
                      labelColor: Colors.white,
                      unselectedLabelColor: Colors.white.withValues(alpha: 0.6),
                      labelStyle: GoogleFonts.poppins(fontWeight: FontWeight.w500, fontSize: 13),
                      unselectedLabelStyle: GoogleFonts.poppins(fontWeight: FontWeight.w500, fontSize: 13),
                      tabs: const [Tab(text: 'Transactions'), Tab(text: 'Withdrawals')],
                    ),
                  ],
                ],
              ),
            ),
          ),

          // Tab content
          if (!_loading)
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [
                  // Transactions tab
                  history.isEmpty
                    ? _emptyState(
                        icon: Icons.receipt_long_rounded,
                        title: 'No transactions yet',
                        subtitle: 'Recharge to get started',
                        action: GestureDetector(
                          onTap: _showRechargeSheet,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                            decoration: BoxDecoration(
                              gradient: JT.grad,
                              borderRadius: BorderRadius.circular(16),
                              boxShadow: JT.btnShadow,
                            ),
                            child: Row(mainAxisSize: MainAxisSize.min, children: [
                              const Icon(Icons.add_rounded, color: Colors.white, size: 18),
                              const SizedBox(width: 8),
                              Text('Recharge Now', style: GoogleFonts.poppins(
                                  color: Colors.white, fontWeight: FontWeight.w400)),
                            ]),
                          ),
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: history.length,
                        itemBuilder: (_, i) {
                          final t = history[i] as Map;
                          final isCredit = (t['type']?.toString() ?? '').contains('credit') ||
                            (t['type']?.toString() ?? '').contains('earn') ||
                            (t['type']?.toString() ?? '').contains('topup') ||
                            (t['type']?.toString() ?? '').contains('recharge');
                          final amt = (t['amount'] as num?)?.toDouble() ?? 0;
                          return Container(
                            margin: const EdgeInsets.only(bottom: 10),
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: JT.bgSoft,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: JT.border, width: 1),
                              boxShadow: JT.cardShadow,
                            ),
                            child: Row(children: [
                              Container(
                                width: 44, height: 44,
                                decoration: BoxDecoration(
                                  color: (isCredit ? JT.success : JT.error).withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(
                                      color: (isCredit ? JT.success : JT.error).withValues(alpha: 0.3)),
                                ),
                                child: Icon(
                                  isCredit ? Icons.arrow_downward_rounded : Icons.arrow_upward_rounded,
                                  color: isCredit ? JT.success : JT.error, size: 20)),
                              const SizedBox(width: 14),
                              Expanded(child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(t['description']?.toString() ?? 'Transaction',
                                    style: GoogleFonts.poppins(
                                        color: JT.textPrimary, fontWeight: FontWeight.w400, fontSize: 13)),
                                  const SizedBox(height: 3),
                                  Text((t['date'] ?? t['createdAt'] ?? '').toString().split('T').first,
                                    style: GoogleFonts.poppins(color: JT.iconInactive, fontSize: 11)),
                                ],
                              )),
                              Text('${isCredit ? '+' : '-'}₹${amt.toStringAsFixed(2)}',
                                style: GoogleFonts.poppins(
                                  fontWeight: FontWeight.w400, fontSize: 15,
                                  color: isCredit ? JT.success : JT.error)),
                            ]),
                          );
                        },
                      ),

                  // Withdrawals tab
                  withdrawals.isEmpty
                    ? _emptyState(
                        icon: Icons.account_balance_rounded,
                        title: 'No withdrawal requests',
                        subtitle: balance >= 100 ? 'Request a withdrawal anytime' : 'Minimum ₹100 to withdraw',
                        action: (!isLocked && balance >= 100) ? TextButton.icon(
                          icon: Icon(Icons.add_rounded, color: JT.primary),
                          label: Text('Request Withdrawal',
                              style: GoogleFonts.poppins(color: JT.primary, fontWeight: FontWeight.w500)),
                          onPressed: _showWithdrawDialog,
                        ) : null,
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: withdrawals.length,
                        itemBuilder: (_, i) {
                          final w = withdrawals[i] as Map;
                          final status = w['status']?.toString() ?? 'pending';
                          final statusColor = status == 'paid' ? JT.success
                            : status == 'approved' ? JT.primary
                            : status == 'rejected' ? JT.error
                            : JT.warning;
                          return Container(
                            margin: const EdgeInsets.only(bottom: 10),
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: JT.bgSoft,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: statusColor.withValues(alpha: 0.2), width: 1),
                              boxShadow: JT.cardShadow,
                            ),
                            child: Row(children: [
                              Container(
                                width: 44, height: 44,
                                decoration: BoxDecoration(
                                  color: statusColor.withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(color: statusColor.withValues(alpha: 0.3)),
                                ),
                                child: Icon(Icons.account_balance_rounded, color: statusColor, size: 20)),
                              const SizedBox(width: 14),
                              Expanded(child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('₹${(w['amount'] as num?)?.toStringAsFixed(2) ?? '0.00'}',
                                    style: GoogleFonts.poppins(
                                        color: JT.textPrimary, fontWeight: FontWeight.w400, fontSize: 16)),
                                  if ((w['notes']?.toString() ?? '').isNotEmpty)
                                    Text(w['notes']!.toString(), maxLines: 1, overflow: TextOverflow.ellipsis,
                                      style: GoogleFonts.poppins(color: JT.iconInactive, fontSize: 11)),
                                ],
                              )),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                                decoration: BoxDecoration(
                                  color: statusColor.withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(color: statusColor.withValues(alpha: 0.3)),
                                ),
                                child: Text(status.toUpperCase(),
                                  style: GoogleFonts.poppins(
                                      color: statusColor, fontSize: 10, fontWeight: FontWeight.w400, letterSpacing: 0.5)),
                              ),
                            ]),
                          );
                        },
                      ),
                ],
              ),
            ),
        ]),
      ),
    );
  }

  Widget _emptyState({
    required IconData icon,
    required String title,
    required String subtitle,
    Widget? action,
  }) {
    return Center(
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Container(
          width: 80, height: 80,
          decoration: BoxDecoration(
            color: JT.bgSoft,
            shape: BoxShape.circle,
            border: Border.all(color: JT.border),
          ),
          child: Icon(icon, color: JT.iconInactive, size: 38),
        ),
        const SizedBox(height: 16),
        Text(title, style: GoogleFonts.poppins(
            color: JT.textSecondary, fontSize: 16, fontWeight: FontWeight.w400)),
        const SizedBox(height: 6),
        Text(subtitle, style: GoogleFonts.poppins(color: JT.iconInactive, fontSize: 13)),
        if (action != null) ...[const SizedBox(height: 20), action],
      ]),
    );
  }
}
