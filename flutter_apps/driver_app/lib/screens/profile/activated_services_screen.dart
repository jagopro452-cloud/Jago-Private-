import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

class ActivatedServicesScreen extends StatefulWidget {
  const ActivatedServicesScreen({super.key});

  @override
  State<ActivatedServicesScreen> createState() => _ActivatedServicesScreenState();
}

class _ActivatedServicesScreenState extends State<ActivatedServicesScreen> {
  bool _loading = true;
  String? _error;
  List<dynamic> _modules = const [];
  List<dynamic> _missingDocuments = const [];
  Map<String, dynamic>? _dispatchProfile;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.eligibleServices), headers: headers);
      final body = jsonDecode(res.body);
      if (!mounted) return;
      if (res.statusCode == 200) {
        setState(() {
          _modules = List<dynamic>.from(body['modules'] ?? const []);
          _missingDocuments = List<dynamic>.from(body['missingDocuments'] ?? const []);
          _dispatchProfile = body['dispatchProfile'] is Map<String, dynamic>
              ? body['dispatchProfile'] as Map<String, dynamic>
              : null;
          _loading = false;
        });
      } else {
        setState(() {
          _loading = false;
          _error = body['message']?.toString() ?? 'Could not load activated services';
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Network issue while loading activated services';
      });
    }
  }

  String _labelForReason(String reason) {
    switch (reason) {
      case 'documents_missing':
        return 'Required documents are still missing';
      case 'approval_pending':
        return 'Driver approval is still pending';
      case 'admin_or_vehicle_not_enabled':
        return 'Admin or vehicle eligibility is not enabled';
      case 'seat_capacity_low':
        return 'Seat capacity is too low for pooled rides';
      default:
        return reason.replaceAll('_', ' ');
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
        title: Text('Activated Services', style: JT.h4),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: JT.primary))
          : _error != null
              ? Center(child: Text(_error!, style: JT.body))
              : RefreshIndicator(
                  onRefresh: _load,
                  color: JT.primary,
                  child: ListView(
                    padding: const EdgeInsets.all(20),
                    children: [
                      Container(
                        padding: const EdgeInsets.all(18),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          boxShadow: JT.cardShadow,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Dispatch Summary', style: JT.bodyPrimary),
                            const SizedBox(height: 10),
                            Text(
                              'Approval: ${_dispatchProfile?['approvalState'] ?? 'pending'}',
                              style: JT.bodyPrimary,
                            ),
                            const SizedBox(height: 6),
                            Text(
                              'Seat Capacity: ${_dispatchProfile?['seatCapacity'] ?? '-'}',
                              style: JT.body,
                            ),
                            if (_missingDocuments.isNotEmpty) ...[
                              const SizedBox(height: 12),
                              Text('Missing Documents', style: JT.bodyPrimary),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: _missingDocuments
                                    .map((doc) => Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                          decoration: BoxDecoration(
                                            color: JT.error.withValues(alpha: 0.08),
                                            borderRadius: BorderRadius.circular(12),
                                          ),
                                          child: Text(doc.toString(), style: JT.caption.copyWith(color: JT.error)),
                                        ))
                                    .toList(),
                              ),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      ..._modules.map((module) {
                        final reasons = List<dynamic>.from(module['blockedReasons'] ?? const []);
                        final enabled = module['enabled'] == true;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 14),
                          child: Container(
                            padding: const EdgeInsets.all(18),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(20),
                              boxShadow: JT.cardShadow,
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(child: Text(module['label']?.toString() ?? '-', style: JT.bodyPrimary)),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                      decoration: BoxDecoration(
                                        color: enabled ? JT.success.withValues(alpha: 0.1) : JT.warning.withValues(alpha: 0.1),
                                        borderRadius: BorderRadius.circular(14),
                                      ),
                                      child: Text(enabled ? 'Active' : 'Blocked', style: JT.caption.copyWith(color: enabled ? JT.success : JT.warning)),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 10),
                                Text(
                                  module['availableByCategory'] == true
                                      ? 'Vehicle category supports this service.'
                                      : 'Vehicle category does not currently support this service.',
                                  style: JT.body,
                                ),
                                if (reasons.isNotEmpty) ...[
                                  const SizedBox(height: 12),
                                  ...reasons.map((reason) => Padding(
                                        padding: const EdgeInsets.only(bottom: 6),
                                        child: Row(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            const Padding(
                                              padding: EdgeInsets.only(top: 4),
                                              child: Icon(Icons.info_outline_rounded, size: 14, color: JT.textSecondary),
                                            ),
                                            const SizedBox(width: 8),
                                            Expanded(
                                              child: Text(_labelForReason(reason.toString()), style: JT.caption.copyWith(color: JT.textSecondary)),
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
                ),
    );
  }
}
