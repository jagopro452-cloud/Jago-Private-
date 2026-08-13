import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import 'b2b_login_screen.dart';
import 'b2b_register_screen.dart';

class B2BDashboardScreen extends StatefulWidget {
  const B2BDashboardScreen({super.key});
  @override
  State<B2BDashboardScreen> createState() => _B2BDashboardScreenState();
}

class _B2BDashboardScreenState extends State<B2BDashboardScreen> {
  bool _loading = true;
  bool _notFound = false;
  bool _isB2BSession = false; // true = logged in via B2B email/password
  Map<String, dynamic>? _company;
  Map<String, dynamic>? _stats;
  List<dynamic> _recentOrders = [];

  @override
  void initState() {
    super.initState();
    _fetchDashboard();
  }

  Future<void> _fetchDashboard() async {
    setState(() { _loading = true; _notFound = false; });
    try {
      // Check if user is in a B2B login session (via email/password)
      final prefs = await SharedPreferences.getInstance();
      final b2bCompanyId = prefs.getString('b2b_company_id');

      http.Response res;
      if (b2bCompanyId != null && b2bCompanyId.isNotEmpty) {
        _isB2BSession = true;
        res = await http.post(
          Uri.parse(ApiConfig.b2bDashboardById),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'companyId': b2bCompanyId}),
        ).timeout(const Duration(seconds: 15));
      } else {
        _isB2BSession = false;
        final headers = await AuthService.getHeaders();
        res = await http.get(
          Uri.parse(ApiConfig.b2bDashboard),
          headers: headers,
        ).timeout(const Duration(seconds: 15));
      }

      if (!mounted) return;
      if (res.statusCode == 404) {
        setState(() { _notFound = true; _loading = false; });
        return;
      }
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        setState(() {
          _company = data['company'] as Map<String, dynamic>?;
          _stats = data['stats'] as Map<String, dynamic>?;
          _recentOrders = data['recentOrders'] as List<dynamic>? ?? [];
          _loading = false;
        });
      } else {
        setState(() => _loading = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('b2b_company_id');
    await prefs.remove('b2b_company_name');
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const B2BLoginScreen()),
    );
  }

  Color _statusColor(String? s) {
    switch (s) {
      case 'completed': return JT.success;
      case 'cancelled': return JT.error;
      case 'in_transit': return JT.primary;
      case 'driver_assigned': return Colors.orange;
      default: return JT.textSecondary;
    }
  }

  String _statusLabel(String? s) {
    switch (s) {
      case 'completed': return 'Delivered';
      case 'cancelled': return 'Cancelled';
      case 'in_transit': return 'In Transit';
      case 'driver_assigned': return 'Driver Assigned';
      case 'searching': return 'Searching';
      default: return s ?? '—';
    }
  }

  String _planLabel(String? p) {
    switch (p) {
      case 'subscription': return 'Subscription';
      case 'credit': return 'Credit Account';
      default: return 'Pay Per Delivery';
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        backgroundColor: JT.bgSoft,
        appBar: _appBar(),
        body: const Center(child: CircularProgressIndicator(color: JT.primary)),
      );
    }

    if (_notFound) {
      return Scaffold(
        backgroundColor: JT.bgSoft,
        appBar: _appBar(),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: JT.primary.withValues(alpha: 0.08),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.business_center_rounded, color: JT.primary, size: 52),
                ),
                const SizedBox(height: 24),
                Text('No B2B Account', style: JT.h2),
                const SizedBox(height: 10),
                Text(
                  'Register your business to get bulk delivery rates and dedicated support.',
                  style: JT.body,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                SizedBox(
                  width: double.infinity,
                  child: JT.gradientButton(
                    label: 'Register Your Business',
                    onTap: () => Navigator.of(context).pushReplacement(
                      MaterialPageRoute(builder: (_) => const B2BRegisterScreen()),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final company = _company ?? {};
    final stats = _stats ?? {};
    final walletBal = double.tryParse(company['walletBalance']?.toString() ?? '0') ?? 0;
    final creditLimit = double.tryParse(company['creditLimit']?.toString() ?? '0') ?? 0;
    final commPct = double.tryParse(company['commissionPct']?.toString() ?? '0') ?? 0;
    final companyStatus = company['status']?.toString() ?? 'pending';
    final isPending = companyStatus == 'pending';

    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: _appBar(
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _fetchDashboard,
            tooltip: 'Refresh',
          ),
          if (!_isB2BSession)
            IconButton(
              icon: const Icon(Icons.edit_rounded),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const B2BRegisterScreen()),
              ).then((_) => _fetchDashboard()),
              tooltip: 'Edit Profile',
            ),
          if (_isB2BSession)
            IconButton(
              icon: const Icon(Icons.logout_rounded),
              onPressed: _logout,
              tooltip: 'Logout',
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _fetchDashboard,
        color: JT.primary,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Pending notice
              if (isPending)
                Container(
                  margin: const EdgeInsets.only(bottom: 16),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(
                    color: JT.warning.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: JT.warning.withValues(alpha: 0.3)),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.access_time_rounded, color: JT.warning, size: 20),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'Account pending approval. You will be notified once approved.',
                          style: TextStyle(color: JT.warning, fontSize: 13, fontWeight: FontWeight.w500),
                        ),
                      ),
                    ],
                  ),
                ),

              // Company header
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: JT.grad,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: const Icon(Icons.business_rounded, color: Colors.white, size: 24),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                company['companyName']?.toString() ?? '—',
                                style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w500),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                _planLabel(company['deliveryPlan']?.toString()),
                                style: const TextStyle(color: Colors.white70, fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: isPending
                                ? JT.warning.withValues(alpha: 0.2)
                                : Colors.green.withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: isPending ? JT.warning : Colors.green, width: 1),
                          ),
                          child: Text(
                            isPending ? 'Pending' : 'Active',
                            style: TextStyle(
                              color: isPending ? JT.warning : Colors.greenAccent,
                              fontSize: 11,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    // Wallet row
                    Row(
                      children: [
                        Expanded(child: _walletChip('Wallet Balance', '₹${walletBal.toStringAsFixed(0)}', Icons.account_balance_wallet_rounded)),
                        const SizedBox(width: 10),
                        if (creditLimit > 0)
                          Expanded(child: _walletChip('Credit Limit', '₹${creditLimit.toStringAsFixed(0)}', Icons.credit_card_rounded)),
                        if (creditLimit == 0)
                          Expanded(child: _walletChip('Commission', '${commPct.toStringAsFixed(1)}%', Icons.percent_rounded)),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),

              // Stats grid
              _sectionLabel('Delivery Stats'),
              const SizedBox(height: 12),
              GridView.count(
                crossAxisCount: 2,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                childAspectRatio: 1.6,
                children: [
                  _statCard('Total Orders', '${stats['totalOrders'] ?? 0}', Icons.local_shipping_rounded, JT.primary),
                  _statCard('Delivered', '${stats['completedOrders'] ?? 0}', Icons.check_circle_rounded, JT.success),
                  _statCard('Active', '${stats['activeOrders'] ?? 0}', Icons.directions_bike_rounded, Colors.orange),
                  _statCard('Cancelled', '${stats['cancelledOrders'] ?? 0}', Icons.cancel_rounded, JT.error),
                ],
              ),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  boxShadow: JT.cardShadow,
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: JT.primary.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.currency_rupee_rounded, color: JT.primary, size: 22),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Total Spent', style: TextStyle(fontSize: 12, color: JT.textSecondary)),
                        Text(
                          '₹${(double.tryParse(stats['totalSpent']?.toString() ?? '0') ?? 0).toStringAsFixed(2)}',
                          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w500, color: JT.textPrimary),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // Recent orders
              if (_recentOrders.isNotEmpty) ...[
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _sectionLabel('Recent Orders'),
                    Text('Last 10', style: TextStyle(fontSize: 11, color: JT.textSecondary)),
                  ],
                ),
                const SizedBox(height: 12),
                Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: JT.cardShadow,
                  ),
                  child: ListView.separated(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    itemCount: _recentOrders.length,
                    separatorBuilder: (_, __) => Divider(height: 1, color: JT.border),
                    itemBuilder: (_, i) {
                      final o = _recentOrders[i] as Map<String, dynamic>;
                      final status = o['currentStatus']?.toString();
                      final fare = double.tryParse(o['totalFare']?.toString() ?? '0') ?? 0;
                      final addr = o['pickupAddress']?.toString() ?? '—';
                      final driver = o['driverName']?.toString();
                      return ListTile(
                        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                        leading: Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: _statusColor(status).withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Icon(Icons.local_shipping_rounded, color: _statusColor(status), size: 20),
                        ),
                        title: Text(
                          addr.length > 40 ? '${addr.substring(0, 40)}…' : addr,
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const SizedBox(height: 2),
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: _statusColor(status).withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(
                                    _statusLabel(status),
                                    style: TextStyle(color: _statusColor(status), fontSize: 10, fontWeight: FontWeight.w500),
                                  ),
                                ),
                                if (driver != null) ...[
                                  const SizedBox(width: 6),
                                  Text('• $driver', style: TextStyle(fontSize: 11, color: JT.textSecondary)),
                                ],
                              ],
                            ),
                          ],
                        ),
                        trailing: fare > 0
                            ? Text('₹${fare.toStringAsFixed(0)}',
                                style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 14, color: JT.textPrimary))
                            : null,
                      );
                    },
                  ),
                ),
              ],

              if (_recentOrders.isEmpty)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(32),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: JT.cardShadow,
                  ),
                  child: Column(
                    children: [
                      Icon(Icons.inventory_2_rounded, size: 48, color: JT.border),
                      const SizedBox(height: 12),
                      Text('No deliveries yet', style: JT.body),
                    ],
                  ),
                ),

              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }

  AppBar _appBar({List<Widget>? actions}) => AppBar(
    backgroundColor: JT.primary,
    foregroundColor: Colors.white,
    title: const Text('B2B Dashboard', style: TextStyle(fontWeight: FontWeight.w500)),
    elevation: 0,
    actions: actions,
  );

  Widget _sectionLabel(String label) => Text(
    label,
    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: JT.textPrimary),
  );

  Widget _walletChip(String label, String value, IconData icon) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.15),
      borderRadius: BorderRadius.circular(10),
      border: Border.all(color: Colors.white24),
    ),
    child: Row(
      children: [
        Icon(icon, color: Colors.white70, size: 16),
        const SizedBox(width: 6),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(color: Colors.white60, fontSize: 10)),
              Text(value, style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w500)),
            ],
          ),
        ),
      ],
    ),
  );

  Widget _statCard(String label, String value, IconData icon, Color color) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14),
      boxShadow: JT.cardShadow,
    ),
    child: Row(
      children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, color: color, size: 20),
        ),
        const SizedBox(width: 10),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: JT.textPrimary)),
            Text(label, style: TextStyle(fontSize: 10, color: JT.textSecondary)),
          ],
        ),
      ],
    ),
  );
}
