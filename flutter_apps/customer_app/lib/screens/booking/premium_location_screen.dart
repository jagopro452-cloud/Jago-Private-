import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import 'booking_screen.dart';
import 'map_location_picker.dart';
import '../wallet/wallet_screen.dart';
import '../notifications/notifications_screen.dart';
import 'parcel_booking_screen.dart';

class PremiumLocationScreen extends StatefulWidget {
  final String serviceType; // 'ride' or 'parcel'
  final String? pickupAddress;
  final double pickupLat;
  final double pickupLng;
  final String? vehicleCategoryId;
  final String? vehicleCategoryName;
  // When set, "Confirm Trip" hands the picked pickup/drop off to this
  // callback instead of navigating to BookingScreen/ParcelBookingScreen —
  // lets other flows (e.g. Car Share) reuse this exact picker without
  // altering the normal ride/parcel booking navigation for every other tile.
  final void Function(
    String pickupAddress, double pickupLat, double pickupLng,
    String dropAddress, double dropLat, double dropLng,
  )? onLocationsConfirmed;

  const PremiumLocationScreen({
    super.key,
    required this.serviceType,
    this.pickupAddress,
    this.pickupLat = 0,
    this.pickupLng = 0,
    this.vehicleCategoryId,
    this.vehicleCategoryName,
    this.onLocationsConfirmed,
  });

  @override
  State<PremiumLocationScreen> createState() => _PremiumLocationScreenState();
}

class _PremiumLocationScreenState extends State<PremiumLocationScreen> {
  late final TextEditingController _pickupCtrl = TextEditingController(
    text: (widget.pickupLat != 0 && widget.pickupLng != 0)
        ? (widget.pickupAddress ?? '')
        : '',
  );
  final TextEditingController _dropCtrl = TextEditingController();
  final FocusNode _pickupFocus = FocusNode();
  final FocusNode _dropFocus = FocusNode();

  late double _pickupLat = widget.pickupLat;
  late double _pickupLng = widget.pickupLng;
  double _dropLat = 0;
  double _dropLng = 0;

  List<Map<String, dynamic>> _popular = [];
  List<Map<String, dynamic>> _nearby = [];
  List<Map<String, dynamic>> _results = [];
  bool _loading = false;
  Timer? _debounce;
  bool _editingPickup = false;
  String _sessionToken = DateTime.now().millisecondsSinceEpoch.toString();

  bool get _isParcel => widget.serviceType == 'parcel';
  Color get _accent => _isParcel ? const Color(0xFFC29763) : JT.primary;
  bool get _showSuggestions => _pickupFocus.hasFocus || _dropFocus.hasFocus;
  bool get _tripReady =>
      _pickupLat != 0 && _pickupLng != 0 && _dropLat != 0 && _dropLng != 0;

  @override
  void initState() {
    super.initState();
    _fetchPopularLocations();
    _fetchNearby();
    if (widget.pickupLat == 0 || widget.pickupLng == 0) {
      _detectLocation();
    }
    _pickupFocus.addListener(_onFocusChange);
    _dropFocus.addListener(_onFocusChange);
  }

  void _onFocusChange() {
    if (_pickupFocus.hasFocus) _editingPickup = true;
    if (_dropFocus.hasFocus) _editingPickup = false;
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _pickupCtrl.dispose();
    _dropCtrl.dispose();
    _pickupFocus.dispose();
    _dropFocus.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _detectLocation() async {
    try {
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      final p = await Geolocator.getCurrentPosition(
        locationSettings:
            const LocationSettings(accuracy: LocationAccuracy.best),
      );
      final addr = await _reverseGeocode(p.latitude, p.longitude);
      if (!mounted) return;
      setState(() {
        _pickupLat = p.latitude;
        _pickupLng = p.longitude;
        _pickupCtrl.text = addr;
      });
      _fetchNearby();
    } catch (_) {}
  }

  Future<String> _reverseGeocode(double lat, double lng) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse('${ApiConfig.reverseGeocode}?lat=$lat&lng=$lng'),
        headers: headers,
      );
      if (res.statusCode == 200) {
        final data = json.decode(res.body) as Map<String, dynamic>;
        final addr = data['formattedAddress']?.toString();
        if (addr != null && addr.isNotEmpty) return addr;
      }
    } catch (_) {}
    return "Selected Location";
  }

  Future<void> _fetchPopularLocations() async {
    try {
      final r = await http.get(Uri.parse(
          '${ApiConfig.baseUrl}/api/app/popular-locations?city=Vijayawada'));
      if (r.statusCode == 200) {
        final data = jsonDecode(r.body) as Map<String, dynamic>;
        final list = (data['locations'] as List<dynamic>? ?? [])
            .map((x) => Map<String, dynamic>.from(x as Map))
            .map((x) => {
                  'name': (x['name'] ?? '').toString(),
                  'lat': double.tryParse(
                          (x['lat'] ?? x['latitude'] ?? 0).toString()) ??
                      0.0,
                  'lng': double.tryParse(
                          (x['lng'] ?? x['longitude'] ?? 0).toString()) ??
                      0.0,
                })
            .where((x) => (x['name'] as String).isNotEmpty)
            .toList();
        if (mounted && list.isNotEmpty) {
          setState(() => _popular = list);
          return;
        }
      }
    } catch (_) {}
    if (mounted && _popular.isEmpty) {
      setState(() => _popular = [
            {'name': 'Benz Circle', 'lat': 16.5062, 'lng': 80.6480},
            {
              'name': 'Vijayawada Railway Station',
              'lat': 16.5175,
              'lng': 80.6400
            },
            {'name': 'Vijayawada Bus Stand', 'lat': 16.5179, 'lng': 80.6238},
            {'name': 'Balaji Bus Stand', 'lat': 16.5106, 'lng': 80.6248},
            {'name': 'Kanaka Durga Temple', 'lat': 16.5176, 'lng': 80.6121},
            {'name': 'Gannavaram Airport', 'lat': 16.5304, 'lng': 80.7968},
            {'name': 'Governorpet', 'lat': 16.5135, 'lng': 80.6346},
            {'name': 'Patamata', 'lat': 16.4883, 'lng': 80.6681},
          ]);
    }
  }

  Future<void> _fetchNearby() async {
    final lat = _pickupLat;
    final lng = _pickupLng;
    if (lat == 0.0 && lng == 0.0) return;
    try {
      final headers = await AuthService.getHeaders();
      final res = await http
          .get(
            Uri.parse(
                '${ApiConfig.placesNearby}?lat=$lat&lng=$lng&radius=3000'),
            headers: headers,
          )
          .timeout(const Duration(seconds: 6));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final places = (data['places'] as List<dynamic>?) ?? [];
        if (mounted && places.isNotEmpty) {
          setState(() {
            _nearby = places
                .map((p) => <String, dynamic>{
                      'name': p['name']?.toString() ?? '',
                      'lat': (p['lat'] as num?)?.toDouble() ?? 0.0,
                      'lng': (p['lng'] as num?)?.toDouble() ?? 0.0,
                    })
                .where((r) => (r['name'] as String).isNotEmpty)
                .toList();
          });
        }
      }
    } catch (_) {}
  }

  void _onFieldChanged(String value) {
    setState(() {
      if (_editingPickup) {
        _pickupLat = 0;
        _pickupLng = 0;
      } else {
        _dropLat = 0;
        _dropLng = 0;
      }
    });
    _debounce?.cancel();
    _debounce =
        Timer(const Duration(milliseconds: 350), () => _search(value));
  }

  // Local popular/nearby places matching the typed letters — shown instantly,
  // ahead of the remote autocomplete results which arrive a beat later.
  List<Map<String, dynamic>> _localMatches(String q, Set<String> seen) {
    final ql = q.toLowerCase();
    final matches = <Map<String, dynamic>>[];
    void addFrom(List<Map<String, dynamic>> source, String tag) {
      for (final row in source) {
        final name = row['name']?.toString() ?? '';
        if (name.isEmpty || !name.toLowerCase().contains(ql)) continue;
        if (!seen.add(name.toLowerCase())) continue;
        matches.add({
          'name': name,
          'mainText': name,
          'secondaryText': tag,
          'placeId': '',
          'lat': (row['lat'] as num?)?.toDouble() ?? 0.0,
          'lng': (row['lng'] as num?)?.toDouble() ?? 0.0,
        });
      }
    }
    addFrom(_nearby, 'Nearby place');
    addFrom(_popular, 'Popular place');
    return matches;
  }

  Future<void> _search(String query) async {
    final q = query.trim();
    if (q.isEmpty) {
      if (mounted) setState(() => _results = []);
      return;
    }
    final seen = <String>{};
    final local = _localMatches(q, seen);
    if (mounted) {
      setState(() {
        _results = local;
        _loading = q.length >= 2;
      });
    }
    if (q.length < 2) return;
    try {
      final headers = await AuthService.getHeaders();
      final lat = _pickupLat;
      final lng = _pickupLng;
      final qp = StringBuffer('?query=${Uri.encodeComponent(q)}');
      qp.write('&sessionToken=$_sessionToken');
      if (lat != 0.0 && lng != 0.0) qp.write('&lat=$lat&lng=$lng');
      final r = await http
          .get(Uri.parse('${ApiConfig.placesAutocomplete}$qp'),
              headers: headers)
          .timeout(const Duration(seconds: 6));
      if (!mounted) return;
      if (r.statusCode == 200) {
        final data = jsonDecode(r.body) as Map<String, dynamic>;
        final preds = (data['predictions'] as List<dynamic>?) ?? [];
        for (final p in preds) {
          final name = p['fullDescription']?.toString() ??
              p['mainText']?.toString() ??
              '';
          if (name.isEmpty || !seen.add(name.toLowerCase())) continue;
          local.add({
            'name': name,
            'mainText': p['mainText']?.toString() ?? '',
            'secondaryText': p['secondaryText']?.toString() ?? '',
            'placeId': p['placeId']?.toString() ?? '',
            'lat': (p['lat'] as num?)?.toDouble() ?? 0.0,
            'lng': (p['lng'] as num?)?.toDouble() ?? 0.0,
          });
        }
        setState(() => _results = local);
      }
    } catch (_) {
      // Local matches already shown — remote autocomplete is best-effort.
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _resolvePlaceId(Map<String, dynamic> p) async {
    var name = p['name']?.toString() ?? '';
    var lat = (p['lat'] as num?)?.toDouble() ?? 0.0;
    var lng = (p['lng'] as num?)?.toDouble() ?? 0.0;
    final placeId = p['placeId']?.toString() ?? '';
    if ((lat == 0.0 || lng == 0.0) && placeId.isNotEmpty) {
      try {
        final headers = await AuthService.getHeaders();
        final r = await http
            .get(
              Uri.parse(
                  '${ApiConfig.placeDetails}?placeId=${Uri.encodeComponent(placeId)}'),
              headers: headers,
            )
            .timeout(const Duration(seconds: 6));
        _sessionToken = DateTime.now().millisecondsSinceEpoch.toString();
        if (r.statusCode == 200) {
          final d = jsonDecode(r.body) as Map<String, dynamic>;
          lat = (d['lat'] as num?)?.toDouble() ?? 0.0;
          lng = (d['lng'] as num?)?.toDouble() ?? 0.0;
          name = d['address']?.toString() ?? name;
        }
      } catch (_) {}
    }
    if (lat == 0.0 || lng == 0.0) return;
    _applySelection(name, lat, lng);
  }

  void _applySelection(String name, double lat, double lng) {
    if (!mounted) return;
    setState(() {
      if (_editingPickup) {
        _pickupCtrl.text = name;
        _pickupLat = lat;
        _pickupLng = lng;
        _pickupFocus.unfocus();
      } else {
        _dropCtrl.text = name;
        _dropLat = lat;
        _dropLng = lng;
        _dropFocus.unfocus();
      }
      _results = [];
    });
  }

  void _selectSuggestion(Map<String, dynamic> p) {
    final lat = (p['lat'] as num?)?.toDouble() ?? 0.0;
    final lng = (p['lng'] as num?)?.toDouble() ?? 0.0;
    if (lat != 0.0 && lng != 0.0) {
      _applySelection(p['name'] as String, lat, lng);
    } else {
      _resolvePlaceId(p);
    }
  }

  Future<void> _pickOnMap({required bool isPickup}) async {
    _editingPickup = isPickup;
    final result = await Navigator.push<PickedLocation>(
      context,
      MaterialPageRoute(
        builder: (_) => MapLocationPicker(
          title: isPickup ? 'Select Pickup' : 'Select Destination',
          initialLat: _pickupLat,
          initialLng: _pickupLng,
        ),
      ),
    );
    if (result != null) {
      _applySelection(result.address, result.lat, result.lng);
    }
  }

  void _proceedToBooking() {
    if (!_tripReady) return;
    if (widget.onLocationsConfirmed != null) {
      widget.onLocationsConfirmed!(
        _pickupCtrl.text, _pickupLat, _pickupLng,
        _dropCtrl.text, _dropLat, _dropLng,
      );
      return;
    }
    if (widget.serviceType == 'parcel') {
      Navigator.push(context, MaterialPageRoute(builder: (context) => ParcelBookingScreen(
        pickupLat: _pickupLat, pickupLng: _pickupLng, dropLat: _dropLat, dropLng: _dropLng,
        pickupAddress: _pickupCtrl.text, dropAddress: _dropCtrl.text,
      )));
    } else {
      Navigator.push(context, MaterialPageRoute(builder: (context) => BookingScreen(
        pickup: _pickupCtrl.text, destination: _dropCtrl.text, pickupLat: _pickupLat, pickupLng: _pickupLng,
        destLat: _dropLat, destLng: _dropLng, vehicleCategoryId: widget.vehicleCategoryId,
        vehicleCategoryName: widget.vehicleCategoryName, category: widget.serviceType,
      )));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(children: [
          _buildHeader(),
          Expanded(
            child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildRouteCard(),
                  if (_showSuggestions) ...[
                    const SizedBox(height: 8),
                    _buildSuggestions(),
                  ],
                  if (_tripReady && !_showSuggestions) ...[
                    const SizedBox(height: 16),
                    _buildConfirmButton(),
                  ],
                ],
              ),
            ),
          ),
        ]),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        IconButton(
          onPressed: () => Navigator.pop(context),
          icon: const Icon(Icons.arrow_back_ios_new_rounded,
              color: Color(0xFF334155), size: 20),
          style: IconButton.styleFrom(
              backgroundColor: Colors.white,
              padding: const EdgeInsets.all(12)),
        ),
        JT.logoBlue(height: 28),
        Row(children: [
          IconButton(
            onPressed: () => Navigator.push(context,
                MaterialPageRoute(builder: (context) => const NotificationsScreen())),
            icon: const Icon(Icons.notifications_none_rounded,
                color: Color(0xFF64748B), size: 22),
            style: IconButton.styleFrom(
                backgroundColor: Colors.white,
                padding: const EdgeInsets.all(12)),
          ),
          const SizedBox(width: 12),
          GestureDetector(
            onTap: () => Navigator.push(context,
                MaterialPageRoute(builder: (context) => const WalletScreen())),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                      color: Colors.black.withValues(alpha: 0.03),
                      blurRadius: 10,
                      offset: const Offset(0, 4))
                ],
              ),
              child: Row(children: [
                Icon(Icons.account_balance_wallet_rounded,
                    color: _accent, size: 16),
                const SizedBox(width: 8),
                Text("Wallet",
                    style: GoogleFonts.poppins(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: const Color(0xFF1E293B))),
              ]),
            ),
          ),
        ]),
      ]),
    );
  }

  Widget _buildRouteCard() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 16,
              offset: const Offset(0, 6)),
        ],
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: 14,
              child: Column(
                children: [
                  Container(
                    width: 10,
                    height: 10,
                    margin: const EdgeInsets.only(top: 6),
                    decoration: const BoxDecoration(
                        color: Color(0xFF22C55E), shape: BoxShape.circle),
                  ),
                  Expanded(
                    child: Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: List.generate(
                            6,
                            (_) => Container(
                                width: 1.4,
                                height: 4,
                                color: const Color(0xFFCBD5E1))),
                      ),
                    ),
                  ),
                  Container(
                    width: 10,
                    height: 10,
                    margin: const EdgeInsets.only(bottom: 6),
                    decoration: BoxDecoration(
                        color: _accent, borderRadius: BorderRadius.circular(3)),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                children: [
                  _locationRow(
                    label: 'PICKUP',
                    controller: _pickupCtrl,
                    focusNode: _pickupFocus,
                    hint: _isParcel ? 'Pickup point?' : 'Pickup location',
                    onMapTap: () => _pickOnMap(isPickup: true),
                  ),
                  const SizedBox(height: 14),
                  _locationRow(
                    label: 'DESTINATION',
                    controller: _dropCtrl,
                    focusNode: _dropFocus,
                    hint: _isParcel
                        ? 'Where should we deliver?'
                        : 'Where are you going?',
                    onMapTap: () => _pickOnMap(isPickup: false),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSuggestions() {
    final query = _editingPickup ? _pickupCtrl.text : _dropCtrl.text;
    final suggestions = query.trim().isEmpty
        ? (_nearby.isNotEmpty ? _nearby : _popular)
        : _results;
    return Container(
      constraints: const BoxConstraints(maxHeight: 260),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 16,
              offset: const Offset(0, 6)),
        ],
      ),
      child: _loading
          ? Padding(
              padding: const EdgeInsets.all(20),
              child: Center(
                  child: CircularProgressIndicator(
                      color: _accent, strokeWidth: 2)))
          : suggestions.isEmpty
              ? Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text('No matches found',
                      style: GoogleFonts.poppins(
                          color: JT.textSecondary, fontSize: 13)),
                )
              : ListView.separated(
                  shrinkWrap: true,
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  itemCount: suggestions.length,
                  separatorBuilder: (_, __) =>
                      const Divider(height: 1, color: Color(0xFFF1F5F9)),
                  itemBuilder: (_, i) {
                    final p = suggestions[i];
                    final mainText = (p['mainText'] as String?);
                    final name = (mainText != null && mainText.isNotEmpty)
                        ? mainText
                        : (p['name']?.toString() ?? '');
                    final sub = p['secondaryText']?.toString() ?? '';
                    return ListTile(
                      dense: true,
                      leading:
                          Icon(Icons.location_on_rounded, color: _accent, size: 20),
                      title: Text(name,
                          style: GoogleFonts.poppins(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: const Color(0xFF1E293B))),
                      subtitle: sub.isNotEmpty
                          ? Text(sub,
                              style: GoogleFonts.poppins(
                                  fontSize: 12, color: const Color(0xFF94A3B8)),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis)
                          : null,
                      onTap: () => _selectSuggestion(p),
                    );
                  },
                ),
    );
  }

  Widget _buildConfirmButton() {
    return GestureDetector(
      onTap: _proceedToBooking,
      child: Container(
        height: 54,
        decoration: BoxDecoration(
            color: const Color(0xFF0F172A),
            borderRadius: BorderRadius.circular(18)),
        child: Center(
          child: Text(_isParcel ? 'Confirm Delivery' : 'Confirm Trip',
              style: GoogleFonts.poppins(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w600)),
        ),
      ),
    );
  }

  Widget _locationRow({
    required String label,
    required TextEditingController controller,
    required FocusNode focusNode,
    required String hint,
    required VoidCallback onMapTap,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label,
                  style: GoogleFonts.poppins(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: focusNode.hasFocus
                          ? _accent
                          : const Color(0xFF94A3B8),
                      letterSpacing: 0.6)),
              const SizedBox(height: 6),
              Container(
                height: 46,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(14)),
                child: Row(
                  children: [
                    const Icon(Icons.location_on_rounded,
                        color: Color(0xFF334155), size: 18),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: controller,
                        focusNode: focusNode,
                        onChanged: _onFieldChanged,
                        style: GoogleFonts.poppins(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: const Color(0xFF1E293B)),
                        decoration: InputDecoration(
                          isDense: true,
                          border: InputBorder.none,
                          hintText: hint,
                          hintStyle: GoogleFonts.poppins(
                              fontSize: 13,
                              color: const Color(0xFF94A3B8),
                              fontWeight: FontWeight.w400),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 10),
        GestureDetector(
          onTap: onMapTap,
          child: Container(
            width: 46,
            height: 46,
            margin: const EdgeInsets.only(top: 17),
            decoration: BoxDecoration(
                color: _accent.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(14)),
            child: Icon(Icons.map_rounded, color: _accent, size: 20),
          ),
        ),
      ],
    );
  }
}
