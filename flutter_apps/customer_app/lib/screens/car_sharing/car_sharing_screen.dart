import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/api_retry.dart';
import '../../services/auth_service.dart';
import '../../widgets/vehicle_artwork.dart';
import '../tracking/tracking_screen.dart';

class CarSharingScreen extends StatefulWidget {
  const CarSharingScreen({super.key});

  @override
  State<CarSharingScreen> createState() => _CarSharingScreenState();
}

class _CarSharingScreenState extends State<CarSharingScreen>
    with SingleTickerProviderStateMixin {
  static const _bg = Color(0xFFF8FAFC);
  static const _blue = JT.primary;
  static const _green = Color(0xFF10B981);

  late TabController _tabs;
  bool _loading = true;
  bool _myLoading = true;
  List _rides = [];
  List _myBookings = [];

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _loadRides();
    _loadMyBookings();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _loadRides() async {
    if (mounted) setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/api/app/customer/car-sharing/rides'),
        headers: headers,
      ).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200 && mounted) {
        setState(() => _rides = jsonDecode(res.body)['data'] ?? []);
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Failed to load rides. Please try again.'),
          backgroundColor: Colors.orange,
        ));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Network error. Please check your connection.'),
          backgroundColor: Colors.orange,
        ));
      }
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _loadMyBookings() async {
    if (mounted) setState(() => _myLoading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/api/app/customer/car-sharing/my-bookings'),
        headers: headers,
      ).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200 && mounted) {
        setState(() => _myBookings = jsonDecode(res.body)['data'] ?? []);
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Failed to load bookings. Please try again.'),
          backgroundColor: Colors.orange,
        ));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Network error. Please check your connection.'),
          backgroundColor: Colors.orange,
        ));
      }
    }
    if (mounted) setState(() => _myLoading = false);
  }

  Future<String?> _fetchLatestConfirmedBookingId() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/api/app/customer/car-sharing/my-bookings'),
        headers: headers,
      );
      if (res.statusCode != 200) return null;
      final list = jsonDecode(res.body)['data'] as List<dynamic>? ?? [];
      for (final item in list) {
        if (item is! Map) continue;
        final status = item['status']?.toString().toLowerCase() ?? '';
        final id = item['id']?.toString() ?? '';
        if (id.isNotEmpty && status == 'confirmed') return id;
      }
      if (list.isNotEmpty && list.first is Map) {
        return (list.first as Map)['id']?.toString();
      }
    } catch (_) {}
    return null;
  }

  Future<void> _book(
    String rideId,
    String from,
    String to,
    double seatPrice,
    int maxSeats,
  ) async {
    int selectedSeats = 1;
    final res = await showDialog<int>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Confirm Pool Booking'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Route: $from -> $to',
                style: const TextStyle(fontWeight: FontWeight.w400),
              ),
              const SizedBox(height: 4),
              Text(
                'Fare: Rs ${seatPrice.toStringAsFixed(0)} / seat',
                style: const TextStyle(
                  color: Colors.green,
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Select seats',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  _seatButton(
                    icon: Icons.remove_rounded,
                    enabled: selectedSeats > 1,
                    onTap: () => setDialogState(() => selectedSeats--),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(
                        color: _blue.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        '$selectedSeats seat${selectedSeats == 1 ? '' : 's'}',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  _seatButton(
                    icon: Icons.add_rounded,
                    enabled: selectedSeats < maxSeats,
                    onTap: () => setDialogState(() => selectedSeats++),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                'Total: Rs ${(seatPrice * selectedSeats).toStringAsFixed(0)}',
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w500,
                  color: _blue,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Amount will be deducted from your wallet.',
                style: TextStyle(color: Colors.grey, fontSize: 12),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, selectedSeats),
              style: ElevatedButton.styleFrom(backgroundColor: _green),
              child: Text(
                'Book $selectedSeats Seat${selectedSeats == 1 ? '' : 's'}',
                style: const TextStyle(color: Colors.white),
              ),
            ),
          ],
        ),
      ),
    );
    if (res == null) return;
    try {
      final headers = await AuthService.getHeaders();
      final idempotencyKey = generateIdempotencyKey();
      final bookRes = await apiRetry(() => http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/customer/car-sharing/book'),
        headers: {...headers, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey},
        body: jsonEncode({'rideId': rideId, 'seatsBooked': res}),
      ).timeout(const Duration(seconds: 15)));
      final d = jsonDecode(bookRes.body);
      if (!mounted) return;
      if (bookRes.statusCode == 200) {
        var bookingId = d['bookingId']?.toString() ??
            d['data']?['id']?.toString() ??
            '';
        if (bookingId.isEmpty) {
          bookingId = await _fetchLatestConfirmedBookingId() ?? '';
        }
        if (bookingId.isNotEmpty && mounted) {
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(
              builder: (_) => TrackingScreen(tripId: bookingId, bookingType: 'pool'),
            ),
          );
          return;
        }
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Booking confirmed but tracking could not open. Check My Bookings.'),
              backgroundColor: Colors.orange,
            ),
          );
        }
        _loadRides();
        _loadMyBookings();
        _tabs.animateTo(1);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(d['message'] ?? 'Booking failed'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Error: $e'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  Widget _seatButton({
    required IconData icon,
    required bool enabled,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(
          color: enabled ? _blue : Colors.grey.shade200,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(icon, color: enabled ? Colors.white : Colors.grey),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: _blue,
        elevation: 0.5,
        title: const Text(
          'City Pool',
          style: TextStyle(fontWeight: FontWeight.w400, fontSize: 18),
        ),
        centerTitle: true,
        bottom: TabBar(
          controller: _tabs,
          labelColor: _blue,
          unselectedLabelColor: Colors.grey,
          indicatorColor: _blue,
          tabs: const [
            Tab(text: 'Available Rides'),
            Tab(text: 'My Bookings'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: [
          _buildRidesList(),
          _buildMyBookings(),
        ],
      ),
    );
  }

  Widget _buildRidesList() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: JT.primary));
    }
    if (_rides.isEmpty) {
      return _empty(
        'No city pool rides available',
        'CAR',
        'Check back later or post your own!',
      );
    }
    return RefreshIndicator(
      onRefresh: _loadRides,
      child: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: _rides.length,
        itemBuilder: (_, i) => _rideCard(_rides[i]),
      ),
    );
  }

  Widget _buildMyBookings() {
    if (_myLoading) {
      return const Center(child: CircularProgressIndicator(color: JT.primary));
    }
    if (_myBookings.isEmpty) {
      return _empty(
        'No bookings yet',
        'TICKET',
        'Book a seat on an available shared ride!',
      );
    }
    return RefreshIndicator(
      onRefresh: _loadMyBookings,
      child: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: _myBookings.length,
        itemBuilder: (_, i) => _bookingCard(_myBookings[i]),
      ),
    );
  }

  Widget _rideCard(Map d) {
    final from = d['fromLocation'] ?? 'From';
    final to = d['toLocation'] ?? 'To';
    final driver = d['driverName'] ?? 'Driver';
    final vehicle = d['vehicleName'] ?? 'Vehicle';
    final available = d['availableSeats'] ?? 0;
    final seatPrice = (d['seatPrice'] ?? 0).toDouble();
    final depTime = d['departureTime'] != null ? _fmt(d['departureTime']) : '--';
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 10,
            offset: const Offset(0, 2),
          )
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.place_rounded, size: 16),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '$from -> $to',
                  style: const TextStyle(
                    fontWeight: FontWeight.w400,
                    fontSize: 14,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: _green.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  'Rs ${seatPrice.toStringAsFixed(0)}/seat',
                  style: const TextStyle(
                    color: Color(0xFF10B981),
                    fontWeight: FontWeight.w400,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              const Icon(Icons.person_rounded, size: 14, color: Colors.grey),
              const SizedBox(width: 4),
              Text(driver,
                  style: const TextStyle(color: Colors.grey, fontSize: 12)),
              const SizedBox(width: 12),
              VehicleArtwork(
                vehicleKey: vehicle.toLowerCase(),
                width: 20,
                height: 20,
              ),
              const SizedBox(width: 4),
              Text(vehicle,
                  style: const TextStyle(color: Colors.grey, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              const Icon(Icons.access_time_rounded,
                  size: 14, color: Colors.grey),
              const SizedBox(width: 4),
              Text(depTime,
                  style: const TextStyle(color: Colors.grey, fontSize: 12)),
              const Spacer(),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: available > 0
                      ? _blue.withValues(alpha: 0.08)
                      : Colors.red.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '$available seats left',
                  style: TextStyle(
                    color: available > 0 ? _blue : Colors.red,
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
          if (available > 0) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              height: 40,
              child: ElevatedButton(
                onPressed: () => _book(
                  d['id'],
                  from.toString(),
                  to.toString(),
                  seatPrice,
                  int.tryParse(available.toString()) ?? 1,
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: _blue,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  elevation: 0,
                ),
                child: const Text(
                  'Book Seats',
                  style: TextStyle(fontWeight: FontWeight.w500, fontSize: 13),
                ),
              ),
            ),
          ]
        ],
      ),
    );
  }

  Widget _bookingCard(Map d) {
    final from = d['fromLocation'] ?? 'From';
    final to = d['toLocation'] ?? 'To';
    final seats = d['seatsBooked'] ?? 1;
    final total = (d['totalFare'] ?? 0).toDouble();
    final status = (d['status'] ?? 'confirmed').toString();
    final bookingId = d['id']?.toString() ?? '';
    final depTime = d['departureTime'] != null ? _fmt(d['departureTime']) : '--';
    final canTrack = status.toLowerCase() == 'confirmed';
    final canCancel = canTrack;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 2),
          )
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(
              child: Text(
                '$from -> $to',
                style:
                    const TextStyle(fontWeight: FontWeight.w400, fontSize: 14),
              ),
            ),
            _statusPill(status),
          ]),
          const SizedBox(height: 8),
          Text(
            '$seats seat(s) - Rs ${total.toStringAsFixed(0)}',
            style: const TextStyle(
              color: Color(0xFF10B981),
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Departure: $depTime',
            style: const TextStyle(color: Colors.grey, fontSize: 12),
          ),
          if (canTrack && bookingId.isNotEmpty) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => TrackingScreen(
                          tripId: bookingId,
                          bookingType: 'pool',
                        ),
                      ),
                    ),
                    icon: const Icon(Icons.map_rounded, size: 16),
                    label: const Text('Track'),
                  ),
                ),
                if (canCancel) ...[
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextButton.icon(
                      onPressed: () => _cancelBooking(bookingId),
                      icon: const Icon(Icons.cancel_outlined, size: 16, color: Colors.red),
                      label: const Text('Cancel', style: TextStyle(color: Colors.red)),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _cancelBooking(String bookingId) async {
    if (bookingId.isEmpty) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel booking?'),
        content: const Text('Your wallet will be refunded for this pool seat.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('No')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Yes, cancel')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse(ApiConfig.carSharingCancelBooking(bookingId)),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({'reason': 'Customer cancelled'}),
      );
      if (!mounted) return;
      final body = jsonDecode(res.body);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(body['message']?.toString() ?? (res.statusCode == 200 ? 'Cancelled' : 'Cancel failed')),
        backgroundColor: res.statusCode == 200 ? Colors.green : Colors.red,
      ));
      if (res.statusCode == 200) _loadMyBookings();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Widget _statusPill(String status) {
    final ok = status.toLowerCase() == 'confirmed';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: (ok ? _green : Colors.orange).withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        status,
        style: TextStyle(
          color: ok ? _green : Colors.orange,
          fontSize: 11,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }

  Widget _empty(String title, String asciiBadge, String subtitle) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 80,
              height: 80,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: _blue.withValues(alpha: 0.08),
                shape: BoxShape.circle,
              ),
              child: Text(
                asciiBadge,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: _blue,
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              title,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              subtitle,
              style: const TextStyle(color: Colors.grey, fontSize: 12),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  String _fmt(dynamic raw) {
    final s = raw?.toString() ?? '';
    if (s.isEmpty) return '--';
    return s;
  }
}
