import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

class IntercityBookingScreen extends StatefulWidget {
  const IntercityBookingScreen({super.key});
  @override
  State<IntercityBookingScreen> createState() => _IntercityBookingScreenState();
}

class _IntercityBookingScreenState extends State<IntercityBookingScreen> {
  static const _blue = JT.primary;

  bool _loading = true;
  bool _booking = false;
  List<dynamic> _routes = [];
  Map<String, dynamic>? _selectedRoute;
  DateTime? _selectedDate;
  TimeOfDay? _selectedTime;
  String _paymentMethod = 'cash';
  int _passengers = 1;

  List<String> _fromCities = [];
  String? _fromCity;
  List<dynamic> _toRoutes = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.intercityRoutes), headers: headers);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final routes = (data as List<dynamic>?) ?? [];
        final cities = routes
            .map((r) => _routeVal((r as Map<String, dynamic>), 'fromCity', 'from_city'))
            .where((c) => c.isNotEmpty)
            .toSet()
            .toList();
        cities.sort();
        if (mounted) setState(() {
          _routes = routes;
          _fromCities = cities;
          _loading = false;
        });
      } else {
        if (mounted) setState(() => _loading = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onFromCityChanged(String? city) {
    setState(() {
      _fromCity = city;
      _selectedRoute = null;
      _toRoutes = _routes.where((r) => _routeVal(r, 'fromCity', 'from_city') == city).toList();
    });
  }

  String _routeVal(Map<String, dynamic> route, String camel, String snake) {
    return (route[camel] ?? route[snake] ?? '').toString();
  }

  double _calculateFare(Map<String, dynamic> route) {
    final base = double.tryParse((route['baseFare'] ?? route['base_fare'] ?? 0).toString()) ?? 0;
    final km = double.tryParse((route['estimatedKm'] ?? route['estimated_km'] ?? 0).toString()) ?? 0;
    final perKm = double.tryParse((route['farePerKm'] ?? route['fare_per_km'] ?? 0).toString()) ?? 0;
    final toll = double.tryParse((route['tollCharges'] ?? route['toll_charges'] ?? 0).toString()) ?? 0;
    return base + (km * perKm) + toll;
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 30)),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(colorScheme: const ColorScheme.light(primary: _blue)),
        child: child!,
      ),
    );
    if (picked != null) setState(() => _selectedDate = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 8, minute: 0),
      builder: (ctx, child) => Theme(
        data: Theme.of(ctx).copyWith(colorScheme: const ColorScheme.light(primary: _blue)),
        child: child!,
      ),
    );
    if (picked != null) setState(() => _selectedTime = picked);
  }

  Future<void> _bookNow() async {
    if (_selectedRoute == null) {
      _snack('Route select cheyyandi'); return;
    }
    if (_selectedDate == null || _selectedTime == null) {
      _snack('Date & time select cheyyandi'); return;
    }

    final scheduledDt = DateTime(
      _selectedDate!.year, _selectedDate!.month, _selectedDate!.day,
      _selectedTime!.hour, _selectedTime!.minute,
    );

    setState(() => _booking = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse(ApiConfig.intercityBook),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({
          'routeId': _selectedRoute!['id'],
          'scheduledAt': scheduledDt.toIso8601String(),
          'paymentMethod': _paymentMethod,
          'passengers': _passengers,
          'pickupAddress': _routeVal(_selectedRoute!, 'fromCity', 'from_city'),
          'destinationAddress': _routeVal(_selectedRoute!, 'toCity', 'to_city'),
        }),
      );
      final data = jsonDecode(res.body);
      if (res.statusCode == 200 || res.statusCode == 201) {
        if (mounted) {
          _showSuccessDialog(data);
        }
      } else {
        _snack(data['message'] ?? 'Booking failed');
      }
    } catch (_) {
      _snack('Connection error. Try again.');
    } finally {
      if (mounted) setState(() => _booking = false);
    }
  }

  void _snack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg, style: GoogleFonts.poppins(fontWeight: FontWeight.w400, color: Colors.white)),
      backgroundColor: JT.error,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      margin: const EdgeInsets.all(16),
    ));
  }

  void _showSuccessDialog(Map<String, dynamic> data) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 72, height: 72,
            decoration: BoxDecoration(color: Colors.green.shade50, shape: BoxShape.circle),
            child: const Icon(Icons.check_circle_rounded, color: Colors.green, size: 48),
          ),
          const SizedBox(height: 16),
          const Text('Booking Confirmed!', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w500)),
          const SizedBox(height: 8),
          Text('Ref: ${data['refId'] ?? ''}', style: const TextStyle(color: Colors.grey, fontSize: 13)),
          const SizedBox(height: 8),
          Text(
            '₹${(data['estimatedFare'] as num?)?.toStringAsFixed(0) ?? '0'}',
            style: GoogleFonts.poppins(fontSize: 28, fontWeight: FontWeight.w500, color: JT.primary),
          ),
          const SizedBox(height: 4),
          const Text('Estimated Fare', style: TextStyle(color: Colors.grey, fontSize: 12)),
          const SizedBox(height: 16),
          const Text(
            'Driver 24 hours lo confirm chesindi. SMS notification vastundi.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: Colors.grey),
          ),
        ]),
        actions: [
          TextButton(
            onPressed: () { Navigator.pop(context); Navigator.pop(context); },
            child: Text('OK', style: GoogleFonts.poppins(color: JT.primary, fontWeight: FontWeight.w400)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bg,
      appBar: AppBar(
        backgroundColor: JT.bg,
        foregroundColor: JT.textPrimary,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text('Intercity / Carpool',
            style: GoogleFonts.poppins(color: JT.textPrimary, fontWeight: FontWeight.w400, fontSize: 16)),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(height: 1, color: JT.border),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: _blue))
          : _routes.isEmpty
              ? _emptyState()
              : _buildBody(),
      bottomNavigationBar: _selectedRoute != null ? _buildBookBar() : null,
    );
  }

  Widget _emptyState() => Center(
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      Container(
        width: 80, height: 80,
        decoration: BoxDecoration(color: JT.bgSoft, shape: BoxShape.circle),
        child: const Icon(Icons.directions_bus_rounded, size: 40, color: JT.primary),
      ),
      const SizedBox(height: 20),
      Text('No routes available yet', style: GoogleFonts.poppins(
          color: JT.textPrimary, fontWeight: FontWeight.w500, fontSize: 16)),
      const SizedBox(height: 8),
      Text('Routes will appear once admin adds intercity destinations.',
          style: GoogleFonts.poppins(color: JT.textSecondary, fontSize: 13),
          textAlign: TextAlign.center),
    ]),
  );

  Widget _buildBody() => SingleChildScrollView(
    padding: const EdgeInsets.all(20),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      _sectionTitle('Route Select Cheyyandi'),
      const SizedBox(height: 12),

      // From city
      _label('From City'),
      Container(
        decoration: _boxDecor(),
        child: DropdownButtonFormField<String>(
          initialValue: _fromCity,
          decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 12), border: InputBorder.none),
          hint: const Text('City select cheyyandi'),
          items: _fromCities.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
          onChanged: _onFromCityChanged,
        ),
      ),
      const SizedBox(height: 16),

      // To route
      if (_fromCity != null) ...[
        _label('To Destination'),
        Container(
          decoration: _boxDecor(),
          child: DropdownButtonFormField<Map<String, dynamic>>(
            initialValue: _selectedRoute,
            decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 12), border: InputBorder.none),
            hint: const Text('Destination select cheyyandi'),
            items: _toRoutes.map((r) {
              final fare = _calculateFare(r);
              return DropdownMenuItem<Map<String, dynamic>>(
                value: r,
                child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  Text(_routeVal(r, 'toCity', 'to_city')),
                  Text('₹${fare.toStringAsFixed(0)}', style: const TextStyle(color: _blue, fontWeight: FontWeight.w500, fontSize: 12)),
                ]),
              );
            }).toList(),
            onChanged: (v) => setState(() => _selectedRoute = v),
          ),
        ),
        const SizedBox(height: 16),
      ],

      // Route info card
      if (_selectedRoute != null) ...[
        _routeInfoCard(),
        const SizedBox(height: 20),
        _sectionTitle('Travel Details'),
        const SizedBox(height: 12),

        // Date picker
        _label('Travel Date'),
        _tapCard(
          onTap: _pickDate,
          icon: Icons.calendar_today_outlined,
          text: _selectedDate != null
              ? DateFormat('dd MMM yyyy, EEEE').format(_selectedDate!)
              : 'Date select cheyyandi',
        ),
        const SizedBox(height: 12),

        // Time picker
        _label('Pickup Time'),
        _tapCard(
          onTap: _pickTime,
          icon: Icons.access_time_outlined,
          text: _selectedTime != null
              ? _selectedTime!.format(context)
              : 'Time select cheyyandi',
        ),
        const SizedBox(height: 20),

        _sectionTitle('Passengers'),
        const SizedBox(height: 12),
        _passengerSelector(),
        const SizedBox(height: 20),

        _sectionTitle('Payment Method'),
        const SizedBox(height: 12),
        _paymentSelector(),
        const SizedBox(height: 100),
      ],
    ]),
  );

  Widget _routeInfoCard() => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: _blue.withValues(alpha: 0.05),
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: _blue.withValues(alpha: 0.2)),
    ),
    child: Column(children: [
      Row(children: [
        Expanded(child: _routeStat(Icons.my_location_outlined, 'From', _routeVal(_selectedRoute!, 'fromCity', 'from_city'))),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: const Icon(Icons.arrow_forward, color: _blue),
        ),
        Expanded(child: _routeStat(Icons.location_on_outlined, 'To', _routeVal(_selectedRoute!, 'toCity', 'to_city'))),
      ]),
      const Divider(height: 20),
      Row(children: [
        _miniStat('Distance', '${_selectedRoute!['estimatedKm'] ?? _selectedRoute!['estimated_km'] ?? 0} km'),
        _miniStat('Toll', '₹${_selectedRoute!['tollCharges'] ?? _selectedRoute!['toll_charges'] ?? 0}'),
        _miniStat('Per Pax', '₹${_calculateFare(_selectedRoute!).toStringAsFixed(0)}'),
      ]),
    ]),
  );

  Widget _routeStat(IconData icon, String label, String val) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(children: [
        Icon(icon, size: 14, color: _blue),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(fontSize: 11, color: Colors.grey)),
      ]),
      const SizedBox(height: 4),
      Text(val, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 15)),
    ],
  );

  Widget _miniStat(String label, String val) => Expanded(
    child: Column(children: [
      Text(val, style: const TextStyle(fontWeight: FontWeight.w500, color: _blue, fontSize: 15)),
      Text(label, style: const TextStyle(fontSize: 11, color: Colors.grey)),
    ]),
  );

  Widget _passengerSelector() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    decoration: _boxDecor(),
    child: Row(children: [
      const Icon(Icons.people_outline, color: _blue),
      const SizedBox(width: 12),
      const Expanded(child: Text('Passengers', style: TextStyle(fontWeight: FontWeight.w500))),
      IconButton(
        onPressed: () { if (_passengers > 1) setState(() => _passengers--); },
        icon: const Icon(Icons.remove_circle_outline, color: _blue),
        padding: EdgeInsets.zero,
        constraints: const BoxConstraints(),
      ),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Text('$_passengers', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: _blue)),
      ),
      IconButton(
        onPressed: () { if (_passengers < 6) setState(() => _passengers++); },
        icon: const Icon(Icons.add_circle_outline, color: _blue),
        padding: EdgeInsets.zero,
        constraints: const BoxConstraints(),
      ),
    ]),
  );

  Widget _paymentSelector() => Row(children: [
    for (final p in [
      {'key': 'cash', 'label': 'Cash', 'icon': Icons.money},
      {'key': 'wallet', 'label': 'Jago Wallet', 'icon': Icons.account_balance_wallet_outlined},
      {'key': 'upi', 'label': 'UPI', 'icon': Icons.payment_outlined},
    ]) ...[
      Expanded(
        child: GestureDetector(
          onTap: () => setState(() => _paymentMethod = p['key'] as String),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 10),
            margin: const EdgeInsets.only(right: 8),
            decoration: BoxDecoration(
              color: _paymentMethod == p['key'] ? _blue : Colors.grey.shade50,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: _paymentMethod == p['key'] ? _blue : Colors.grey.shade200),
            ),
            child: Column(children: [
              Icon(p['icon'] as IconData, color: _paymentMethod == p['key'] ? Colors.white : Colors.grey, size: 22),
              const SizedBox(height: 4),
              Text(p['label'] as String,
                style: TextStyle(
                  fontSize: 11, fontWeight: FontWeight.w400,
                  color: _paymentMethod == p['key'] ? Colors.white : Colors.grey,
                )),
            ]),
          ),
        ),
      ),
    ],
  ]);

  Widget _buildBookBar() {
    final farePerPassenger = _calculateFare(_selectedRoute!);
    final fare = farePerPassenger * _passengers;
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 20, offset: const Offset(0, -4))],
      ),
      child: Row(children: [
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('₹${fare.toStringAsFixed(0)}',
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w500, color: _blue)),
          Text('$_passengers passenger${_passengers > 1 ? 's' : ''} · ${_routeVal(_selectedRoute!, 'fromCity', 'from_city')} → ${_routeVal(_selectedRoute!, 'toCity', 'to_city')}',
            style: const TextStyle(fontSize: 11, color: Colors.grey)),
        ]),
        const Spacer(),
        SizedBox(
          width: 130,
          child: ElevatedButton(
            onPressed: _booking ? null : _bookNow,
            style: ElevatedButton.styleFrom(
              backgroundColor: _blue, foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              elevation: 0,
            ),
            child: _booking
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : const Text('Book Now', style: TextStyle(fontWeight: FontWeight.w500, fontSize: 15)),
          ),
        ),
      ]),
    );
  }

  Widget _sectionTitle(String t) => Text(t,
      style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w400, color: JT.textPrimary));

  Widget _label(String t) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(t, style: GoogleFonts.poppins(
        fontSize: 12, color: JT.textSecondary, fontWeight: FontWeight.w400)),
  );

  BoxDecoration _boxDecor() => BoxDecoration(
    color: JT.surface,
    borderRadius: BorderRadius.circular(14),
    border: Border.all(color: JT.border),
    boxShadow: JT.cardShadow,
  );

  Widget _tapCard({required VoidCallback onTap, required IconData icon, required String text}) =>
    GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: _boxDecor(),
        child: Row(children: [
          Icon(icon, color: _blue, size: 20),
          const SizedBox(width: 12),
          Text(text, style: TextStyle(
            fontSize: 14,
            color: text.contains('cheyyandi') ? Colors.grey : Colors.black87,
            fontWeight: text.contains('cheyyandi') ? FontWeight.normal : FontWeight.w500,
          )),
          const Spacer(),
          const Icon(Icons.keyboard_arrow_right, color: Colors.grey, size: 20),
        ]),
      ),
    );
}
