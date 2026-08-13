import 'dart:io';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';
import 'package:camera/camera.dart';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../services/auth_service.dart';

class FaceVerificationScreen extends StatefulWidget {
  final String reason;
  final VoidCallback onVerified;
  const FaceVerificationScreen({super.key, required this.reason, required this.onVerified});

  @override
  State<FaceVerificationScreen> createState() => _FaceVerificationScreenState();
}

class _FaceVerificationScreenState extends State<FaceVerificationScreen> with SingleTickerProviderStateMixin {
  CameraController? _camCtrl;
  List<CameraDescription> _cameras = [];
  File? _selfieFile;
  bool _loading = false;
  bool _cameraReady = false;
  bool _submitted = false;
  String? _error;
  late AnimationController _pulseCtrl;
  late Animation<double> _pulse;
  int _countdown = 3;
  Timer? _countdownTimer;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))..repeat(reverse: true);
    _pulse = Tween<double>(begin: 1.0, end: 1.05).animate(CurvedAnimation(parent: _pulseCtrl, curve: Curves.easeInOut));
    _initCamera();
  }

  Future<void> _initCamera() async {
    try {
      _cameras = await availableCameras();
      final front = _cameras.firstWhere((c) => c.lensDirection == CameraLensDirection.front, orElse: () => _cameras.first);
      _camCtrl = CameraController(front, ResolutionPreset.high, enableAudio: false);
      await _camCtrl!.initialize();
      if (mounted) setState(() => _cameraReady = true);
    } catch (e) {
      if (mounted) setState(() => _error = 'Camera not available. Please allow camera access.');
    }
  }

  Future<void> _takeSelfie() async {
    if (_camCtrl == null || !_camCtrl!.value.isInitialized) return;
    setState(() => _countdown = 3);
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (t) async {
      if (!mounted) { t.cancel(); return; }
      if (_countdown <= 1) {
        t.cancel();
        try {
          final photo = await _camCtrl!.takePicture();
          if (mounted) setState(() { _selfieFile = File(photo.path); _countdown = 0; });
        } catch (e) {
          if (mounted) setState(() => _error = 'Failed to capture. Try again.');
        }
      } else {
        if (mounted) setState(() => _countdown--);
      }
    });
  }

  Future<void> _submitSelfie() async {
    if (_selfieFile == null) return;
    setState(() { _loading = true; _error = null; });
    try {
      final faceHeaders = await AuthService.getHeaders();
      final request = http.MultipartRequest('POST', Uri.parse(ApiConfig.faceVerify));
      request.headers.addAll(faceHeaders);
      request.files.add(await http.MultipartFile.fromPath('selfie', _selfieFile!.path));
      final streamedResponse = await request.send();
      final body = await streamedResponse.stream.bytesToString();
      if (streamedResponse.statusCode == 200) {
        if (mounted) setState(() { _submitted = true; _loading = false; });
        await Future.delayed(const Duration(milliseconds: 1500));
        if (mounted) widget.onVerified();
      } else {
        String msg = 'Verification failed. Try again.';
        try {
          if (body.trimLeft().startsWith('{')) {
            final data = jsonDecode(body) as Map<String, dynamic>;
            msg = data['message'] ?? msg;
          }
        } catch (_) {}
        if (mounted) setState(() { _error = msg; _loading = false; });
      }
    } catch (e) {
      if (mounted) setState(() { _error = 'Network error. Please check connection.'; _loading = false; });
    }
  }

  @override
  void dispose() {
    _camCtrl?.dispose();
    _pulseCtrl.dispose();
    _countdownTimer?.cancel();
    super.dispose();
  }

  String get _reasonText {
    switch (widget.reason) {
      case 'first_time': return 'First-time verification required';
      case 'daily_check': return 'Daily safety check — start your day!';
      case 'after_10_trips': return '10 trips completed — quick safety check!';
      default: return 'Safety verification required';
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_submitted) {
      return Scaffold(
        backgroundColor: JT.textPrimary,
        body: Center(
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Container(width: 100, height: 100, decoration: BoxDecoration(color: const Color(0xFF16A34A).withValues(alpha: 0.2), shape: BoxShape.circle),
              child: const Icon(Icons.verified_user, color: Color(0xFF22C55E), size: 56)),
            const SizedBox(height: 20),
            const Text('Verified! ✅', style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w500)),
            const SizedBox(height: 8),
            const Text('Identity confirmed. You can start riding!', style: TextStyle(color: Color(0xFF64748B), fontSize: 14)),
          ]),
        ),
      );
    }

    return Scaffold(
      backgroundColor: JT.textPrimary,
      appBar: AppBar(
        backgroundColor: JT.textPrimary,
        title: const Text('Safety Verification', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w500)),
        centerTitle: true,
        automaticallyImplyLeading: false,
      ),
      body: SafeArea(
        child: Column(
          children: [
            Container(
              margin: const EdgeInsets.all(16),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFF1E3A5F).withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: const Color(0xFF2563EB).withValues(alpha: 0.5)),
              ),
              child: Row(children: [
                const Icon(Icons.shield_outlined, color: Color(0xFF3B82F6), size: 22),
                const SizedBox(width: 10),
                Expanded(child: Text(_reasonText, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13))),
              ]),
            ),
            Expanded(
              child: _selfieFile != null
                  ? _buildPreview()
                  : _cameraReady
                      ? _buildCamera()
                      : _error != null
                          ? _buildError()
                          : const Center(child: CircularProgressIndicator(color: Color(0xFF3B82F6))),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCamera() {
    return Stack(
      alignment: Alignment.center,
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24),
            child: CameraPreview(_camCtrl!),
          ),
        ),
        Positioned(
          child: AnimatedBuilder(
            animation: _pulse,
            builder: (_, child) => Transform.scale(
              scale: _pulse.value,
              child: Container(
                width: 260, height: 320,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(140),
                  border: Border.all(color: const Color(0xFF3B82F6), width: 3),
                  color: Colors.transparent,
                ),
              ),
            ),
          ),
        ),
        if (_countdown < 3 && _countdown > 0)
          Center(
            child: Text('$_countdown', style: const TextStyle(color: Color(0xFF3B82F6), fontSize: 80, fontWeight: FontWeight.w500)),
          ),
        Positioned(
          bottom: 40,
          child: Column(children: [
            const Text('Position your face in the oval', style: TextStyle(color: Colors.white70, fontSize: 13)),
            const SizedBox(height: 16),
            GestureDetector(
              onTap: _countdown == 3 ? _takeSelfie : null,
              child: Container(
                width: 72, height: 72,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFF3B82F6), width: 3),
                  color: const Color(0xFF2563EB).withValues(alpha: 0.2),
                ),
                child: Center(
                  child: Container(
                    width: 54, height: 54,
                    decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFF2563EB)),
                    child: const Icon(Icons.camera_alt, color: Colors.white, size: 26),
                  ),
                ),
              ),
            ),
          ]),
        ),
      ],
    );
  }

  Widget _buildPreview() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(children: [
        Expanded(
          child: Stack(
            alignment: Alignment.center,
            children: [
              ClipOval(
                child: Container(
                  width: 260, height: 260,
                  child: Image.file(_selfieFile!, fit: BoxFit.cover),
                ),
              ),
              Positioned(
                bottom: 60,
                child: Container(
                  width: 260,
                  height: 260,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFF22C55E), width: 4),
                  ),
                ),
              ),
            ],
          ),
        ),
        if (_error != null) Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 13)),
        const SizedBox(height: 20),
        Row(children: [
          Expanded(
            child: OutlinedButton(
              onPressed: () => setState(() { _selfieFile = null; _countdown = 3; }),
              style: OutlinedButton.styleFrom(foregroundColor: const Color(0xFF94A3B8), side: const BorderSide(color: Color(0xFF1E3A5F)), padding: const EdgeInsets.symmetric(vertical: 14), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
              child: const Text('Retake'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: ElevatedButton.icon(
              onPressed: _loading ? null : _submitSelfie,
              icon: _loading ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.verified_user, size: 18),
              label: Text(_loading ? 'Verifying...' : 'Verify Identity', style: const TextStyle(fontWeight: FontWeight.w500)),
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2563EB), foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(vertical: 14), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), elevation: 0),
            ),
          ),
        ]),
      ]),
    );
  }

  Widget _buildError() {
    return Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      const Icon(Icons.camera_alt_outlined, color: Color(0xFF334155), size: 60),
      const SizedBox(height: 16),
      Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF64748B), fontSize: 14)),
      const SizedBox(height: 20),
      ElevatedButton(onPressed: _initCamera, style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2563EB), foregroundColor: Colors.white), child: const Text('Retry')),
    ]));
  }
}
