import 'dart:convert';
import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../services/auth_service.dart';
import '../home/home_screen.dart';
import 'subscription_plans_screen.dart';

class ModelSelectionScreen extends StatefulWidget {
  const ModelSelectionScreen({super.key});

  @override
  State<ModelSelectionScreen> createState() => _ModelSelectionScreenState();
}

class _ModelSelectionScreenState extends State<ModelSelectionScreen> {
  String _selectedModel = 'commission';
  bool _isLoading = false;

  final Color _darkBg = JT.textPrimary;
  final Color _primary = JT.primary;
  final Color _surface = JT.surface;
  final Color _gold = const Color(0xFFFFD700);

  Future<void> _continue() async {
    if (_selectedModel == 'commission') {
      setState(() => _isLoading = true);
      try {
        final headers = await AuthService.getHeaders();
        final res = await http.post(
          Uri.parse('${ApiConfig.baseUrl}/api/app/driver/choose-model'),
          headers: {...headers, 'Content-Type': 'application/json'},
          body: jsonEncode({'model': 'commission'}),
        );

        if (res.statusCode == 200) {
          if (!mounted) return;
          Navigator.pushAndRemoveUntil(
            context,
            MaterialPageRoute(builder: (_) => const HomeScreen()),
            (route) => false,
          );
        } else {
          _showError('Failed to select model. Please try again.');
        }
      } catch (e) {
        _showError('Connection error. Please check your internet.');
      } finally {
        if (mounted) setState(() => _isLoading = false);
      }
    } else {
      Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => SubscriptionPlansScreen(selectedModel: _selectedModel)),
      );
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.red),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _darkBg,
      body: Stack(
        children: [
          // Header Gradient
          Container(
            height: MediaQuery.of(context).size.height * 0.4,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  _primary.withValues(alpha: 0.8),
                  _darkBg,
                ],
              ),
            ),
          ),
          SafeArea(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 40),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Choose Your Plan',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 32,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'How would you like to earn with JAGO Pro Pilot?',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.7),
                          fontSize: 16,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 40),
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Column(
                      children: [
                        _buildModelCard(
                          id: 'commission',
                          title: 'Commission Model',
                          subtitle: '₹0 upfront — JAGO Pro takes 15% per ride',
                          icon: Icons.handshake_outlined,
                          badge: 'FREE TO START',
                          badgeColor: Colors.green,
                          features: [
                            'No upfront payment',
                            'Pay only from earnings',
                            'Perfect for new drivers',
                          ],
                        ),
                        const SizedBox(height: 20),
                        _buildModelCard(
                          id: 'subscription',
                          title: 'Subscription Model',
                          subtitle: 'Pay once, earn 100%',
                          icon: Icons.calendar_month_outlined,
                          badge: 'SAVE MORE',
                          badgeColor: _gold,
                          features: [
                            'Keep 100% of every fare',
                            'Predictable costs',
                            'Best for active drivers',
                          ],
                          isSubscription: true,
                        ),
                        const SizedBox(height: 20),
                        _buildModelCard(
                          id: 'hybrid',
                          title: 'Hybrid Model',
                          subtitle: 'Lower commission + plan benefits',
                          icon: Icons.auto_graph_outlined,
                          badge: 'FLEXIBLE',
                          badgeColor: Colors.orange,
                          features: [
                            'Balanced fixed + variable charges',
                            'Works for mixed service demand',
                            'Better margin than pure commission',
                          ],
                          isSubscription: true,
                        ),
                      ],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Container(
                    width: double.infinity,
                    height: 56,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [_primary, const Color(0xFFFF8C42)],
                      ),
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: [
                        BoxShadow(
                          color: _primary.withValues(alpha: 0.3),
                          blurRadius: 12,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: ElevatedButton(
                      onPressed: _isLoading ? null : _continue,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.transparent,
                        shadowColor: Colors.transparent,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                      child: _isLoading
                          ? const CircularProgressIndicator(color: Colors.white)
                          : const Text(
                              'Continue',
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w500,
                                color: Colors.white,
                              ),
                            ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildModelCard({
    required String id,
    required String title,
    required String subtitle,
    required IconData icon,
    required String badge,
    required Color badgeColor,
    required List<String> features,
    bool isSubscription = false,
  }) {
    final isSelected = _selectedModel == id;
    return GestureDetector(
      onTap: () => setState(() => _selectedModel = id),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: isSelected && isSubscription 
              ? _primary.withValues(alpha: 0.1) 
              : _surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? _primary : JT.surfaceAlt,
            width: 2,
          ),
          boxShadow: isSelected ? [
            BoxShadow(
              color: _primary.withValues(alpha: 0.1),
              blurRadius: 20,
              offset: const Offset(0, 10),
            )
          ] : [],
        ),
        child: Stack(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: _primary.withValues(alpha: 0.1),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(icon, color: _primary, size: 28),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: badgeColor.withValues(alpha: 0.2),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              badge,
                              style: TextStyle(
                                color: badgeColor,
                                fontSize: 10,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Text(
                  subtitle,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.9),
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 16),
                const Divider(color: Colors.white10),
                const SizedBox(height: 12),
                ...features.map((f) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          Icon(Icons.check_circle,
                              color: Colors.green.shade400, size: 16),
                          const SizedBox(width: 8),
                          Text(
                            f,
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.6),
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    )),
              ],
            ),
            if (isSelected)
              Positioned(
                top: 0,
                right: 0,
                child: Container(
                  decoration: const BoxDecoration(
                    color: JT.primary,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.check, color: Colors.white, size: 20),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
