import 'dart:convert';
import 'package:flutter/material.dart';
import '../../services/error_reporting.dart';
import '../../config/jago_theme.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:shimmer/shimmer.dart';
import '../../src/core/config/api_config.dart';
import '../../services/auth_service.dart';
import '../booking/booking_screen.dart';
import '../main_screen.dart';
import '../tracking/tracking_screen.dart';

class TripsHistoryScreen extends StatefulWidget {
  const TripsHistoryScreen({super.key});
  @override
  State<TripsHistoryScreen> createState() => _TripsHistoryScreenState();
}

class _TripsHistoryScreenState extends State<TripsHistoryScreen>
    with SingleTickerProviderStateMixin {
  List<dynamic> _trips = [];
  bool _loading = true;
  bool _loadingMore = false;
  int _offset = 0;
  int? _total;
  static const int _pageSize = 20;
  String _filter = 'all'; // all | completed | cancelled

  late AnimationController _headerCtrl;

  static const Color _blue = Color(0xFF6366F1);
  static const Color _navy = Color(0xFF1E293B);
  static const Color _purple = Color(0xFF7C3AED);
  static const Color _ridePrimaryDark = Color(0xFF4F4ACF);
  static const LinearGradient _rideGradient = LinearGradient(
    colors: [Color(0xFF4F4ACF), Color(0xFF6366F1)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  @override
  void initState() {
    super.initState();
    _headerCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 600));
    _fetchTrips();
  }

  @override
  void dispose() {
    _headerCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchTrips() async {
    setState(() => _loading = true);
    final headers = await AuthService.getHeaders();
    try {
      final res = await http.get(
          Uri.parse('${ApiConfig.trips}?limit=$_pageSize&offset=0'),
          headers: headers);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (mounted) {
          final trips = (data['trips'] ?? []) as List<dynamic>;
          setState(() {
            _trips = trips;
            _offset = trips.length;
            _total = data['total'] is int ? data['total'] as int : int.tryParse('${data['total']}');
            _loading = false;
          });
          _headerCtrl.forward(from: 0);
        }
      } else {
        if (mounted) setState(() => _loading = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool get _hasMore => _total == null || _offset < _total!;

  Future<void> _loadMoreTrips() async {
    if (_loadingMore || _loading || !_hasMore) return;
    setState(() => _loadingMore = true);
    final headers = await AuthService.getHeaders();
    try {
      final res = await http.get(
          Uri.parse('${ApiConfig.trips}?limit=$_pageSize&offset=$_offset'),
          headers: headers);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (mounted) {
          final trips = (data['trips'] ?? []) as List<dynamic>;
          setState(() {
            _trips = [..._trips, ...trips];
            _offset += trips.length;
            _total = data['total'] is int ? data['total'] as int : int.tryParse('${data['total']}');
            _loadingMore = false;
          });
        }
      } else {
        if (mounted) setState(() => _loadingMore = false);
      }
    } catch (e, st) {
      reportSilentFailure('TripsHistoryScreen._loadMoreTrips', e, st);
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  // A trip is active when its status isn't one of the two terminal states —
  // matches the same rule the backend's /active-trip endpoint and the
  // duplicate-booking guard (ACTIVE_TRIP_STATUSES) already use, so this
  // never drifts from what the server considers "still open."
  static bool _isActiveStatus(String s) => s != 'completed' && s != 'cancelled' && s.isNotEmpty;

  List<dynamic> get _filtered {
    if (_filter == 'all') return _trips;
    if (_filter == 'active') {
      return _trips.where((t) => _isActiveStatus((t['currentStatus'] ?? t['status'] ?? '').toString())).toList();
    }
    return _trips.where((t) {
      final s = (t['currentStatus'] ?? t['status'] ?? '').toString();
      return s == _filter;
    }).toList();
  }

  int get _activeCount => _trips
      .where((t) => _isActiveStatus((t['currentStatus'] ?? t['status'] ?? '').toString()))
      .length;
  int get _completedCount => _trips
      .where((t) => (t['currentStatus'] ?? t['status'] ?? '') == 'completed')
      .length;
  int get _cancelledCount => _trips
      .where((t) => (t['currentStatus'] ?? t['status'] ?? '') == 'cancelled')
      .length;

  Future<void> _showReceipt(BuildContext ctx, String tripId) async {
    showDialog(
        context: ctx,
        barrierDismissible: false,
        builder: (_) =>
            const Center(child: CircularProgressIndicator(color: JT.primary)));
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.tripReceipt(tripId)),
          headers: headers);
      if (!mounted) return;
      Navigator.pop(ctx);
      if (res.statusCode == 200) {
        final receipt = jsonDecode(res.body)['receipt'];
        _showReceiptSheet(ctx, receipt);
      } else {
        _showSnack('Receipt not available', error: true);
      }
    } catch (_) {
      if (mounted) {
        Navigator.pop(ctx);
        _showSnack('Could not load receipt', error: true);
      }
    }
  }

  void _showSnack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg,
          style: GoogleFonts.poppins(
              fontWeight: FontWeight.w400, color: Colors.white, fontSize: 13)),
      backgroundColor: error ? JT.primaryDark : _blue,
      behavior: SnackBarBehavior.floating,
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ));
  }

  void _showReceiptSheet(BuildContext ctx, Map<String, dynamic> r) {
    final fare = r['fare'] ?? {};
    final vehicle = r['vehicle'] ?? {};
    final driver = r['driver'] ?? {};
    showModalBottomSheet(
      context: ctx,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => Container(
        constraints:
            BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.85),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          // Handle
          Container(
            width: 40,
            height: 4,
            margin: const EdgeInsets.only(top: 14, bottom: 8),
            decoration: BoxDecoration(
                color: const Color(0xFFE2E8F0),
                borderRadius: BorderRadius.circular(2)),
          ),
          // Header
          Container(
            margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFDCE7F5)),
              boxShadow: JT.cardShadow,
            ),
            child: Row(children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: JT.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.receipt_long_rounded,
                    color: JT.primary, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Text('Trip Receipt',
                        style: GoogleFonts.poppins(
                            color: _navy,
                            fontWeight: FontWeight.w400,
                            fontSize: 18)),
                    Text(r['receiptNo'] ?? '',
                        style: GoogleFonts.poppins(
                            color: const Color(0xFF64748B), fontSize: 12)),
                  ])),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: JT.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text('PAID',
                    style: GoogleFonts.poppins(
                        color: JT.primary,
                        fontWeight: FontWeight.w400,
                        fontSize: 12)),
              ),
            ]),
          ),
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Route card
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF8FAFC),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: const Color(0xFFE2E8F0)),
                      ),
                      child: IntrinsicHeight(
                        child: Row(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Container(
                                        width: 10,
                                        height: 10,
                                        decoration: const BoxDecoration(
                                            shape: BoxShape.circle,
                                            color: _blue)),
                                    Expanded(
                                        child: Container(
                                            width: 2,
                                            color: const Color(0xFFE2E8F0),
                                            margin: const EdgeInsets.symmetric(
                                                vertical: 3))),
                                    Container(
                                        width: 10,
                                        height: 10,
                                        decoration: BoxDecoration(
                                            color: _purple,
                                            borderRadius:
                                                BorderRadius.circular(2))),
                                  ]),
                              const SizedBox(width: 12),
                              Expanded(
                                  child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                    Text('PICKUP',
                                        style: GoogleFonts.poppins(
                                            color: _blue,
                                            fontSize: 10,
                                            fontWeight: FontWeight.w500,
                                            letterSpacing: 0.8)),
                                    const SizedBox(height: 2),
                                    Text(r['pickup']?['address'] ?? '',
                                        style: GoogleFonts.poppins(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w400,
                                            color: _navy),
                                        maxLines: 2),
                                    const SizedBox(height: 12),
                                    Text('DROP-OFF',
                                        style: GoogleFonts.poppins(
                                            color: _purple,
                                            fontSize: 10,
                                            fontWeight: FontWeight.w500,
                                            letterSpacing: 0.8)),
                                    const SizedBox(height: 2),
                                    Text(r['destination']?['address'] ?? '',
                                        style: GoogleFonts.poppins(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w400,
                                            color: _navy),
                                        maxLines: 2),
                                  ])),
                            ]),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Driver & vehicle row
                    if (driver['name'] != null || vehicle['name'] != null)
                      Row(children: [
                        if (driver['name'] != null)
                          Expanded(
                              child: _infoChip(Icons.person_rounded,
                                  driver['name'], JT.primary)),
                        if (driver['name'] != null && vehicle['name'] != null)
                          const SizedBox(width: 10),
                        if (vehicle['name'] != null)
                          Expanded(
                              child: _infoChip(
                                  Icons.directions_car_rounded,
                                  '${vehicle['name']} ${vehicle['number'] ?? ''}',
                                  const Color(0xFF1A6FDB))),
                      ]),
                    if ((r['distanceKm'] ?? 0) > 0) ...[
                      const SizedBox(height: 10),
                      _infoChip(Icons.route_rounded, '${r['distanceKm']} km',
                          JT.primary),
                    ],

                    const SizedBox(height: 16),
                    Text('Fare Breakdown',
                        style: GoogleFonts.poppins(
                            fontSize: 14,
                            fontWeight: FontWeight.w500,
                            color: _navy)),
                    const SizedBox(height: 10),

                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF8FAFC),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: const Color(0xFFE2E8F0)),
                      ),
                      child: Column(children: [
                        _fareRow('Base Fare', fare['baseFare'] ?? 0),
                        if ((fare['distanceFare'] ?? 0) > 0)
                          _fareRow('Distance Fare', fare['distanceFare'] ?? 0),
                        if ((fare['waitingCharge'] ?? 0) > 0)
                          _fareRow(
                              'Waiting Charge', fare['waitingCharge'] ?? 0),
                        if ((fare['discount'] ?? 0) > 0)
                          _fareRow('Discount', fare['discount'] ?? 0,
                              isDiscount: true),
                        _fareRow('GST (5%)', fare['gst'] ?? 0, isGst: true),
                        const Divider(height: 20, color: Color(0xFFE2E8F0)),
                        Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('Total Paid',
                                  style: GoogleFonts.poppins(
                                      fontWeight: FontWeight.w400,
                                      fontSize: 16,
                                      color: _navy)),
                              Text('₹${fare['payable'] ?? fare['total'] ?? 0}',
                                  style: GoogleFonts.poppins(
                                      fontWeight: FontWeight.w500,
                                      fontSize: 20,
                                      color: _blue)),
                            ]),
                        const SizedBox(height: 8),
                        Row(children: [
                          const Icon(Icons.payment_rounded,
                              size: 14, color: Color(0xFF94A3B8)),
                          const SizedBox(width: 6),
                          Text(
                              'Paid via ${(fare['paymentMethod'] ?? 'cash').toUpperCase()}',
                              style: GoogleFonts.poppins(
                                  fontSize: 12,
                                  color: const Color(0xFF94A3B8))),
                        ]),
                      ]),
                    ),

                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      height: 54,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: _blue,
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: [
                            BoxShadow(
                                color: _blue.withValues(alpha: 0.35),
                                blurRadius: 14,
                                offset: const Offset(0, 6))
                          ],
                        ),
                        child: ElevatedButton(
                          onPressed: () => Navigator.pop(ctx),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.transparent,
                            shadowColor: Colors.transparent,
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16)),
                            elevation: 0,
                          ),
                          child: Text('Close',
                              style: GoogleFonts.poppins(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w500,
                                  fontSize: 15)),
                        ),
                      ),
                    ),
                  ]),
            ),
          ),
        ]),
      ),
    );
  }

  Widget _infoChip(IconData icon, String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Row(children: [
        Icon(icon, color: color, size: 15),
        const SizedBox(width: 6),
        Expanded(
            child: Text(text,
                style: GoogleFonts.poppins(
                    fontSize: 12, fontWeight: FontWeight.w400, color: color),
                maxLines: 1,
                overflow: TextOverflow.ellipsis)),
      ]),
    );
  }

  Widget _fareRow(String label, dynamic amount,
      {bool isDiscount = false, bool isGst = false}) {
    final color = isDiscount
        ? JT.primaryDark
        : isGst
            ? JT.primary
            : const Color(0xFF475569);
    final prefix = isDiscount ? '-' : '';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text(label,
            style: GoogleFonts.poppins(
                fontSize: 13, color: const Color(0xFF64748B))),
        Text('$prefix₹$amount',
            style: GoogleFonts.poppins(
                fontSize: 13, fontWeight: FontWeight.w400, color: color)),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filtered;

    return Scaffold(
      backgroundColor: const Color(0xFFD3C7FE), // Matches the pastel purple background
      body: Stack(
        children: [
          // Fluid bottom shapes
          Positioned(
            bottom: -50,
            left: -50,
            right: -50,
            child: Container(
              height: 250,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.15),
                borderRadius: const BorderRadius.all(Radius.elliptical(400, 200)),
              ),
            ),
          ),
          Positioned(
            bottom: -100,
            left: -100,
            right: -100,
            child: Container(
              height: 300,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.35),
                borderRadius: const BorderRadius.all(Radius.elliptical(500, 250)),
              ),
            ),
          ),
          
          Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 12),
                
                // Trips Content (Header + Filters + List)
                Expanded(
                  child: Container(
                    decoration: const BoxDecoration(
                      color: Color(0xFFF1F5F9), // Back to original background for list content
                      borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // My Trips & Subtitle
                        Padding(
                          padding: const EdgeInsets.fromLTRB(20, 24, 20, 16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('My Trips',
                                style: GoogleFonts.poppins(
                                  color: JT.textPrimary,
                                  fontSize: 24,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: -0.5,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text('Track your recent rides and parcel bookings',
                                style: GoogleFonts.poppins(
                                  color: const Color(0xFF64748B),
                                  fontSize: 13,
                                  fontWeight: FontWeight.w400,
                                ),
                              ),
                            ],
                          ),
                        ),

                        // Filter chips
                        Container(
                          color: const Color(0xFFF1F5F9), // keep background continuous
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                          child: SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: Row(children: [
                              _filterChip('all', 'All'),
                              const SizedBox(width: 8),
                              _filterChip('active', 'Active'),
                              const SizedBox(width: 8),
                              _filterChip('completed', 'Completed'),
                              const SizedBox(width: 8),
                              _filterChip('cancelled', 'Cancelled'),
                            ]),
                          ),
                        ),

                        // Dashboard Summary Cards
                        Padding(
                          padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                          child: Row(
                            children: [
                              _headerStat('$_activeCount', 'Active', Icons.radio_button_checked_rounded, JT.primary),
                              const SizedBox(width: 10),
                              _headerStat('$_completedCount', 'Completed', Icons.check_circle_rounded, const Color(0xFF10B981)), // green
                              const SizedBox(width: 10),
                              _headerStat('$_cancelledCount', 'Cancelled', Icons.cancel_rounded, const Color(0xFFEF4444)), // red
                            ],
                          ),
                        ),

                        // List 
                        Expanded(
                          child: _loading
                              ? _buildSkeletonList()
                              : filtered.isEmpty
                                  ? _buildEmpty()
                                  : RefreshIndicator(
                                      onRefresh: _fetchTrips,
                                      color: _blue,
                                      child: NotificationListener<ScrollNotification>(
                                        onNotification: (n) {
                                          // Paginate regardless of active filter - the
                                          // filter only narrows what's already loaded,
                                          // so a filtered view reaching its own bottom
                                          // can still mean there are more matches
                                          // sitting on a page that hasn't loaded yet.
                                          if (n.metrics.pixels >=
                                              n.metrics.maxScrollExtent - 200) {
                                            _loadMoreTrips();
                                          }
                                          return false;
                                        },
                                        child: ListView.builder(
                                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                                          itemCount: filtered.length + (_hasMore ? 1 : 0),
                                          itemBuilder: (ctx, i) {
                                            if (i >= filtered.length) {
                                              return const Padding(
                                                padding: EdgeInsets.symmetric(vertical: 20),
                                                child: Center(
                                                    child: CircularProgressIndicator(
                                                        color: _blue, strokeWidth: 2.5)),
                                              );
                                            }
                                            return _buildTripCard(ctx, filtered[i]);
                                          },
                                        ),
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
      );
    }

  Widget _headerStat(String value, String label, IconData icon, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFDCE7F5)),
          boxShadow: JT.cardShadow,
        ),
        child: Row(children: [
          Icon(icon, color: color, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: GoogleFonts.poppins(
                    color: JT.textPrimary,
                    fontWeight: FontWeight.w500,
                    fontSize: 18,
                    height: 1),
              ),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: GoogleFonts.poppins(
                    color: const Color(0xFF64748B),
                    fontSize: 10,
                    fontWeight: FontWeight.w500),
              ),
            ]),
          ),
        ]),
      ),
    );
  }

  Widget _filterChip(String value, String label) {
    final active = _filter == value;
    return GestureDetector(
      onTap: () => setState(() => _filter = value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
        decoration: BoxDecoration(
          color: active ? _blue : Colors.white,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: active ? _blue : const Color(0xFFE2E8F0)),
          boxShadow: active ? [BoxShadow(color: _blue.withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 4))] : null,
        ),
        child: Text(
          label,
          style: GoogleFonts.poppins(
            color: active ? Colors.white : const Color(0xFF64748B),
            fontWeight: active ? FontWeight.w600 : FontWeight.w500,
            fontSize: 13,
          ),
        ),
      ),
    );
  }

  Widget _buildSkeletonList() {
    Widget box(double w, double h, {double r = 8}) => Container(
          width: w,
          height: h,
          decoration: BoxDecoration(
              color: Colors.white, borderRadius: BorderRadius.circular(r)),
        );
    return Shimmer.fromColors(
      baseColor: const Color(0xFFE5E7EB),
      highlightColor: const Color(0xFFF3F4F6),
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        itemCount: 6,
        itemBuilder: (_, __) => Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(children: [
            box(48, 48, r: 12),
            const SizedBox(width: 12),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  box(140, 14, r: 6),
                  const SizedBox(height: 8),
                  box(200, 12, r: 5),
                  const SizedBox(height: 6),
                  box(100, 12, r: 5),
                ])),
            const SizedBox(width: 8),
            box(56, 28, r: 8),
          ]),
        ),
      ),
    );
  }

  Widget _buildEmpty() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 28),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(
              color: const Color(0xFFEBF4FF),
              borderRadius: BorderRadius.circular(28),
              boxShadow: JT.shadowXs,
            ),
            child: const Icon(Icons.receipt_long_outlined,
                size: 40, color: JT.primary),
          ),
          const SizedBox(height: 18),
          Text(
            _filter == 'all' ? 'No rides yet' : 'No ${_filter} rides',
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(
                color: const Color(0xFF475569),
                fontSize: 18,
                fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 8),
          Text(
            'Your ride history will appear here once your trips are completed.',
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(
                color: const Color(0xFF94A3B8), fontSize: 13, height: 1.4),
          ),
          if (_filter == 'all') ...[
            const SizedBox(height: 18),
            SizedBox(
              width: 190,
              child: _rideGradientButton(
                label: 'Book a Ride',
                onTap: () => Navigator.pushAndRemoveUntil(
                  context,
                  MaterialPageRoute(builder: (_) => const MainScreen()),
                  (_) => false,
                ),
              ),
            ),
          ],
        ]),
      ),
    );
  }

  Widget _buildTripCard(BuildContext ctx, Map<String, dynamic> t) {
    final status = (t['currentStatus'] ?? t['status'] ?? '').toString();
    final isCompleted = status == 'completed';
    final isCancelled = status == 'cancelled';
    final statusColor = isCompleted
        ? const Color(0xFF10B981) // Green for Completed
        : isCancelled
            ? const Color(0xFFEF4444) // Red for Cancelled
            : status.toLowerCase() == 'upcoming'
                ? const Color(0xFFF59E0B) // Orange for Upcoming
                : JT.primary; // Blue for ongoing/others
    final statusLabel = isCompleted
        ? 'Completed'
        : isCancelled
            ? 'Cancelled'
            : status;
    final date = t['createdAt'] ?? t['created_at'] ?? '';
    final formattedDate = _formatDate(date);

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
              color: const Color(0xFF0F172A).withValues(alpha: 0.04),
              blurRadius: 16,
              offset: const Offset(0, 4))
        ],
      ),
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
            // Vehicle icon / Graphic
            Container(
              width: 54,
              height: 54,
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Icon(
                isCompleted
                    ? Icons.check_circle_outline_rounded
                    : isCancelled
                        ? Icons.cancel_outlined
                        : Icons.directions_car_rounded,
                color: statusColor,
                size: 26,
              ),
            ),
            const SizedBox(width: 16),
            // Route info
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Column(
                        children: [
                          Container(
                            margin: const EdgeInsets.only(top: 4, bottom: 4),
                            width: 10,
                            height: 10,
                            decoration: const BoxDecoration(
                              color: Color(0xFF10B981), // Green dot for pickup
                              shape: BoxShape.circle,
                            ),
                          ),
                          Container(
                            width: 2,
                            height: 14,
                            decoration: BoxDecoration(
                              color: const Color(0xFFE2E8F0), // faint line
                              borderRadius: BorderRadius.circular(1),
                            ),
                          ),
                          Container(
                            margin: const EdgeInsets.only(top: 4),
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(
                              color: const Color(0xFFEF4444), // Red square for drop
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              t['pickupAddress'] ?? 'Pickup location',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: GoogleFonts.poppins(
                                  fontWeight: FontWeight.w500,
                                  fontSize: 13,
                                  color: const Color(0xFF1E293B)),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              t['destinationAddress'] ?? 'Destination',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: GoogleFonts.poppins(
                                  fontWeight: FontWeight.w500,
                                  fontSize: 13,
                                  color: const Color(0xFF64748B)),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  if (formattedDate.isNotEmpty)
                    Text(formattedDate,
                        style: GoogleFonts.poppins(
                            fontSize: 11,
                            color: const Color(0xFF94A3B8),
                            fontWeight: FontWeight.w500)),
                ])),
            // Fare + status
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(
                '₹${t['actualFare'] ?? t['estimatedFare'] ?? '0'}',
                style: GoogleFonts.poppins(
                    fontWeight: FontWeight.w700,
                    fontSize: 18,
                    color: const Color(0xFF1E293B)),
              ),
              const SizedBox(height: 6),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(statusLabel,
                    style: GoogleFonts.poppins(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: statusColor)),
              ),
            ]),
          ]),
        ),
        if (!isCompleted && !isCancelled) ...[
          Container(height: 1, color: const Color(0xFFF1F5F9)),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
            child: SizedBox(
              width: double.infinity,
              child: _actionButton(
                icon: Icons.my_location_rounded,
                label: 'Track Trip',
                filled: true,
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => TrackingScreen(tripId: (t['id'] ?? t['tripId'] ?? '').toString()),
                  ),
                ),
              ),
            ),
          ),
        ],
        if (isCompleted) ...[
          Container(height: 1, color: const Color(0xFFF1F5F9)),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
            child: Row(children: [
              Expanded(
                child: _actionButton(
                  icon: Icons.receipt_long_rounded,
                  label: 'Receipt',
                  onTap: () => _showReceipt(ctx, t['id'] ?? t['tripId'] ?? ''),
                ),
              ),
              const SizedBox(width: 8),
              if ((t['destinationAddress'] ?? '').isNotEmpty)
                Expanded(
                  child: _actionButton(
                    icon: Icons.refresh_rounded,
                    label: 'Book Again',
                    filled: true,
                    onTap: () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => BookingScreen(
                            pickup: t['pickupAddress'] ?? 'Current Location',
                            destination: t['destinationAddress'] ?? '',
                            pickupLat: double.tryParse(
                                    t['pickupLat']?.toString() ??
                                        t['pickup_lat']?.toString() ??
                                        '17.3850') ??
                                17.3850,
                            pickupLng: double.tryParse(
                                    t['pickupLng']?.toString() ??
                                        t['pickup_lng']?.toString() ??
                                        '78.4867') ??
                                78.4867,
                            destLat: double.tryParse(
                                    t['destinationLat']?.toString() ??
                                        t['destination_lat']?.toString() ??
                                        '0') ??
                                0,
                            destLng: double.tryParse(
                                    t['destinationLng']?.toString() ??
                                        t['destination_lng']?.toString() ??
                                        '0') ??
                                0,
                            vehicleCategoryId:
                                t['vehicleCategoryId']?.toString() ??
                                    t['vehicle_category_id']?.toString(),
                            vehicleCategoryName:
                                t['vehicleCategoryName']?.toString() ??
                                    t['vehicle_category_name']?.toString(),
                          ),
                        )),
                  ),
                ),
            ]),
          ),
        ],
      ]),
    );
  }

  Widget _actionButton(
      {required IconData icon,
      required String label,
      required VoidCallback onTap,
      bool filled = false}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 44,
        decoration: BoxDecoration(
          color: filled ? _blue : const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(12),
          border: filled ? null : Border.all(color: const Color(0xFFE2E8F0)),
          boxShadow: filled ? JT.shadowXs : null,
        ),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(icon, size: 14, color: filled ? Colors.white : _blue),
          const SizedBox(width: 6),
          Text(label,
              style: GoogleFonts.poppins(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  color: filled ? Colors.white : _blue)),
        ]),
      ),
    );
  }

  String _formatDate(String raw) {
    try {
      final d = DateTime.parse(raw).toLocal();
      final months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec'
      ];
      return '${d.day} ${months[d.month - 1]} ${d.year}';
    } catch (_) {
      return raw.length > 10 ? raw.substring(0, 10) : raw;
    }
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
