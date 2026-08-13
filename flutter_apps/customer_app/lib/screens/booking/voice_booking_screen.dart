import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:speech_to_text/speech_to_text.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart';
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import 'parcel_booking_screen.dart';
import 'intercity_booking_screen.dart';

// ─────────────────────────────────────────────────────────────────────────────
// JAGO AI Voice Booking — Multi-service voice assistant
// Supports: Ride (Bike/Auto/Car) · Parcel Logistics · Intercity Carpool
// Languages: EN / TE / HI / TA / KN / ML / MR / BN / UR
// ─────────────────────────────────────────────────────────────────────────────

class _LangOption {
  final String name;
  final String localeId;
  final String ttsLang;
  final String flag;
  final String welcomeText;
  const _LangOption(this.name, this.localeId, this.ttsLang, this.flag, this.welcomeText);
}

const _supportedLangs = [
  _LangOption('English',   'en_IN', 'en-IN', '🇮🇳', 'Try: "Bike to Hitech City" or "Send parcel to Ameerpet"'),
  _LangOption('Telugu',   'te_IN', 'te-IN', '🇮🇳', 'చెప్పండి: "బైక్ హైటెక్ సిటీ కి" లేదా "పార్సెల్ పంపాలి"'),
  _LangOption('Hindi',    'hi_IN', 'hi-IN', '🇮🇳', 'बोलें: "बाइक हाईटेक सिटी तक" या "पार्सल भेजना है"'),
  _LangOption('Tamil',    'ta_IN', 'ta-IN', '🇮🇳', 'சொல்லுங்கள்: "பைக் ஹைடெக் சிட்டி" அல்லது "பார்சல் அனுப்ப வேண்டும்"'),
  _LangOption('Kannada',  'kn_IN', 'kn-IN', '🇮🇳', 'ಹೇಳಿ: "ಬೈಕ್ ಹೈಟೆಕ್ ಸಿಟಿ" ಅಥವಾ "ಪಾರ್ಸೆಲ್ ಕಳುಹಿಸಬೇಕು"'),
  _LangOption('Malayalam','ml_IN', 'ml-IN', '🇮🇳', 'പറയൂ: "ബൈക്ക് ഹൈടെക് സിറ്റി" അല്ലെങ്കിൽ "പാർസൽ അയക്കണം"'),
  _LangOption('Marathi',  'mr_IN', 'mr-IN', '🇮🇳', 'सांगा: "बाइक हायटेक सिटी" किंवा "पार्सल पाठवायचा आहे"'),
  _LangOption('Bengali',  'bn_IN', 'bn-IN', '🇮🇳', 'বলুন: "বাইক হাইটেক সিটি" বা "পার্সেল পাঠাতে হবে"'),
  _LangOption('Urdu',     'ur_IN', 'ur-IN', '🇮🇳', 'کہیں: "بائیک ہائی ٹیک سٹی" یا "پارسل بھیجنا ہے"'),
];

// Service intent types returned by the server
const _intentRide       = 'book_ride';
const _intentParcel     = 'send_parcel';
const _intentIntercity  = 'book_intercity';

class VoiceBookingScreen extends StatefulWidget {
  const VoiceBookingScreen({super.key});
  @override
  State<VoiceBookingScreen> createState() => _VoiceBookingScreenState();
}

class _VoiceBookingScreenState extends State<VoiceBookingScreen>
    with TickerProviderStateMixin {
  final SpeechToText _speech = SpeechToText();
  final FlutterTts _tts = FlutterTts();

  bool _isListening = false;
  bool _speechAvailable = false;
  bool _loading = false;
  bool _awaitingConfirmation = false;
  String _recognizedText = '';
  String _statusText = 'Tap the mic to start';
  Map<String, dynamic>? _parsedIntent;
  String _detectedService = ''; // 'ride' | 'parcel' | 'intercity'

  List<Map<String, dynamic>> _allFares = [];
  int _selectedFareIndex = 0;
  double _distanceKm = 0;

  _LangOption _selectedLang = _supportedLangs[0];
  List<LocaleName> _availableLocales = [];
  double? _currentLat;
  double? _currentLng;
  String _currentAddress = 'Current Location';

  late AnimationController _pulseCtrl;
  late AnimationController _waveCtrl;

  // ─── Life-cycle ──────────────────────────────────────────────────────────

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 1))
      ..repeat(reverse: true);
    _waveCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 800))
      ..repeat(reverse: true);
    _initSpeech();
    _fetchCurrentLocation();
  }

  Future<void> _fetchCurrentLocation() async {
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) return;
      final pos = await Geolocator.getLastKnownPosition() ??
          await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
          ).timeout(const Duration(seconds: 8));
      if (!mounted) return;
      setState(() { _currentLat = pos.latitude; _currentLng = pos.longitude; });
      // Try server proxy
      try {
        final headers = await AuthService.getHeaders();
        final r = await http.get(
          Uri.parse('${ApiConfig.reverseGeocode}?lat=${pos.latitude}&lng=${pos.longitude}'),
          headers: headers,
        ).timeout(const Duration(seconds: 6));
        if (r.statusCode == 200) {
          final d = jsonDecode(r.body) as Map<String, dynamic>;
          final addr = d['formattedAddress']?.toString() ?? '';
          if (mounted && addr.isNotEmpty) {
            setState(() => _currentAddress = addr);
            return;
          }
        }
      } catch (_) {}
      // Nominatim fallback
      try {
        final r = await http.get(
          Uri.parse(
              'https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.latitude}&lon=${pos.longitude}'),
          headers: const {'User-Agent': 'JagoPro/1.0'},
        ).timeout(const Duration(seconds: 5));
        if (r.statusCode == 200) {
          final d = jsonDecode(r.body) as Map<String, dynamic>;
          final addr = d['display_name']?.toString() ?? '';
          if (mounted && addr.isNotEmpty) {
            setState(() => _currentAddress = addr.split(',').take(3).join(',').trim());
          }
        }
      } catch (_) {}
    } catch (_) {}
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    _waveCtrl.dispose();
    _speech.stop();
    _tts.stop();
    super.dispose();
  }

  // ─── Speech init ─────────────────────────────────────────────────────────

  Future<void> _initSpeech() async {
    final available = await _speech.initialize(
      onError: (e) => setState(() => _statusText = 'Mic error: ${e.errorMsg}'),
      onStatus: (s) {
        if (s == 'done' || s == 'notListening') {
          if (mounted) setState(() => _isListening = false);
          if (_recognizedText.isNotEmpty) {
            if (_awaitingConfirmation) {
              _processVoiceConfirmation(_recognizedText);
            } else {
              _parseIntent(_recognizedText);
            }
          }
        }
      },
    );
    if (available) {
      final locales = await _speech.locales();
      if (mounted) {
        setState(() {
          _speechAvailable = true;
          _availableLocales = locales;
        });
        _autoDetectLanguage();
      }
    } else {
      if (mounted) setState(() => _speechAvailable = false);
    }
    _speakWelcome();
  }

  void _autoDetectLanguage() {
    final deviceLocale = WidgetsBinding.instance.platformDispatcher.locale;
    final langCode = deviceLocale.languageCode;
    final match = _supportedLangs.where((l) => l.localeId.startsWith(langCode)).toList();
    if (match.isNotEmpty) setState(() => _selectedLang = match.first);
  }

  _LangOption _detectLangFromText(String text) {
    if (text.runes.any((r) => r >= 0x0C00 && r <= 0x0C7F))
      return _supportedLangs.firstWhere((l) => l.localeId.startsWith('te'), orElse: () => _selectedLang);
    if (text.runes.any((r) => r >= 0x0900 && r <= 0x097F))
      return _supportedLangs.firstWhere((l) => l.localeId.startsWith('hi'), orElse: () => _selectedLang);
    if (text.runes.any((r) => r >= 0x0B80 && r <= 0x0BFF))
      return _supportedLangs.firstWhere((l) => l.localeId.startsWith('ta'), orElse: () => _selectedLang);
    if (text.runes.any((r) => r >= 0x0C80 && r <= 0x0CFF))
      return _supportedLangs.firstWhere((l) => l.localeId.startsWith('kn'), orElse: () => _selectedLang);
    if (text.runes.any((r) => r >= 0x0D00 && r <= 0x0D7F))
      return _supportedLangs.firstWhere((l) => l.localeId.startsWith('ml'), orElse: () => _selectedLang);
    if (text.runes.any((r) => r >= 0x0980 && r <= 0x09FF))
      return _supportedLangs.firstWhere((l) => l.localeId.startsWith('bn'), orElse: () => _selectedLang);
    if (text.runes.any((r) => r >= 0x0600 && r <= 0x06FF))
      return _supportedLangs.firstWhere((l) => l.localeId.startsWith('ur'), orElse: () => _selectedLang);
    return _selectedLang;
  }

  // ─── TTS ─────────────────────────────────────────────────────────────────

  Future<void> _speak(String text, {_LangOption? lang}) async {
    final l = lang ?? _selectedLang;
    await _tts.setLanguage(l.ttsLang);
    await _tts.setSpeechRate(0.88);
    await _tts.speak(text);
  }

  Future<void> _speakWelcome() async {
    await Future.delayed(const Duration(milliseconds: 800));
    await _speak('Welcome to Jago Voice Assistant. You can book a ride, send a parcel, or book an intercity trip. Tap the mic and speak.');
  }

  // ─── Language picker ─────────────────────────────────────────────────────

  Future<void> _selectLanguage() async {
    final chosen = await showModalBottomSheet<_LangOption>(
      context: context,
      backgroundColor: JT.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 40, height: 4,
            margin: const EdgeInsets.only(top: 12, bottom: 8),
            decoration: BoxDecoration(color: JT.border, borderRadius: BorderRadius.circular(2)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
            child: Text('Choose Language', style: GoogleFonts.poppins(
                color: JT.textPrimary, fontWeight: FontWeight.w400, fontSize: 16)),
          ),
          ..._supportedLangs.map((lang) {
            final available = _availableLocales.any(
                (l) => l.localeId.startsWith(lang.localeId.substring(0, 2)));
            return ListTile(
              leading: Text(lang.flag, style: const TextStyle(fontSize: 24)),
              title: Text(lang.name, style: GoogleFonts.poppins(
                  color: available ? JT.textPrimary : JT.textSecondary,
                  fontWeight: FontWeight.w400)),
              trailing: lang == _selectedLang
                  ? const Icon(Icons.check_circle, color: JT.primary)
                  : available ? null
                  : Text('Not available', style: GoogleFonts.poppins(color: JT.textSecondary, fontSize: 10)),
              onTap: available ? () => Navigator.pop(context, lang) : null,
            );
          }),
          const SizedBox(height: 24),
        ],
      ),
    );
    if (chosen != null && mounted) {
      setState(() => _selectedLang = chosen);
      _speakWelcome();
    }
  }

  String? _normalizeVehicleType(String? raw) {
    final key = (raw ?? '').trim().toLowerCase();
    if (key.isEmpty) return null;
    if (key.contains('bike parcel')) return 'bike_parcel';
    if (key.contains('parcel auto')) return 'auto_parcel';
    if (key.contains('mini truck') || key.contains('tata ace')) return 'tata_ace';
    if (key.contains('pickup')) return 'pickup_truck';
    if (key.contains('tempo')) return 'tempo_407';
    if (key.contains('bike')) return 'bike';
    if (key.contains('auto')) return 'auto';
    if (key.contains('cab') ||
        key.contains('car') ||
        key.contains('sedan') ||
        key.contains('suv') ||
        key.contains('premium')) {
      return 'car';
    }
    return null;
  }

  // ─── Listening ────────────────────────────────────────────────────────────

  Future<void> _startListening() async {
    if (!_speechAvailable) { _showSnack('Microphone not available'); return; }
    HapticFeedback.mediumImpact();
    await _tts.stop();
    setState(() {
      _isListening = true;
      _awaitingConfirmation = false;
      _recognizedText = '';
      _parsedIntent = null;
      _allFares = [];
      _detectedService = '';
      _statusText = 'Listening… speak now';
    });
    final localeAvailable = _availableLocales
        .any((l) => l.localeId.startsWith(_selectedLang.localeId.substring(0, 2)));
    await _speech.listen(
      onResult: (r) {
        if (mounted) setState(() {
          _recognizedText = r.recognizedWords;
          _statusText = 'Heard: "$_recognizedText"';
        });
      },
      localeId: localeAvailable ? _selectedLang.localeId : 'en_IN',
      listenFor: const Duration(seconds: 12),
      pauseFor: const Duration(seconds: 3),
    );
  }

  Future<void> _stopListening() async {
    await _speech.stop();
    if (!mounted) return;
    setState(() => _isListening = false);
    if (_recognizedText.isNotEmpty) {
      if (_awaitingConfirmation) {
        _processVoiceConfirmation(_recognizedText);
      } else {
        _parseIntent(_recognizedText);
      }
    }
  }

  Future<void> _listenForConfirmation() async {
    if (!_speechAvailable || !mounted) return;
    await Future.delayed(const Duration(milliseconds: 600));
    if (!mounted) return;
    setState(() {
      _isListening = true;
      _awaitingConfirmation = true;
      _recognizedText = '';
      _statusText = 'Listening for confirmation…';
    });
    final localeAvailable = _availableLocales
        .any((l) => l.localeId.startsWith(_selectedLang.localeId.substring(0, 2)));
    await _speech.listen(
      onResult: (r) {
        if (mounted) setState(() {
          _recognizedText = r.recognizedWords;
          _statusText = 'Heard: "$_recognizedText"';
        });
      },
      localeId: localeAvailable ? _selectedLang.localeId : 'en_IN',
      listenFor: const Duration(seconds: 10),
      pauseFor: const Duration(seconds: 3),
    );
  }

  // ─── Voice confirmation processing ───────────────────────────────────────

  void _processVoiceConfirmation(String text) {
    setState(() { _isListening = false; _awaitingConfirmation = false; });
    final lower = text.toLowerCase().trim();
    if (_tryVehicleSwitch(lower)) return;

    const confirmWords = [
      'yes', 'confirm', 'book', 'okay', 'ok', 'sure', 'proceed', 'go', 'accept',
      'done', 'correct', 'right', 'ha', 'haan',
      'అవును', 'బుక్', 'హాఁ', 'హా',
      'हाँ', 'बुक', 'हां', 'हा',
      'ஆம்', 'சரி',
      'ಹೌದು', 'ಸರಿ',
      'ശരി', 'അതെ',
      'হ্যাঁ', 'ঠিক',
      'हो',
    ];
    const cancelWords = [
      'no', 'cancel', 'stop', 'nahi', 'nope', 'back',
      'illa', 'vendam', 'వద్దు', 'నో', 'వద్దు',
      'वेण्डाम', 'نهیں', 'नहीं',
    ];

    if (cancelWords.any((w) => lower.contains(w))) {
      setState(() => _statusText = 'Cancelled. Tap the mic to try again.');
      _speak('Booking cancelled.');
      return;
    }
    if (confirmWords.any((w) => lower.contains(w))) {
      _speak('Perfect! Booking your ride now.').then((_) => _confirmBooking());
      return;
    }
    setState(() => _statusText = 'Say "yes" to confirm or "no" to cancel.');
    _speak('Say yes to confirm, or no to cancel.').then((_) => _listenForConfirmation());
  }

  bool _tryVehicleSwitch(String lower) {
    if (_allFares.isEmpty) return false;
    const vehicleMap = {
      'bike': ['bike', 'bicycle', 'motor'],
      'auto': ['auto', 'autorickshaw', 'rickshaw', 'temo'],
      'car': ['car', 'cab', 'sedan', 'mini'],
      'suv': ['suv', 'innova'],
    };
    for (final entry in vehicleMap.entries) {
      if (entry.value.any((k) => lower.contains(k))) {
        final idx = _allFares.indexWhere((f) {
          final name = (f['vehicleCategoryName'] ?? f['name'] ?? '').toString().toLowerCase();
          return name.contains(entry.key);
        });
        if (idx >= 0 && idx != _selectedFareIndex) {
          setState(() {
            _selectedFareIndex = idx;
            _statusText = 'Switched to ${_allFares[idx]['vehicleCategoryName'] ?? 'vehicle'}. Say yes to confirm.';
          });
          final name = _allFares[idx]['vehicleCategoryName'] ?? 'vehicle';
          final fare = (_allFares[idx]['estimatedFare'] ?? 0).toStringAsFixed(0);
          _speak('Switched to $name for ₹$fare. Say yes to confirm or no to cancel.')
              .then((_) => _listenForConfirmation());
          return true;
        }
      }
    }
    return false;
  }

  // ─── Parse intent from server ─────────────────────────────────────────────

  Future<void> _parseIntent(String text) async {
    final detectedLang = _detectLangFromText(text);
    if (detectedLang != _selectedLang && mounted) {
      setState(() => _selectedLang = detectedLang);
    }
    setState(() { _loading = true; _statusText = '🧠 Understanding your request…'; });

    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/voice-booking/parse'),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({
          'text': text,
          if (_currentLat != null) 'currentLat': _currentLat,
          if (_currentLng != null) 'currentLng': _currentLng,
          'currentAddress': _currentAddress,
        }),
      ).timeout(const Duration(seconds: 12));

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (!mounted) return;

        final intent = data['intent']?.toString() ?? _intentRide;
        setState(() {
          _parsedIntent = data;
          _detectedService = intent == _intentParcel ? 'parcel'
              : intent == _intentIntercity ? 'intercity' : 'ride';
        });

        // ── Parcel intent → navigate to ParcelBookingScreen ──────────────
        if (intent == _intentParcel) {
          if (mounted) setState(() => _loading = false);
          if (_currentLat == null || _currentLng == null) {
            await _speak('I could not detect your location. Please enable GPS and try again.');
            if (mounted) _showSnack('Location unavailable. Please enable GPS.');
            return;
          }
          await _speak('Sure! Opening parcel booking for you.');
          if (mounted) {
            Navigator.pushReplacement(context, MaterialPageRoute(
              builder: (_) => ParcelBookingScreen(
                pickupAddress: _currentAddress,
                pickupLat: _currentLat!,
                pickupLng: _currentLng!,
              ),
            ));
          }
          return;
        }

        // ── Intercity intent → navigate to IntercityBookingScreen ─────────
        if (intent == _intentIntercity) {
          if (mounted) setState(() => _loading = false);
          await _speak('Opening intercity booking for you.');
          if (mounted) {
            Navigator.pushReplacement(context, MaterialPageRoute(
              builder: (_) => const IntercityBookingScreen(),
            ));
          }
          return;
        }

        // ── Ride intent → fetch all fares ─────────────────────────────────
        if (data['pickup'] != null && data['destination'] != null) {
          setState(() => _statusText = '📍 Finding locations…');
          await _getAllFares(data);
        } else {
          setState(() => _statusText = '❓ Please say pickup and destination clearly.\nExample: "Bike from JNTU to Hitech City"');
          await _speak('Sorry, I could not understand. Please say the pickup and destination clearly.');
        }
      } else {
        final err = res.statusCode == 503
            ? 'Voice service unavailable. Check your connection.'
            : 'Server error (${res.statusCode}). Please try again.';
        setState(() => _statusText = err);
        await _speak('Sorry, something went wrong. Please try again.');
      }
    } on TimeoutException {
      setState(() => _statusText = '⏱ Request timed out. Check internet connection.');
      await _speak('Request timed out. Please check your connection and try again.');
    } catch (e) {
      setState(() => _statusText = '⚠️ Error: ${e.toString().replaceAll('Exception: ', '')}');
      await _speak('Sorry, an error occurred. Please try again.');
    }
    if (mounted) setState(() => _loading = false);
  }

  // ─── Fetch all ride fares ─────────────────────────────────────────────────

  Future<void> _getAllFares(Map<String, dynamic> intent) async {
    if (intent['pickupLat'] == null || intent['destLat'] == null) {
      setState(() => _statusText = 'Could not locate that place. Try a more specific address.');
      await _speak('Sorry, I could not find that location. Please try with a more specific address.');
      return;
    }
    setState(() => _statusText = 'Getting vehicle fares…');
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/customer/estimate-fare'),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({
          'pickupLat': intent['pickupLat'],
          'pickupLng': intent['pickupLng'],
          'destinationLat': intent['destLat'],
          'destinationLng': intent['destLng'],
        }),
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final fares = (data['fares'] as List?)?.cast<Map<String, dynamic>>() ?? [];
        _distanceKm = (data['distanceKm'] as num?)?.toDouble() ?? 0;

        // Ride vehicles only — parcel/cargo handled by separate screen
        final rideVehicles = fares.where((f) {
          final name = (f['vehicleCategoryName'] ?? f['name'] ?? '').toString().toLowerCase();
          return !name.contains('parcel') && !name.contains('cargo') && !name.contains('delivery');
        }).toList();

        if (rideVehicles.isEmpty) {
          setState(() => _statusText = 'No vehicles available right now.');
          await _speak('Sorry, no vehicles are available right now. Please try again later.');
          return;
        }

        int preferredIndex = 0;
        final intentVehicleId = intent['vehicleCategoryId']?.toString();
        if (intentVehicleId != null) {
          final idx = rideVehicles.indexWhere((f) =>
              f['vehicleCategoryId']?.toString() == intentVehicleId ||
              f['id']?.toString() == intentVehicleId);
          if (idx >= 0) preferredIndex = idx;
        }
        // Also pre-select by vehicleType name
        final intentVehicleType = intent['vehicleType']?.toString().toLowerCase() ?? '';
        if (intentVehicleType.isNotEmpty && preferredIndex == 0) {
          final idx = rideVehicles.indexWhere((f) =>
              (f['vehicleCategoryName'] ?? f['name'] ?? '').toString().toLowerCase().contains(intentVehicleType));
          if (idx >= 0) preferredIndex = idx;
        }

        if (!mounted) return;
        setState(() {
          _allFares = rideVehicles;
          _selectedFareIndex = preferredIndex;
          _statusText = 'Ready! Say YES to confirm or tap Book Now.';
        });
        await _announceAllFaresAndConfirm(intent);
      }
    } catch (_) {
      setState(() => _statusText = 'Error fetching fares. Try again.');
    }
  }

  // ─── TTS: Announce fares ──────────────────────────────────────────────────

  Future<void> _announceAllFaresAndConfirm(Map<String, dynamic> intent) async {
    if (_allFares.isEmpty || !mounted) return;
    final pickup = intent['pickup'] ?? 'your pickup';
    final dest = intent['destination'] ?? 'your destination';
    final dist = _distanceKm > 0 ? '${_distanceKm.toStringAsFixed(1)} kilometres' : '';
    final sb = StringBuffer();
    sb.write('I found ${_allFares.length} option${_allFares.length > 1 ? "s" : ""} '
        'from $pickup to $dest');
    if (dist.isNotEmpty) sb.write(', $dist');
    sb.write('. ');
    for (int i = 0; i < _allFares.length; i++) {
      final f = _allFares[i];
      final name = f['vehicleCategoryName'] ?? f['name'] ?? 'Vehicle';
      final fare = (f['estimatedFare'] as num?)?.toStringAsFixed(0) ?? '?';
      if (i == _allFares.length - 1 && _allFares.length > 1) sb.write('and ');
      sb.write('$name ₹$fare');
      if (i < _allFares.length - 1) sb.write(', ');
    }
    sb.write('. ');
    final selected = _allFares[_selectedFareIndex];
    sb.write('${selected['vehicleCategoryName'] ?? 'Bike'} is selected. ');
    sb.write('Say yes to confirm, or say the vehicle name to switch. Say no to cancel.');
    setState(() => _statusText = sb.toString());
    await _speak(sb.toString());
    await Future.delayed(const Duration(milliseconds: 400));
    if (mounted && !_isListening && !_loading) _listenForConfirmation();
  }

  // ─── Confirm ride booking ─────────────────────────────────────────────────

  Future<void> _confirmBooking() async {
    if (_parsedIntent == null || _allFares.isEmpty) return;
    setState(() => _loading = true);
    try {
      final fare = _allFares[_selectedFareIndex];
      final vcId = fare['vehicleCategoryId']?.toString() ?? fare['id']?.toString()
          ?? _parsedIntent!['vehicleCategoryId']?.toString();
      final vehicleType = _normalizeVehicleType(
        fare['vehicleType']?.toString() ??
            fare['type']?.toString() ??
            fare['vehicleCategoryName']?.toString() ??
            fare['name']?.toString() ??
            _parsedIntent!['vehicleType']?.toString(),
      );
      final vehicleName =
          fare['vehicleCategoryName']?.toString() ??
          fare['vehicleName']?.toString() ??
          fare['name']?.toString() ??
          'Bike';
      if ((vcId == null || vcId.isEmpty) && vehicleType == null) {
        _showSnack('Vehicle selection not ready. Please pick a vehicle again.');
        await _speak('Vehicle selection is not ready yet. Please try again.');
        if (mounted) setState(() => _loading = false);
        return;
      }
      final headers = await AuthService.getHeaders();
      final payload = <String, dynamic>{
        'pickupLat': _parsedIntent!['pickupLat'],
        'pickupLng': _parsedIntent!['pickupLng'],
        'destinationLat': _parsedIntent!['destLat'],
        'destinationLng': _parsedIntent!['destLng'],
        'pickupAddress': _parsedIntent!['pickup'],
        'destinationAddress': _parsedIntent!['destination'],
        if (vcId != null && vcId.isNotEmpty) 'vehicleCategoryId': vcId,
        if (vehicleType != null) 'vehicleType': vehicleType,
        'vehicleCategoryName': vehicleName,
        'vehicleName': vehicleName,
        'estimatedFare': fare['estimatedFare'] ?? 0,
        'estimatedDistance': _distanceKm,
        'paymentMethod': 'cash',
        'tripType': 'normal',
      };
      debugPrint('[VOICE_BOOK_RIDE] payload=${jsonEncode(payload)}');
      final res = await http.post(
        Uri.parse(ApiConfig.bookRide),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode(payload),
      );
      if (res.statusCode == 200) {
        HapticFeedback.heavyImpact();
        await _speak('Your ride is booked! A driver is being assigned. Have a safe trip!');
        if (mounted) Navigator.of(context).pop(true);
      } else {
        final err = jsonDecode(res.body);
        final msg = err['message'] ?? 'Booking failed';
        _showSnack(msg);
        await _speak('Booking failed. $msg Please try again.');
      }
    } catch (_) {
      _showSnack('Connection error');
      await _speak('Connection error. Please check your internet and try again.');
    }
    if (mounted) setState(() => _loading = false);
  }

  void _showSnack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg, style: GoogleFonts.poppins(fontWeight: FontWeight.w400, color: Colors.white)),
      backgroundColor: JT.error,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      margin: const EdgeInsets.all(16),
    ));
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bg,
      appBar: AppBar(
        backgroundColor: JT.bg,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded, color: JT.textPrimary, size: 18),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text('Voice Booking',
            style: GoogleFonts.poppins(color: JT.textPrimary, fontWeight: FontWeight.w400, fontSize: 16)),
        actions: [
          GestureDetector(
            onTap: _selectLanguage,
            child: Container(
              margin: const EdgeInsets.only(right: 16),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: JT.surfaceAlt,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: JT.border),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Text(_selectedLang.flag, style: const TextStyle(fontSize: 14)),
                const SizedBox(width: 6),
                Text(_selectedLang.name.split(' ')[0],
                    style: GoogleFonts.poppins(color: JT.textPrimary, fontSize: 12, fontWeight: FontWeight.w400)),
                const SizedBox(width: 4),
                const Icon(Icons.expand_more, color: JT.primary, size: 14),
              ]),
            ),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
        child: Column(children: [
          // ── Hero mic section ──────────────────────────────────────────
          _buildHeroSection(),
          const SizedBox(height: 20),

          // ── Service type badge ────────────────────────────────────────
          if (_detectedService.isNotEmpty) ...[
            _buildServiceBadge(),
            const SizedBox(height: 16),
          ],

          // ── Status card ───────────────────────────────────────────────
          _buildStatusCard(),
          const SizedBox(height: 14),

          // ── Recognized text ───────────────────────────────────────────
          if (_recognizedText.isNotEmpty) ...[
            _buildInfoCard(
              icon: Icons.record_voice_over_rounded,
              label: 'You said',
              child: Text('"$_recognizedText"',
                  style: GoogleFonts.poppins(
                      color: JT.textPrimary, fontSize: 14, fontStyle: FontStyle.italic, fontWeight: FontWeight.w500)),
            ),
            const SizedBox(height: 14),
          ],

          // ── Parsed intent ─────────────────────────────────────────────
          if (_parsedIntent != null && _parsedIntent!['pickup'] != null) ...[
            _buildInfoCard(
              icon: Icons.check_circle_rounded,
              iconColor: JT.success,
              label: 'Understood',
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                _intentRow(Icons.my_location_rounded, 'From', _parsedIntent!['pickup'] ?? '—'),
                _intentRow(Icons.location_on_rounded, 'To', _parsedIntent!['destination'] ?? '—'),
                if (_distanceKm > 0)
                  _intentRow(Icons.route_rounded, 'Distance', '${_distanceKm.toStringAsFixed(1)} km'),
              ]),
            ),
            const SizedBox(height: 14),
          ],

          // ── Vehicle fare cards ─────────────────────────────────────────
          if (_allFares.isNotEmpty) ...[
            _buildFaresList(),
            const SizedBox(height: 16),
            _buildActionButtons(),
          ],

          const SizedBox(height: 28),
          _buildCommandHints(),
        ]),
      ),
    );
  }

  // ─── Hero mic button ──────────────────────────────────────────────────────

  Widget _buildHeroSection() {
    final micColor = _awaitingConfirmation ? JT.success
        : _isListening ? JT.error : JT.primary;
    return Column(children: [
      const SizedBox(height: 16),
      // Mic button
      GestureDetector(
        onTap: _isListening ? _stopListening : _startListening,
        child: AnimatedBuilder(
          animation: _pulseCtrl,
          builder: (_, __) {
            final scale = _isListening ? 1.0 + _pulseCtrl.value * 0.08 : 1.0;
            final glow = BoxShadow(
              color: micColor.withValues(alpha: _isListening ? 0.35 + 0.15 * _pulseCtrl.value : 0.2),
              blurRadius: _isListening ? 32 + 12 * _pulseCtrl.value : 16,
              spreadRadius: _isListening ? 4 : 0,
            );
            return Transform.scale(
              scale: scale,
              child: Container(
                width: 120, height: 120,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    colors: _awaitingConfirmation
                        ? [JT.success, JT.success.withValues(alpha: 0.8)]
                        : _isListening
                            ? [JT.error, JT.error.withValues(alpha: 0.8)]
                            : [JT.primary, const Color(0xFF4FA9FF)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  boxShadow: [glow],
                ),
                child: Icon(
                  _isListening ? Icons.stop_rounded : Icons.mic_rounded,
                  color: Colors.white, size: 52,
                ),
              ),
            );
          },
        ),
      ),
      const SizedBox(height: 12),
      Text(
        _awaitingConfirmation ? 'Say YES to confirm or NO to cancel'
            : _isListening ? 'Listening… tap to stop'
            : _speechAvailable ? 'Tap mic to speak'
            : 'Microphone not available',
        style: GoogleFonts.poppins(
          color: _awaitingConfirmation ? JT.success
              : _isListening ? JT.error : JT.primary,
          fontSize: 13, fontWeight: FontWeight.w500,
        ),
      ),
      const SizedBox(height: 4),
      Text(_selectedLang.welcomeText,
          style: GoogleFonts.poppins(fontSize: 11, color: JT.textSecondary),
          textAlign: TextAlign.center),
      // Wave animation while listening
      if (_isListening) ...[
        const SizedBox(height: 10),
        AnimatedBuilder(
          animation: _waveCtrl,
          builder: (_, __) => Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(5, (i) => Container(
              margin: const EdgeInsets.symmetric(horizontal: 3),
              width: 4,
              height: 10 + 16 * (i % 3 == 0
                  ? _waveCtrl.value
                  : i % 2 == 0
                      ? (1 - _waveCtrl.value)
                      : _waveCtrl.value * 0.7),
              decoration: BoxDecoration(
                color: JT.error,
                borderRadius: BorderRadius.circular(2),
              ),
            )),
          ),
        ),
      ],
    ]);
  }

  // ─── Service badge ────────────────────────────────────────────────────────

  Widget _buildServiceBadge() {
    final isParcel = _detectedService == 'parcel';
    final isIntercity = _detectedService == 'intercity';
    final label = isParcel ? '📦 Parcel Booking' : isIntercity ? '🛣️ Intercity Trip' : '🚗 Ride Booking';
    final color = isParcel ? JT.warning : isIntercity ? JT.success : JT.primary;
    return Center(child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Text(label, style: GoogleFonts.poppins(
          color: color, fontWeight: FontWeight.w500, fontSize: 13)),
    ));
  }

  // ─── Status card ──────────────────────────────────────────────────────────

  Widget _buildStatusCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.border),
        boxShadow: JT.cardShadow,
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(_awaitingConfirmation ? Icons.record_voice_over_rounded : Icons.info_outline_rounded,
              color: _awaitingConfirmation ? JT.success : JT.primary, size: 16),
          const SizedBox(width: 8),
          Text(_awaitingConfirmation ? 'Awaiting Confirmation' : 'Status',
              style: GoogleFonts.poppins(fontSize: 11, color: JT.textSecondary, fontWeight: FontWeight.w400)),
        ]),
        const SizedBox(height: 8),
        if (_loading)
          Row(children: [
            const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: JT.primary)),
            const SizedBox(width: 12),
            Expanded(child: Text(_statusText, style: GoogleFonts.poppins(color: JT.textPrimary, fontSize: 13))),
          ])
        else
          Text(_statusText, style: GoogleFonts.poppins(color: JT.textPrimary, fontSize: 13)),
        // Confirmation pulsing indicator
        if (_awaitingConfirmation) ...[
          const SizedBox(height: 10),
          AnimatedBuilder(
            animation: _pulseCtrl,
            builder: (_, __) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: JT.success.withValues(alpha: 0.08 + 0.04 * _pulseCtrl.value),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: JT.success.withValues(alpha: 0.25)),
              ),
              child: Row(children: [
                Container(
                  width: 8, height: 8,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: JT.success,
                    boxShadow: [BoxShadow(color: JT.success.withValues(alpha: 0.5 + _pulseCtrl.value * 0.3), blurRadius: 6)],
                  ),
                ),
                const SizedBox(width: 8),
                Text('Listening for voice confirmation…',
                    style: GoogleFonts.poppins(color: JT.success, fontSize: 12, fontWeight: FontWeight.w400)),
              ]),
            ),
          ),
        ],
      ]),
    );
  }

  // ─── Fare cards list ──────────────────────────────────────────────────────

  Widget _buildFaresList() {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Container(width: 3, height: 16, decoration: BoxDecoration(gradient: JT.grad, borderRadius: BorderRadius.circular(2))),
        const SizedBox(width: 8),
        Text('Available Vehicles', style: GoogleFonts.poppins(
            fontSize: 14, fontWeight: FontWeight.w400, color: JT.textPrimary)),
        if (_distanceKm > 0) ...[
          const Spacer(),
          Text('${_distanceKm.toStringAsFixed(1)} km',
              style: GoogleFonts.poppins(fontSize: 12, color: JT.primary, fontWeight: FontWeight.w400)),
        ],
      ]),
      const SizedBox(height: 12),
      ..._allFares.asMap().entries.map((entry) {
        final i = entry.key;
        final f = entry.value;
        final isSelected = i == _selectedFareIndex;
        final name = f['vehicleCategoryName'] ?? f['name'] ?? 'Vehicle';
        final fareVal = (f['estimatedFare'] as num?)?.toStringAsFixed(0) ?? '?';
        final time = f['estimatedTime']?.toString() ?? '~5 min';
        return GestureDetector(
          onTap: () => setState(() => _selectedFareIndex = i),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: BoxDecoration(
              color: isSelected ? JT.primary.withValues(alpha: 0.06) : JT.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: isSelected ? JT.primary : JT.border, width: isSelected ? 2 : 1),
              boxShadow: isSelected ? JT.btnShadow : JT.cardShadow,
            ),
            child: Row(children: [
              Container(
                width: 44, height: 44,
                decoration: BoxDecoration(
                  color: isSelected ? JT.primary.withValues(alpha: 0.12) : JT.bgSoft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(_iconForVehicle(name),
                    color: isSelected ? JT.primary : JT.iconInactive, size: 22),
              ),
              const SizedBox(width: 14),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(name, style: GoogleFonts.poppins(
                    color: isSelected ? JT.primary : JT.textPrimary,
                    fontWeight: FontWeight.w400, fontSize: 14)),
                Text(time, style: GoogleFonts.poppins(color: JT.textSecondary, fontSize: 11)),
              ])),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text('₹$fareVal', style: GoogleFonts.poppins(
                    color: isSelected ? JT.primary : JT.textPrimary,
                    fontSize: 22, fontWeight: FontWeight.w500)),
                if (isSelected)
                  Container(
                    margin: const EdgeInsets.only(top: 2),
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: JT.primary, borderRadius: BorderRadius.circular(6)),
                    child: Text('Selected', style: GoogleFonts.poppins(
                        color: Colors.white, fontSize: 9, fontWeight: FontWeight.w400)),
                  ),
              ]),
            ]),
          ),
        );
      }).toList(),
    ]);
  }

  // ─── Action buttons ───────────────────────────────────────────────────────

  Widget _buildActionButtons() {
    return Row(children: [
      Expanded(
        child: OutlinedButton.icon(
          onPressed: _startListening,
          icon: const Icon(Icons.refresh_rounded, size: 18),
          label: Text('Try Again', style: GoogleFonts.poppins(fontWeight: FontWeight.w500)),
          style: OutlinedButton.styleFrom(
            foregroundColor: JT.textSecondary,
            side: BorderSide(color: JT.border),
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
      ),
      const SizedBox(width: 12),
      Expanded(
        flex: 2,
        child: ElevatedButton.icon(
          onPressed: _loading ? null : () {
            HapticFeedback.heavyImpact();
            _speak('Booking now.').then((_) => _confirmBooking());
          },
          icon: Icon(_awaitingConfirmation ? Icons.check_rounded : Icons.flash_on_rounded, size: 20),
          label: Text(
            _awaitingConfirmation ? 'CONFIRM' : 'BOOK NOW',
            style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w400),
          ),
          style: ElevatedButton.styleFrom(
            backgroundColor: _awaitingConfirmation ? JT.success : JT.primary,
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            elevation: 0,
          ),
        ),
      ),
    ]);
  }

  // ─── Command hints ────────────────────────────────────────────────────────

  Widget _buildCommandHints() {
    const hints = [
      ('🏍️', 'Ride', '"Bike to Hitech City"'),
      ('🛺', 'Auto', '"Auto kavali Ameerpet ki"'),
      ('📦', 'Parcel', '"Parcel pampali" or "Send parcel"'),
      ('🚛', 'Logistics', '"Mini truck kavali"'),
      ('🛣️', 'Intercity', '"Bangalore ki outstation"'),
    ];
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Example Commands', style: GoogleFonts.poppins(
          fontSize: 12, fontWeight: FontWeight.w500, color: JT.textSecondary)),
      const SizedBox(height: 8),
      ...hints.map((h) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(children: [
          Text(h.$1, style: const TextStyle(fontSize: 16)),
          const SizedBox(width: 8),
          Text('${h.$2}: ', style: GoogleFonts.poppins(
              fontSize: 11, fontWeight: FontWeight.w500, color: JT.primary)),
          Expanded(child: Text(h.$3, style: GoogleFonts.poppins(
              fontSize: 11, color: JT.textSecondary))),
        ]),
      )),
      const SizedBox(height: 12),
      Center(child: Text('Optimised for elderly · visually impaired · hands-free use',
          style: GoogleFonts.poppins(fontSize: 10, color: JT.textSecondary),
          textAlign: TextAlign.center)),
    ]);
  }

  // ─── Shared helpers ───────────────────────────────────────────────────────

  Widget _buildInfoCard({
    required IconData icon,
    Color iconColor = JT.primary,
    required String label,
    required Widget child,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.border),
        boxShadow: JT.cardShadow,
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(icon, color: iconColor, size: 15),
          const SizedBox(width: 7),
          Text(label, style: GoogleFonts.poppins(
              color: JT.textSecondary, fontSize: 11, fontWeight: FontWeight.w400)),
        ]),
        const SizedBox(height: 8),
        child,
      ]),
    );
  }

  Widget _intentRow(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(children: [
        Icon(icon, color: JT.primary, size: 15),
        const SizedBox(width: 8),
        Text('$label: ', style: GoogleFonts.poppins(
            color: JT.textSecondary, fontSize: 12, fontWeight: FontWeight.w400)),
        Expanded(child: Text(value, style: GoogleFonts.poppins(
            color: JT.textPrimary, fontSize: 13, fontWeight: FontWeight.w500),
            maxLines: 2, overflow: TextOverflow.ellipsis)),
      ]),
    );
  }

  static IconData _iconForVehicle(String name) {
    final n = name.toLowerCase();
    if (n.contains('bike') || n.contains('motor')) return Icons.electric_bike_rounded;
    if (n.contains('auto') || n.contains('temo')) return Icons.electric_rickshaw_rounded;
    if (n.contains('suv') || n.contains('innova')) return Icons.directions_car_filled_rounded;
    if (n.contains('pool') || n.contains('share')) return Icons.group_rounded;
    return Icons.directions_car_rounded;
  }
}
