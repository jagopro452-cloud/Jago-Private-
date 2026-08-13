import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';

class RideForWhomScreen extends StatefulWidget {
  final String vehicleName;

  const RideForWhomScreen({super.key, required this.vehicleName});

  @override
  State<RideForWhomScreen> createState() => _RideForWhomScreenState();
}

class _RideForWhomScreenState extends State<RideForWhomScreen> {
  int _selectedOption = 1; // 1 = For Myself, 2 = For Someone Else
  
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _noteCtrl = TextEditingController();

  void _onBookRide() {
    if (_selectedOption == 2) {
      if (_nameCtrl.text.trim().isEmpty) {
        _showError('Please enter passenger name');
        return;
      }
      final phone = _phoneCtrl.text.trim();
      if (phone.isEmpty || phone.length < 10) {
        _showError('Please enter valid mobile number');
        return;
      }
    }

    Navigator.pop(context, {
      'isForSomeone': _selectedOption == 2,
      'name': _nameCtrl.text.trim(),
      'phone': _phoneCtrl.text.trim(),
      'note': _noteCtrl.text.trim(),
    });
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg, style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w500)),
      backgroundColor: JT.error,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      margin: const EdgeInsets.all(16),
    ));
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _noteCtrl.dispose();
    super.dispose();
  }

  Widget _buildOptionCard({
    required int value,
    required String title,
    required String subtitle,
    required IconData icon,
  }) {
    final isSelected = _selectedOption == value;
    
    return GestureDetector(
      onTap: () => setState(() => _selectedOption = value),
      child: AnimatedContainer(
        duration: JT.animationMedium,
        curve: Curves.easeInOut,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: isSelected ? JT.primary.withValues(alpha: 0.05) : JT.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? JT.primary : JT.borderLight,
            width: isSelected ? 2 : 1.5,
          ),
          boxShadow: isSelected ? [
            BoxShadow(
              color: JT.primary.withValues(alpha: 0.12),
              blurRadius: 20,
              offset: const Offset(0, 8),
            )
          ] : [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.02),
              blurRadius: 10,
              offset: const Offset(0, 4),
            )
          ],
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                gradient: isSelected ? JT.grad : LinearGradient(colors: [JT.bgSoft, JT.borderLight]),
                shape: BoxShape.circle,
                boxShadow: isSelected ? [
                  BoxShadow(color: JT.primary.withValues(alpha: 0.2), blurRadius: 10, offset: const Offset(0, 4))
                ] : [],
              ),
              child: Icon(icon, color: isSelected ? Colors.white : JT.textTertiary, size: 24),
            ),
            const SizedBox(width: 18),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: JT.h5.copyWith(
                    color: isSelected ? JT.primary : JT.textPrimary,
                    fontWeight: isSelected ? FontWeight.w700 : FontWeight.w600,
                  )),
                  const SizedBox(height: 4),
                  Text(subtitle, style: JT.caption.copyWith(
                    color: isSelected ? JT.primary.withValues(alpha: 0.7) : JT.textSecondary,
                  )),
                ],
              ),
            ),
            AnimatedContainer(
              duration: JT.animationFast,
              width: 24, height: 24,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: isSelected ? JT.primary : JT.iconInactive,
                  width: isSelected ? 7 : 2,
                ),
                color: Colors.white,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInputField({
    required TextEditingController controller,
    required String label,
    required String hint,
    required IconData icon,
    TextInputType keyboardType = TextInputType.text,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text(label, style: JT.subtitle2.copyWith(fontWeight: FontWeight.w600, color: JT.textPrimary)),
        ),
        TextField(
          controller: controller,
          keyboardType: keyboardType,
          style: JT.bodyPrimary.copyWith(fontWeight: FontWeight.w500),
          decoration: JT.modernInputDecoration(
            labelText: '',
            hintText: hint,
            prefixIcon: Icon(icon, size: 20, color: JT.primary.withValues(alpha: 0.6)),
          ).copyWith(
            contentPadding: const EdgeInsets.all(18),
            fillColor: Colors.white,
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F3FF),
      body: Column(
        children: [
          // Global Header
          SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  GestureDetector(
                    onTap: () => Navigator.pop(context),
                    child: JT.logoBlue(height: 56),
                  ),
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
            child: Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
              ),
              child: ClipRRect(
                borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
                child: Column(
                  children: [
                    Expanded(
                      child: SingleChildScrollView(
                        physics: const BouncingScrollPhysics(),
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Who is this ride for?', 
                              style: JT.h2.copyWith(fontSize: 22, height: 1.2)),
                            const SizedBox(height: 8),
                            Text('Manage ride details for you or your friends', 
                              style: JT.subtitle2),
                            const SizedBox(height: 32),
                            
                            _buildOptionCard(
                              value: 1,
                              title: 'For Myself',
                              subtitle: 'Primary account holder',
                              icon: Icons.person_rounded,
                            ),
                            const SizedBox(height: 16),
                            _buildOptionCard(
                              value: 2,
                              title: 'Someone Else',
                              subtitle: 'Book for family or colleagues',
                              icon: Icons.people_alt_rounded,
                            ),
                            
                            AnimatedSwitcher(
                              duration: JT.animationMedium,
                              transitionBuilder: (child, animation) => FadeTransition(
                                opacity: animation,
                                child: SlideTransition(
                                  position: Tween<Offset>(begin: const Offset(0, 0.05), end: Offset.zero).animate(animation),
                                  child: child,
                                ),
                              ),
                              child: _selectedOption == 2 ? Padding(
                                key: const ValueKey('second_option_details'),
                                padding: const EdgeInsets.only(top: 40),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        const Icon(Icons.badge_rounded, color: JT.primary, size: 20),
                                        const SizedBox(width: 8),
                                        Text('Passenger Information', style: JT.h5),
                                      ],
                                    ),
                                    const SizedBox(height: 24),
                                    _buildInputField(
                                      controller: _nameCtrl,
                                      label: 'Passenger Name',
                                      hint: 'Enter full name',
                                      icon: Icons.person_outline_rounded,
                                    ),
                                    const SizedBox(height: 20),
                                    _buildInputField(
                                      controller: _phoneCtrl,
                                      label: 'Mobile Number',
                                      hint: '+91 99999 99999',
                                      icon: Icons.phone_outlined,
                                      keyboardType: TextInputType.phone,
                                    ),
                                    const SizedBox(height: 20),
                                    _buildInputField(
                                      controller: _noteCtrl,
                                      label: 'Add a Note (Optional)',
                                      hint: 'Pickup landmarks / special instructions',
                                      icon: Icons.notes_rounded,
                                    ),
                                  ],
                                ),
                              ) : const SizedBox.shrink(),
                            )
                          ],
                        ),
                      ),
                    ),
                    
                    // Bottom Button Action
                    Container(
                      padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        boxShadow: [
                          BoxShadow(color: Colors.black.withValues(alpha: 0.05), offset: const Offset(0, -10), blurRadius: 20),
                        ],
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
                      ),
                      child: JT.gradientButton(
                        label: _selectedOption == 1 ? 'Book My Ride' : 'Book for Passenger',
                        onTap: _onBookRide,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
      bottomNavigationBar: _buildBottomNav(),
    );
  }

  Widget _headerAction(IconData icon) {
    return Container(
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
    bool isSelected = index == 0;
    return GestureDetector(
      onTap: () => Navigator.pop(context),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: isSelected
            ? BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF7C3AED), Color(0xFF6366F1)], 
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

