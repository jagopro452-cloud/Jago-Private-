import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';

/// Assigned-driver summary card (photo, name, rating, vehicle number/model,
/// vehicle-type icon, "Verified" pill).
///
/// Extracted verbatim from `TrackingScreen._buildPremiumDriverCard`
/// (Bike/Auto reference implementation). [vehicleIcon] is passed in rather
/// than resolved internally, since the icon-for-vehicle-label lookup lives
/// on each screen's own state (`_resolveVehicleLabel`/`_iconForVehicleLabel`
/// in `TrackingScreen`, the pool-driver vehicle type in
/// `LocalPoolStatusScreen`) and must stay untouched business logic.
///
/// [extraBadge], when supplied, renders directly beneath the "Verified"
/// pill — e.g. Car Share's seat-count chip.
class DriverMatchedCard extends StatelessWidget {
  final String name;
  final dynamic rating;
  final String? photo;
  final String vehicleNum;
  final String vehicleModel;
  final String? phone;
  final IconData vehicleIcon;
  final Widget? extraBadge;

  const DriverMatchedCard({
    super.key,
    required this.name,
    required this.rating,
    required this.photo,
    required this.vehicleNum,
    required this.vehicleModel,
    required this.phone,
    required this.vehicleIcon,
    this.extraBadge,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.primary.withValues(alpha: 0.08), width: 1),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: JT.border,
              shape: BoxShape.circle,
              image: photo != null && photo!.isNotEmpty
                  ? DecorationImage(image: NetworkImage(photo!), fit: BoxFit.cover)
                  : null,
            ),
            child: (photo == null || photo!.isEmpty)
                ? const Icon(Icons.person_rounded, color: Colors.white, size: 26)
                : null,
          ),
          const SizedBox(width: 12),
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
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                          color: JT.textPrimary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.green[50],
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.star_rounded, color: Colors.green, size: 11),
                          const SizedBox(width: 2),
                          Text(
                            rating?.toString() ?? '4.8',
                            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: Colors.green),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 5),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: JT.border, width: 1),
                  ),
                  child: Text(
                    vehicleNum.isNotEmpty ? vehicleNum.toUpperCase() : '...',
                    style: GoogleFonts.poppins(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: JT.textPrimary,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  vehicleModel.isNotEmpty ? vehicleModel : 'Jago Pilot',
                  style: GoogleFonts.poppins(fontSize: 11, color: JT.textSecondary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFF),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: JT.primary.withValues(alpha: 0.12)),
                ),
                child: Icon(vehicleIcon, color: JT.primary, size: 20),
              ),
              const SizedBox(height: 5),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                decoration: BoxDecoration(
                  color: JT.primary,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.check_rounded, color: Colors.white, size: 10),
                    const SizedBox(width: 2),
                    Text('Verified',
                        style: GoogleFonts.poppins(fontSize: 8.5, fontWeight: FontWeight.w600, color: Colors.white)),
                  ],
                ),
              ),
              if (extraBadge != null) ...[
                const SizedBox(height: 5),
                extraBadge!,
              ],
            ],
          ),
        ],
      ),
    );
  }
}
