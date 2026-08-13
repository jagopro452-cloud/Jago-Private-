import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

class LostFoundScreen extends StatefulWidget {
  const LostFoundScreen({super.key});
  @override
  State<LostFoundScreen> createState() => _LostFoundScreenState();
}

class _LostFoundScreenState extends State<LostFoundScreen> {
  bool _loading = true;
  bool _submitting = false;
  List _reports = [];
  final _formKey = GlobalKey<FormState>();
  final _descCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  String? _selectedTripId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _descCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse('${ApiConfig.baseUrl}/api/app/customer/lost-found'), headers: headers);
      if (res.statusCode == 200 && mounted) setState(() => _reports = jsonDecode(res.body));
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/lost-found'),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({
          'tripId': _selectedTripId,
          'description': _descCtrl.text.trim(),
          'contactPhone': _phoneCtrl.text.trim(),
        }),
      );
      if (!mounted) return;
      final body = jsonDecode(res.body);
      final messenger = ScaffoldMessenger.of(context);
      if (res.statusCode == 200) {
        Navigator.pop(context);
        messenger.showSnackBar(SnackBar(
          content: Text(body['message'] ?? 'Report submitted!'),
          backgroundColor: JT.success,
          duration: const Duration(seconds: 5),
        ));
        _load();
      } else {
        messenger.showSnackBar(SnackBar(content: Text(body['message'] ?? 'Failed'), backgroundColor: JT.error));
      }
    } catch (_) {}
    if (mounted) setState(() => _submitting = false);
  }

  void _showReportSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: Container(
          decoration: BoxDecoration(color: JT.bg, borderRadius: BorderRadius.vertical(top: Radius.circular(JT.radiusXl + 4))),
          constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.9),
          padding: EdgeInsets.all(JT.spacing24),
          child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  Text('Report Lost Item', style: JT.h4),
                  IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context)),
                ]),
                SizedBox(height: JT.spacing8),
                Container(
                  padding: EdgeInsets.all(JT.spacing12),
                  decoration: BoxDecoration(color: JT.warningLight, borderRadius: BorderRadius.circular(JT.radiusSm + 2)),
                  child: Row(children: [
                    Icon(Icons.info_outline, color: JT.warning, size: 18),
                    SizedBox(width: JT.spacing8),
                    Expanded(child: Text('We will contact the driver and get back to you within 2 hours.', style: JT.caption.copyWith(color: JT.warning))),
                  ]),
                ),
                SizedBox(height: JT.spacing16),
                Text('What did you lose?', style: JT.bodyPrimary),
                SizedBox(height: JT.spacing8),
                TextFormField(
                  controller: _descCtrl,
                  maxLines: 3,
                  decoration: JT.modernInputDecoration(
                    labelText: '',
                    hintText: 'e.g., Black leather wallet, iPhone 14 Pro, Laptop bag...',
                  ),
                  validator: (v) => v == null || v.isEmpty ? 'Please describe the item' : null,
                ),
                SizedBox(height: JT.spacing12),
                Text('Contact Phone', style: JT.bodyPrimary),
                SizedBox(height: JT.spacing8),
                TextFormField(
                  controller: _phoneCtrl,
                  keyboardType: TextInputType.phone,
                  decoration: JT.modernInputDecoration(
                    labelText: '',
                    hintText: '9876543210',
                    prefixIcon: const Icon(Icons.phone),
                  ),
                ),
                SizedBox(height: JT.spacing20),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _submitting ? null : _submit,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: JT.primary,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(JT.radiusMd)),
                      padding: EdgeInsets.symmetric(vertical: JT.spacing16 - 2),
                    ),
                    child: _submitting
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : Text('Submit Report', style: JT.btnText),
                  ),
                ),
              ],
            ),
          ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.surfaceAlt,
      appBar: AppBar(
        backgroundColor: JT.bg,
        foregroundColor: JT.textPrimary,
        elevation: 0,
        title: Text('Lost & Found', style: JT.h4),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showReportSheet,
        backgroundColor: JT.primary,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add),
        label: const Text('Report Lost Item'),
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: JT.primary))
          : _reports.isEmpty
              ? _emptyState()
              : ListView.builder(
                  padding: EdgeInsets.all(JT.spacing16),
                  itemCount: _reports.length + 2,
                  itemBuilder: (context, index) {
                    if (index == 0) return Text('Your Reports', style: JT.h5);
                    if (index == 1) return SizedBox(height: JT.spacing12);
                    return _reportCard(_reports[index - 2]);
                  },
                ),
    );
  }

  Widget _emptyState() => Center(
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      Container(
        padding: EdgeInsets.all(JT.spacing24),
        decoration: BoxDecoration(color: JT.primary.withValues(alpha: 0.1), shape: BoxShape.circle),
        child: Icon(Icons.search, size: 64, color: JT.primary),
      ),
      SizedBox(height: JT.spacing16),
      Text('Lost something?', style: JT.h3),
      SizedBox(height: JT.spacing8),
      Text('Report lost items from your recent\nrides and we\'ll help you find them.',
          textAlign: TextAlign.center, style: JT.body),
      const SizedBox(height: 80),
    ]),
  );

  Widget _reportCard(Map<String, dynamic> r) {
    final status = r['status'] ?? 'open';
    final statusColor = status == 'resolved' ? JT.success : status == 'in_progress' ? JT.primary : JT.warning;
    return Container(
      margin: EdgeInsets.only(bottom: JT.spacing12),
      padding: EdgeInsets.all(JT.spacing16),
      decoration: JT.cardStyle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.inventory_2_outlined, color: JT.primary, size: 20),
            SizedBox(width: JT.spacing8),
            Expanded(child: Text(r['description'] ?? '', style: JT.bodyPrimary, maxLines: 2, overflow: TextOverflow.ellipsis)),
            Container(
              padding: EdgeInsets.symmetric(horizontal: JT.spacing8 + 2, vertical: JT.spacing4),
              decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(JT.radiusXl)),
              child: Text(status.toUpperCase(), style: JT.caption.copyWith(color: statusColor, fontWeight: FontWeight.w500, fontSize: 11)),
            ),
          ]),
          if (r['pickupAddress'] != null) ...[
            SizedBox(height: JT.spacing8),
            Text('Trip: ${r['pickupAddress']} → ${r['destinationAddress'] ?? '...'}',
                style: JT.caption, maxLines: 1, overflow: TextOverflow.ellipsis),
          ],
          if (r['driverName'] != null) ...[
            SizedBox(height: JT.spacing4),
            Text('Driver: ${r['driverName']} • ${r['driverPhone'] ?? ''}', style: JT.caption),
          ],
          SizedBox(height: JT.spacing4),
          Text(r['createdAt']?.toString().substring(0, 10) ?? '', style: JT.caption),
        ],
      ),
    );
  }
}
