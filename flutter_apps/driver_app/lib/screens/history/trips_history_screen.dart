import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:shimmer/shimmer.dart';
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

class TripsHistoryScreen extends StatefulWidget {
  const TripsHistoryScreen({super.key});
  @override
  State<TripsHistoryScreen> createState() => _TripsHistoryScreenState();
}

class _TripsHistoryScreenState extends State<TripsHistoryScreen>
    with SingleTickerProviderStateMixin {
  List<dynamic> _allTrips = [];
  List<dynamic> _filtered = [];
  bool _loading = true;
  bool _loadingMore = false;
  int _offset = 0;
  int? _total;
  static const int _pageSize = 20;
  String _activeFilter = 'All';
  String _searchQuery = '';
  final _searchCtrl = TextEditingController();
  late TabController _tabCtrl;

  // Summary stats
  double _totalEarnings = 0;
  int _activeCount = 0;
  int _completedCount = 0;
  int _cancelledCount = 0;

  // Color system
  static const Color _bg = Color(0xFFFFFFFF);
  static const Color _surface = Color(0xFFF7FAFF);
  static const Color _card = JT.surfaceAlt;
  static const Color _border = JT.border;
  static const Color _primary = Color(0xFF2F7BFF);
  static const Color _green = JT.success;
  static const Color _amber = JT.warning;
  static const Color _red = JT.error;
  static const Color _textSecondary = JT.textSecondary;
  static const Color _textHint = JT.iconInactive;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 4, vsync: this);
    _tabCtrl.addListener(() {
      if (_tabCtrl.indexIsChanging) return;
      final filters = ['All', 'Active', 'Completed', 'Cancelled'];
      setState(() { _activeFilter = filters[_tabCtrl.index]; });
      _onTabChanged();
    });
    _fetchTrips();
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  String? get _statusParam => switch (_activeFilter) {
        'Active' => 'active',
        'Completed' => 'completed',
        'Cancelled' => 'cancelled',
        _ => null,
      };

  Future<void> _fetchTrips({bool refresh = false}) async {
    if (mounted) setState(() => _loading = true);
    final headers = await AuthService.getHeaders();
    try {
      final status = _statusParam;
      final uri = Uri.parse(
          '${ApiConfig.driverTrips}?limit=$_pageSize&offset=0${status != null ? '&status=$status' : ''}');
      final res = await http.get(uri, headers: headers);
      if (res.statusCode == 200 && mounted) {
        final data = jsonDecode(res.body);
        final trips = (data['trips'] as List?) ?? [];
        setState(() {
          _allTrips = trips;
          _offset = trips.length;
          _total = data['total'] is int ? data['total'] as int : int.tryParse('${data['total']}');
          _loading = false;
        });
        _applyFilter();
        _refreshSummaryCounts();
      } else if (mounted) {
        setState(() => _loading = false);
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
      final status = _statusParam;
      final uri = Uri.parse(
          '${ApiConfig.driverTrips}?limit=$_pageSize&offset=$_offset${status != null ? '&status=$status' : ''}');
      final res = await http.get(uri, headers: headers);
      if (res.statusCode == 200 && mounted) {
        final data = jsonDecode(res.body);
        final trips = (data['trips'] as List?) ?? [];
        setState(() {
          _allTrips = [..._allTrips, ...trips];
          _offset += trips.length;
          _total = data['total'] is int ? data['total'] as int : int.tryParse('${data['total']}');
          _loadingMore = false;
        });
        _applyFilter();
      } else if (mounted) {
        setState(() => _loadingMore = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  /// Completed/Cancelled counts shown in the summary header must reflect the
  /// driver's FULL trip history, not just the current page - fetched cheaply
  /// via limit=1 (the endpoint always returns an accurate `total` for the
  /// given status filter regardless of how many rows are requested).
  /// Earnings total intentionally still reflects only currently-loaded trips
  /// pending a dedicated all-time earnings-aggregate endpoint (a backend
  /// API addition, out of scope here) - not a regression from prior behavior.
  Future<void> _refreshSummaryCounts() async {
    final headers = await AuthService.getHeaders();
    try {
      final results = await Future.wait([
        http.get(Uri.parse('${ApiConfig.driverTrips}?limit=1&status=completed'), headers: headers),
        http.get(Uri.parse('${ApiConfig.driverTrips}?limit=1&status=cancelled'), headers: headers),
        http.get(Uri.parse('${ApiConfig.driverTrips}?limit=1&status=active'), headers: headers),
      ]);
      if (!mounted) return;
      final completedData = results[0].statusCode == 200 ? jsonDecode(results[0].body) : null;
      final cancelledData = results[1].statusCode == 200 ? jsonDecode(results[1].body) : null;
      final activeData = results[2].statusCode == 200 ? jsonDecode(results[2].body) : null;
      double earnings = 0;
      for (final t in _allTrips) {
        final status = t['currentStatus'] ?? t['status'] ?? '';
        if (status == 'completed') {
          earnings += double.tryParse((t['actualFare'] ?? t['estimatedFare'] ?? '0').toString()) ?? 0;
        }
      }
      setState(() {
        _completedCount = completedData != null
            ? (completedData['total'] is int ? completedData['total'] as int : int.tryParse('${completedData['total']}') ?? 0)
            : _completedCount;
        _cancelledCount = cancelledData != null
            ? (cancelledData['total'] is int ? cancelledData['total'] as int : int.tryParse('${cancelledData['total']}') ?? 0)
            : _cancelledCount;
        _activeCount = activeData != null
            ? (activeData['total'] is int ? activeData['total'] as int : int.tryParse('${activeData['total']}') ?? 0)
            : _activeCount;
        _totalEarnings = earnings;
      });
    } catch (_) {
      // Non-critical - summary header keeps its last known values.
    }
  }

  void _onTabChanged() {
    _offset = 0;
    _total = null;
    _fetchTrips();
  }

  void _applyFilter() {
    final q = _searchQuery.toLowerCase();
    setState(() {
      // Status filtering now happens server-side (see _statusParam) - this
      // only applies the client-side text search over the currently loaded
      // page(s) for the active status filter.
      _filtered = _allTrips.where((t) {
        final pickup = (t['pickupAddress'] ?? '').toString().toLowerCase();
        final dest = (t['destinationAddress'] ?? '').toString().toLowerCase();
        return q.isEmpty || pickup.contains(q) || dest.contains(q);
      }).toList();
    });
  }

  String _formatDate(String? raw) {
    if (raw == null) return '';
    try {
      final dt = DateTime.parse(raw).toLocal();
      final months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      final h = dt.hour > 12 ? dt.hour - 12 : (dt.hour == 0 ? 12 : dt.hour);
      final ampm = dt.hour >= 12 ? 'PM' : 'AM';
      final m = dt.minute.toString().padLeft(2, '0');
      return '${dt.day} ${months[dt.month - 1]} · $h:$m $ampm';
    } catch (_) { return ''; }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'completed': return _green;
      case 'cancelled': return _red;
      case 'ongoing': return _primary;
      default: return _amber;
    }
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'completed': return 'Completed';
      case 'cancelled': return 'Cancelled';
      case 'ongoing': return 'Ongoing';
      case 'driver_assigned': return 'Driver Assigned';
      case 'arrived': return 'Arrived';
      default: return status;
    }
  }

  void _showTripDetail(Map t) {
    final status = (t['currentStatus'] ?? t['status'] ?? '').toString();
    final fare = double.tryParse(
        (t['actualFare'] ?? t['estimatedFare'] ?? '0').toString()) ?? 0;
    final isPaid = (t['paymentStatus'] ?? '') == 'paid';
    final type = (t['type'] ?? 'ride').toString();
    final statusColor = _statusColor(status);

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => Container(
        decoration: BoxDecoration(
          color: _card,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          border: Border(
            top: BorderSide(color: statusColor.withValues(alpha: 0.3), width: 1),
          ),
        ),
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 44, height: 4,
            decoration: BoxDecoration(
              color: _border,
              borderRadius: BorderRadius.circular(2)),
          ),
          const SizedBox(height: 20),
          Row(children: [
            Container(
              width: 52, height: 52,
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: statusColor.withValues(alpha: 0.3)),
                boxShadow: [BoxShadow(color: statusColor.withValues(alpha: 0.2), blurRadius: 16)],
              ),
              child: Icon(
                type == 'parcel' ? Icons.inventory_2_rounded : Icons.route_rounded,
                color: statusColor, size: 26),
            ),
            const SizedBox(width: 14),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(
                type == 'parcel' ? 'Parcel Delivery' : 'Ride',
                style: GoogleFonts.poppins(color: JT.textPrimary, fontSize: 17, fontWeight: FontWeight.w400),
              ),
              const SizedBox(height: 3),
              Text(_formatDate(t['createdAt']?.toString()),
                style: GoogleFonts.poppins(color: _textHint, fontSize: 12)),
            ])),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: statusColor.withValues(alpha: 0.3)),
              ),
              child: Text(_statusLabel(status),
                style: GoogleFonts.poppins(color: statusColor, fontSize: 12, fontWeight: FontWeight.w500)),
            ),
          ]),
          const SizedBox(height: 22),

          // Pickup/drop rows
          _detailRow(Icons.my_location_rounded, 'Pickup',
            t['pickupAddress']?.toString() ?? '—', _green),
          const SizedBox(height: 12),
          _detailRow(Icons.location_on_rounded, 'Drop',
            t['destinationAddress']?.toString() ?? '—', _red),

          const SizedBox(height: 20),

          // Stats row
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: _surface,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: _border, width: 1),
            ),
            child: Row(children: [
              _tripStat('Fare', '₹${fare.toStringAsFixed(0)}', Icons.currency_rupee_rounded, _green),
              _vDivider(),
              _tripStat('Payment',
                isPaid ? 'Paid' : (t['paymentMethod']?.toString() ?? 'Cash'),
                isPaid ? Icons.check_circle_rounded : Icons.account_balance_wallet_rounded,
                isPaid ? _green : _amber),
              _vDivider(),
              _tripStat('Distance',
                '${(double.tryParse(t['distanceKm']?.toString() ?? '0') ?? 0).toStringAsFixed(1)} km',
                Icons.straighten_rounded, _primary),
            ]),
          ),

          if (t['refId'] != null) ...[
            const SizedBox(height: 14),
            Row(children: [
              Icon(Icons.tag_rounded, size: 14, color: _textHint),
              const SizedBox(width: 6),
              Text('Trip ID: ${t['refId']}',
                style: GoogleFonts.poppins(color: _textHint, fontSize: 12, letterSpacing: 0.5)),
            ]),
          ],

          if (status == 'completed') ...[
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton.icon(
                onPressed: () async {
                  Navigator.pop(context);
                  await _fetchAndShowReceipt(t['id']?.toString() ?? t['tripId']?.toString() ?? '');
                },
                icon: const Icon(Icons.receipt_long_rounded, size: 18),
                label: Text('View Receipt', style: GoogleFonts.poppins(fontWeight: FontWeight.w400, fontSize: 15)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: _primary,
                  foregroundColor: Colors.black,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
              ),
            ),
          ],
        ]),
      ),
    );
  }

  Future<void> _fetchAndShowReceipt(String tripId) async {
    if (tripId.isEmpty) return;
    final headers = await AuthService.getHeaders();
    try {
      final res = await http.get(Uri.parse(ApiConfig.tripReceipt(tripId)),
        headers: headers);
      if (!mounted) return;
      if (res.statusCode == 200) {
        final receipt = jsonDecode(res.body)['receipt'] as Map<String, dynamic>;
        _showReceiptSheet(receipt);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Receipt not available', style: GoogleFonts.poppins()),
            backgroundColor: _red,
          ));
      }
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Could not load receipt', style: GoogleFonts.poppins()),
          backgroundColor: _red,
        ));
    }
  }

  void _showReceiptSheet(Map<String, dynamic> r) {
    final fare = r['fare'] as Map? ?? {};
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => Container(
        decoration: BoxDecoration(
          color: _card,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          border: Border(top: BorderSide(color: _green.withValues(alpha: 0.3), width: 1)),
        ),
        padding: EdgeInsets.only(
          left: 22, right: 22, top: 20,
          bottom: MediaQuery.of(context).viewInsets.bottom + 28),
        child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 44, height: 4,
            decoration: BoxDecoration(color: _border, borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: 18),
          Text('Earnings Receipt', style: GoogleFonts.poppins(
              color: JT.textPrimary, fontSize: 18, fontWeight: FontWeight.w400)),
          const SizedBox(height: 4),
          Text(r['receiptNo'] ?? '', style: GoogleFonts.poppins(color: _textHint, fontSize: 12)),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: _surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: _border),
            ),
            child: Column(children: [
              _receiptLine('Pickup', r['pickup']?['address'] ?? '—'),
              const SizedBox(height: 6),
              _receiptLine('Drop', r['destination']?['address'] ?? '—'),
              const SizedBox(height: 6),
              _receiptLine('Distance', '${r['distanceKm'] ?? 0} km'),
            ]),
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: _surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: _border),
            ),
            child: Column(children: [
              _receiptLine('Total Fare', '₹${fare['total'] ?? 0}'),
              const SizedBox(height: 6),
              _receiptLine('GST (5%)', '₹${fare['gst'] ?? 0}', highlight: _amber),
              const SizedBox(height: 6),
              _receiptLine('Commission', '₹${fare['commission'] ?? 0}', highlight: _red),
              Divider(color: _border, height: 24),
              _receiptLine('Your Earning', '₹${fare['driverEarning'] ?? 0}', highlight: _green, bold: true),
              const SizedBox(height: 6),
              _receiptLine('Payment', (fare['paymentMethod'] ?? 'Cash').toUpperCase()),
            ]),
          ),
          const SizedBox(height: 20),
          SizedBox(width: double.infinity,
            height: 52,
            child: ElevatedButton(
              onPressed: () => Navigator.pop(context),
              style: ElevatedButton.styleFrom(
                backgroundColor: _primary,
                foregroundColor: Colors.black,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: Text('Close', style: GoogleFonts.poppins(fontWeight: FontWeight.w400, fontSize: 15, color: Colors.black)),
            )),
        ])),
      ),
    );
  }

  Widget _receiptLine(String label, String value, {Color? highlight, bool bold = false}) {
    return Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
      Text(label, style: GoogleFonts.poppins(color: _textSecondary, fontSize: 13)),
      Text(value, style: GoogleFonts.poppins(
        color: highlight ?? JT.textPrimary,
        fontSize: bold ? 15 : 13,
        fontWeight: bold ? FontWeight.w400 : FontWeight.w400)),
    ]);
  }

  Widget _detailRow(IconData icon, String label, String value, Color color) {
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(
        width: 36, height: 36,
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: 0.25)),
        ),
        child: Icon(icon, color: color, size: 18),
      ),
      const SizedBox(width: 12),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: GoogleFonts.poppins(color: _textHint, fontSize: 11, fontWeight: FontWeight.w400)),
        const SizedBox(height: 3),
        Text(value, style: GoogleFonts.poppins(color: JT.textPrimary, fontSize: 13, fontWeight: FontWeight.w400)),
      ])),
    ]);
  }

  Widget _tripStat(String label, String value, IconData icon, Color color) {
    return Expanded(child: Column(children: [
      Container(
        width: 36, height: 36,
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          shape: BoxShape.circle,
          border: Border.all(color: color.withValues(alpha: 0.25)),
        ),
        child: Icon(icon, color: color, size: 18),
      ),
      const SizedBox(height: 8),
      Text(value, style: GoogleFonts.poppins(
          color: JT.textPrimary, fontSize: 13, fontWeight: FontWeight.w400)),
      const SizedBox(height: 2),
      Text(label, style: GoogleFonts.poppins(color: _textHint, fontSize: 10)),
    ]));
  }

  Widget _vDivider() => Container(
    width: 1, height: 50,
    color: _border,
    margin: const EdgeInsets.symmetric(horizontal: 8),
  );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      body: NestedScrollView(
        headerSliverBuilder: (_, __) => [
          SliverAppBar(
            expandedHeight: 210,
            floating: false,
            pinned: true,
            backgroundColor: _bg,
            leading: IconButton(
              icon: Icon(Icons.arrow_back_ios_new_rounded, color: JT.textPrimary, size: 20),
              onPressed: () => Navigator.pop(context),
            ),
            title: Text('My Trips',
              style: GoogleFonts.poppins(
                  color: JT.textPrimary, fontWeight: FontWeight.w400, fontSize: 18)),
            flexibleSpace: FlexibleSpaceBar(
              background: Container(
                color: _bg,
                child: SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 60, 16, 0),
                    child: Column(children: [
                      const SizedBox(height: 16),
                      // Summary stat cards
                      Row(children: [
                        _summaryCard('Total Earned', '₹${_totalEarnings.toStringAsFixed(0)}',
                          Icons.currency_rupee_rounded, _green),
                        const SizedBox(width: 10),
                        _summaryCard('Completed', '$_completedCount',
                          Icons.check_circle_rounded, _primary),
                        const SizedBox(width: 10),
                        _summaryCard('Cancelled', '$_cancelledCount',
                          Icons.cancel_rounded, _red),
                      ]),
                    ]),
                  ),
                ),
              ),
            ),
            bottom: PreferredSize(
              preferredSize: const Size.fromHeight(52),
              child: Container(
                color: _bg,
                child: TabBar(
                  controller: _tabCtrl,
                  indicatorColor: _primary,
                  indicatorWeight: 2,
                  labelColor: JT.textPrimary,
                  unselectedLabelColor: _textHint,
                  labelStyle: GoogleFonts.poppins(fontWeight: FontWeight.w400, fontSize: 12),
                  unselectedLabelStyle: GoogleFonts.poppins(fontWeight: FontWeight.w500, fontSize: 12),
                  tabs: [
                    Tab(text: 'All (${_allTrips.length})'),
                    Tab(text: 'Active ($_activeCount)'),
                    Tab(text: 'Done ($_completedCount)'),
                    Tab(text: 'Cancelled ($_cancelledCount)'),
                  ],
                ),
              ),
            ),
          ),
        ],
        body: Column(children: [
          // Search bar
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
            child: Container(
              height: 46,
              decoration: BoxDecoration(
                color: _card,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: _border, width: 1),
              ),
              child: TextField(
                controller: _searchCtrl,
                onChanged: (v) {
                  setState(() => _searchQuery = v);
                  _applyFilter();
                },
                style: GoogleFonts.poppins(color: JT.textPrimary, fontSize: 13),
                decoration: InputDecoration(
                  hintText: 'Search by pickup or destination...',
                  hintStyle: GoogleFonts.poppins(color: _textHint, fontSize: 13),
                  prefixIcon: Icon(Icons.search_rounded, color: _textHint, size: 20),
                  suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: Icon(Icons.clear_rounded, color: _textHint, size: 18),
                        onPressed: () {
                          _searchCtrl.clear();
                          setState(() => _searchQuery = '');
                          _applyFilter();
                        })
                    : null,
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
          ),

          // Trip list
          Expanded(
            child: _loading
              ? Shimmer.fromColors(
                  baseColor: const Color(0xFFE5E7EB),
                  highlightColor: const Color(0xFFF3F4F6),
                  child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                    itemCount: 6,
                    itemBuilder: (_, __) => Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      height: 88,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                  ),
                )
              : RefreshIndicator(
                  color: _primary, backgroundColor: _card,
                  onRefresh: () => _fetchTrips(refresh: true),
                  child: _filtered.isEmpty
                    ? ListView(children: [
                        SizedBox(
                          height: 300,
                          child: Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                            Container(
                              width: 80, height: 80,
                              decoration: BoxDecoration(
                                color: _card,
                                shape: BoxShape.circle,
                                border: Border.all(color: _border),
                              ),
                              child: Icon(Icons.route_outlined, size: 38, color: _textHint),
                            ),
                            const SizedBox(height: 18),
                            Text(
                              _searchQuery.isNotEmpty ? 'No trips found' : 'No trips yet',
                              style: GoogleFonts.poppins(
                                  color: _textSecondary, fontSize: 16, fontWeight: FontWeight.w500),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              _searchQuery.isNotEmpty
                                ? 'Try a different search term'
                                : 'Your trip history will appear here',
                              style: GoogleFonts.poppins(color: _textHint, fontSize: 13),
                            ),
                          ])),
                        )
                      ])
                    : NotificationListener<ScrollNotification>(
                        onNotification: (n) {
                          if (_searchQuery.isEmpty &&
                              n.metrics.pixels >= n.metrics.maxScrollExtent - 200) {
                            _loadMoreTrips();
                          }
                          return false;
                        },
                        child: ListView.builder(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                        itemCount: _filtered.length + (_searchQuery.isEmpty && _hasMore ? 1 : 0),
                        itemBuilder: (_, i) {
                          if (i >= _filtered.length) {
                            return const Padding(
                              padding: EdgeInsets.symmetric(vertical: 20),
                              child: Center(
                                  child: CircularProgressIndicator(
                                      color: _primary, strokeWidth: 2.5)),
                            );
                          }
                          final t = _filtered[i] as Map;
                          final status = (t['currentStatus'] ?? t['status'] ?? '').toString();
                          final fare = double.tryParse(
                              (t['actualFare'] ?? t['estimatedFare'] ?? '0').toString()) ?? 0;
                          final type = (t['type'] ?? 'ride').toString();
                          final isPaid = (t['paymentStatus'] ?? '') == 'paid';
                          final statusColor = _statusColor(status);

                          return GestureDetector(
                            onTap: () => _showTripDetail(Map.from(t)),
                            child: Container(
                              margin: const EdgeInsets.only(bottom: 12),
                              decoration: BoxDecoration(
                                color: _card,
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: statusColor.withValues(alpha: 0.15), width: 1),
                                boxShadow: [
                                  BoxShadow(color: Colors.black.withValues(alpha: 0.2), blurRadius: 12, offset: const Offset(0, 4)),
                                ],
                              ),
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Container(
                                      width: 46, height: 46,
                                      decoration: BoxDecoration(
                                        color: statusColor.withValues(alpha: 0.1),
                                        borderRadius: BorderRadius.circular(14),
                                        border: Border.all(color: statusColor.withValues(alpha: 0.25)),
                                      ),
                                      child: Icon(
                                        type == 'parcel' ? Icons.inventory_2_rounded : Icons.route_rounded,
                                        color: statusColor, size: 22),
                                    ),
                                    const SizedBox(width: 14),
                                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      Text(
                                        t['destinationAddress']?.toString() ?? 'Destination',
                                        maxLines: 1, overflow: TextOverflow.ellipsis,
                                        style: GoogleFonts.poppins(
                                          color: JT.textPrimary, fontSize: 13, fontWeight: FontWeight.w500),
                                      ),
                                      const SizedBox(height: 4),
                                      Row(children: [
                                        Container(
                                          width: 8, height: 8,
                                          decoration: BoxDecoration(
                                            color: _green, shape: BoxShape.circle,
                                            boxShadow: [BoxShadow(color: _green.withValues(alpha: 0.5), blurRadius: 4)],
                                          ),
                                        ),
                                        const SizedBox(width: 6),
                                        Expanded(
                                          child: Text(
                                            t['pickupAddress']?.toString() ?? '',
                                            maxLines: 1, overflow: TextOverflow.ellipsis,
                                            style: GoogleFonts.poppins(color: _textHint, fontSize: 11),
                                          ),
                                        ),
                                      ]),
                                    ])),
                                    Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                      Text('₹${fare.toStringAsFixed(0)}',
                                        style: GoogleFonts.poppins(
                                          color: _green, fontSize: 18, fontWeight: FontWeight.w500)),
                                      const SizedBox(height: 5),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                                        decoration: BoxDecoration(
                                          color: statusColor.withValues(alpha: 0.1),
                                          borderRadius: BorderRadius.circular(8),
                                          border: Border.all(color: statusColor.withValues(alpha: 0.25)),
                                        ),
                                        child: Text(_statusLabel(status),
                                          style: GoogleFonts.poppins(
                                              color: statusColor, fontSize: 10, fontWeight: FontWeight.w500)),
                                      ),
                                    ]),
                                  ]),
                                  const SizedBox(height: 14),
                                  // Divider
                                  Container(height: 1, color: _border),
                                  const SizedBox(height: 12),
                                  Row(children: [
                                    Icon(Icons.schedule_rounded, size: 13, color: _textHint),
                                    const SizedBox(width: 5),
                                    Text(_formatDate(t['createdAt']?.toString()),
                                      style: GoogleFonts.poppins(color: _textHint, fontSize: 11)),
                                    const Spacer(),
                                    // Payment badge
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: (isPaid ? _green : _amber).withValues(alpha: 0.1),
                                        borderRadius: BorderRadius.circular(7),
                                        border: Border.all(
                                            color: (isPaid ? _green : _amber).withValues(alpha: 0.3)),
                                      ),
                                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                                        Icon(
                                          isPaid ? Icons.check_circle_rounded : Icons.account_balance_wallet_rounded,
                                          size: 11,
                                          color: isPaid ? _green : _amber),
                                        const SizedBox(width: 4),
                                        Text(
                                          isPaid ? 'Paid' : (t['paymentMethod']?.toString() ?? 'Cash'),
                                          style: GoogleFonts.poppins(
                                            fontSize: 10, fontWeight: FontWeight.w500,
                                            color: isPaid ? _green : _amber)),
                                      ]),
                                    ),
                                    const SizedBox(width: 8),
                                    // Type badge
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: _primary.withValues(alpha: 0.1),
                                        borderRadius: BorderRadius.circular(7),
                                        border: Border.all(color: _primary.withValues(alpha: 0.25)),
                                      ),
                                      child: Text(
                                        type == 'parcel' ? 'Parcel' : 'Ride',
                                        style: GoogleFonts.poppins(
                                            fontSize: 10, fontWeight: FontWeight.w500, color: _primary)),
                                    ),
                                    // No-Show badge
                                    if (t['no_show'] == true || t['penalty_applied'] == true) ...[
                                      const SizedBox(width: 8),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                        decoration: BoxDecoration(
                                          color: _red.withValues(alpha: 0.1),
                                          borderRadius: BorderRadius.circular(7),
                                          border: Border.all(color: _red.withValues(alpha: 0.35)),
                                        ),
                                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                                          Icon(Icons.warning_amber_rounded, size: 10, color: _red),
                                          const SizedBox(width: 3),
                                          Text('No-Show',
                                            style: GoogleFonts.poppins(
                                              fontSize: 10, fontWeight: FontWeight.w500, color: _red)),
                                        ]),
                                      ),
                                    ],
                                  ]),
                                ]),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                ),
          ),
        ]),
      ),
    );
  }

  Widget _summaryCard(String label, String value, IconData icon, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 10),
        decoration: BoxDecoration(
          color: _card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: color.withValues(alpha: 0.25), width: 1),
          boxShadow: [BoxShadow(color: color.withValues(alpha: 0.1), blurRadius: 16)],
        ),
        child: Column(children: [
          Container(
            width: 36, height: 36,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              shape: BoxShape.circle,
              border: Border.all(color: color.withValues(alpha: 0.3)),
            ),
            child: Icon(icon, color: color, size: 18),
          ),
          const SizedBox(height: 8),
          Text(value,
            style: GoogleFonts.poppins(
                color: color, fontSize: 16, fontWeight: FontWeight.w500)),
          const SizedBox(height: 3),
          Text(label, style: GoogleFonts.poppins(color: _textHint, fontSize: 9),
            textAlign: TextAlign.center),
        ]),
      ),
    );
  }
}
