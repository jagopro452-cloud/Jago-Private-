import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import 'pending_verification_screen.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});
  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  static const int _totalSteps = 5;

  static const _stepTitles = [
    'Personal Information',
    'Driving Licence',
    'Vehicle Details',
    'Vehicle Documents',
    'Live Selfie',
  ];

  static const _stepSubtitles = [
    'Tell us a bit about yourself',
    'Verify your driving credentials',
    'Tell us about your ride',
    'Upload your vehicle registration',
    "One quick photo to confirm it's you",
  ];

  static const _vehicleTypeOptions = ['bike', 'auto', 'car', 'mini', 'sedan', 'suv', 'xl'];
  static const _vehicleTypeIcons = {
    'bike': Icons.two_wheeler_outlined,
    'auto': Icons.electric_rickshaw_outlined,
    'car': Icons.directions_car_outlined,
    'mini': Icons.directions_car_filled_outlined,
    'sedan': Icons.directions_car_outlined,
    'suv': Icons.airport_shuttle_outlined,
    'xl': Icons.local_taxi_outlined,
  };

  static const _selfieTips = [
    'Face the camera in good lighting',
    'Remove sunglasses, mask or hat',
    'Keep a neutral expression',
  ];

  final PageController _pageController = PageController();
  int _currentStep = 0;
  bool _loading = false;

  // Step 1: Personal Information
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  final _referralCtrl = TextEditingController();
  DateTime? _dob;

  // Step 2: Driving Licence
  final _licenseNumCtrl = TextEditingController();
  File? _dlFront;
  File? _dlBack;

  // Step 3: Vehicle Details
  final _vehicleBrandCtrl = TextEditingController();
  final _vehicleModelCtrl = TextEditingController();
  final _vehicleColorCtrl = TextEditingController();
  final _vehicleYearCtrl = TextEditingController();
  final _vehicleNumCtrl = TextEditingController();
  String _vehicleType = 'bike';
  bool _carShareEnabled = false;
  bool _intercityEnabled = false;

  // Step 4: Vehicle Documents
  File? _rcPhoto;

  // Step 5: Live Selfie
  File? _selfiePhoto;

  final _picker = ImagePicker();

  @override
  void initState() {
    super.initState();
    _prefillPhone();
  }

  Future<void> _prefillPhone() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _phoneCtrl.text = prefs.getString('user_phone') ?? '';
    });
  }

  @override
  void dispose() {
    _pageController.dispose();
    _nameCtrl.dispose();
    _phoneCtrl.dispose();
    _referralCtrl.dispose();
    _licenseNumCtrl.dispose();
    _vehicleBrandCtrl.dispose();
    _vehicleModelCtrl.dispose();
    _vehicleColorCtrl.dispose();
    _vehicleYearCtrl.dispose();
    _vehicleNumCtrl.dispose();
    super.dispose();
  }

  void _showSnack(String msg, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: error ? JT.error : JT.primary,
      behavior: SnackBarBehavior.floating,
    ));
  }

  bool get _canContinue {
    switch (_currentStep) {
      case 0:
        return _nameCtrl.text.trim().length >= 2 &&
            _phoneCtrl.text.trim().length == 10 &&
            _dob != null;
      case 1:
        return _licenseNumCtrl.text.trim().isNotEmpty && _dlFront != null && _dlBack != null;
      case 2:
        return _vehicleBrandCtrl.text.trim().isNotEmpty &&
            _vehicleModelCtrl.text.trim().isNotEmpty &&
            _vehicleColorCtrl.text.trim().isNotEmpty &&
            _vehicleYearCtrl.text.trim().length == 4 &&
            _vehicleNumCtrl.text.trim().isNotEmpty;
      case 3:
        return _rcPhoto != null;
      case 4:
        return _selfiePhoto != null;
      default:
        return false;
    }
  }

  void _goNext() {
    if (_currentStep == _totalSteps - 1) {
      _submit();
      return;
    }
    _pageController.nextPage(duration: const Duration(milliseconds: 320), curve: Curves.easeInOutCubic);
    setState(() => _currentStep++);
  }

  void _goBack() {
    _pageController.previousPage(duration: const Duration(milliseconds: 320), curve: Curves.easeInOutCubic);
    setState(() => _currentStep--);
  }

  Future<void> _pickImage(String type, ImageSource source) async {
    final picked = await _picker.pickImage(
      source: source,
      preferredCameraDevice: type == 'selfie' ? CameraDevice.front : CameraDevice.rear,
      imageQuality: 70,
    );
    if (picked == null) return;
    setState(() {
      switch (type) {
        case 'dl_front':
          _dlFront = File(picked.path);
          break;
        case 'dl_back':
          _dlBack = File(picked.path);
          break;
        case 'rc':
          _rcPhoto = File(picked.path);
          break;
        case 'selfie':
          _selfiePhoto = File(picked.path);
          break;
      }
    });
  }

  Future<String?> _fileToBase64(File? file) async {
    if (file == null) return null;
    return base64Encode(await file.readAsBytes());
  }

  /// The app is OTP-only end to end — a driver never sets or types a
  /// password. The account-creation endpoint still requires one though, so
  /// we generate a throwaway value here purely to satisfy that field; it is
  /// never shown to the user and never used for login.
  String _generatePassword() {
    const lowers = 'abcdefghijkmnpqrstuvwxyz';
    const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    final rand = Random.secure();
    String pick(String s) => s[rand.nextInt(s.length)];
    final chars = <String>[
      pick(uppers), pick(uppers),
      pick(lowers), pick(lowers), pick(lowers), pick(lowers),
      pick(digits), pick(digits), pick(digits), pick(digits),
    ];
    chars.shuffle(rand);
    return chars.join();
  }

  Future<void> _submit() async {
    setState(() => _loading = true);
    try {
      // Ensure driver has an account and token. If not logged in, register first.
      String? token = await AuthService.getToken();
      if (token == null || token.isEmpty) {
        final phone = _phoneCtrl.text.trim();
        final name = _nameCtrl.text.trim();
        if (phone.length != 10) throw Exception('Enter a valid 10-digit phone number');
        if (name.length < 2) throw Exception('Please enter your full name');
        final regRes = await AuthService.registerWithPassword(
          phone,
          _generatePassword(),
          name,
          referralCode: _referralCtrl.text.trim(),
        );
        if (regRes['success'] != true) {
          throw Exception(regRes['message'] ?? 'Registration failed. Try again.');
        }
        token = await AuthService.getToken();
      }

      final authHeaders = await AuthService.getHeaders();
      final headers = {...authHeaders, 'Content-Type': 'application/json'};

      // 1. Update Profile Fields
      final profileRes = await http.patch(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/update-registration'),
        headers: headers,
        body: jsonEncode({
          'name': _nameCtrl.text.trim(),
          'dob': _dob?.toIso8601String(),
          'licenseNumber': _licenseNumCtrl.text.trim(),
          'vehicleBrand': _vehicleBrandCtrl.text.trim(),
          'vehicleModel': _vehicleModelCtrl.text.trim(),
          'vehicleColor': _vehicleColorCtrl.text.trim(),
          'vehicleYear': int.tryParse(_vehicleYearCtrl.text.trim()),
          'vehicleNumber': _vehicleNumCtrl.text.trim().toUpperCase(),
          'vehicleType': _vehicleType,
          'carShareEnabled': _carShareEnabled,
          'intercityEnabled': _intercityEnabled,
        }),
      );

      if (profileRes.statusCode != 200) {
        String msg = 'Failed to update profile';
        try {
          if ((profileRes.headers['content-type'] ?? '').contains('application/json')) {
            final decoded = jsonDecode(profileRes.body);
            msg = decoded['message'] ?? msg;
          }
        } catch (_) {}
        throw Exception(msg);
      }

      // 2. Upload Documents
      final docs = {
        'dl_front': _dlFront,
        'dl_back': _dlBack,
        'rc': _rcPhoto,
        'selfie': _selfiePhoto,
      };

      for (var entry in docs.entries) {
        if (entry.value != null) {
          final b64 = await _fileToBase64(entry.value);
          final uploadRes = await http.post(
            Uri.parse('${ApiConfig.baseUrl}/api/app/driver/upload-document-base64'),
            headers: headers,
            body: jsonEncode({'docType': entry.key, 'imageData': b64}),
          );
          if (uploadRes.statusCode != 200) {
            String msg = 'Failed to upload ${entry.key}';
            try {
              if ((uploadRes.headers['content-type'] ?? '').contains('application/json')) {
                final decoded = jsonDecode(uploadRes.body);
                msg = decoded['message'] ?? msg;
              }
            } catch (_) {}
            throw Exception(msg);
          }
          try {
            final decoded = jsonDecode(uploadRes.body);
            if (decoded is! Map || decoded['success'] != true) {
              throw Exception('Failed to upload ${entry.key}');
            }
          } catch (_) {
            throw Exception('Failed to upload ${entry.key}');
          }
        }
      }

      if (!mounted) return;
      Navigator.pushAndRemoveUntil(context, MaterialPageRoute(builder: (_) => const PendingVerificationScreen()), (_) => false);
    } catch (e) {
      _showSnack(e.toString(), error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bg,
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            Expanded(
              child: PageView(
                controller: _pageController,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  _buildStep1(),
                  _buildStep2(),
                  _buildStep3(),
                  _buildStep4(),
                  _buildStep5(),
                ],
              ),
            ),
            _buildBottomNav(),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (_currentStep > 0)
                GestureDetector(
                  onTap: _loading ? null : _goBack,
                  child: Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: JT.surfaceAlt,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: JT.border),
                    ),
                    child: Icon(Icons.arrow_back_rounded, color: JT.textPrimary, size: 20),
                  ),
                )
              else
                const SizedBox(width: 38),
              const SizedBox(width: 14),
              Expanded(
                child: Row(
                  children: List.generate(_totalSteps, (i) => Expanded(
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 250),
                      margin: EdgeInsets.only(right: i == _totalSteps - 1 ? 0 : 6),
                      height: 5,
                      decoration: BoxDecoration(
                        color: i <= _currentStep ? JT.primary : JT.border,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                  )),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Text(
            'STEP ${_currentStep + 1} OF $_totalSteps',
            style: JT.caption.copyWith(color: JT.primary, fontWeight: FontWeight.w600, letterSpacing: 1.2),
          ),
          const SizedBox(height: 4),
          Text(_stepTitles[_currentStep], style: JT.h4),
          const SizedBox(height: 4),
          Text(_stepSubtitles[_currentStep], style: JT.body),
        ],
      ),
    );
  }

  Widget _buildBottomNav() {
    final isLast = _currentStep == _totalSteps - 1;
    final continueEnabled = !_loading && _canContinue;
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
      decoration: BoxDecoration(
        color: JT.bg,
        border: Border(top: BorderSide(color: JT.border)),
      ),
      child: Row(
        children: [
          if (_currentStep > 0) ...[
            Expanded(
              child: SizedBox(
                height: 54,
                child: OutlinedButton(
                  onPressed: _loading ? null : _goBack,
                  style: OutlinedButton.styleFrom(
                    side: BorderSide(color: JT.border),
                    foregroundColor: JT.textPrimary,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  child: Text('Back', style: JT.bodyPrimary.copyWith(fontWeight: FontWeight.w500)),
                ),
              ),
            ),
            const SizedBox(width: 12),
          ],
          Expanded(
            flex: _currentStep > 0 ? 2 : 1,
            child: SizedBox(
              height: 54,
              child: ElevatedButton(
                onPressed: continueEnabled ? _goNext : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: JT.primary,
                  disabledBackgroundColor: JT.border,
                  elevation: 0,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                child: _loading
                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                    : Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            isLast ? 'Submit Application' : 'Continue',
                            style: JT.btnText.copyWith(color: continueEnabled ? Colors.white : JT.iconInactive),
                          ),
                          const SizedBox(width: 8),
                          Icon(
                            isLast ? Icons.check_rounded : Icons.arrow_forward_rounded,
                            size: 19,
                            color: continueEnabled ? Colors.white : JT.iconInactive,
                          ),
                        ],
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── Step 1: Personal Information ──────────────────────────────────────
  Widget _buildStep1() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _textField(
            label: 'Full Name',
            controller: _nameCtrl,
            icon: Icons.person_outline,
            capitalization: TextCapitalization.words,
          ),
          const SizedBox(height: 16),
          _phoneField(),
          const SizedBox(height: 16),
          _dobField(),
          const SizedBox(height: 16),
          _textField(
            label: 'Referral Code (Optional)',
            controller: _referralCtrl,
            icon: Icons.card_giftcard_outlined,
            capitalization: TextCapitalization.characters,
          ),
        ],
      ),
    );
  }

  // ── Step 2: Driving Licence ────────────────────────────────────────────
  Widget _buildStep2() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _textField(
            label: 'Driving Licence Number',
            controller: _licenseNumCtrl,
            icon: Icons.badge_outlined,
            capitalization: TextCapitalization.characters,
          ),
          const SizedBox(height: 20),
          Text('Licence Photos', style: JT.bodyPrimary.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text('Make sure all four corners and the text are clearly visible.', style: JT.caption),
          const SizedBox(height: 12),
          _uploadCard(
            label: 'Front Side',
            hint: 'Upload the front of your licence',
            file: _dlFront,
            onCamera: () => _pickImage('dl_front', ImageSource.camera),
            onGallery: () => _pickImage('dl_front', ImageSource.gallery),
          ),
          const SizedBox(height: 14),
          _uploadCard(
            label: 'Back Side',
            hint: 'Upload the back of your licence',
            file: _dlBack,
            onCamera: () => _pickImage('dl_back', ImageSource.camera),
            onGallery: () => _pickImage('dl_back', ImageSource.gallery),
          ),
        ],
      ),
    );
  }

  // ── Step 3: Vehicle Details ────────────────────────────────────────────
  Widget _buildStep3() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _textField(
            label: 'Vehicle Brand',
            controller: _vehicleBrandCtrl,
            icon: Icons.directions_car_outlined,
            capitalization: TextCapitalization.words,
          ),
          const SizedBox(height: 16),
          _textField(
            label: 'Vehicle Model',
            controller: _vehicleModelCtrl,
            icon: Icons.model_training_outlined,
            capitalization: TextCapitalization.words,
          ),
          const SizedBox(height: 16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _textField(
                  label: 'Color',
                  controller: _vehicleColorCtrl,
                  icon: Icons.color_lens_outlined,
                  capitalization: TextCapitalization.words,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: _textField(
                  label: 'Year',
                  controller: _vehicleYearCtrl,
                  icon: Icons.calendar_today_outlined,
                  keyboard: TextInputType.number,
                  formatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          _textField(
            label: 'Vehicle Number',
            controller: _vehicleNumCtrl,
            icon: Icons.numbers_outlined,
            capitalization: TextCapitalization.characters,
          ),
          const SizedBox(height: 16),
          _vehicleTypeField(),
          const SizedBox(height: 16),
          _capabilityToggle(
            icon: Icons.people_alt_outlined,
            title: 'Enable Car Share',
            subtitle:
                'Allow this vehicle to receive bookings where passengers reserve individual seats, in addition to normal full-vehicle bookings. You can change this anytime later from your profile.',
            value: _carShareEnabled,
            onChanged: (v) => setState(() => _carShareEnabled = v),
          ),
          const SizedBox(height: 14),
          _capabilityToggle(
            icon: Icons.alt_route_outlined,
            title: 'Enable Intercity',
            subtitle:
                'Allow this vehicle to receive long-distance bookings between cities, where passengers reserve one or more seats or the whole vehicle. You can change this anytime later from your profile.',
            value: _intercityEnabled,
            onChanged: (v) => setState(() => _intercityEnabled = v),
          ),
        ],
      ),
    );
  }

  // ── Step 4: Vehicle Documents ──────────────────────────────────────────
  Widget _buildStep4() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Registration Certificate', style: JT.bodyPrimary.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text("Upload a clear photo of your vehicle's RC.", style: JT.caption),
          const SizedBox(height: 12),
          _uploadCard(
            label: 'RC Photo',
            hint: 'Take a photo or choose from gallery',
            file: _rcPhoto,
            onCamera: () => _pickImage('rc', ImageSource.camera),
            onGallery: () => _pickImage('rc', ImageSource.gallery),
          ),
        ],
      ),
    );
  }

  // ── Step 5: Live Selfie ────────────────────────────────────────────────
  Widget _buildStep5() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: JT.surfaceAlt,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: JT.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Icon(Icons.info_outline, color: JT.primary, size: 18),
                  const SizedBox(width: 8),
                  Text('Before you take the selfie', style: JT.bodyPrimary.copyWith(fontWeight: FontWeight.w600)),
                ]),
                const SizedBox(height: 10),
                ..._selfieTips.map((t) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.check_circle_outline, size: 15, color: JT.success),
                      const SizedBox(width: 8),
                      Expanded(child: Text(t, style: JT.body)),
                    ],
                  ),
                )),
              ],
            ),
          ),
          const SizedBox(height: 32),
          Center(
            child: GestureDetector(
              onTap: () => _pickImage('selfie', ImageSource.camera),
              child: Stack(
                children: [
                  Container(
                    width: 200,
                    height: 200,
                    decoration: BoxDecoration(
                      color: JT.surfaceAlt,
                      shape: BoxShape.circle,
                      border: Border.all(color: _selfiePhoto != null ? JT.success : JT.primary, width: 2.5),
                      image: _selfiePhoto != null
                          ? DecorationImage(image: FileImage(_selfiePhoto!), fit: BoxFit.cover)
                          : null,
                    ),
                    child: _selfiePhoto == null
                        ? Icon(Icons.person_outline, size: 70, color: JT.iconInactive)
                        : null,
                  ),
                  Positioned(
                    bottom: 6,
                    right: 6,
                    child: Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: JT.primary,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 3),
                      ),
                      child: Icon(
                        _selfiePhoto == null ? Icons.camera_alt_rounded : Icons.refresh_rounded,
                        color: Colors.white,
                        size: 20,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Center(
            child: Text(
              _selfiePhoto == null ? 'Tap to take a selfie' : 'Looks good! Tap to retake',
              style: JT.bodyPrimary.copyWith(fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }

  // ── Shared field widgets ───────────────────────────────────────────────

  Widget _textField({
    required String label,
    required TextEditingController controller,
    required IconData icon,
    TextInputType keyboard = TextInputType.text,
    List<TextInputFormatter>? formatters,
    TextCapitalization capitalization = TextCapitalization.none,
    Widget? suffix,
    bool obscure = false,
  }) {
    return TextField(
      controller: controller,
      keyboardType: keyboard,
      inputFormatters: formatters,
      textCapitalization: capitalization,
      obscureText: obscure,
      onChanged: (_) => setState(() {}),
      style: JT.bodyPrimary,
      decoration: InputDecoration(
        labelText: label,
        labelStyle: JT.body,
        prefixIcon: Icon(icon, color: JT.primary, size: 20),
        suffixIcon: suffix,
        filled: true,
        fillColor: JT.surfaceAlt,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: JT.border)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: JT.border)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: JT.primary, width: 1.8)),
      ),
    );
  }

  Widget _phoneField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _phoneCtrl,
          keyboardType: TextInputType.phone,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
          onChanged: (_) => setState(() {}),
          style: JT.bodyPrimary,
          decoration: InputDecoration(
            labelText: 'Mobile Number',
            labelStyle: JT.body,
            prefixIcon: Padding(
              padding: const EdgeInsets.only(left: 16, right: 8),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.phone_outlined, color: JT.primary, size: 20),
                  const SizedBox(width: 8),
                  Text('+91', style: JT.bodyPrimary.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(width: 8),
                  Container(width: 1, height: 18, color: JT.border),
                ],
              ),
            ),
            prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
            filled: true,
            fillColor: JT.surfaceAlt,
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: JT.border)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: JT.border)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: JT.primary, width: 1.8)),
          ),
        ),
        if (_phoneCtrl.text.isNotEmpty && _phoneCtrl.text.length < 10)
          Padding(
            padding: const EdgeInsets.only(top: 6, left: 4),
            child: Row(children: [
              Icon(Icons.error_outline, size: 13, color: JT.error),
              const SizedBox(width: 4),
              Text('Enter a valid 10-digit mobile number', style: JT.caption.copyWith(color: JT.error)),
            ]),
          ),
      ],
    );
  }

  Widget _dobField() {
    return GestureDetector(
      onTap: _pickDob,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: JT.surfaceAlt,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: JT.border),
        ),
        child: Row(
          children: [
            Icon(Icons.calendar_today_outlined, color: JT.primary, size: 20),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('Date of Birth', style: JT.caption),
                  const SizedBox(height: 2),
                  Text(
                    _dob == null ? 'Select your date of birth' : DateFormat('dd MMM yyyy').format(_dob!),
                    style: _dob == null ? JT.body : JT.bodyPrimary.copyWith(fontWeight: FontWeight.w500),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, color: JT.iconInactive),
          ],
        ),
      ),
    );
  }

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: _dob ?? now.subtract(const Duration(days: 9855)),
      firstDate: DateTime(1940),
      lastDate: now.subtract(const Duration(days: 6570)),
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(primary: JT.primary, surface: Colors.white),
        ),
        child: child!,
      ),
    );
    if (d != null) setState(() => _dob = d);
  }

  Widget _vehicleTypeField() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: JT.surfaceAlt,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: JT.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('Type of Vehicle', style: JT.caption),
          DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: _vehicleType,
              isExpanded: true,
              icon: Icon(Icons.keyboard_arrow_down_rounded, color: JT.iconInactive),
              dropdownColor: Colors.white,
              borderRadius: BorderRadius.circular(14),
              items: _vehicleTypeOptions.map((s) => DropdownMenuItem(
                value: s,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(_vehicleTypeIcons[s] ?? Icons.directions_car_outlined, size: 18, color: JT.primary),
                    const SizedBox(width: 10),
                    Text(_titleCase(s), style: JT.bodyPrimary),
                  ],
                ),
              )).toList(),
              onChanged: (v) => setState(() => _vehicleType = v!),
            ),
          ),
        ],
      ),
    );
  }

  String _titleCase(String s) {
    const upperAcronyms = {'suv', 'xl'};
    if (upperAcronyms.contains(s)) return s.toUpperCase();
    return s[0].toUpperCase() + s.substring(1);
  }

  Widget _capabilityToggle({
    required IconData icon,
    required String title,
    required String subtitle,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: JT.surfaceAlt,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10), border: Border.all(color: JT.border)),
            child: Icon(icon, color: JT.primary, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: JT.bodyPrimary.copyWith(fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text(subtitle, style: JT.caption),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Switch(
            value: value,
            activeThumbColor: JT.primary,
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }

  Widget _uploadCard({
    required String label,
    required String hint,
    required File? file,
    required VoidCallback onCamera,
    required VoidCallback onGallery,
  }) {
    final hasFile = file != null;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: JT.surfaceAlt,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: hasFile ? JT.success.withValues(alpha: 0.4) : JT.border, width: hasFile ? 1.5 : 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(label, style: JT.bodyPrimary.copyWith(fontWeight: FontWeight.w600))),
              if (hasFile)
                Row(children: [
                  Icon(Icons.check_circle, size: 16, color: JT.success),
                  const SizedBox(width: 4),
                  Text('Uploaded', style: TextStyle(fontSize: 12, color: JT.success, fontWeight: FontWeight.w500)),
                ]),
            ],
          ),
          const SizedBox(height: 10),
          if (hasFile)
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.file(file, height: 150, width: double.infinity, fit: BoxFit.cover),
            )
          else
            Container(
              height: 120,
              width: double.infinity,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: JT.border),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.add_a_photo_outlined, color: JT.iconInactive, size: 28),
                  const SizedBox(height: 6),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Text(hint, style: JT.caption, textAlign: TextAlign.center),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _uploadActionBtn(
                  icon: Icons.photo_camera_outlined,
                  label: hasFile ? 'Retake' : 'Take Photo',
                  onTap: onCamera,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _uploadActionBtn(
                  icon: Icons.photo_library_outlined,
                  label: hasFile ? 'Replace' : 'Gallery',
                  onTap: onGallery,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _uploadActionBtn({required IconData icon, required String label, required VoidCallback onTap}) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 16, color: JT.primary),
      label: Text(label, style: TextStyle(fontSize: 12.5, color: JT.primary, fontWeight: FontWeight.w500)),
      style: OutlinedButton.styleFrom(
        side: BorderSide(color: JT.primary.withValues(alpha: 0.4)),
        backgroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(vertical: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }
}
