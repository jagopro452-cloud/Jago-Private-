import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool _loading = true;
  List<dynamic> _notifications = [];

  static const Color _blue = Color(0xFF2563EB);
  static const Color _surface = JT.surface;
  static const Color _bg = JT.textPrimary;

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
    final headers = await AuthService.getHeaders();
    await http.patch(Uri.parse(ApiConfig.notificationsReadAll),
        headers: headers);
    _fetch();
  }

  IconData _iconForType(String? type) {
    switch (type) {
      case 'trip_new': return Icons.directions_car_rounded;
      case 'trip_accepted': return Icons.check_circle_rounded;
      case 'trip_completed': return Icons.flag_rounded;
      case 'payment': case 'wallet': return Icons.account_balance_wallet_rounded;
      case 'promo': return Icons.local_offer_rounded;
      default: return Icons.notifications_rounded;
    }
  }

  Color _colorForType(String? type) {
    switch (type) {
      case 'trip_new': return _blue;
      case 'trip_accepted': return Colors.green;
      case 'trip_completed': return Colors.teal;
      case 'payment': case 'wallet': return Colors.purple;
      case 'promo': return Colors.orange;
      default: return Colors.grey;
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
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _surface,
        foregroundColor: Colors.white,
        title: const Text('Notifications', style: TextStyle(fontWeight: FontWeight.w500)),
        elevation: 0,
        actions: [
          if (_notifications.isNotEmpty)
            TextButton(
              onPressed: _markAllRead,
              child: const Text('అన్నీ చదివాను', style: TextStyle(color: Colors.white54, fontSize: 12)),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
          : _notifications.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.notifications_none_rounded, size: 80, color: Colors.white24),
                      const SizedBox(height: 16),
                      const Text('Notifications లేవు', style: TextStyle(color: Colors.white38, fontSize: 16)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _fetch,
                  color: _blue,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(12),
                    itemCount: _notifications.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final n = _notifications[i] as Map<String, dynamic>;
                      final isRead = n['is_read'] == true || n['isRead'] == true;
                      final type = n['type']?.toString();
                      final color = _colorForType(type);
                      return Container(
                        decoration: BoxDecoration(
                          color: isRead ? _surface : _blue.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(14),
                          border: isRead ? Border.all(color: Colors.white.withValues(alpha: 0.05)) : Border.all(color: _blue.withValues(alpha: 0.3)),
                        ),
                        child: ListTile(
                          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          leading: Container(
                            width: 42, height: 42,
                            decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(12)),
                            child: Icon(_iconForType(type), color: color, size: 22),
                          ),
                          title: Text(
                            n['title']?.toString() ?? '',
                            style: TextStyle(fontWeight: isRead ? FontWeight.w500 : FontWeight.w500, color: Colors.white, fontSize: 14),
                          ),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const SizedBox(height: 2),
                              Text(n['body']?.toString() ?? n['message']?.toString() ?? '',
                                  style: const TextStyle(color: Colors.white54, fontSize: 12)),
                              const SizedBox(height: 4),
                              Text(_timeAgo(n['created_at']?.toString() ?? n['createdAt']?.toString()),
                                  style: const TextStyle(color: Colors.white38, fontSize: 11)),
                            ],
                          ),
                          trailing: !isRead
                              ? Container(width: 8, height: 8,
                                  decoration: BoxDecoration(color: _blue, shape: BoxShape.circle))
                              : null,
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}
