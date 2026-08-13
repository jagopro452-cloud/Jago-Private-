import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';
import '../main_screen.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../services/auth_service.dart';
import '../../src/core/config/api_config.dart';
import 'package:flutter/services.dart';

class TripCompletionScreen extends StatefulWidget {
  final Map<String, dynamic> trip;
  final double walletPendingAmount;

  const TripCompletionScreen({
    super.key,
    required this.trip,
    this.walletPendingAmount = 0.0,
  });

  @override
  State<TripCompletionScreen> createState() => _TripCompletionScreenState();
}

class _TripCompletionScreenState extends State<TripCompletionScreen> {
  static const Color _ridePrimary = Color(0xFF6366F1);
  static const Color _ridePrimaryDark = Color(0xFF4F4ACF);
  static const Color _rideSecondary = Color(0xFF8B5CF6);
  static const Color _rideBg = Color(0xFFF5F3FF);
  static const LinearGradient _rideGradient = LinearGradient(
    colors: [Color(0xFF4F4ACF), Color(0xFF6366F1)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  int _rated = 0;
  bool _isRatingSubmitted = false;
  int _currentIndex = 0; // For bottom nav mock consistency

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    final driverName = trip['driverName']?.toString() ?? 
                       trip['driver_name']?.toString() ?? 
                       trip['pilot_name']?.toString() ?? 'Driver';
    final driverPhoto = trip['driverPhoto']?.toString() ?? 
                        trip['driver_photo']?.toString();
    final driverRating = trip['driverRating'] ?? trip['driver_rating'] ?? '5.00';
    
    final from = trip['pickupShortName'] ?? trip['pickup_short_name'] ?? 
                 trip['pickupAddress'] ?? trip['pickup_address'] ?? 'Pickup';
    final to = trip['destinationShortName'] ?? trip['dest_short_name'] ?? 
               trip['destinationAddress'] ?? trip['destination_address'] ?? 'Destination';
    
    // Detailed fare extraction logic
    final fare = trip['actualFare'] ?? trip['actual_fare'] ?? 
                 trip['totalFare'] ?? trip['total_fare'] ??
                 trip['payableAmount'] ?? trip['payable_amount'] ??
                 trip['estimatedFare'] ?? trip['estimated_fare'] ?? 
                 trip['fare'] ?? '0.00';
    
    final actualFare = fare.toString();
    final distance = trip['estimatedDistance'] ?? trip['estimated_distance'] ?? 
                     trip['distanceKm'] ?? trip['distance_km'] ?? '';
    final pendingAmount = widget.walletPendingAmount;

    return Scaffold(
      backgroundColor: _rideBg,
      body: Column(
        children: [
          // Global Header (Matching MainScreen)
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  // Jago Logo
                  GestureDetector(
                    onTap: () {
                      Navigator.pushAndRemoveUntil(
                        context,
                        MaterialPageRoute(builder: (_) => const MainScreen()),
                        (_) => false,
                      );
                    },
                    child: JT.logoBlue(height: 56),
                  ),
                  
                  // Actions: Wallet & Notifications
                  Row(
                    children: [
                      _headerAction(Icons.account_balance_wallet_outlined),
                      const SizedBox(width: 12),
                      _headerAction(Icons.notifications_none_rounded),
                    ],
                  ),
                ],
              ),
            ),
          ),

          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(
                children: [
                  const SizedBox(height: 10),
                  // Trip Completed Banner
                  _buildStatusBanner(),
                  const SizedBox(height: 20),
                  
                  // Main Design Card
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [
                          Color(0xFFFFFFFF),
                          Color(0xFFF8FBFF),
                        ],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(32),
                      border: Border.all(color: JT.border),
                      boxShadow: [
                        BoxShadow(
                          color: JT.textPrimary.withValues(alpha: 0.06),
                          blurRadius: 28,
                          offset: const Offset(0, 12),
                        ),
                      ],
                    ),
                    child: Stack(
                      children: [
                        // Background decorative dots
                        Positioned(
                          top: 0,
                          right: 0,
                          child: Row(
                            children: [
                              _dot(const Color(0xFFFACC15), 6),
                              const SizedBox(width: 20),
                              _dot(const Color(0xFFC084FC), 4),
                            ],
                          ),
                        ),
                        Positioned(
                          top: 20,
                          right: 30,
                          child: _dot(const Color(0xFF4ADE80), 5),
                        ),

                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // "Your ride is ended" Header
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(6),
                                  decoration: const BoxDecoration(
                                    color: JT.success,
                                    shape: BoxShape.circle,
                                  ),
                                  child: const Icon(Icons.check, color: Colors.white, size: 16),
                                ),
                                const SizedBox(width: 12),
                                Text(
                                  'Your ride is complete',
                                  style: GoogleFonts.poppins(
                                    fontSize: 18,
                                    fontWeight: FontWeight.w700,
                                    color: JT.textPrimary,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 24),

                            // Driver Info Row
                            _buildPilotCard(driverName, driverPhoto, driverRating),
                            const SizedBox(height: 20),

                            // Actions Row (Chat, Call, SOS)
                            _buildActionRow(driverName),
                            const SizedBox(height: 16),

                            _buildTripHighlights(actualFare, distance),
                            const SizedBox(height: 20),

                            // Route Details
                            _buildRouteDetails(from, to),
                            const SizedBox(height: 24),

                            // Final Fare
                            _buildFareDisplay(actualFare, distance),
                            if (pendingAmount > 0) ...[
                              const SizedBox(height: 12),
                              _buildPendingPayment(pendingAmount),
                            ],
                            const SizedBox(height: 32),

                            // Rating Section
                            Center(
                              child: Column(
                                children: [
                                  Text(
                                    _isRatingSubmitted ? 'Rating received!' : 'Rate your Driver',
                                    style: GoogleFonts.poppins(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w500,
                                      color: JT.textSecondary,
                                    ),
                                  ),
                                  const SizedBox(height: 12),
                                  _buildStarRating(),
                                ],
                              ),
                            ),
                            const SizedBox(height: 24),

                            // Finished Button
                            _rideGradientButton(
                              label: 'Finished',
                              onTap: () {
                                Navigator.pushAndRemoveUntil(
                                  context,
                                  MaterialPageRoute(builder: (_) => const MainScreen()),
                                  (_) => false,
                                );
                              },
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 30),
                ],
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: _buildBottomNav(),
    );
  }

  Widget _headerAction(IconData icon) {
    return GestureDetector(
      onTap: () {
        Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (_) => const MainScreen()), // Navigation with target index would be better if MainScreen supported it via constructor
          (_) => false,
        );
      },
      child: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: JT.textPrimary.withValues(alpha: 0.04),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Icon(icon, color: JT.textSecondary, size: 24),
      ),
    );
  }

  Widget _buildStatusBanner() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 20),
      decoration: BoxDecoration(
        gradient: _rideGradient,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: _ridePrimaryDark.withValues(alpha: 0.22),
            blurRadius: 15,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.2),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.stars_rounded, color: Colors.white, size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Trip Completed!',
                  style: GoogleFonts.poppins(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
                Text(
                  'Your journey has ended safely.',
                  style: GoogleFonts.poppins(
                    color: Colors.white.withValues(alpha: 0.8),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPilotCard(String name, String? photo, dynamic rating) {
    return Container(
      padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: JT.border),
        boxShadow: [
          BoxShadow(
            color: JT.textPrimary.withValues(alpha: 0.04),
            blurRadius: 18,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: JT.border,
              shape: BoxShape.circle,
              image: photo != null
                  ? DecorationImage(image: NetworkImage(photo), fit: BoxFit.cover)
                  : null,
            ),
            child: photo == null
                ? const Icon(Icons.person, color: Colors.white, size: 30)
                : null,
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        name,
                        style: GoogleFonts.poppins(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: JT.textPrimary),
                      ),
                    ),
                    const SizedBox(width: 6),
                    const Icon(Icons.verified, color: JT.primary, size: 16),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Container(
                      padding:
                          const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFFBEB),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.star_rounded,
                              color: Color(0xFFFFB800), size: 16),
                          const SizedBox(width: 4),
                          Text(
                            rating.toString(),
                            style: GoogleFonts.poppins(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: const Color(0xFF92400E)),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding:
                          const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF1F5F9),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        'Driver',
                        style: GoogleFonts.poppins(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: JT.textSecondary),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTripHighlights(dynamic actualFare, dynamic distance) {
    return Row(
      children: [
        _highlightChip(
          icon: Icons.electric_bike_rounded,
          label: 'RIDE',
          value: 'Completed',
          accent: _ridePrimary,
        ),
        const SizedBox(width: 12),
        _highlightChip(
          icon: Icons.currency_rupee_rounded,
          label: 'FARE',
          value: '₹${actualFare.toString()}',
          accent: JT.success,
        ),
        if (distance.toString().isNotEmpty) ...[
          const SizedBox(width: 12),
          _highlightChip(
            icon: Icons.route_rounded,
            label: 'DISTANCE',
            value: '${distance.toString()} km',
            accent: _rideSecondary,
          ),
        ],
      ],
    );
  }

  Widget _highlightChip({
    required IconData icon,
    required String label,
    required String value,
    required Color accent,
  }) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              Colors.white,
              accent.withValues(alpha: 0.06),
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: accent.withValues(alpha: 0.14)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: accent.withValues(alpha: 0.10),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 16, color: accent),
            ),
            const SizedBox(height: 10),
            Text(
              label,
              style: GoogleFonts.poppins(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: const Color(0xFF94A3B8),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: GoogleFonts.poppins(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: const Color(0xFF0F172A),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActionRow(String driverName) {
    return Row(
      children: [
        Expanded(
          child: Container(
            height: 56,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Row(
              children: [
                const Icon(Icons.chat_bubble_outline, size: 20, color: Color(0xFF94A3B8)),
                const SizedBox(width: 12),
                Text(
                  'Message $driverName...',
                  style: GoogleFonts.poppins(color: const Color(0xFF94A3B8), fontSize: 13),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 12),
        _iconBtn(Icons.call_outlined, const Color(0xFF2D8CFF), const Color(0xFFE0F2FE)),
        const SizedBox(width: 12),
        _iconBtn(Icons.sos, const Color(0xFFEF4444), const Color(0xFFFEF2F2)),
      ],
    );
  }

  Widget _iconBtn(IconData icon, Color color, Color bg) {
    return Container(
      width: 52,
      height: 56,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Icon(icon, color: color, size: 22),
    );
  }

  Widget _buildRouteDetails(dynamic from, dynamic to) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            const Icon(Icons.circle, size: 10, color: Color(0xFF2D8CFF)),
            Container(
              width: 1.5,
              height: 36,
              color: const Color(0xFFCBD5E1),
              margin: const EdgeInsets.symmetric(vertical: 4),
            ),
            const Icon(Icons.location_on, size: 16, color: Color(0xFFEF4444)),
          ],
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Pickup',
                    style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF2D8CFF), fontWeight: FontWeight.w600),
                  ),
                  Text(
                    from.toString(),
                    style: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF64748B)),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Destination',
                    style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFFEF4444), fontWeight: FontWeight.w600),
                  ),
                  Text(
                    to.toString(),
                    style: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF64748B)),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildFareDisplay(dynamic actualFare, dynamic distance) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            Color(0xFFF8FBFF),
            Color(0xFFFFFFFF),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: JT.border),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Final Fare',
                style: GoogleFonts.poppins(
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                  color: JT.textSecondary,
                ),
              ),
              Text(
                '₹${actualFare.toString()}',
                style: GoogleFonts.poppins(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: _ridePrimary,
                ),
              ),
            ],
          ),
          if (distance.toString().isNotEmpty) ...[
            const Divider(height: 24, color: Color(0xFFE2E8F0)),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Distance Traveled',
                  style: GoogleFonts.poppins(
                    fontSize: 13,
                    color: JT.textTertiary,
                  ),
                ),
                Text(
                  '${distance.toString()} km',
                  style: GoogleFonts.poppins(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: JT.textSecondary,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPendingPayment(double amount) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            Color(0xFFFFF7ED),
            Color(0xFFFFFFFF),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFED7AA)),
      ),
      child: Row(children: [
        const Icon(Icons.info_outline_rounded, color: Color(0xFFEA580C), size: 16),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            '₹${amount.toStringAsFixed(2)} to be paid in cash/UPI',
            style: GoogleFonts.poppins(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: const Color(0xFF9A3412),
            ),
          ),
        ),
      ]),
    );
  }

  Future<void> _rateDriver(int stars) async {
    if (_isRatingSubmitted) return;
    setState(() {
      _rated = stars;
      _isRatingSubmitted = true;
    });
    HapticFeedback.mediumImpact();
    
    try {
      final headers = await AuthService.getHeaders();
      await http.post(
        Uri.parse(ApiConfig.rateDriver),
        headers: headers,
        body: jsonEncode({
          'tripId': widget.trip['id']?.toString(),
          'driverId': widget.trip['driverId']?.toString() ?? widget.trip['driver_id']?.toString(),
          'rating': stars,
        }),
      );
    } catch (e) {
      debugPrint('Rating failed: $e');
    }
  }

  Widget _buildStarRating() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: const Color(0xFFFCFCFF),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: List.generate(5, (index) {
          final starIndex = index + 1;
          final isFilled = starIndex <= _rated;
          return GestureDetector(
            onTap: () => _rateDriver(starIndex),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Icon(
                isFilled ? Icons.star_rounded : Icons.star_outline_rounded,
                size: 40,
                color:
                    isFilled ? const Color(0xFFFFB800) : const Color(0xFFE2E8F0),
              ),
            ),
          );
        }),
      ),
    );
  }

  Widget _buildBottomNav() {
    return Container(
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
              _navItem(0, Icons.home_rounded, Icons.home_outlined, 'Home'),
              _navItem(1, Icons.receipt_long_rounded, Icons.receipt_long_outlined, 'Trips'),
              _navItem(2, Icons.account_balance_wallet_rounded, Icons.account_balance_wallet_outlined, 'Wallet'),
              _navItem(3, Icons.person_rounded, Icons.person_outline_rounded, 'Profile'),
            ],
          ),
        ),
      ),
    );
  }

  Widget _navItem(int index, IconData activeIcon, IconData inactiveIcon, String label) {
    bool isSelected = index == _currentIndex;
    return GestureDetector(
      onTap: () {
        setState(() => _currentIndex = index);
        // Navigate back to main screen with selected tab if needed
        Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (_) => const MainScreen()), // In real app, you might pass the index
          (_) => false,
        );
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: isSelected
            ? BoxDecoration(
                gradient: _rideGradient,
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                    color: _ridePrimaryDark.withValues(alpha: 0.3),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
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

  Widget _dot(Color color, double size) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
      ),
    );
  }

  Widget _rideGradientButton({
    required String label,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 54,
        decoration: BoxDecoration(
          gradient: _rideGradient,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: _ridePrimaryDark.withValues(alpha: 0.28),
              blurRadius: 14,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Center(
          child: Text(
            label,
            style: GoogleFonts.poppins(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: Colors.white,
            ),
          ),
        ),
      ),
    );
  }
}
