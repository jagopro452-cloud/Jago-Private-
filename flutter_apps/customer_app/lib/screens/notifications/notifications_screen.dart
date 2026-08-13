import 'dart:convert';
import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../services/auth_service.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool _loading = true;
  List<dynamic> _notifications = [];

  static const Color _blue = Color(0xFF2F7BFF);

  @override
  void initState() {
    super.initState();
    _fetch();
  }

  Future<void> _fetch() async {
    if (mounted) setState(() => _loading = true);
    final headers = await AuthService.getHeaders();
    try {
      final res = await http.get(Uri.parse(ApiConfig.notifications),
          headers: headers);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (mounted) setState(() {
          _notifications = List<dynamic>.from(data['notifications'] ?? data ?? []);
          _loading = false;
        });
      } else {
        if (mounted) setState(() => _loading = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _markAllRead() async {
    try {
      final headers = await AuthService.getHeaders();
      await http.patch(Uri.parse(ApiConfig.notificationsReadAll),
          headers: headers);
    } catch (_) {
      // Best-effort - the unread dots simply won't clear; _fetch() below
      // will show the true current state either way.
    }
    _fetch();
  }

  IconData _iconForType(String? type) {
    switch (type) {
      case 'trip_new': return Icons.directions_car_rounded;
      case 'trip_accepted': return Icons.check_circle_rounded;
      case 'trip_completed': return Icons.flag_rounded;
      case 'trip_cancelled': return Icons.cancel_rounded;
      case 'payment': return Icons.payment_rounded;
      case 'promo': return Icons.local_offer_rounded;
      case 'wallet': return Icons.account_balance_wallet_rounded;
      default: return Icons.notifications_rounded;
    }
  }

  Color _colorForType(String? type) {
    switch (type) {
      case 'trip_accepted': return Colors.green;
      case 'trip_completed': return Colors.teal;
      case 'trip_cancelled': return Colors.red;
      case 'payment': case 'wallet': return Colors.blue;
      case 'promo': return Colors.orange;
      default: return _blue;
    }
  }

  String _timeAgo(String? dateStr) {
    if (dateStr == null) return '';
    try {
      final dt = DateTime.parse(dateStr).toLocal();
      final diff = DateTime.now().difference(dt);
      if (diff.inMinutes < 1) return 'Just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      return '${diff.inDays}d ago';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    
    final bg = Colors.white;
    final textColor = JT.textPrimary;
    final subColor = JT.textSecondary;

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.transparent,
        foregroundColor: JT.textPrimary,
        title: const Text('Notifications', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 18)),
        elevation: 0,
        centerTitle: false,
        actions: [
          if (_notifications.isNotEmpty)
            TextButton(
              onPressed: _markAllRead,
              style: TextButton.styleFrom(foregroundColor: _blue),
              child: const Text('Mark all read', style: TextStyle(fontWeight: FontWeight.w500, fontSize: 13)),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: _blue))
          : _notifications.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(24),
                        decoration: BoxDecoration(color: const Color(0xFFF1F5F9), shape: BoxShape.circle),
                        child: Icon(Icons.notifications_none_rounded, size: 48, color: const Color(0xFF94A3B8)),
                      ),
                      const SizedBox(height: 24),
                      Text('No Notifications Yet', style: TextStyle(color: textColor, fontSize: 18, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 8),
                      Text('We\'ll let you know when something\nimportant happens.', textAlign: TextAlign.center, style: TextStyle(color: subColor, fontSize: 14)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _fetch,
                  color: _blue,
                  backgroundColor: Colors.white,
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    itemCount: _notifications.length,
                    separatorBuilder: (_, __) => const Divider(height: 16, color: Color(0xFFF1F5F9)),
                    itemBuilder: (_, i) {
                      final n = _notifications[i] as Map<String, dynamic>;
                      final isRead = n['is_read'] == true || n['isRead'] == true;
                      final type = n['type']?.toString();
                      final color = _colorForType(type);
                      return Container(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: ListTile(
                          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          leading: Container(
                            width: 42, height: 42,
                            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
                            child: Icon(_iconForType(type), color: color, size: 22),
                          ),
                          title: Text(
                            n['title']?.toString() ?? '',
                            style: TextStyle(fontWeight: isRead ? FontWeight.w500 : FontWeight.w500, color: textColor, fontSize: 14),
                          ),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const SizedBox(height: 2),
                              Text(n['body']?.toString() ?? n['message']?.toString() ?? '',
                                  style: TextStyle(color: subColor, fontSize: 12)),
                              const SizedBox(height: 4),
                              Text(_timeAgo(n['created_at']?.toString() ?? n['createdAt']?.toString()),
                                  style: TextStyle(color: subColor, fontSize: 11)),
                            ],
                          ),
                          trailing: !isRead
                              ? Container(width: 8, height: 8,
                                  decoration: const BoxDecoration(color: JT.primary, shape: BoxShape.circle))
                              : null,
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
