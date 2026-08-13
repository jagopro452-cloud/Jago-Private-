import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../services/socket_service.dart';
import '../profile/support_chat_screen.dart';
import '../safety/emergency_contacts_screen.dart';

class PoolCancellationScreen extends StatefulWidget {
  final String title;
  final String bookingId;
  final bool isOutstation;
  final String routeLabel;
  final int seatsBooked;
  final double totalFare;

  const PoolCancellationScreen({
    super.key,
    required this.title,
    required this.bookingId,
    required this.isOutstation,
    required this.routeLabel,
    required this.seatsBooked,
    required this.totalFare,
  });

  @override
  State<PoolCancellationScreen> createState() => _PoolCancellationScreenState();
}

class _PoolCancellationScreenState extends State<PoolCancellationScreen> {
  final _reasonCtrl = TextEditingController();
  bool _loading = false;

  @override
  void dispose() {
    _reasonCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.post(
        Uri.parse(widget.isOutstation
            ? ApiConfig.outstationPoolCancel(widget.bookingId)
            : ApiConfig.localPoolCancel(widget.bookingId)),
        headers: headers,
        body: jsonEncode({'reason': _reasonCtrl.text.trim()}),
      ).timeout(const Duration(seconds: 15));
      final body = jsonDecode(res.body);
      if (!mounted) return;
      if (res.statusCode == 200) {
        Navigator.pop(context, body);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(body['message']?.toString() ?? 'Cancellation failed')),
        );
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Network issue while cancelling booking')),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        title: Text(widget.title, style: JT.h5),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Booking Summary', style: JT.subtitle1),
                const SizedBox(height: 14),
                _row('Booking ID', widget.bookingId),
                _row('Route', widget.routeLabel),
                _row('Seats', '${widget.seatsBooked}'),
                _row('Total Fare', 'Rs ${widget.totalFare.toStringAsFixed(0)}'),
              ],
            ),
          ),
          const SizedBox(height: 16),
          _card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Reason', style: JT.subtitle1),
                const SizedBox(height: 12),
                TextField(
                  controller: _reasonCtrl,
                  minLines: 3,
                  maxLines: 4,
                  style: JT.bodyPrimary,
                  decoration: InputDecoration(
                    hintText: 'Why are you cancelling this pool booking?',
                    hintStyle: JT.body,
                    filled: true,
                    fillColor: JT.surfaceAlt,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide(color: JT.border),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide(color: JT.border),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'Refund eligibility follows admin pool policy. Before departure: refund may apply. After departure: no refund.',
                  style: JT.caption.copyWith(color: JT.textSecondary),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          JT.gradientButton(
            label: _loading ? 'Cancelling...' : 'Confirm Cancellation',
            onTap: _submit,
            loading: _loading,
          ),
        ],
      ),
    );
  }
}

class CoPassengerScreen extends StatefulWidget {
  final String title;
  final String referenceId;
  final bool isOutstation;

  const CoPassengerScreen({
    super.key,
    required this.title,
    required this.referenceId,
    required this.isOutstation,
  });

  @override
  State<CoPassengerScreen> createState() => _CoPassengerScreenState();
}

class _CoPassengerScreenState extends State<CoPassengerScreen> {
  bool _loading = true;
  String? _error;
  List<dynamic> _passengers = [];
  Map<String, dynamic> _occupancy = const {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse(widget.isOutstation
            ? ApiConfig.outstationPoolCoPassengers(widget.referenceId)
            : ApiConfig.localPoolCoPassengers(widget.referenceId)),
        headers: headers,
      ).timeout(const Duration(seconds: 15));
      final body = jsonDecode(res.body);
      if (!mounted) return;
      if (res.statusCode == 200) {
        setState(() {
          _passengers = List<dynamic>.from(body['passengers'] ?? body['data']?['passengers'] ?? const []);
          _occupancy = body['occupancy'] is Map<String, dynamic>
              ? body['occupancy'] as Map<String, dynamic>
              : (body['data']?['occupancy'] is Map<String, dynamic>
                  ? body['data']['occupancy'] as Map<String, dynamic>
                  : <String, dynamic>{});
          _loading = false;
        });
      } else {
        setState(() {
          _error = body['message']?.toString() ?? 'Could not load co-passengers';
          _loading = false;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Network issue while loading co-passengers';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        title: Text(widget.title, style: JT.h5),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: JT.body))
              : ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    _card(
                      child: Row(
                        children: [
                          _metric('Passengers', '${_occupancy['passengerCount'] ?? _passengers.length}'),
                          const SizedBox(width: 12),
                          _metric('Seats', '${_occupancy['seatsBooked'] ?? 0}'),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    ..._passengers.map((passenger) => Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: _card(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(
                                        passenger['passengerName']?.toString() ?? 'Passenger',
                                        style: JT.subtitle1,
                                      ),
                                    ),
                                    if (_safetyBadgeLabel(passenger) != null) ...[
                                      _safetyBadge(
                                        _safetyBadgeLabel(passenger)!,
                                        _safetyBadgeColor(passenger),
                                      ),
                                      const SizedBox(width: 8),
                                    ],
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                      decoration: BoxDecoration(
                                        color: (passenger['isVerified'] == true ? JT.successLight : JT.warningLight),
                                        borderRadius: BorderRadius.circular(999),
                                      ),
                                      child: Text(
                                        passenger['isVerified'] == true ? 'Verified' : 'Pending Verification',
                                        style: JT.caption.copyWith(
                                          color: passenger['isVerified'] == true ? JT.success : JT.warning,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                _row('Pickup', passenger['pickupPoint']?.toString() ?? '-'),
                                _row('Drop', passenger['dropPoint']?.toString() ?? '-'),
                                _row('Seats', '${passenger['seatsBooked'] ?? 1}'),
                                if ((passenger['safety'] is Map && (passenger['safety']['openIssueCount'] ?? 0) > 0) ||
                                    (passenger['safety'] is Map && passenger['safety']['hasActiveBlock'] == true))
                                  _row(
                                    'Safety',
                                    passenger['safety']['hasActiveBlock'] == true
                                        ? 'Operations has restricted this rider from future pool matching.'
                                        : '${passenger['safety']['openIssueCount']} open review case(s) on this rider.',
                                  ),
                              ],
                            ),
                          ),
                        )),
                  ],
                ),
    );
  }
}

String? _safetyBadgeLabel(Map<dynamic, dynamic> entity) {
  final safety = entity['safety'];
  if (safety is Map && safety['badgeLabel'] != null) {
    return safety['badgeLabel']?.toString();
  }
  return null;
}

Color _safetyBadgeColor(Map<dynamic, dynamic> entity) {
  final label = _safetyBadgeLabel(entity);
  if (label == 'Blocked User') return JT.error;
  if (label == 'High Risk User') return JT.warning;
  return JT.primary;
}

Widget _safetyBadge(String label, Color color) {
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(999),
      border: Border.all(color: color.withValues(alpha: 0.2)),
    ),
    child: Text(
      label,
      style: JT.caption.copyWith(color: color, fontWeight: FontWeight.w600),
    ),
  );
}

class ReportIssueScreen extends StatefulWidget {
  final String referenceId;
  final String module;
  final String referenceType;
  final String title;
  final String issueChannel;
  final String submitLabel;

  const ReportIssueScreen({
    super.key,
    required this.referenceId,
    required this.module,
    required this.referenceType,
    required this.title,
    this.issueChannel = 'report',
    this.submitLabel = 'Submit Report',
  });

  @override
  State<ReportIssueScreen> createState() => _ReportIssueScreenState();
}

class _ReportIssueScreenState extends State<ReportIssueScreen> {
  static const _categories = [
    'Unsafe Behaviour',
    'Harassment',
    'Late Arrival',
    'No Show',
    'Fake Booking',
    'Vehicle Issue',
    'Payment Issue',
    'Other',
  ];

  String _category = _categories.first;
  final _descriptionCtrl = TextEditingController();
  bool _loading = false;

  @override
  void dispose() {
    _descriptionCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.post(
        Uri.parse(ApiConfig.poolIssueReport),
        headers: headers,
        body: jsonEncode({
          'module': widget.module,
          'referenceType': widget.referenceType,
          'referenceId': widget.referenceId,
          'issueChannel': widget.issueChannel,
          'category': _category,
          'description': _descriptionCtrl.text.trim(),
          'evidenceUrls': const [],
        }),
      ).timeout(const Duration(seconds: 15));
      final body = jsonDecode(res.body);
      if (!mounted) return;
      if (res.statusCode == 201 || res.statusCode == 200) {
        Navigator.pop(context, body);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(body['message']?.toString() ?? 'Could not submit report')),
        );
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Network issue while submitting report')),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        title: Text(widget.title, style: JT.h5),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Issue Category', style: JT.subtitle1),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _categories.map((category) {
                    final selected = category == _category;
                    return GestureDetector(
                      onTap: () => setState(() => _category = category),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          color: selected ? JT.primaryLight : Colors.white,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: selected ? JT.primary : JT.border),
                        ),
                        child: Text(category, style: JT.caption.copyWith(color: selected ? JT.primary : JT.textSecondary)),
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _descriptionCtrl,
                  minLines: 4,
                  maxLines: 5,
                  style: JT.bodyPrimary,
                  decoration: InputDecoration(
                    hintText: 'Add clear notes for operations team',
                    hintStyle: JT.body,
                    filled: true,
                    fillColor: JT.surfaceAlt,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide(color: JT.border),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          JT.gradientButton(
            label: _loading ? 'Submitting...' : widget.submitLabel,
            onTap: _submit,
            loading: _loading,
          ),
        ],
      ),
    );
  }
}

class PoolRatingScreen extends StatefulWidget {
  final String title;
  final String referenceId;
  final bool isOutstation;

  const PoolRatingScreen({
    super.key,
    required this.title,
    required this.referenceId,
    required this.isOutstation,
  });

  @override
  State<PoolRatingScreen> createState() => _PoolRatingScreenState();
}

class _PoolRatingScreenState extends State<PoolRatingScreen> {
  final _noteCtrl = TextEditingController();
  final Map<String, int> _ratings = {
    'Safety': 5,
    'Cleanliness': 5,
    'Behaviour': 5,
    'Punctuality': 5,
  };
  bool _loading = false;

  @override
  void dispose() {
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.post(
        Uri.parse(widget.isOutstation
            ? ApiConfig.outstationPoolRateDriver(widget.referenceId)
            : ApiConfig.localPoolRateDriver(widget.referenceId)),
        headers: headers,
        body: jsonEncode({
          'overallRating': _ratings.values.reduce((a, b) => a + b) / _ratings.length,
          'safetyRating': _ratings['Safety'],
          'cleanlinessRating': _ratings['Cleanliness'],
          'behaviourRating': _ratings['Behaviour'],
          'punctualityRating': _ratings['Punctuality'],
          'note': _noteCtrl.text.trim(),
        }),
      ).timeout(const Duration(seconds: 15));
      final body = jsonDecode(res.body);
      if (!mounted) return;
      if (res.statusCode == 200) {
        Navigator.pop(context, body);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(body['message']?.toString() ?? 'Could not submit rating')),
        );
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Network issue while submitting rating')),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        title: Text(widget.title, style: JT.h5),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Rate your pool driver', style: JT.subtitle1),
                const SizedBox(height: 14),
                ..._ratings.keys.map((label) => Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(label, style: JT.bodyPrimary),
                          const SizedBox(height: 8),
                          Row(
                            children: List.generate(5, (index) {
                              final star = index + 1;
                              return IconButton(
                                onPressed: () => setState(() => _ratings[label] = star),
                                padding: EdgeInsets.zero,
                                visualDensity: VisualDensity.compact,
                                icon: Icon(
                                  star <= (_ratings[label] ?? 5) ? Icons.star_rounded : Icons.star_outline_rounded,
                                  color: JT.warning,
                                ),
                              );
                            }),
                          ),
                        ],
                      ),
                    )),
                TextField(
                  controller: _noteCtrl,
                  minLines: 3,
                  maxLines: 4,
                  style: JT.bodyPrimary,
                  decoration: InputDecoration(
                    hintText: 'Add an optional review',
                    hintStyle: JT.body,
                    filled: true,
                    fillColor: JT.surfaceAlt,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide(color: JT.border),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          JT.gradientButton(
            label: _loading ? 'Submitting...' : 'Submit Rating',
            onTap: _submit,
            loading: _loading,
          ),
        ],
      ),
    );
  }
}

class PoolDisputeTimelineScreen extends StatefulWidget {
  final String title;
  final String module;
  final String referenceId;

  const PoolDisputeTimelineScreen({
    super.key,
    required this.title,
    required this.module,
    required this.referenceId,
  });

  @override
  State<PoolDisputeTimelineScreen> createState() => _PoolDisputeTimelineScreenState();
}

class _PoolDisputeTimelineScreenState extends State<PoolDisputeTimelineScreen> {
  final SocketService _socket = SocketService();
  bool _loading = true;
  String? _error;
  List<dynamic> _items = const [];
  StreamSubscription<Map<String, dynamic>>? _issueUpdateSub;

  @override
  void initState() {
    super.initState();
    _issueUpdateSub = _socket.onPoolIssueUpdated.listen((event) {
      final module = event['module']?.toString() ?? '';
      final referenceId = event['referenceId']?.toString() ?? '';
      if (module != widget.module || referenceId != widget.referenceId || !mounted) return;
      _load();
    });
    _load();
  }

  @override
  void dispose() {
    _issueUpdateSub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse(ApiConfig.poolIssueList(module: widget.module, referenceId: widget.referenceId)),
        headers: headers,
      ).timeout(const Duration(seconds: 15));
      final body = jsonDecode(res.body);
      if (!mounted) return;
      if (res.statusCode == 200) {
        final all = List<dynamic>.from(body['items'] ?? const []);
        setState(() {
          _items = all.where((item) => (item['issue_channel'] ?? item['issueChannel'] ?? 'report').toString() == 'dispute').toList();
          _loading = false;
        });
      } else {
        setState(() {
          _error = body['message']?.toString() ?? 'Could not load dispute timeline';
          _loading = false;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Network issue while loading dispute timeline';
      });
    }
  }

  Future<void> _openCreateDispute() async {
    final result = await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ReportIssueScreen(
          referenceId: widget.referenceId,
          module: widget.module,
          referenceType: widget.module == 'outstation_pool' ? 'booking' : 'request',
          title: 'Raise Pool Dispute',
          issueChannel: 'dispute',
          submitLabel: 'Create Dispute',
        ),
      ),
    );
    if (result != null) {
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        title: Text(widget.title, style: JT.h5),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: JT.primary))
          : _error != null
              ? Center(child: Text(_error!, style: JT.body))
              : ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    if (_items.isEmpty)
                      _card(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('No active disputes', style: JT.subtitle1),
                            const SizedBox(height: 8),
                            Text(
                              'Refund, payment, seat allocation, no-show or behaviour issues can be tracked here after you raise a dispute.',
                              style: JT.body,
                            ),
                            const SizedBox(height: 16),
                            JT.gradientButton(label: 'Raise Dispute', onTap: _openCreateDispute, height: 48),
                          ],
                        ),
                      )
                    else
                      ..._items.map((item) {
                        final timeline = item['timeline'] as Map<String, dynamic>? ?? const {};
                        final stages = List<dynamic>.from(timeline['stages'] ?? const []);
                        final updates = List<dynamic>.from(timeline['adminUpdates'] ?? const []);
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 14),
                          child: _card(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(item['category']?.toString() ?? 'Pool Dispute', style: JT.subtitle1),
                                    ),
                                    _statusPill((item['status'] ?? 'open').toString()),
                                  ],
                                ),
                                const SizedBox(height: 10),
                                _row('Issue Date', _prettyTime(item['created_at']?.toString())),
                                _row('Evidence', '${(item['evidence_urls'] is List ? (item['evidence_urls'] as List).length : 0)} item(s)'),
                                if ((item['resolution_note'] ?? '').toString().isNotEmpty)
                                  _row('Resolution', item['resolution_note'].toString()),
                                const SizedBox(height: 14),
                                Text('Status Timeline', style: JT.bodyPrimary),
                                const SizedBox(height: 10),
                                ...stages.map((stage) => Padding(
                                      padding: const EdgeInsets.only(bottom: 10),
                                      child: Row(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Container(
                                            width: 10,
                                            height: 10,
                                            margin: const EdgeInsets.only(top: 6),
                                            decoration: BoxDecoration(
                                              color: _timelineColor(stage['state']?.toString() ?? 'pending'),
                                              shape: BoxShape.circle,
                                            ),
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Text(stage['title']?.toString() ?? '-', style: JT.bodyPrimary),
                                                if ((stage['note'] ?? '').toString().isNotEmpty)
                                                  Padding(
                                                    padding: const EdgeInsets.only(top: 2),
                                                    child: Text(stage['note'].toString(), style: JT.caption.copyWith(color: JT.textSecondary)),
                                                  ),
                                              ],
                                            ),
                                          ),
                                        ],
                                      ),
                                    )),
                                if (updates.isNotEmpty) ...[
                                  const SizedBox(height: 6),
                                  Text('Admin Updates', style: JT.bodyPrimary),
                                  const SizedBox(height: 10),
                                  ...updates.map((update) => Container(
                                        margin: const EdgeInsets.only(bottom: 10),
                                        padding: const EdgeInsets.all(12),
                                        decoration: BoxDecoration(
                                          color: JT.surfaceAlt,
                                          borderRadius: BorderRadius.circular(16),
                                        ),
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(update['message']?.toString() ?? '', style: JT.bodyPrimary),
                                            const SizedBox(height: 4),
                                            Text(
                                              '${update['author'] ?? 'Operations'} • ${_prettyTime(update['createdAt']?.toString())}',
                                              style: JT.caption,
                                            ),
                                          ],
                                        ),
                                      )),
                                ],
                              ],
                            ),
                          ),
                        );
                      }),
                  ],
                ),
    );
  }
}

class PoolSupportScreen extends StatelessWidget {
  final String module;
  final String referenceId;
  final String title;

  const PoolSupportScreen({
    super.key,
    required this.module,
    required this.referenceId,
    required this.title,
  });

  static const _categories = [
    'Refund',
    'Cancellation',
    'Driver Issue',
    'Passenger Issue',
    'Safety Issue',
    'Payment Issue',
    'Other',
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        title: Text(title, style: JT.h5),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Pool Support Center', style: JT.subtitle1),
                const SizedBox(height: 8),
                Text(
                  'Use existing JAGO support chat for pool cancellations, refunds, safety issues and payment clarifications.',
                  style: JT.body,
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _categories
                      .map((category) => Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                            decoration: BoxDecoration(
                              color: JT.surfaceAlt,
                              borderRadius: BorderRadius.circular(999),
                              border: Border.all(color: JT.border),
                            ),
                            child: Text(category, style: JT.caption.copyWith(color: JT.textSecondary)),
                          ))
                      .toList(),
                ),
                const SizedBox(height: 18),
                JT.gradientButton(
                  label: 'Open Support Chat',
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SupportChatScreen())),
                  height: 48,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          _card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Need formal investigation?', style: JT.subtitle1),
                const SizedBox(height: 8),
                Text('Create a dispute when you need timeline tracking and admin resolution notes.', style: JT.body),
                const SizedBox(height: 14),
                OutlinedButton(
                  onPressed: () {
                    Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => ReportIssueScreen(
                        referenceId: referenceId,
                        module: module,
                        referenceType: module == 'outstation_pool' ? 'booking' : 'request',
                        title: 'Create Pool Dispute',
                        issueChannel: 'dispute',
                        submitLabel: 'Create Dispute',
                      ),
                    ));
                  },
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(48),
                    side: BorderSide(color: JT.primary),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  child: Text('Create Dispute', style: JT.bodyPrimary.copyWith(color: JT.primary)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class PoolSafetyScreen extends StatefulWidget {
  final String title;
  final String module;
  final String referenceId;
  final String tripId;
  final String driverName;
  final String vehicleInfo;
  final String liveStatus;
  final String? blockedUserId;

  const PoolSafetyScreen({
    super.key,
    required this.title,
    required this.module,
    required this.referenceId,
    required this.tripId,
    required this.driverName,
    required this.vehicleInfo,
    required this.liveStatus,
    this.blockedUserId,
  });

  @override
  State<PoolSafetyScreen> createState() => _PoolSafetyScreenState();
}

class _PoolSafetyScreenState extends State<PoolSafetyScreen> {
  bool _busy = false;

  Future<void> _shareTrip() async {
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.post(
        Uri.parse(ApiConfig.poolShare),
        headers: headers,
        body: jsonEncode({'module': widget.module, 'referenceId': widget.referenceId}),
      ).timeout(const Duration(seconds: 15));
      final body = jsonDecode(res.body);
      if (res.statusCode == 200) {
        final text = body['shareText']?.toString() ?? 'JAGO Pool trip details';
        await Clipboard.setData(ClipboardData(text: text));
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Trip details copied. Share with family or emergency contacts.')),
        );
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not prepare share details right now')),
      );
    }
  }

  Future<void> _sendSos() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Send Pool SOS', style: JT.subtitle1),
        content: Text('Emergency alert will be sent using JAGO safety operations.', style: JT.body),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Send SOS')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      final headers = await AuthService.getHeaders();
      await http.post(
        Uri.parse(ApiConfig.sos),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({
          'tripId': widget.tripId,
          'message': 'Customer SOS alert during pool trip',
          'module': widget.module,
          'referenceId': widget.referenceId,
        }),
      ).timeout(const Duration(seconds: 15));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('SOS sent. JAGO safety team has been alerted.')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('SOS failed. Please call 100 immediately.')),
      );
    }
  }

  Future<void> _callEmergency() async {
    final uri = Uri.parse('tel:100');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  Future<void> _blockUser() async {
    if (widget.blockedUserId == null || widget.blockedUserId!.isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.post(
        Uri.parse(ApiConfig.poolBlockUser),
        headers: headers,
        body: jsonEncode({
          'blockedUserId': widget.blockedUserId,
          'module': widget.module,
          'referenceType': widget.module == 'outstation_pool' ? 'booking' : 'request',
          'referenceId': widget.referenceId,
          'reason': 'Blocked from pool safety center',
        }),
      ).timeout(const Duration(seconds: 15));
      if (!mounted) return;
      final body = jsonDecode(res.body);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(body['message']?.toString() ?? 'User blocked from future pool matching')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not block this user right now')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        title: Text(widget.title, style: JT.h5),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Safety Snapshot', style: JT.subtitle1),
                const SizedBox(height: 14),
                _row('Trip ID', widget.tripId),
                _row('Driver', widget.driverName.isEmpty ? 'Assigned soon' : widget.driverName),
                _row('Vehicle', widget.vehicleInfo.isEmpty ? '-' : widget.vehicleInfo),
                _row('Live Status', widget.liveStatus),
              ],
            ),
          ),
          const SizedBox(height: 16),
          _card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Safety Actions', style: JT.subtitle1),
                const SizedBox(height: 14),
                _actionTile(Icons.share_outlined, 'Share Trip', 'Copy live trip summary for family or friends.', _shareTrip),
                _actionTile(Icons.sos_rounded, 'Pool SOS', 'Use live JAGO emergency operations for an active safety incident.', _sendSos),
                _actionTile(Icons.contact_phone_outlined, 'Emergency Contacts', 'Manage people who should be contacted during SOS.', () async {
                  Navigator.of(context).push(MaterialPageRoute(builder: (_) => const EmergencyContactsScreen()));
                }),
                _actionTile(Icons.local_phone_outlined, 'Call Emergency', 'Quick access to emergency calling.', _callEmergency),
                if (widget.blockedUserId != null && widget.blockedUserId!.isNotEmpty)
                  _actionTile(Icons.block_outlined, 'Block This User', 'Prevent future pool matching with this user.', _blockUser),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

Widget _card({required Widget child}) {
  return Container(
    padding: const EdgeInsets.all(18),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(22),
      border: Border.all(color: JT.border),
      boxShadow: JT.cardShadow,
    ),
    child: child,
  );
}

Widget _statusPill(String status) {
  final normalized = status.toLowerCase();
  final color = normalized == 'resolved'
      ? JT.success
      : normalized == 'rejected'
          ? JT.error
          : normalized == 'under_review'
              ? JT.warning
              : JT.primary;
  final bg = normalized == 'resolved'
      ? JT.successLight
      : normalized == 'rejected'
          ? JT.errorLight
          : normalized == 'under_review'
              ? JT.warningLight
              : JT.primaryLight;
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
    child: Text(status.replaceAll('_', ' ').toUpperCase(), style: JT.caption.copyWith(color: color)),
  );
}

Color _timelineColor(String state) {
  switch (state) {
    case 'done':
      return JT.success;
    case 'active':
      return JT.primary;
    case 'skipped':
      return JT.textTertiary;
    default:
      return JT.warning;
  }
}

String _prettyTime(String? raw) {
  final dt = raw == null ? null : DateTime.tryParse(raw);
  if (dt == null) return '-';
  final local = dt.toLocal();
  return '${local.day.toString().padLeft(2, '0')}/${local.month.toString().padLeft(2, '0')}/${local.year} ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

Widget _actionTile(IconData icon, String title, String subtitle, Future<void> Function() onTap) {
  return InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(18),
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(color: JT.surfaceAlt, borderRadius: BorderRadius.circular(14)),
            child: Icon(icon, color: JT.primary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: JT.bodyPrimary),
                const SizedBox(height: 2),
                Text(subtitle, style: JT.caption.copyWith(color: JT.textSecondary)),
              ],
            ),
          ),
          const Icon(Icons.chevron_right_rounded, color: JT.iconInactive),
        ],
      ),
    ),
  );
}

Widget _metric(String label, String value) {
  return Expanded(
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: JT.surfaceAlt,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: JT.caption),
          const SizedBox(height: 4),
          Text(value, style: JT.h4),
        ],
      ),
    ),
  );
}

Widget _row(String label, String value) {
  return Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 92,
          child: Text(label, style: JT.caption.copyWith(color: JT.textSecondary)),
        ),
        Expanded(
          child: Text(
            value,
            style: GoogleFonts.poppins(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: JT.textPrimary,
            ),
          ),
        ),
      ],
    ),
  );
}
