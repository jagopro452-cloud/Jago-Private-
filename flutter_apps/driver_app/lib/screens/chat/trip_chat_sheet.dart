import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';
import '../../services/socket_service.dart';

/// In-ride chat bottom sheet between driver and customer.
/// Uses existing socket trip:send_message / trip:new_message events.
class TripChatSheet extends StatefulWidget {
  final String tripId;
  final String senderName;
  final String chatScope;
  final String? poolModule;
  final String title;

  const TripChatSheet({
    super.key,
    required this.tripId,
    required this.senderName,
    this.chatScope = 'trip',
    this.poolModule,
    this.title = 'Trip Chat',
  });

  @override
  State<TripChatSheet> createState() => _TripChatSheetState();
}

class _TripChatSheetState extends State<TripChatSheet> {
  final SocketService _socket = SocketService();
  final TextEditingController _msgCtrl = TextEditingController();
  final ScrollController _scrollCtrl = ScrollController();
  final List<Map<String, dynamic>> _messages = [];
  final List<StreamSubscription> _subs = [];

  @override
  void initState() {
    super.initState();
    _subs.add((widget.chatScope == 'pool' ? _socket.onPoolChatMessage : _socket.onChatMessage).listen((msg) {
      if (!mounted) return;
      // Skip echo of own messages (already added locally in _send)
      if (msg['senderType']?.toString().toLowerCase() == 'driver') return;
      setState(() => _messages.add(msg));
      _scrollToBottom();
    }));

    _subs.add((widget.chatScope == 'pool' ? _socket.onPoolMessageHistory : _socket.onMessageHistory).listen((data) {
      if (!mounted) return;
      final msgs = data['messages'] as List<dynamic>? ?? [];
      setState(() {
        _messages.clear();
        _messages.addAll(msgs.map((m) => Map<String, dynamic>.from(m)));
      });
      _scrollToBottom();
    }));

    if (widget.chatScope == 'pool' && widget.poolModule != null) {
      _socket.joinPoolChat(module: widget.poolModule!, referenceId: widget.tripId);
      _socket.loadPoolChatHistory(module: widget.poolModule!, referenceId: widget.tripId);
    } else {
      _socket.setActiveTrip(widget.tripId);
      _socket.loadChatHistory(widget.tripId);
    }
  }

  void _scrollToBottom() {
    Future.delayed(const Duration(milliseconds: 100), () {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(_scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      }
    });
  }

  void _send() {
    final text = _msgCtrl.text.trim();
    if (text.isEmpty) return;
    if (widget.chatScope == 'pool' && widget.poolModule != null) {
      _socket.sendPoolChatMessage(
        module: widget.poolModule!,
        referenceId: widget.tripId,
        message: text,
        senderName: widget.senderName,
      );
    } else {
      _socket.sendChatMessage(
        tripId: widget.tripId,
        message: text,
        senderName: widget.senderName,
      );
    }
    setState(() {
      _messages.add({
        'message': text,
        'senderType': 'driver',
        'senderName': widget.senderName,
        'timestamp': DateTime.now().toIso8601String(),
      });
    });
    _msgCtrl.clear();
    _scrollToBottom();
  }

  @override
  void dispose() {
    for (final s in _subs) { s.cancel(); }
    _msgCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: MediaQuery.of(context).size.height * 0.6,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(children: [
        const SizedBox(height: 12),
        Container(width: 36, height: 4, decoration: BoxDecoration(
          color: const Color(0xFFDCE9FF), borderRadius: BorderRadius.circular(2))),
        const SizedBox(height: 12),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text(widget.title, style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w500, color: JT.textPrimary)),
            GestureDetector(
              onTap: () => Navigator.pop(context),
              child: Container(
                width: 32, height: 32,
                decoration: BoxDecoration(color: const Color(0xFFF5F8FF), shape: BoxShape.circle),
                child: const Icon(Icons.close, size: 18, color: Color(0xFF94A3B8)),
              ),
            ),
          ]),
        ),
        const Divider(height: 16),
        Expanded(
          child: _messages.isEmpty
            ? Center(child: Text('No messages yet.\nSay hi to the customer!',
                textAlign: TextAlign.center,
                style: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF94A3B8))))
            : ListView.builder(
                controller: _scrollCtrl,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                itemCount: _messages.length,
                itemBuilder: (_, i) => _buildMessage(_messages[i]),
              ),
        ),
        Container(
          padding: const EdgeInsets.fromLTRB(16, 8, 8, 16),
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
          ),
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: _msgCtrl,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
                decoration: InputDecoration(
                  hintText: 'Type a message...',
                  hintStyle: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF94A3B8)),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: const BorderSide(color: Color(0xFFDCE9FF)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: const BorderSide(color: Color(0xFFDCE9FF)),
                  ),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  isDense: true,
                ),
                style: GoogleFonts.poppins(fontSize: 13),
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: _send,
              child: Container(
                width: 42, height: 42,
                decoration: BoxDecoration(shape: BoxShape.circle, color: JT.primary),
                child: const Icon(Icons.send_rounded, color: Colors.white, size: 20),
              ),
            ),
          ]),
        ),
      ]),
    );
  }

  Widget _buildMessage(Map<String, dynamic> msg) {
    final isMe = msg['senderType'] == 'driver';
    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.7),
        decoration: BoxDecoration(
          color: isMe ? JT.primary : const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isMe ? 16 : 4),
            bottomRight: Radius.circular(isMe ? 4 : 16),
          ),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          if (!isMe)
            Text(msg['senderName']?.toString() ?? 'Customer',
              style: GoogleFonts.poppins(fontSize: 10, fontWeight: FontWeight.w400,
                color: const Color(0xFF64748B))),
          Text(msg['message']?.toString() ?? '',
            style: GoogleFonts.poppins(fontSize: 13,
              color: isMe ? Colors.white : JT.textPrimary)),
        ]),
      ),
    );
  }
}
