import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../call/call_screen.dart';

class SupportChatScreen extends StatefulWidget {
  const SupportChatScreen({super.key});
  @override
  State<SupportChatScreen> createState() => _SupportChatScreenState();
}

class _SupportChatScreenState extends State<SupportChatScreen> {
  static final _blue = JT.primary;
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
    final sessionId = 'support-customer-${DateTime.now().millisecondsSinceEpoch}';
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => CallScreen(
        contactName: 'Jago Support',
        tripId: sessionId,
        targetUserId: _supportTargetUserId,
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: AppBar(
        backgroundColor: _blue,
        foregroundColor: Colors.white,
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Jago Support', style: JT.h5.copyWith(color: Colors.white)),
          Row(children: [
            Container(width: 7, height: 7, decoration: BoxDecoration(color: JT.success, shape: BoxShape.circle)),
            SizedBox(width: JT.spacing4),
            Text('Online', style: JT.caption.copyWith(color: Colors.white, fontSize: 11)),
          ]),
        ]),
        elevation: 0,
        actions: [
          IconButton(icon: const Icon(Icons.call_outlined), onPressed: _startSupportCall),
          IconButton(icon: const Icon(Icons.refresh_outlined), onPressed: _load),
        ],
      ),
      body: Column(children: [
        // Welcome banner
        if (_messages.isEmpty && !_loading)
          Container(
            margin: EdgeInsets.all(JT.spacing16),
            padding: EdgeInsets.all(JT.spacing16),
            decoration: BoxDecoration(
              color: _blue.withValues(alpha: 0.07),
              borderRadius: BorderRadius.circular(JT.radiusLg),
              border: Border.all(color: _blue.withValues(alpha: 0.2)),
            ),
            child: Row(children: [
              Container(
                padding: EdgeInsets.all(JT.spacing8 + 2),
                decoration: BoxDecoration(color: _blue.withValues(alpha: 0.1), shape: BoxShape.circle),
                child: Icon(Icons.support_agent, color: _blue, size: 28),
              ),
              SizedBox(width: JT.spacing12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Jago Support Team', style: JT.subtitle1),
                SizedBox(height: JT.spacing4),
                Text('Mee query ki meeru message cheyyandi. Meeru 24/7 available.',
                  style: JT.caption),
              ])),
            ]),
          ),

        // Messages
        Expanded(
          child: _loading
            ? Center(child: CircularProgressIndicator(color: _blue))
            : _messages.isEmpty
              ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Icon(Icons.chat_bubble_outline, size: 64, color: JT.iconInactive),
                  SizedBox(height: JT.spacing12),
                  Text('Meeru first message nadavachu!', style: JT.body),
                ]))
              : ListView.builder(
                  controller: _scroll,
                  padding: EdgeInsets.symmetric(horizontal: JT.spacing16, vertical: JT.spacing8),
                  itemCount: _messages.length,
                  itemBuilder: (ctx, i) => _buildBubble(_messages[i]),
                ),
        ),

        // Input
        Container(
          color: JT.bg,
          padding: EdgeInsets.fromLTRB(JT.spacing16, JT.spacing8 + 2, JT.spacing16, MediaQuery.of(context).viewInsets.bottom + JT.spacing16),
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: _ctrl,
                decoration: InputDecoration(
                  hintText: 'Meeru ela help cheyyagalamu?',
                  hintStyle: JT.body,
                  filled: true,
                  fillColor: JT.borderLight,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                  contentPadding: EdgeInsets.symmetric(horizontal: JT.spacing16 + 2, vertical: JT.spacing12),
                ),
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
              ),
            ),
            SizedBox(width: JT.spacing8 + 2),
            GestureDetector(
              onTap: _send,
              child: Container(
                width: 46, height: 46,
                decoration: BoxDecoration(color: _blue, shape: BoxShape.circle),
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
      padding: EdgeInsets.only(bottom: JT.spacing8 + 2),
      child: Row(
        mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isUser) ...[
            Container(
              width: 30, height: 30,
              margin: EdgeInsets.only(right: JT.spacing8),
              decoration: BoxDecoration(color: _blue, shape: BoxShape.circle),
              child: const Icon(Icons.support_agent, color: Colors.white, size: 16),
            ),
          ],
          Column(
            crossAxisAlignment: isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: [
              Container(
                constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.65),
                padding: EdgeInsets.symmetric(horizontal: JT.spacing12 + 2, vertical: JT.spacing8 + 2),
                decoration: BoxDecoration(
                  color: isUser ? _blue : JT.bg,
                  borderRadius: BorderRadius.only(
                    topLeft: const Radius.circular(18),
                    topRight: const Radius.circular(18),
                    bottomLeft: Radius.circular(isUser ? 18 : 4),
                    bottomRight: Radius.circular(isUser ? 4 : 18),
                  ),
                  boxShadow: JT.shadowXs,
                ),
                child: Text(
                  msg['message'] ?? '',
                  style: JT.body.copyWith(color: isUser ? Colors.white : JT.textPrimary),
                ),
              ),
              SizedBox(height: JT.spacing2 + 1),
              Text(time, style: JT.caption.copyWith(fontSize: 10)),
            ],
          ),
        ],
      ),
    );
  }
}
