import 'dart:convert';
import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';
import 'package:http/http.dart' as http;
import 'package:razorpay_flutter/razorpay_flutter.dart';
import '../../config/api_config.dart';
import '../../services/auth_service.dart';
import '../home/home_screen.dart';

class SubscriptionPlansScreen extends StatefulWidget {
  final String selectedModel;

  const SubscriptionPlansScreen({
    super.key,
    this.selectedModel = 'subscription',
  });

  @override
  State<SubscriptionPlansScreen> createState() => _SubscriptionPlansScreenState();
}

class _SubscriptionPlansScreenState extends State<SubscriptionPlansScreen> {
  late Razorpay _razorpay;
  List<dynamic> _plans = [];
  List<dynamic> _insurancePlans = [];
  bool _isLoading = true;
  bool _isPaying = false;
  String? _selectedPlanId;
  dynamic _selectedPlan;
  String? _selectedInsurancePlanId;
  dynamic _selectedInsurancePlan;

  // Pending payment context (set before opening Razorpay)
  String? _pendingInsurancePlanId;

  static const Color _bg = Color(0xFFFFFFFF);
  static const Color _cyan = Color(0xFF2F7BFF);
  static const Color _surface = Color(0xFFFFFFFF);
  static const Color _card = Color(0xFF111827);
  static const Color _gold = Color(0xFFFFD700);

  @override
  void initState() {
    super.initState();
    _syncSelectedModel();
    _fetchPlans();
    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _handlePaymentSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _handlePaymentError);
    _razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, _handleExternalWallet);
  }

  Future<void> _syncSelectedModel() async {
    try {
      final headers = await AuthService.getHeaders();
      await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/choose-model'),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({'model': widget.selectedModel}),
      );
    } catch (_) {}
  }

  @override
  void dispose() {
    _razorpay.clear();
    super.dispose();
  }

  Future<void> _fetchPlans() async {
    try {
      final headers = await AuthService.getHeaders();
      // Fetch subscription plans
      final res = await http.get(
        Uri.parse(ApiConfig.subscriptionPlans),
        headers: headers,
      );
      if (res.statusCode == 200) {
        final body = jsonDecode(res.body);
        final plans = (body is List)
            ? body
            : List<dynamic>.from((body['plans'] as List?) ?? const []);
        // Try to fetch insurance plans
        List<dynamic> insPlans = [];
        try {
          final insRes = await http.get(
            Uri.parse('${ApiConfig.baseUrl}/api/app/driver/insurance/plans'),
            headers: headers,
          );
          if (insRes.statusCode == 200) {
            final insBody = jsonDecode(insRes.body);
            insPlans = (insBody is List)
                ? insBody
                : List<dynamic>.from((insBody['plans'] as List?) ?? const []);
          }
        } catch (_) {}

        if (mounted) {
          setState(() {
            _plans = plans;
            _insurancePlans = insPlans;
            _isLoading = false;
            if (_plans.isNotEmpty) {
              _selectedPlanId = _plans[0]['id'].toString();
              _selectedPlan = _plans[0];
            }
          });
        }
      } else {
        if (mounted) {
          setState(() => _isLoading = false);
          _showError('Failed to load plans');
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        _showError('Failed to load plans');
      }
    }
  }

  Future<void> _subscribe() async {
    if (_selectedPlanId == null || _isPaying) return;

    setState(() => _isPaying = true);
    try {
      final headers = await AuthService.getHeaders();
      final body = <String, dynamic>{'planId': _selectedPlanId};
      if (_selectedInsurancePlanId != null) {
        body['insurancePlanId'] = _selectedInsurancePlanId;
      }
      final res = await http.post(
        Uri.parse(ApiConfig.subscriptionCreateOrder),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final order = data['order'] as Map<String, dynamic>;
        final breakdown = data['breakdown'] as Map<String, dynamic>? ?? {};
        final keyId = data['keyId'] as String? ?? '';

        // Store context for verify step
        _pendingInsurancePlanId = _selectedInsurancePlanId;

        // Show confirmation bottom sheet before opening Razorpay
        if (mounted) {
          final confirmed = await _showConfirmationSheet(breakdown, order);
          if (confirmed != true) {
            setState(() => _isPaying = false);
            return;
          }
        }

        // Fetch driver phone for prefill
        String driverPhone = '';
        try {
          final profRes = await http.get(
            Uri.parse('${ApiConfig.baseUrl}/api/app/driver/profile'),
            headers: headers,
          );
          if (profRes.statusCode == 200) {
            final profData = jsonDecode(profRes.body);
            driverPhone = profData['phone']?.toString() ?? '';
          }
        } catch (_) {}

        final options = {
          'key': keyId,
          'amount': order['amount'],
          'currency': 'INR',
          'name': 'JAGO Pro Pilot',
          'order_id': order['id'],
          'description': 'Subscription: ${_selectedPlan?['name']}',
          'timeout': 300,
          'prefill': {
            'contact': driverPhone,
            'email': '',
          },
          'theme': {'color': '#2F7BFF'},
        };
        _razorpay.open(options);
      } else {
        final errData = jsonDecode(res.body);
        _showError(errData['message'] ?? 'Failed to create order');
        setState(() => _isPaying = false);
      }
    } catch (e) {
      _showError('Error initiating payment');
      setState(() => _isPaying = false);
    }
  }

  Future<bool?> _showConfirmationSheet(Map<String, dynamic> breakdown, Map<String, dynamic> order) {
    final planFee = _toDouble(breakdown['planFee']);
    final gst = _toDouble(breakdown['gst']);
    final insurance = _toDouble(breakdown['insurance']);
    final total = _toDouble(breakdown['total']);
    final gstPct = _toDouble(breakdown['gstPct']);

    return showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => Container(
        decoration: const BoxDecoration(
          color: JT.bg,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: const EdgeInsets.fromLTRB(24, 20, 24, 36),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40, height: 4,
                decoration: BoxDecoration(color: JT.border, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const SizedBox(height: 20),
            const Text(
              'Payment Summary',
              style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 4),
            Text(
              _selectedPlan?['name'] ?? '',
              style: const TextStyle(color: JT.primary, fontSize: 14),
            ),
            const SizedBox(height: 20),
            const Divider(color: Colors.white10),
            const SizedBox(height: 12),
            _summaryRow('Plan Fee', '₹${planFee.toStringAsFixed(0)}'),
            const SizedBox(height: 8),
            _summaryRow('GST (${gstPct.toStringAsFixed(0)}%)', '₹${gst.toStringAsFixed(0)}'),
            if (insurance > 0) ...[
              const SizedBox(height: 8),
              _summaryRow('Insurance Premium', '₹${insurance.toStringAsFixed(0)}'),
            ],
            const SizedBox(height: 12),
            const Divider(color: Colors.white10),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Total', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w500)),
                Text(
                  '₹${total.toStringAsFixed(0)}',
                  style: const TextStyle(color: JT.primary, fontSize: 22, fontWeight: FontWeight.w500),
                ),
              ],
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(context, false),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: JT.border),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    child: const Text('Cancel', style: TextStyle(color: Colors.white70, fontSize: 15)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  flex: 2,
                  child: Container(
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(colors: [JT.primary, JT.primary]),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: ElevatedButton(
                      onPressed: () => Navigator.pop(context, true),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.transparent,
                        shadowColor: Colors.transparent,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                      child: Text(
                        'Pay ₹${total.toStringAsFixed(0)}',
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: JT.bg),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _summaryRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: Colors.white60, fontSize: 14)),
        Text(value, style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w400)),
      ],
    );
  }

  void _handlePaymentSuccess(PaymentSuccessResponse response) async {
    try {
      final headers = await AuthService.getHeaders();
      final body = <String, dynamic>{
        'planId': _selectedPlanId,
        'razorpayPaymentId': response.paymentId,
        'razorpayOrderId': response.orderId,
        'razorpaySignature': response.signature,
      };
      if (_pendingInsurancePlanId != null) {
        body['insurancePlanId'] = _pendingInsurancePlanId;
      }
      final res = await http.post(
        Uri.parse(ApiConfig.subscriptionVerify),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );

      if (mounted) setState(() => _isPaying = false);

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final subscription = data['subscription'] as Map<String, dynamic>? ?? {};
        if (!mounted) return;
        _showSuccessDialog(subscription);
      } else {
        final errData = jsonDecode(res.body);
        _showError(errData['message'] ?? 'Failed to activate subscription');
      }
    } catch (e) {
      if (mounted) setState(() => _isPaying = false);
      _showError('Error finalizing payment');
    }
  }

  void _handlePaymentError(PaymentFailureResponse response) {
    if (mounted) setState(() => _isPaying = false);
    _showError('Payment failed: ${response.message}');
  }

  void _handleExternalWallet(ExternalWalletResponse response) {
    if (mounted) setState(() => _isPaying = false);
  }

  void _showError(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.red.shade700),
    );
  }

  void _showSuccessDialog(Map<String, dynamic> subscription) {
    final validUntil = subscription['valid_until'] ?? subscription['validUntil'] ?? '';
    final planName = subscription['plan_name'] ?? _selectedPlan?['name'] ?? 'Subscription';
    String validUntilStr = '';
    int daysLeft = 0;
    if (validUntil.isNotEmpty) {
      try {
        final dt = DateTime.parse(validUntil.toString());
        daysLeft = dt.difference(DateTime.now()).inDays;
        validUntilStr = '${dt.day}/${dt.month}/${dt.year}';
      } catch (_) {
        validUntilStr = validUntil.toString();
      }
    }

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        backgroundColor: _card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64, height: 64,
              decoration: BoxDecoration(
                color: JT.primary.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.check_circle_rounded, color: JT.primary, size: 36),
            ),
            const SizedBox(height: 16),
            const Text(
              'Subscription Active!',
              style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 8),
            Text(
              planName,
              style: const TextStyle(color: JT.primary, fontSize: 14),
            ),
            if (validUntilStr.isNotEmpty) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: JT.bg,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  children: [
                    Text(
                      'Active until $validUntilStr',
                      style: const TextStyle(color: Colors.white70, fontSize: 13),
                    ),
                    if (daysLeft > 0)
                      Text(
                        '$daysLeft days remaining',
                        style: const TextStyle(color: JT.primary, fontSize: 13, fontWeight: FontWeight.w400),
                      ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 16),
            const Text(
              'You can now accept rides and earn!',
              style: TextStyle(color: Colors.white54, fontSize: 13),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: Container(
                decoration: BoxDecoration(
                  gradient: const LinearGradient(colors: [JT.primary, JT.primary]),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: ElevatedButton(
                  onPressed: () {
                    Navigator.pushAndRemoveUntil(
                      context,
                      MaterialPageRoute(builder: (_) => const HomeScreen()),
                      (route) => false,
                    );
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.transparent,
                    shadowColor: Colors.transparent,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  child: const Text(
                    'Start Earning',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: JT.bg),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  double _toDouble(dynamic val) {
    if (val == null) return 0.0;
    if (val is num) return val.toDouble();
    return double.tryParse(val.toString()) ?? 0.0;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Choose Plan', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w500)),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: JT.primary))
          : Column(
              children: [
                const SizedBox(height: 8),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Unlock Full Earnings',
                        style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w500),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Subscribe and start accepting rides today',
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.5), fontSize: 14),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    children: [
                      ..._plans.map((plan) => _buildPlanCard(plan)),
                      if (_insurancePlans.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        _buildInsuranceSection(),
                      ],
                      const SizedBox(height: 8),
                      _buildBenefitsSection(),
                    ],
                  ),
                ),
                _buildBottomButton(),
              ],
            ),
    );
  }

  Widget _buildPlanCard(dynamic plan) {
    final id = plan['id'].toString();
    final isSelected = _selectedPlanId == id;
    final name = plan['name']?.toString() ?? '';
    final price = _toDouble(plan['price']);
    final durationDays = plan['duration_days'] ?? plan['durationDays'] ?? 30;
    final dailyRate = (price / (durationDays as num)).toStringAsFixed(0);
    final features = List<String>.from(plan['features'] ?? []);

    final isPopular = name.toLowerCase().contains('weekly') || name.toLowerCase().contains('week');
    final isBestValue = name.toLowerCase().contains('month') || name.toLowerCase().contains('basic');

    final accentColor = isBestValue ? _gold : _cyan;
    final borderColor = isSelected ? accentColor : JT.border;

    return GestureDetector(
      onTap: () => setState(() {
        _selectedPlanId = id;
        _selectedPlan = plan;
      }),
      child: Container(
        margin: const EdgeInsets.only(bottom: 16),
        decoration: BoxDecoration(
          color: _card,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: borderColor, width: 1.5),
          boxShadow: isSelected
              ? [BoxShadow(color: accentColor.withValues(alpha: 0.12), blurRadius: 16, offset: const Offset(0, 6))]
              : [],
        ),
        child: Stack(
          children: [
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: accentColor.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          '$durationDays DAYS',
                          style: TextStyle(color: accentColor, fontSize: 10, fontWeight: FontWeight.w500),
                        ),
                      ),
                      if (isPopular || isBestValue)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: accentColor.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            isBestValue ? 'BEST VALUE' : 'POPULAR',
                            style: TextStyle(color: accentColor, fontSize: 10, fontWeight: FontWeight.w500),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(name, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w500)),
                  const SizedBox(height: 8),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text('₹${price.toStringAsFixed(0)}',
                          style: TextStyle(color: accentColor, fontSize: 28, fontWeight: FontWeight.w500)),
                      const SizedBox(width: 4),
                      Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Text(
                          '+ GST  ·  per $durationDays days',
                          style: TextStyle(color: Colors.white.withValues(alpha: 0.4), fontSize: 11),
                        ),
                      ),
                      const Spacer(),
                      Text('≈ ₹$dailyRate/day',
                          style: TextStyle(color: Colors.white.withValues(alpha: 0.55), fontSize: 12)),
                    ],
                  ),
                  if (features.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    const Divider(color: Colors.white10),
                    const SizedBox(height: 10),
                    ...features.map((f) => Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: Row(
                            children: [
                              Icon(Icons.check_circle_outline, color: Colors.green.shade400, size: 15),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(f,
                                    style: TextStyle(color: Colors.white.withValues(alpha: 0.65), fontSize: 13)),
                              ),
                            ],
                          ),
                        )),
                  ],
                ],
              ),
            ),
            Positioned(
              top: 20,
              right: 20,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                width: 22,
                height: 22,
                decoration: BoxDecoration(
                  color: isSelected ? accentColor : Colors.transparent,
                  shape: BoxShape.circle,
                  border: Border.all(color: isSelected ? accentColor : JT.border, width: 1.5),
                ),
                child: isSelected
                    ? const Icon(Icons.check, color: JT.bg, size: 14)
                    : null,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInsuranceSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Add Insurance (Optional)',
          style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w500),
        ),
        const SizedBox(height: 4),
        Text(
          'Protect yourself and your vehicle',
          style: TextStyle(color: Colors.white.withValues(alpha: 0.5), fontSize: 13),
        ),
        const SizedBox(height: 12),
        // None option
        GestureDetector(
          onTap: () => setState(() {
            _selectedInsurancePlanId = null;
            _selectedInsurancePlan = null;
          }),
          child: Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: _card,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: _selectedInsurancePlanId == null ? Colors.white38 : JT.border,
                width: 1.5,
              ),
            ),
            child: Row(
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  width: 20, height: 20,
                  decoration: BoxDecoration(
                    color: _selectedInsurancePlanId == null ? Colors.white : Colors.transparent,
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: _selectedInsurancePlanId == null ? Colors.white : JT.border,
                      width: 1.5,
                    ),
                  ),
                  child: _selectedInsurancePlanId == null
                      ? const Icon(Icons.check, color: JT.bg, size: 12)
                      : null,
                ),
                const SizedBox(width: 12),
                const Text('No Insurance', style: TextStyle(color: Colors.white70, fontSize: 14)),
              ],
            ),
          ),
        ),
        ..._insurancePlans.map((ins) => _buildInsuranceCard(ins)),
        const SizedBox(height: 8),
      ],
    );
  }

  Widget _buildInsuranceCard(dynamic ins) {
    final id = ins['id'].toString();
    final isSelected = _selectedInsurancePlanId == id;
    final name = ins['name']?.toString() ?? '';
    final premium = _toDouble(ins['premium'] ?? ins['price']);
    final description = ins['description']?.toString() ?? '';

    return GestureDetector(
      onTap: () => setState(() {
        _selectedInsurancePlanId = id;
        _selectedInsurancePlan = ins;
      }),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: _card,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? JT.primary : JT.border,
            width: 1.5,
          ),
        ),
        child: Row(
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              width: 20, height: 20,
              decoration: BoxDecoration(
                color: isSelected ? _cyan : Colors.transparent,
                shape: BoxShape.circle,
                border: Border.all(
                  color: isSelected ? _cyan : JT.border,
                  width: 1.5,
                ),
              ),
              child: isSelected
                  ? const Icon(Icons.check, color: JT.bg, size: 12)
                  : null,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w400)),
                  if (description.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(description,
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.5), fontSize: 12),
                        maxLines: 2),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: JT.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                '+₹${premium.toStringAsFixed(0)}',
                style: const TextStyle(color: JT.primary, fontSize: 13, fontWeight: FontWeight.w500),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBenefitsSection() {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: BoxDecoration(
        color: _surface,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _benefitItem(Icons.trending_up_rounded, 'Max Earnings'),
          _benefitItem(Icons.shield_rounded, 'Safe Payments'),
          _benefitItem(Icons.support_agent_rounded, 'Priority Support'),
        ],
      ),
    );
  }

  Widget _benefitItem(IconData icon, String label) {
    return Column(
      children: [
        Icon(icon, color: _cyan.withValues(alpha: 0.6), size: 22),
        const SizedBox(height: 4),
        Text(label, style: TextStyle(color: Colors.white.withValues(alpha: 0.45), fontSize: 10)),
      ],
    );
  }

  Widget _buildBottomButton() {
    final planPrice = _selectedPlan != null ? _toDouble(_selectedPlan['price']) : 0.0;
    final insPrice = _selectedInsurancePlan != null
        ? _toDouble(_selectedInsurancePlan['premium'] ?? _selectedInsurancePlan['price'])
        : 0.0;
    // GST approximate for display (actual calc is server-side)
    final approxTotal = planPrice + insPrice;

    return Container(
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
      decoration: const BoxDecoration(
        color: JT.bg,
        boxShadow: [BoxShadow(color: Colors.black45, blurRadius: 16, offset: Offset(0, -4))],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_selectedInsurancePlan != null || _selectedPlan != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                '₹${approxTotal.toStringAsFixed(0)} + GST  ·  Exact total shown before payment',
                style: TextStyle(color: Colors.white.withValues(alpha: 0.45), fontSize: 12),
              ),
            ),
          SizedBox(
            width: double.infinity,
            height: 54,
            child: Container(
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [JT.primary, JT.primary]),
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: JT.primary.withValues(alpha: 0.25),
                    blurRadius: 16,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: ElevatedButton(
                onPressed: (_isPaying || _selectedPlanId == null) ? null : _subscribe,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  disabledBackgroundColor: Colors.transparent,
                  shadowColor: Colors.transparent,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                child: _isPaying
                    ? const SizedBox(
                        width: 22, height: 22,
                        child: CircularProgressIndicator(color: JT.bg, strokeWidth: 2.5),
                      )
                    : const Text(
                        'Continue to Payment',
                        style: TextStyle(fontSize: 17, fontWeight: FontWeight.w500, color: JT.bg),
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
