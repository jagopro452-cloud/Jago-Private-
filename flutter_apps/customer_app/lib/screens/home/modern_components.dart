import 'package:flutter/material.dart';

enum ServiceCategory { ride, parcel }

class ModernBottomCard extends StatefulWidget {
  final String userName;
  final String pickupAddress;
  final double pickupLat;
  final double pickupLng;
  final VoidCallback onLocationTap;
  final VoidCallback onSearchRideTap;
  final VoidCallback onSearchParcelTap;

  const ModernBottomCard({
    super.key,
    required this.userName,
    required this.pickupAddress,
    required this.pickupLat,
    required this.pickupLng,
    required this.onLocationTap,
    required this.onSearchRideTap,
    required this.onSearchParcelTap,
  });

  @override
  State<ModernBottomCard> createState() => _ModernBottomCardState();
}

class _ModernBottomCardState extends State<ModernBottomCard> {
  String _selectedVehicleId = '';

  final List<Map<String, dynamic>> _quickBookOptions = [
    {'id': 'bike', 'title': 'Bike', 'icon': Icons.two_wheeler, 'price': '₹45', 'time': '2 min'},
    {'id': 'auto', 'title': 'Auto', 'icon': Icons.electric_rickshaw, 'price': '₹70', 'time': '3 min'},
    {'id': 'car', 'title': 'Cab', 'icon': Icons.directions_car, 'price': '₹120', 'time': '5 min'},
    {'id': 'parcel', 'title': 'Parcel', 'icon': Icons.inventory_2, 'price': '₹60', 'time': '4 min'},
  ];

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // ----- MAIN SEARCH BAR -----
          GestureDetector(
            onTap: widget.onSearchRideTap,
            child: Container(
              height: 56,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: const Color(0xFFF3F4F6),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                children: [
                  const Icon(Icons.search, color: Color(0xFF2563EB), size: 28),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Text(
                      "Where do you want to go?",
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w500,
                        color: Color(0xFF9CA3AF),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          
          const SizedBox(height: 24),

          // ----- RECENT LOCATION (Simulated) -----
          const Text(
            "Recent",
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: Color(0xFF111827),
            ),
          ),
          const SizedBox(height: 12),
          GestureDetector(
            onTap: widget.onLocationTap,
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: const Color(0xFFF3F4F6),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.access_time_rounded, color: Color(0xFF6B7280), size: 20),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        "Pickup Location",
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFF111827),
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        widget.pickupAddress.isNotEmpty ? widget.pickupAddress : "Detecting location...",
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 13,
                          color: Color(0xFF6B7280),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          
          const SizedBox(height: 24),

          // ----- QUICK BOOK (OUR SERVICES) -----
          const Text(
            "Quick Book",
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: Color(0xFF111827),
            ),
          ),
          const SizedBox(height: 16),
          
          SizedBox(
            height: 110,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              physics: const BouncingScrollPhysics(),
              itemCount: _quickBookOptions.length,
              itemBuilder: (context, index) {
                final option = _quickBookOptions[index];
                final isSelected = _selectedVehicleId == option['id'];
                
                return Padding(
                  padding: const EdgeInsets.only(right: 12.0),
                  child: GestureDetector(
                    onTap: () {
                      setState(() {
                        _selectedVehicleId = option['id'] as String;
                      });
                      if (option['id'] == 'parcel') {
                        widget.onSearchParcelTap();
                      } else {
                        widget.onSearchRideTap();
                      }
                    },
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      width: 90,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(
                        color: isSelected ? const Color(0xFFDBEAFE) : const Color(0xFFEFF6FF), // Pale Blue
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: isSelected ? const Color(0xFF2563EB) : Colors.transparent, 
                          width: 2,
                        ),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            option['icon'] as IconData, 
                            size: 32, 
                            color: const Color(0xFF2563EB),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            option['title'] as String, 
                            style: const TextStyle(
                              fontSize: 14, 
                              fontWeight: FontWeight.bold, 
                              color: Color(0xFF111827),
                            ),
                          ),
                          const SizedBox(height: 2),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(
                                option['price'] as String,
                                style: const TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: Color(0xFF4B5563),
                                ),
                              ),
                              const SizedBox(width: 4),
                              Text(
                                option['time'] as String,
                                style: const TextStyle(
                                  fontSize: 10,
                                  color: Color(0xFF9CA3AF),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
