import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import 'dart:convert';

class KycDocumentsScreen extends StatefulWidget {
  const KycDocumentsScreen({super.key});

  @override
  State<KycDocumentsScreen> createState() => _KycDocumentsScreenState();
}

class _KycDocumentsScreenState extends State<KycDocumentsScreen> {
  Map<String, dynamic> _docStatus = {};
  bool _loading = true;
  final _picker = ImagePicker();
  final Map<String, bool> _uploading = {};

  final List<Map<String, dynamic>> _docs = [
    {'key': 'dl_front', 'label': "Driving License (Front)", 'icon': Icons.credit_card, 'desc': "Front side of DL"},
    {'key': 'dl_back', 'label': "Driving License (Back)", 'icon': Icons.credit_card_outlined, 'desc': "Back side of DL"},
    {'key': 'rc', 'label': "Vehicle RC (Registration)", 'icon': Icons.directions_car, 'desc': "Vehicle Registration Certificate"},
    {'key': 'aadhar_front', 'label': "Aadhar Card (Front)", 'icon': Icons.badge, 'desc': "Front side of Aadhar"},
    {'key': 'aadhar_back', 'label': "Aadhar Card (Back)", 'icon': Icons.badge_outlined, 'desc': "Back side of Aadhar"},
    {'key': 'insurance', 'label': "Vehicle Insurance", 'icon': Icons.security, 'desc': "Valid insurance certificate"},
  ];

  @override
  void initState() {
    super.initState();
    _loadDocuments();
  }

  Future<void> _loadDocuments() async {
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.driverDocuments), headers: headers);
      if (res.statusCode == 200 &&
          (res.headers['content-type'] ?? '').contains('application/json')) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final docs = (data['documents'] as List?) ?? [];
        final statusMap = <String, dynamic>{};
        for (final d in docs) statusMap[d['docType']] = d;
        if (mounted) setState(() { _docStatus = statusMap; _loading = false; });
      } else {
        if (mounted) setState(() => _loading = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _uploadDoc(String docType) async {
    final picked = await _picker.pickImage(source: ImageSource.camera, imageQuality: 80, maxWidth: 1200);
    if (picked == null) return;
    setState(() => _uploading[docType] = true);
    try {
      final authHeaders = await AuthService.getHeaders();
      final request = http.MultipartRequest('POST', Uri.parse(ApiConfig.uploadDocument));
      request.headers.addAll(authHeaders);
      request.fields['docType'] = docType;
      request.files.add(await http.MultipartFile.fromPath('document', picked.path));
      final response = await request.send();
      if (response.statusCode == 200) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: const Text('Document uploaded! Under review.'), backgroundColor: JT.primary));
        await _loadDocuments();
      } else {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: const Text('Upload failed. Please try again.'), backgroundColor: JT.error));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: const Text('Upload failed. Try again.'), backgroundColor: JT.error));
    } finally {
      if (mounted) setState(() => _uploading[docType] = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bg,
      appBar: AppBar(
        backgroundColor: JT.bg,
        title: Text('KYC Documents', style: TextStyle(color: JT.textPrimary, fontWeight: FontWeight.w500)),
        leading: IconButton(icon: Icon(Icons.arrow_back, color: JT.textPrimary), onPressed: () => Navigator.pop(context)),
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: JT.primary))
          : Column(
              children: [
                _buildHeader(),
                Expanded(
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _docs.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (_, i) => _docCard(_docs[i]),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildHeader() {
    final total = _docs.length;
    final uploaded = _docs.where((d) => _docStatus.containsKey(d['key'])).length;
    final approved = _docs.where((d) => _docStatus[d['key']]?['status'] == 'approved').length;
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: JT.grad,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('KYC Progress', style: TextStyle(color: Colors.white70, fontSize: 12)),
            Text('$approved/$total Approved', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 18)),
          ]),
          Container(
            width: 56, height: 56,
            decoration: const BoxDecoration(shape: BoxShape.circle, color: JT.border),
            child: Center(child: Text('${((approved / total) * 100).round()}%', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 14))),
          ),
        ]),
        const SizedBox(height: 10),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(value: approved / total, backgroundColor: JT.border, valueColor: const AlwaysStoppedAnimation(Colors.white), minHeight: 6),
        ),
        const SizedBox(height: 8),
        Text('$uploaded uploaded, ${total - uploaded} pending', style: const TextStyle(color: Colors.white70, fontSize: 12)),
      ]),
    );
  }

  Widget _docCard(Map<String, dynamic> doc) {
    final key = doc['key'] as String;
    final status = _docStatus[key]?['status'] as String?;
    final isUploading = _uploading[key] == true;

    Color statusColor;
    IconData statusIcon;
    String statusText;

    if (status == 'approved') {
      statusColor = const Color(0xFF22C55E);
      statusIcon = Icons.check_circle;
      statusText = 'Approved ✓';
    } else if (status == 'pending') {
      statusColor = Colors.orange;
      statusIcon = Icons.access_time;
      statusText = 'Under Review';
    } else if (status == 'rejected') {
      statusColor = Colors.red;
      statusIcon = Icons.cancel;
      statusText = 'Rejected — Re-upload';
    } else {
      statusColor = const Color(0xFF475569);
      statusIcon = Icons.upload_file;
      statusText = 'Not uploaded';
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: JT.bgSoft,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: status == 'approved' ? const Color(0xFF22C55E).withValues(alpha: 0.3) : JT.border),
      ),
      child: Row(
        children: [
          Container(
            width: 44, height: 44,
            decoration: BoxDecoration(color: JT.border, borderRadius: BorderRadius.circular(12)),
            child: Icon(doc['icon'] as IconData, color: JT.primary, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(doc['label'] as String, style: TextStyle(color: JT.textPrimary, fontWeight: FontWeight.w400, fontSize: 13)),
              const SizedBox(height: 2),
              Row(children: [
                Icon(statusIcon, size: 13, color: statusColor),
                const SizedBox(width: 4),
                Text(statusText, style: TextStyle(color: statusColor, fontSize: 11)),
              ]),
            ]),
          ),
          const SizedBox(width: 8),
          if (status != 'approved')
            GestureDetector(
              onTap: isUploading ? null : () => _uploadDoc(key),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: isUploading ? JT.border : JT.primary,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: isUploading
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : Text(status == 'rejected' ? 'Re-upload' : 'Upload', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w500)),
              ),
            )
          else
            Icon(Icons.check_circle, color: JT.success, size: 28),
        ],
      ),
    );
  }
}
