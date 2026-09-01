import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

class OutstationPoolScreen extends StatefulWidget {
  // 0 = Search Rides, 1 = My Bookings — lets a caller (e.g. resuming an
  // active booking from Home) land directly on the bookings tab instead of
  // always starting on search.
  final int initialTab;
  const OutstationPoolScreen({super.key, this.initialTab = 0});
  @override
  State<OutstationPoolScreen> createState() => _OutstationPoolScreenState();
}

class _OutstationPoolScreenState extends State<OutstationPoolScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this, initialIndex: widget.initialTab.clamp(0, 1));
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: AppBar(
        backgroundColor: JT.primary,
        foregroundColor: Colors.white,
        title: const Text('Outstation Pool', style: TextStyle(fontWeight: FontWeight.w500)),
        elevation: 0,
        bottom: TabBar(
          controller: _tabs,
          indicatorColor: Colors.white,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white70,
          tabs: const [
            Tab(icon: Icon(Icons.search_rounded), text: 'Search Rides'),
            Tab(icon: Icon(Icons.confirmation_number_rounded), text: 'My Bookings'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: const [
          _SearchTab(),
          _BookingsTab(),
        ],
      ),
    );
  }
}

// ── Search Tab ────────────────────────────────────────────────────────────────

class _SearchTab extends StatefulWidget {
  const _SearchTab();
  @override
  State<_SearchTab> createState() => _SearchTabState();
}

class _SearchTabState extends State<_SearchTab> {
  final _fromCtrl = TextEditingController();
  final _toCtrl = TextEditingController();
  DateTime? _date;
  bool _searching = false;
  List<dynamic> _results = [];
  bool _searched = false;

  @override
  void dispose() {
    _fromCtrl.dispose();
    _toCtrl.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final from = _fromCtrl.text.trim();
    final to = _toCtrl.text.trim();
    if (from.isEmpty || to.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Please enter both cities'),
        behavior: SnackBarBehavior.floating,
      ));
      return;
    }
    if (from.toLowerCase() == to.toLowerCase()) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Pickup and drop cities cannot be the same'),
        behavior: SnackBarBehavior.floating,
      ));
      return;
    }
    setState(() { _searching = true; _results = []; _searched = false; });
    try {
      final headers = await AuthService.getHeaders();
      final dateStr = _date != null ? DateFormat('yyyy-MM-dd').format(_date!) : '';
      final uri = Uri.parse(ApiConfig.outstationPoolSearch).replace(queryParameters: {
        'fromCity': from,
        'toCity': to,
        if (dateStr.isNotEmpty) 'date': dateStr,
      });
      final res = await http.get(uri, headers: headers).timeout(const Duration(seconds: 15));
      if (!mounted) return;
      if (res.statusCode == 401) {
        await AuthService.handle401();
        return;
      }
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        setState(() { _results = data['data'] as List<dynamic>? ?? []; _searched = true; });
      } else {
        String msg = 'Could not fetch rides. Please try again.';
        try {
          final body = jsonDecode(res.body);
          msg = body['message']?.toString() ?? msg;
        } catch (_) {}
        setState(() => _searched = true);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(msg),
          behavior: SnackBarBehavior.floating,
          backgroundColor: JT.error,
        ));
      }
    } catch (_) {
      if (mounted) {
        setState(() => _searched = true);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Network error. Please try again.'),
          behavior: SnackBarBehavior.floating,
        ));
      }
    } finally {
      if (mounted) setState(() => _searching = false);
    }
  }

  Future<void> _pickDate() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _date ?? DateTime.now(),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 90)),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(
          colorScheme: ColorScheme.light(primary: JT.primary),
        ),
        child: child!,
      ),
    );
    if (d != null) setState(() => _date = d);
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // Search card
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            boxShadow: JT.cardShadow,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Find a Pool Ride', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: JT.textPrimary)),
              const SizedBox(height: 14),
              TextField(
                controller: _fromCtrl,
                textInputAction: TextInputAction.next,
                decoration: _dec('From City', Icons.trip_origin_rounded),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _toCtrl,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _search(),
                decoration: _dec('To City', Icons.location_on_rounded),
              ),
              const SizedBox(height: 10),
              GestureDetector(
                onTap: _pickDate,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                  decoration: BoxDecoration(
                    border: Border.all(color: JT.border),
                    borderRadius: BorderRadius.circular(10),
                    color: JT.bgSoft,
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.calendar_today_rounded, color: JT.primary, size: 18),
                      const SizedBox(width: 10),
                      Text(
                        _date != null ? DateFormat('dd MMM yyyy').format(_date!) : 'Any Date',
                        style: TextStyle(fontSize: 13, color: _date != null ? JT.textPrimary : JT.textSecondary),
                      ),
                      const Spacer(),
                      if (_date != null)
                        GestureDetector(
                          onTap: () => setState(() => _date = null),
                          child: Icon(Icons.clear_rounded, size: 18, color: JT.textSecondary),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: JT.gradientButton(
                  label: 'Search Rides',
                  loading: _searching,
                  onTap: _search,
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 20),

        if (_searching)
          const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator(color: JT.primary))),

        if (_searched && _results.isEmpty && !_searching)
          Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                children: [
                  Icon(Icons.directions_car_rounded, size: 64, color: JT.textSecondary.withValues(alpha: 0.4)),
                  const SizedBox(height: 16),
                  Text('No rides found', style: TextStyle(fontSize: 16, color: JT.textSecondary)),
                  const SizedBox(height: 6),
                  Text('Try different cities or dates', style: TextStyle(fontSize: 12, color: JT.textSecondary)),
                ],
              ),
            ),
          ),

        ..._results.map((r) => _RideCard(ride: r as Map<String, dynamic>)),
      ],
    );
  }

  InputDecoration _dec(String label, IconData icon) => InputDecoration(
    labelText: label,
    prefixIcon: Icon(icon, color: JT.primary, size: 18),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.border)),
    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.border)),
    focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.primary, width: 1.5)),
    filled: true,
    fillColor: JT.bgSoft,
    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
    labelStyle: TextStyle(fontSize: 13, color: JT.textSecondary),
  );
}

// ── Ride Card ─────────────────────────────────────────────────────────────────

class _RideCard extends StatelessWidget {
  final Map<String, dynamic> ride;
  const _RideCard({required this.ride});

  @override
  Widget build(BuildContext context) {
    final seats = ride['availableSeats'] ?? ride['available_seats'] ?? 0;
    final fare = double.tryParse(ride['farePerSeat']?.toString() ?? ride['fare_per_seat']?.toString() ?? '0') ?? 0;
    final depDate = ride['departureDate']?.toString() ?? ride['departure_date']?.toString() ?? '';
    final depTime = ride['departureTime']?.toString() ?? ride['departure_time']?.toString() ?? '';
    final driverName = ride['driverName']?.toString() ?? ride['driver_name']?.toString() ?? 'Driver';
    final rating = double.tryParse(ride['driverRating']?.toString() ?? ride['driver_rating']?.toString() ?? '0') ?? 0;
    final vehicle = ride['vehicleModel']?.toString() ?? ride['vehicle_model']?.toString() ?? '';
    final vehicleNo = ride['vehicleNumber']?.toString() ?? ride['vehicle_number']?.toString() ?? '';

    String formattedDate = depDate;
    try {
      formattedDate = DateFormat('dd MMM yyyy').format(DateTime.parse(depDate));
    } catch (_) {}

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: JT.cardShadow,
      ),
      child: Column(
        children: [
          // Route header
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              gradient: JT.grad,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
            ),
            child: Row(
              children: [
                const Icon(Icons.trip_origin_rounded, color: Colors.white70, size: 16),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    '${ride['fromCity'] ?? ride['from_city'] ?? ''} → ${ride['toCity'] ?? ride['to_city'] ?? ''}',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 14),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text('₹${fare.toStringAsFixed(0)}/seat',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 13)),
                ),
              ],
            ),
          ),

          // Details
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              children: [
                Row(
                  children: [
                    _infoChip(Icons.calendar_today_rounded, formattedDate),
                    const SizedBox(width: 8),
                    _infoChip(Icons.access_time_rounded, depTime),
                    const SizedBox(width: 8),
                    _infoChip(Icons.event_seat_rounded, '$seats seats left'),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    CircleAvatar(
                      radius: 16,
                      backgroundColor: JT.primary.withValues(alpha: 0.1),
                      child: Text(driverName.isNotEmpty ? driverName[0].toUpperCase() : 'D',
                          style: TextStyle(color: JT.primary, fontWeight: FontWeight.w500, fontSize: 12)),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(driverName, style: TextStyle(fontWeight: FontWeight.w400, color: JT.textPrimary, fontSize: 13)),
                          if (vehicle.isNotEmpty || vehicleNo.isNotEmpty)
                            Text('${vehicle.isNotEmpty ? vehicle : ''}${vehicleNo.isNotEmpty ? ' · $vehicleNo' : ''}',
                                style: TextStyle(fontSize: 11, color: JT.textSecondary)),
                        ],
                      ),
                    ),
                    if (rating > 0)
                      Row(
                        children: [
                          const Icon(Icons.star_rounded, size: 14, color: Colors.amber),
                          const SizedBox(width: 2),
                          Text(rating.toStringAsFixed(1),
                              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w400, color: JT.textPrimary)),
                        ],
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: JT.primary,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      padding: const EdgeInsets.symmetric(vertical: 11),
                    ),
                    onPressed: seats > 0
                        ? () => _showBookDialog(context, ride, fare, seats)
                        : null,
                    child: Text(seats > 0 ? 'Book Seat' : 'Fully Booked',
                        style: const TextStyle(fontWeight: FontWeight.w500)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _infoChip(IconData icon, String label) => Expanded(
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
      decoration: BoxDecoration(
        color: JT.bgSoft,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(icon, size: 12, color: JT.primary),
          const SizedBox(width: 4),
          Flexible(child: Text(label, style: TextStyle(fontSize: 10, color: JT.textSecondary), overflow: TextOverflow.ellipsis)),
        ],
      ),
    ),
  );

  void _showBookDialog(BuildContext context, Map<String, dynamic> ride, double farePerSeat, int maxSeats) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _BookBottomSheet(
        ride: ride,
        farePerSeat: farePerSeat,
        maxSeats: maxSeats,
        onBooked: () {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Booked! Check the My Bookings tab.')),
          );
        },
      ),
    );
  }
}

// ── Book Bottom Sheet ─────────────────────────────────────────────────────────

class _BookBottomSheet extends StatefulWidget {
  final Map<String, dynamic> ride;
  final double farePerSeat;
  final int maxSeats;
  final VoidCallback? onBooked;
  const _BookBottomSheet({
    required this.ride,
    required this.farePerSeat,
    required this.maxSeats,
    this.onBooked,
  });
  @override
  State<_BookBottomSheet> createState() => _BookBottomSheetState();
}

class _BookBottomSheetState extends State<_BookBottomSheet> {
  int _seats = 1;
  bool _wholeCar = false;
  String _paymentMethod = 'cash';
  final _pickupCtrl = TextEditingController();
  final _dropCtrl = TextEditingController();
  bool _booking = false;

  @override
  void dispose() {
    _pickupCtrl.dispose();
    _dropCtrl.dispose();
    super.dispose();
  }

  Future<void> _book() async {
    final seats = _wholeCar ? widget.maxSeats : _seats;
    if (seats < 1 || seats > widget.maxSeats) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Choose a valid number of seats'),
        behavior: SnackBarBehavior.floating,
      ));
      return;
    }
    // A search result is either a real posted ride, or a driver's open
    // "available for outstation" window that hasn't been booked into a ride
    // yet (server/outstation-pool-v2.ts materializes the ride on first book).
    final isAvailability = widget.ride['source']?.toString() == 'availability';
    final targetId = widget.ride['id']?.toString() ?? '';
    if (targetId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Ride unavailable. Please refresh and try again.'),
        behavior: SnackBarBehavior.floating,
      ));
      return;
    }
    setState(() => _booking = true);
    try {
      final headers = await AuthService.getHeaders();
      final idempotencyKey = const Uuid().v4();
      final res = await http.post(
        Uri.parse(ApiConfig.outstationPoolBook),
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: jsonEncode({
          if (isAvailability) 'availabilityId': targetId else 'rideId': targetId,
          'seatsBooked': seats,
          'bookingMode': _wholeCar ? 'whole_car' : 'seat',
          'paymentMethod': _paymentMethod,
          'idempotencyKey': idempotencyKey,
          if (_pickupCtrl.text.trim().isNotEmpty) 'pickupAddress': _pickupCtrl.text.trim(),
          if (_dropCtrl.text.trim().isNotEmpty) 'dropoffAddress': _dropCtrl.text.trim(),
        }),
      ).timeout(const Duration(seconds: 15));

      if (!mounted) return;
      if (res.statusCode == 401) {
        await AuthService.handle401();
        return;
      }
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode == 200 && body['success'] == true) {
        Navigator.of(context).pop();
        widget.onBooked?.call();
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Booking confirmed!'),
          backgroundColor: Colors.green,
          behavior: SnackBarBehavior.floating,
        ));
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(body['message'] ?? 'Booking failed'),
          backgroundColor: JT.error,
          behavior: SnackBarBehavior.floating,
        ));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Network error. Please try again.'),
          behavior: SnackBarBehavior.floating,
        ));
      }
    } finally {
      if (mounted) setState(() => _booking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final effectiveSeats = _wholeCar ? widget.maxSeats : _seats;
    final total = widget.farePerSeat * effectiveSeats;
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: EdgeInsets.fromLTRB(20, 8, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40, height: 4,
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2)),
              ),
            ),
            Text('Confirm Booking', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: JT.textPrimary)),
            const SizedBox(height: 4),
            Text(
              '${widget.ride['fromCity'] ?? widget.ride['from_city'] ?? ''} → ${widget.ride['toCity'] ?? widget.ride['to_city'] ?? ''}',
              style: TextStyle(fontSize: 13, color: JT.textSecondary),
            ),
            const SizedBox(height: 20),

            // Booking mode selector
            Text('Booking Mode', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w400, color: JT.textPrimary)),
            const SizedBox(height: 8),
            Row(
              children: [
                _modeBtn('Seat(s)', !_wholeCar, () => setState(() => _wholeCar = false)),
                const SizedBox(width: 10),
                _modeBtn('Whole Car', _wholeCar, () => setState(() => _wholeCar = true)),
              ],
            ),
            const SizedBox(height: 16),

            // Seats selector
            Text(_wholeCar ? 'Seats' : 'Number of Seats', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w400, color: JT.textPrimary)),
            const SizedBox(height: 8),
            Row(
              children: [
                _seatBtn(Icons.remove_rounded, _wholeCar ? null : () {
                  if (_seats > 1) setState(() => _seats--);
                }),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Text('$effectiveSeats', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w500, color: JT.textPrimary)),
                ),
                _seatBtn(Icons.add_rounded, _wholeCar ? null : () {
                  if (_seats < widget.maxSeats) setState(() => _seats++);
                }),
                const Spacer(),
                Text(
                  '₹${total.toStringAsFixed(0)} total',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: JT.primary),
                ),
              ],
            ),
            if (_wholeCar) ...[
              const SizedBox(height: 6),
              Text(
                'The whole vehicle ($effectiveSeats seats) is reserved for you. No other passengers can join this ride.',
                style: TextStyle(fontSize: 11, color: JT.textSecondary),
              ),
            ],

            const SizedBox(height: 16),

            // Optional pickup/drop addresses
            TextField(
              controller: _pickupCtrl,
              decoration: _inputDec('Pickup Address (optional)', Icons.trip_origin_rounded),
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _dropCtrl,
              decoration: _inputDec('Drop Address (optional)', Icons.location_on_rounded),
              textInputAction: TextInputAction.done,
            ),

            const SizedBox(height: 16),

            // Payment method
            Text('Payment Method', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w400, color: JT.textPrimary)),
            const SizedBox(height: 8),
            Row(
              children: [
                _payBtn('cash', Icons.money_rounded, 'Cash'),
                const SizedBox(width: 10),
                _payBtn('wallet', Icons.account_balance_wallet_rounded, 'Wallet'),
                const SizedBox(width: 10),
                _payBtn('upi', Icons.payment_rounded, 'UPI'),
              ],
            ),

            const SizedBox(height: 20),

            SizedBox(
              width: double.infinity,
              child: JT.gradientButton(
                label: 'Confirm Booking · ₹${total.toStringAsFixed(0)}',
                loading: _booking,
                onTap: _book,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _seatBtn(IconData icon, VoidCallback? onTap) => GestureDetector(
    onTap: onTap,
    child: Container(
      width: 36, height: 36,
      decoration: BoxDecoration(
        color: JT.primary.withValues(alpha: onTap == null ? 0.05 : 0.1),
        shape: BoxShape.circle,
      ),
      child: Icon(icon, color: onTap == null ? JT.textSecondary : JT.primary, size: 18),
    ),
  );

  Widget _modeBtn(String label, bool selected, VoidCallback onTap) => Expanded(
    child: GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: selected ? JT.primary : Colors.transparent,
          border: Border.all(color: selected ? JT.primary : JT.border),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: selected ? Colors.white : JT.textSecondary),
        ),
      ),
    ),
  );

  Widget _payBtn(String value, IconData icon, String label) => Expanded(
    child: GestureDetector(
      onTap: () => setState(() => _paymentMethod = value),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: _paymentMethod == value ? JT.primary : Colors.transparent,
          border: Border.all(color: _paymentMethod == value ? JT.primary : JT.border),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          children: [
            Icon(icon, size: 18, color: _paymentMethod == value ? Colors.white : JT.textSecondary),
            const SizedBox(height: 2),
            Text(label, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w400,
                color: _paymentMethod == value ? Colors.white : JT.textSecondary)),
          ],
        ),
      ),
    ),
  );

  InputDecoration _inputDec(String label, IconData icon) => InputDecoration(
    labelText: label,
    prefixIcon: Icon(icon, color: JT.primary, size: 18),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.border)),
    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.border)),
    focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: JT.primary, width: 1.5)),
    filled: true, fillColor: JT.bgSoft,
    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
    labelStyle: TextStyle(fontSize: 12, color: JT.textSecondary),
  );
}

// ── My Bookings Tab ───────────────────────────────────────────────────────────

class _BookingsTab extends StatefulWidget {
  const _BookingsTab();
  @override
  State<_BookingsTab> createState() => _BookingsTabState();
}

class _BookingsTabState extends State<_BookingsTab> {
  bool _loading = true;
  List<dynamic> _bookings = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _cancelBooking(String bookingId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Cancel Booking?'),
        content: const Text('This will cancel your seat reservation. Refund (if applicable) will be processed to your wallet within 24 hours.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: JT.error),
            child: const Text('Cancel Booking'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse(ApiConfig.outstationPoolCancel(bookingId)),
        headers: {...headers, 'Content-Type': 'application/json'},
      ).timeout(const Duration(seconds: 15));
      if (!mounted) return;
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final refund = data['refundAmount'];
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(refund != null
              ? 'Booking cancelled. ₹${refund.toString()} refund initiated.'
              : 'Booking cancelled.'),
          backgroundColor: Colors.green,
          behavior: SnackBarBehavior.floating,
        ));
        _load();
      } else {
        final msg = (jsonDecode(res.body) as Map<String, dynamic>)['message']?.toString() ?? 'Could not cancel. Please try again.';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(msg),
          backgroundColor: JT.error,
          behavior: SnackBarBehavior.floating,
        ));
      }
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Network error. Please try again.'),
        backgroundColor: Colors.orange,
        behavior: SnackBarBehavior.floating,
      ));
    }
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse(ApiConfig.outstationPoolBookings),
        headers: headers,
      ).timeout(const Duration(seconds: 15));
      if (!mounted) return;
      if (res.statusCode == 401) {
        await AuthService.handle401();
        return;
      }
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        setState(() { _bookings = data['data'] as List<dynamic>? ?? []; });
      } else {
        String msg = 'Unable to load bookings';
        try {
          msg = (jsonDecode(res.body) as Map<String, dynamic>)['message']?.toString() ?? msg;
        } catch (_) {}
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(msg),
          behavior: SnackBarBehavior.floating,
          backgroundColor: JT.error,
        ));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Network error. Pull to retry.'),
          behavior: SnackBarBehavior.floating,
        ));
      }
    }
    if (mounted) setState(() => _loading = false);
  }

  Color _statusColor(String? s) {
    switch (s) {
      case 'confirmed': return Colors.green;
      case 'cancelled': return JT.error;
      case 'completed': return JT.primary;
      default: return JT.textSecondary;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator(color: JT.primary));

    if (_bookings.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.confirmation_number_rounded, size: 64, color: JT.textSecondary.withValues(alpha: 0.4)),
              const SizedBox(height: 16),
              Text('No bookings yet', style: TextStyle(fontSize: 16, color: JT.textSecondary)),
              const SizedBox(height: 6),
              Text('Book a pool ride to see it here', style: TextStyle(fontSize: 12, color: JT.textSecondary)),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      color: JT.primary,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _bookings.length,
        itemBuilder: (_, i) {
          final b = _bookings[i] as Map<String, dynamic>;
          final status = b['status']?.toString() ?? '';
          final seats = b['seatsBooked'] ?? b['seats_booked'] ?? 1;
          final fare = double.tryParse(b['totalFare']?.toString() ?? b['total_fare']?.toString() ?? '0') ?? 0;
          final from = b['fromCity']?.toString() ?? b['from_city']?.toString() ?? '';
          final to = b['toCity']?.toString() ?? b['to_city']?.toString() ?? '';
          final depDate = b['departureDate']?.toString() ?? b['departure_date']?.toString() ?? '';
          final depTime = b['departureTime']?.toString() ?? b['departure_time']?.toString() ?? '';
          final driverName = b['driverName']?.toString() ?? b['driver_name']?.toString() ?? '';
          final createdAt = b['createdAt']?.toString() ?? b['created_at']?.toString() ?? '';

          String formattedDate = depDate;
          try { formattedDate = DateFormat('dd MMM yyyy').format(DateTime.parse(depDate)); } catch (_) {}
          String formattedCreated = '';
          try { formattedCreated = DateFormat('dd MMM, h:mm a').format(DateTime.parse(createdAt).toLocal()); } catch (_) {}

          return Container(
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              boxShadow: JT.cardShadow,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text('$from → $to',
                          style: TextStyle(fontWeight: FontWeight.w500, fontSize: 14, color: JT.textPrimary)),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: _statusColor(status).withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(status.toUpperCase(),
                          style: TextStyle(fontSize: 10, fontWeight: FontWeight.w500, color: _statusColor(status))),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Icon(Icons.calendar_today_rounded, size: 13, color: JT.textSecondary),
                    const SizedBox(width: 4),
                    Text('$formattedDate${depTime.isNotEmpty ? ' at $depTime' : ''}',
                        style: TextStyle(fontSize: 12, color: JT.textSecondary)),
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Icon(Icons.event_seat_rounded, size: 13, color: JT.textSecondary),
                    const SizedBox(width: 4),
                    Text('$seats seat${seats == 1 ? '' : 's'} · ₹${fare.toStringAsFixed(0)}',
                        style: TextStyle(fontSize: 12, color: JT.textSecondary)),
                    if (driverName.isNotEmpty) ...[
                      const SizedBox(width: 10),
                      Icon(Icons.person_rounded, size: 13, color: JT.textSecondary),
                      const SizedBox(width: 4),
                      Text(driverName, style: TextStyle(fontSize: 12, color: JT.textSecondary)),
                    ],
                  ],
                ),
                if (formattedCreated.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text('Booked: $formattedCreated', style: TextStyle(fontSize: 11, color: JT.textSecondary.withValues(alpha: 0.7))),
                ],
                if (status == 'confirmed') ...[
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: () => _cancelBooking(b['id']?.toString() ?? ''),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: JT.error,
                        side: BorderSide(color: JT.error.withValues(alpha: 0.5)),
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      child: const Text('Cancel Booking', style: TextStyle(fontSize: 13)),
                    ),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}
