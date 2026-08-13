import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/jago_theme.dart';
import 'home/home_screen.dart';
import 'history/trips_history_screen.dart';
import 'wallet/wallet_screen.dart';
import 'profile/profile_screen.dart';
import 'notifications/notifications_screen.dart';
import '../services/auth_service.dart';
import '../src/core/config/api_config.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

class MainScreen extends StatefulWidget {
  const MainScreen({super.key});

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  int _currentIndex = 0;
  int _unreadNotifCount = 0;

  final List<Widget> _pages = [
    const HomeScreen(),
    const TripsHistoryScreen(),
    const WalletScreen(),
    const ProfileScreen(),
  ];

  @override
  void initState() {
    super.initState();
    _fetchUnreadCount();
  }

  Future<void> _fetchUnreadCount() async {
    try {
      final headers = await AuthService.getHeaders();
      final r = await http
          .get(Uri.parse('${ApiConfig.baseUrl}/api/app/notifications?limit=1'),
              headers: headers)
          .timeout(const Duration(seconds: 8));
      if (r.statusCode == 200 && mounted) {
        final data = jsonDecode(r.body);
        setState(() => _unreadNotifCount = (data['unreadCount'] as int?) ?? 0);
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarColor: Colors.white,
      systemNavigationBarIconBrightness: Brightness.dark,
    ));

    return Scaffold(
      backgroundColor: const Color(0xFFF5F3FF), // Match lavender theme
      body: Column(
        children: [
          // Global Header
          SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 10),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  // Jago Logo
                  GestureDetector(
                    onTap: () => setState(() => _currentIndex = 3), // Navigate to Profile
                    child: JT.logoBlue(height: 56),
                  ),
                  
                  // Actions: Wallet & Notifications
                  Row(
                    children: [
                      // Wallet Button
                      _headerAction(2, Icons.account_balance_wallet_outlined),
                      const SizedBox(width: 12),
                      // Notification Bell
                      GestureDetector(
                        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen())).then((_) => _fetchUnreadCount()),
                        child: Container(
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(16),
                            boxShadow: [
                              BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 10, offset: const Offset(0, 4)),
                            ],
                          ),
                          child: Stack(
                            alignment: Alignment.center,
                            children: [
                              const Icon(Icons.notifications_none_rounded, color: Color(0xFF64748B), size: 24),
                              if (_unreadNotifCount > 0) 
                                Positioned(
                                  top: 12,
                                  right: 12,
                                  child: Container(
                                    width: 8,
                                    height: 8,
                                    decoration: const BoxDecoration(
                                      color: Color(0xFFEF4444),
                                      shape: BoxShape.circle,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          
          // Main Content
          Expanded(
            child: Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
              ),
              child: ClipRRect(
                borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
                child: IndexedStack(
                  index: _currentIndex,
                  children: _pages,
                ),
              ),
            ),
          ),
        ],
      ),
      
      // Global Bottom Navigation
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: Colors.grey.shade100, width: 1)),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildNavItem(0, Icons.home_rounded, Icons.home_outlined, "Home"),
                _buildNavItem(1, Icons.receipt_long_rounded, Icons.receipt_long_outlined, "Trips"),
                _buildNavItem(2, Icons.account_balance_wallet_rounded, Icons.account_balance_wallet_outlined, "Wallet"),
                _buildNavItem(3, Icons.person_rounded, Icons.person_outline_rounded, "Profile"),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _headerAction(int targetIndex, IconData icon) {
    return GestureDetector(
      onTap: () => setState(() => _currentIndex = targetIndex),
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 10, offset: const Offset(0, 4)),
          ],
        ),
        child: Icon(icon, color: const Color(0xFF64748B), size: 24),
      ),
    );
  }

  Widget _buildNavItem(int index, IconData activeIcon, IconData inactiveIcon, String label) {
    final isSelected = _currentIndex == index;
    return GestureDetector(
      onTap: () => setState(() => _currentIndex = index),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: isSelected
            ? BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF7C3AED), Color(0xFF6366F1)], // Premium Purple Gradient
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(color: const Color(0xFF7C3AED).withValues(alpha: 0.3), blurRadius: 10, offset: const Offset(0, 4)),
                ],
              )
            : null,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              isSelected ? activeIcon : inactiveIcon,
              color: isSelected ? Colors.white : const Color(0xFF94A3B8),
              size: 22,
            ),
            if (isSelected) ...[
              const SizedBox(width: 8),
              Text(
                label,
                style: GoogleFonts.poppins(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
              ),
            ]
          ],
        ),
      ),
    );
  }
}
