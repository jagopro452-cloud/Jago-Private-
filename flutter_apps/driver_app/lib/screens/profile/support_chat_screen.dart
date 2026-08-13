import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../services/auth_service.dart';
import '../call/call_screen.dart';

class DriverSupportChatScreen extends StatefulWidget {
  const DriverSupportChatScreen({super.key});
  @override
  State<DriverSupportChatScreen> createState() => _DriverSupportChatScreenState();
}

class _DriverSupportChatScreenState extends State<DriverSupportChatScreen> {
  static const _bg = Color(0xFF0d1b2e);
  static const _card = Color(0xFF112240);
  static const _blue = Color(0xFF2563EB);
  static const _supportTargetUserId = '__admin_support__';

  List<dynamic> _messages = [];
  bool _loading = true;
  bool _sending = false;
  final _ctrl = TextEditingController();
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.supportChat), headers: headers);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (mounted) setState(() {
          _messages = data['messages'] ?? [];
          _loading = false;
        });
        _scrollToBottom();
      } else {
        if (mounted) setState(() => _loading = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _send() async {
    final text = _ctrl.text.trim();
    if (text.isEmpty || _sending) return;
    _ctrl.clear();
    setState(() {
      _messages.add({'sender': 'user', 'message': text, 'created_at': DateTime.now().toIso8601String()});
      _sending = true;
    });
    _scrollToBottom();
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      await http.post(
        Uri.parse(ApiConfig.supportChatSend),
        headers: headers,
        body: jsonEncode({'message': text}),
      );
    } catch (_) {}
    if (mounted) setState(() => _sending = false);
    await _load();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
      }
    });
  }

  String _fmtTime(String? ts) {
    if (ts == null) return '';
    final dt = DateTime.tryParse(ts);
    if (dt == null) return '';
    final local = dt.toLocal();
    return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }

  void _startSupportCall() {
    final sessionId = 'support-driver-${DateTime.now().millisecondsSinceEpoch}';
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => CallScreen(
        contactName: 'JAGO Pro Support',
        tripId: sessionId,
        targetUserId: _supportTargetUserId,
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _card,
        foregroundColor: Colors.white,
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('JAGO Pro Support', style: TextStyle(fontWeight: FontWeight.w500, fontSize: 16)),
          Row(children: [
            Container(width: 7, height: 7, decoration: const BoxDecoration(color: Colors.greenAccent, shape: BoxShape.circle)),
            const SizedBox(width: 4),
            const Text('Online 24/7', style: TextStyle(fontSize: 11, color: Colors.grey)),
          ]),
        ]),
        elevation: 0,
        actions: [
          IconButton(icon: const Icon(Icons.call_outlined, color: Colors.white), onPressed: _startSupportCall),
          IconButton(icon: const Icon(Icons.refresh_outlined, color: Colors.grey), onPressed: _load),
        ],
      ),
      body: Column(children: [
        if (_messages.isEmpty && !_loading)
          Container(
            margin: const EdgeInsets.all(16),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: _blue.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: _blue.withValues(alpha: 0.3)),
            ),
            child: Row(children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: _blue.withValues(alpha: 0.2), shape: BoxShape.circle),
                child: const Icon(Icons.support_agent, color: _blue, size: 28),
              ),
              const SizedBox(width: 12),
              const Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('JAGO Pro Pilot Support', style: TextStyle(fontWeight: FontWeight.w500, fontSize: 14, color: Colors.white)),
                SizedBox(height: 4),
                Text('Trip issues, payments, documents — meeru ready ga unnamu!',
                  style: TextStyle(fontSize: 12, color: Colors.grey)),
              ])),
            ]),
          ),

        Expanded(
          child: _loading
            ? const Center(child: CircularProgressIndicator(color: _blue))
            : _messages.isEmpty
              ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Icon(Icons.chat_bubble_outline, size: 64, color: Colors.white.withValues(alpha: 0.1)),
                  const SizedBox(height: 12),
                  const Text('Meeru first message nadavachu!', style: TextStyle(color: Colors.grey)),
                ]))
              : ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  itemCount: _messages.length,
                  itemBuilder: (ctx, i) => _buildBubble(_messages[i]),
                ),
        ),

        Container(
          color: _card,
          padding: EdgeInsets.fromLTRB(16, 10, 16, MediaQuery.of(context).viewInsets.bottom + 16),
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: _ctrl,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  hintText: 'Issue type cheyyandi...',
                  hintStyle: const TextStyle(color: Colors.grey, fontSize: 14),
                  filled: true,
                  fillColor: Colors.white.withValues(alpha: 0.07),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                ),
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
              ),
            ),
            const SizedBox(width: 10),
            GestureDetector(
              onTap: _send,
              child: Container(
                width: 46, height: 46,
                decoration: const BoxDecoration(color: _blue, shape: BoxShape.circle),
                child: _sending
                  ? const Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                  : const Icon(Icons.send_rounded, color: Colors.white, size: 20),
              ),
            ),
          ]),
        ),
      ]),
    );
  }

  Widget _buildBubble(Map<String, dynamic> msg) {
    final isUser = msg['sender'] == 'user';
    final time = _fmtTime(msg['created_at']?.toString());
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isUser) ...[
            Container(
              width: 30, height: 30,
              margin: const EdgeInsets.only(right: 8),
              decoration: const BoxDecoration(color: _blue, shape: BoxShape.circle),
              child: const Icon(Icons.support_agent, color: Colors.white, size: 16),
            ),
          ],
          Column(
            crossAxisAlignment: isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: [
              Container(
                constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.65),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: isUser ? _blue : _card,
                  borderRadius: BorderRadius.only(
                    topLeft: const Radius.circular(18),
                    topRight: const Radius.circular(18),
                    bottomLeft: Radius.circular(isUser ? 18 : 4),
                    bottomRight: Radius.circular(isUser ? 4 : 18),
                  ),
                  border: isUser ? null : Border.all(color: Colors.white.withValues(alpha: 0.08)),
                ),
                child: Text(
                  msg['message'] ?? '',
                  style: const TextStyle(color: Colors.white, fontSize: 14),
                ),
              ),
              const SizedBox(height: 3),
              Text(time, style: const TextStyle(color: Colors.grey, fontSize: 10)),
            ],
          ),
        ],
      ),
    );
  }
}
