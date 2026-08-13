import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../services/socket_service.dart';
import 'outstation_pool_trip_screen.dart';

/// Driver-side entry point for Outstation Pool auto-match: the driver goes
/// "available" for a route + departure window instead of manually posting a
/// full ride, and the backend matcher (server/outstation-pool-matcher.ts)
/// pools compatible customer requests and proposes them here.
class OutstationPoolAvailabilityScreen extends StatefulWidget {
  const OutstationPoolAvailabilityScreen({super.key});

  @override
  State<OutstationPoolAvailabilityScreen> createState() =>
      _OutstationPoolAvailabilityScreenState();
}

class _OutstationPoolAvailabilityScreenState
    extends State<OutstationPoolAvailabilityScreen> {
  final SocketService _socket = SocketService();
  StreamSubscription<Map<String, dynamic>>? _newRequestSub;

  bool _loading = true;
  bool _submitting = false;
  Map<String, dynamic>? _availability;

  final _fromCtrl = TextEditingController();
  final _toCtrl = TextEditingController();
  final _seatsCtrl = TextEditingController(text: '4');
  final _priceCtrl = TextEditingController(text: '1.8');
  DateTime? _earliestDeparture;
  DateTime? _latestDeparture;

  @override
  void initState() {
    super.initState();
    _load();
    _newRequestSub =
        _socket.onOutstationPoolNewRequest.listen(_onNewRequest);
  }

  @override
  void dispose() {
    _newRequestSub?.cancel();
    _fromCtrl.dispose();
    _toCtrl.dispose();
    _seatsCtrl.dispose();
    _priceCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http
          .get(Uri.parse(ApiConfig.outstationPoolAvailabilityMine), headers: headers)
          .timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        if (mounted) setState(() => _availability = data['availability'] as Map<String, dynamic>?);
      }
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  void _onNewRequest(Map<String, dynamic> req) {
    if (!mounted) return;
    _showIncomingRequestSheet(req);
  }

  Future<void> _pickDate(bool isEarliest) async {
    final now = DateTime.now();
    final current = isEarliest ? _earliestDeparture : _latestDeparture;
    final date = await showDatePicker(
      context: context,
      initialDate: current ?? now,
      firstDate: now,
      lastDate: now.add(const Duration(days: 60)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(current ?? now.add(const Duration(hours: 1))),
    );
    if (time == null) return;
    final combined = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    setState(() {
      if (isEarliest) {
        _earliestDeparture = combined;
      } else {
        _latestDeparture = combined;
      }
    });
  }

  Future<void> _goAvailable() async {
    if (_fromCtrl.text.trim().isEmpty || _toCtrl.text.trim().isEmpty) {
      _snack('From and To cities are required', error: true);
      return;
    }
    if (_earliestDeparture == null || _latestDeparture == null) {
      _snack('Pick an earliest and latest departure time', error: true);
      return;
    }
    if (_latestDeparture!.isBefore(_earliestDeparture!)) {
      _snack('Latest departure must be after earliest departure', error: true);
      return;
    }
    setState(() => _submitting = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http
          .post(
            Uri.parse(ApiConfig.outstationPoolAvailability),
            headers: {...headers, 'Content-Type': 'application/json'},
            body: jsonEncode({
              'fromCity': _fromCtrl.text.trim(),
              'toCity': _toCtrl.text.trim(),
              'seatCapacity': int.tryParse(_seatsCtrl.text.trim()) ?? 4,
              'pricePerKmPerSeat': double.tryParse(_priceCtrl.text.trim()),
              'earliestDeparture': _earliestDeparture!.toIso8601String(),
              'latestDeparture': _latestDeparture!.toIso8601String(),
            }),
          )
          .timeout(const Duration(seconds: 15));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (!mounted) return;
      if (res.statusCode == 200) {
        _snack('You are now available for Outstation Pool');
        await _load();
      } else {
        _snack(data['message']?.toString() ?? 'Could not go available', error: true);
      }
    } catch (_) {
      _snack('Network error while going available', error: true);
    }
    if (mounted) setState(() => _submitting = false);
  }

  Future<void> _endAvailability() async {
    final id = _availability?['id']?.toString();
    if (id == null || id.isEmpty) return;
    setState(() => _submitting = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http
          .patch(Uri.parse(ApiConfig.outstationPoolAvailabilityEnd(id)), headers: headers)
          .timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        _snack('You are now offline for Outstation Pool');
        if (mounted) setState(() => _availability = null);
      } else {
        _snack('Could not go offline', error: true);
      }
    } catch (_) {
      _snack('Network error while going offline', error: true);
    }
    if (mounted) setState(() => _submitting = false);
  }

  Future<void> _openActiveRide() async {
    final rideId = _availability?['matched_ride_id']?.toString();
    if (rideId == null || rideId.isEmpty) return;
    try {
      final headers = await AuthService.getHeaders();
      final res = await http
          .get(Uri.parse(ApiConfig.driverOutstationPoolRides), headers: headers)
          .timeout(const Duration(seconds: 10));
      if (res.statusCode != 200 || !mounted) return;
      final payload = jsonDecode(res.body) as Map<String, dynamic>;
      final rides = (payload['data'] is List ? payload['data'] as List : const [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      final ride = rides.cast<Map<String, dynamic>?>().firstWhere(
            (r) => r?['id']?.toString() == rideId,
            orElse: () => null,
          );
      if (ride != null && mounted) {
        Navigator.push(context, MaterialPageRoute(builder: (_) => OutstationPoolTripScreen(ride: ride)));
      } else {
        _snack('Ride details not available yet', error: true);
      }
    } catch (_) {
      _snack('Network error while opening ride', error: true);
    }
  }

  Future<void> _respondToRequest(String requestId, bool accept) async {
    Navigator.of(context, rootNavigator: true).pop();
    try {
      final headers = await AuthService.getHeaders();
      final uri = accept
          ? Uri.parse(ApiConfig.outstationPoolRequestAccept(requestId))
          : Uri.parse(ApiConfig.outstationPoolRequestSkip(requestId));
      final res = await http.post(uri, headers: headers).timeout(const Duration(seconds: 12));
      if (!mounted) return;
      if (res.statusCode == 200) {
        _snack(accept ? 'Passenger confirmed' : 'Request skipped');
        await _load();
      } else {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        _snack(data['message']?.toString() ?? 'Could not respond to request', error: true);
      }
    } catch (_) {
      _snack('Network error while responding to request', error: true);
    }
  }

  void _showIncomingRequestSheet(Map<String, dynamic> req) {
    final requestId = req['requestId']?.toString() ?? '';
    if (requestId.isEmpty) return;
    int secondsLeft = (req['expiresInSeconds'] as num?)?.toInt() ?? 45;
    Timer? countdown;
    showModalBottomSheet(
      context: context,
      isDismissible: false,
      enableDrag: false,
      backgroundColor: Colors.transparent,
      builder: (sheetCtx) => StatefulBuilder(
        builder: (sheetCtx, setSheetState) {
          countdown ??= Timer.periodic(const Duration(seconds: 1), (t) {
            secondsLeft -= 1;
            if (secondsLeft <= 0) {
              t.cancel();
              if (Navigator.canPop(sheetCtx)) Navigator.pop(sheetCtx);
            } else {
              setSheetState(() {});
            }
          });
          final customerName = req['customerName']?.toString() ?? 'Passenger';
          final customerPhone = req['customerPhone']?.toString() ?? '';
          final fromCity = req['fromCity']?.toString() ?? '';
          final toCity = req['toCity']?.toString() ?? '';
          final seats = req['seatsRequested'] ?? 1;
          return Container(
            padding: const EdgeInsets.all(20),
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2)),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'New Outstation Pool Request',
                        style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w700),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(color: JT.primaryLight, borderRadius: BorderRadius.circular(20)),
                      child: Text('${secondsLeft}s', style: GoogleFonts.poppins(fontSize: 12, fontWeight: FontWeight.w600, color: JT.primaryDark)),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text('$fromCity -> $toCity', style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                Text('$customerName · $seats seat${seats == 1 ? '' : 's'}',
                    style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary)),
                if (customerPhone.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  GestureDetector(
                    onTap: () => launchUrl(Uri.parse('tel:$customerPhone')),
                    child: Text(customerPhone, style: GoogleFonts.poppins(fontSize: 13, color: JT.primary)),
                  ),
                ],
                const SizedBox(height: 20),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => _respondToRequest(requestId, false),
                        child: const Text('Skip'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: () => _respondToRequest(requestId, true),
                        style: ElevatedButton.styleFrom(backgroundColor: JT.primary, foregroundColor: Colors.white),
                        child: const Text('Accept'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    ).whenComplete(() => countdown?.cancel());
  }

  void _snack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: error ? JT.error : JT.success, behavior: SnackBarBehavior.floating),
    );
  }

  String _fmt(dynamic v) {
    if (v == null) return '-';
    try {
      final dt = DateTime.parse(v.toString()).toLocal();
      return '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return v.toString();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bg,
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: JT.textPrimary,
        title: Text('Outstation Pool', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: JT.primary))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_availability != null) _buildStatusCard() else _buildFormCard(),
                ],
              ),
            ),
    );
  }

  Widget _buildStatusCard() {
    final a = _availability!;
    final hasRide = (a['matched_ride_id'] ?? a['matchedRideId']) != null;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), boxShadow: JT.cardShadow),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 10, height: 10,
                decoration: const BoxDecoration(color: JT.success, shape: BoxShape.circle),
              ),
              const SizedBox(width: 8),
              Text('You are available', style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 14),
          Text('${a['from_city']} -> ${a['to_city']}', style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text('Seats available: ${a['available_seats']} / ${a['seat_capacity']}',
              style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary)),
          const SizedBox(height: 4),
          Text('Rate: Rs ${a['price_per_km_per_seat']}/km/seat', style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary)),
          const SizedBox(height: 4),
          Text('Window: ${_fmt(a['earliest_departure'])} - ${_fmt(a['latest_departure'])}',
              style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary)),
          const SizedBox(height: 18),
          if (hasRide)
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _openActiveRide,
                icon: const Icon(Icons.route_rounded, size: 18),
                label: const Text('View Active Ride'),
                style: ElevatedButton.styleFrom(backgroundColor: JT.primary, foregroundColor: Colors.white),
              ),
            ),
          if (hasRide) const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: _submitting ? null : _endAvailability,
              child: _submitting
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Go Offline'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFormCard() {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), boxShadow: JT.cardShadow),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Go Available for Outstation Pool', style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text('Set your route and departure window — we\'ll match you with passengers automatically.',
              style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
          const SizedBox(height: 16),
          _textField(_fromCtrl, 'From City'),
          const SizedBox(height: 10),
          _textField(_toCtrl, 'To City'),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(child: _textField(_seatsCtrl, 'Seats', keyboardType: TextInputType.number)),
              const SizedBox(width: 10),
              Expanded(child: _textField(_priceCtrl, 'Price / km / seat', keyboardType: const TextInputType.numberWithOptions(decimal: true))),
            ],
          ),
          const SizedBox(height: 10),
          _dateTimeTile('Earliest Departure', _earliestDeparture, () => _pickDate(true)),
          const SizedBox(height: 10),
          _dateTimeTile('Latest Departure', _latestDeparture, () => _pickDate(false)),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: JT.gradientButton(label: 'Go Available', loading: _submitting, onTap: _goAvailable),
          ),
        ],
      ),
    );
  }

  Widget _dateTimeTile(String label, DateTime? value, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        decoration: BoxDecoration(color: JT.bgSoft, borderRadius: BorderRadius.circular(12)),
        child: Row(
          children: [
            Icon(Icons.schedule_rounded, size: 18, color: JT.textSecondary),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                value == null ? label : '$label: ${_fmt(value.toIso8601String())}',
                style: GoogleFonts.poppins(fontSize: 13, color: value == null ? JT.textSecondary : JT.textPrimary),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _textField(TextEditingController controller, String label, {TextInputType? keyboardType}) {
    return TextField(
      controller: controller,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        labelText: label,
        filled: true,
        fillColor: JT.bgSoft,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
      ),
    );
  }
}
