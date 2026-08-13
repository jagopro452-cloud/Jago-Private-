import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';
import '../../services/socket_service.dart';

/// In-ride chat bottom sheet between customer and driver.
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
  // Track locally-sent message texts to avoid duplicate display from server echo
  final Set<String> _pendingLocalMessages = {};

  @override
  void initState() {
    super.initState();

    // Ensure the customer is tracked in the trip room (so server routes events to us)
    if (widget.chatScope == 'pool' && widget.poolModule != null) {
      _socket.joinPoolChat(module: widget.poolModule!, referenceId: widget.tripId);
    } else {
      _socket.trackTrip(widget.tripId);
    }

    // Listen for new real-time messages
    _subs.add((widget.chatScope == 'pool' ? _socket.onPoolChatMessage : _socket.onChatMessage).listen((msg) {
      if (!mounted) return;
      final text = msg['message']?.toString() ?? '';
      final senderType = msg['senderType']?.toString() ?? '';
      // De-duplicate: if this is an echo of a message we sent locally, skip it
      if (senderType == 'customer' && _pendingLocalMessages.contains(text)) {
        _pendingLocalMessages.remove(text);
        return;
      }

      setState(() => _messages.add(Map<String, dynamic>.from(msg)));
      _scrollToBottom();
    }));

    // Listen for message history (replaces list with full DB history)
    _subs.add((widget.chatScope == 'pool' ? _socket.onPoolMessageHistory : _socket.onMessageHistory).listen((data) {
      if (!mounted) return;
      final msgs = data['messages'] as List<dynamic>? ?? [];
      setState(() {
        _messages.clear();
        _messages.addAll(msgs.map((m) => Map<String, dynamic>.from(m)));
      });
      _scrollToBottom();
    }));

    // Listen for connection changes — reload history on reconnect
    _subs.add(_socket.onConnectionChanged.listen((connected) {
      if (!mounted || !connected) return;
      if (widget.chatScope == 'pool' && widget.poolModule != null) {
        _socket.joinPoolChat(module: widget.poolModule!, referenceId: widget.tripId);
      } else {
        _socket.trackTrip(widget.tripId);
      }
      Future.delayed(const Duration(milliseconds: 500), () {
        if (widget.chatScope == 'pool' && widget.poolModule != null) {
          _socket.loadPoolChatHistory(module: widget.poolModule!, referenceId: widget.tripId);
        } else {
          _socket.loadChatHistory(widget.tripId);
        }
      });
    }));

    // Load chat history after a brief delay to allow socket room join to complete
    Future.delayed(const Duration(milliseconds: 400), () {
      if (!mounted) return;
      if (widget.chatScope == 'pool' && widget.poolModule != null) {
        _socket.loadPoolChatHistory(module: widget.poolModule!, referenceId: widget.tripId);
      } else {
        _socket.loadChatHistory(widget.tripId);
      }
    });
  }

  void _scrollToBottom() {
    Future.delayed(const Duration(milliseconds: 100), () {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(
          _scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _send() {
    final text = _msgCtrl.text.trim();
    if (text.isEmpty) return;

    // Track this text so we can de-duplicate the echo from the server
    _pendingLocalMessages.add(text);

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
        'senderType': 'customer',
        'senderName': widget.senderName,
        'timestamp': DateTime.now().toIso8601String(),
      });
    });
    _msgCtrl.clear();
    _scrollToBottom();
  }

  String _formatTime(String? timestamp) {
    if (timestamp == null) return '';
    try {
      final dt = DateTime.parse(timestamp).toLocal();
      final h = dt.hour > 12 ? dt.hour - 12 : (dt.hour == 0 ? 12 : dt.hour);
      final m = dt.minute.toString().padLeft(2, '0');
      final ampm = dt.hour >= 12 ? 'pm' : 'am';
      return '$h:$m $ampm';
    } catch (_) {
      return '';
    }
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _msgCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: MediaQuery.of(context).size.height * 0.65,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(children: [
        // Handle bar
        const SizedBox(height: 12),
        Container(
          width: 36,
          height: 4,
          decoration: BoxDecoration(
            color: const Color(0xFFDCE9FF),
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(height: 12),
        // Header
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(widget.title,
                style: GoogleFonts.poppins(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: JT.textPrimary,
                )),
              Text('Messages are end-to-end for this trip',
                style: GoogleFonts.poppins(
                  fontSize: 11,
                  color: JT.textTertiary,
                )),
            ]),
            GestureDetector(
              onTap: () => Navigator.pop(context),
              child: Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: const Color(0xFFF5F8FF),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.close, size: 18, color: Color(0xFF94A3B8)),
              ),
            ),
          ]),
        ),
        const Divider(height: 16),
        // Messages list
        Expanded(
          child: _messages.isEmpty
            ? Center(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: JT.primaryLight,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.chat_bubble_outline_rounded,
                      color: JT.primary, size: 28),
                  ),
                  const SizedBox(height: 12),
                  Text('No messages yet',
                    style: GoogleFonts.poppins(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: JT.textPrimary,
                    )),
                  const SizedBox(height: 4),
                  Text('Say hi to your pilot!',
                    style: GoogleFonts.poppins(
                      fontSize: 12,
                      color: JT.textTertiary,
                    )),
                ]),
              )
            : ListView.builder(
                controller: _scrollCtrl,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                itemCount: _messages.length,
                itemBuilder: (_, i) => _buildMessage(_messages[i]),
              ),
        ),
        // Input row
        Container(
          padding: EdgeInsets.fromLTRB(
            16, 8, 8, 16 + MediaQuery.of(context).viewInsets.bottom),
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: Color(0xFFE2E8F0))),
            color: Colors.white,
          ),
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: _msgCtrl,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
                maxLength: 500,
                decoration: InputDecoration(
                  hintText: 'Type a message...',
                  counterText: '',
                  hintStyle: GoogleFonts.poppins(
                    fontSize: 13,
                    color: const Color(0xFF94A3B8),
                  ),
                  filled: true,
                  fillColor: const Color(0xFFF8FAFC),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: const BorderSide(color: Color(0xFFDCE9FF)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: const BorderSide(color: Color(0xFFDCE9FF)),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: const BorderSide(color: JT.primary, width: 1.5),
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 10,
                  ),
                  isDense: true,
                ),
                style: GoogleFonts.poppins(fontSize: 13, color: JT.textPrimary),
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: _send,
              child: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: JT.primary,
                  boxShadow: [
                    BoxShadow(
                      color: JT.primary.withValues(alpha: 0.3),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: const Icon(Icons.send_rounded, color: Colors.white, size: 20),
              ),
            ),
          ]),
        ),
      ]),
    );
  }

  Widget _buildMessage(Map<String, dynamic> msg) {
    final senderType = msg['senderType']?.toString() ?? '';
    final isMe = senderType == 'customer';
    final timestamp = msg['timestamp'] ?? msg['createdAt'];
    final time = _formatTime(timestamp?.toString());

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Align(
        alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
        child: Column(
          crossAxisAlignment:
              isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (!isMe)
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 3),
                child: Text(
                  msg['senderName']?.toString().isNotEmpty == true
                      ? msg['senderName'].toString()
                      : 'Pilot',
                  style: GoogleFonts.poppins(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: JT.primary,
                  ),
                ),
              ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              constraints: BoxConstraints(
                maxWidth: MediaQuery.of(context).size.width * 0.72,
              ),
              decoration: BoxDecoration(
                color: isMe ? JT.primary : const Color(0xFFF1F5F9),
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: Radius.circular(isMe ? 16 : 4),
                  bottomRight: Radius.circular(isMe ? 4 : 16),
                ),
                boxShadow: [
                  BoxShadow(
                    color: (isMe ? JT.primary : Colors.black)
                        .withValues(alpha: 0.08),
                    blurRadius: 6,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Text(
                msg['message']?.toString() ?? '',
                style: GoogleFonts.poppins(
                  fontSize: 13,
                  color: isMe ? Colors.white : JT.textPrimary,
                  height: 1.4,
                ),
              ),
            ),
            if (time.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 3, left: 4, right: 4),
                child: Text(
                  time,
                  style: GoogleFonts.poppins(
                    fontSize: 10,
                    color: JT.textTertiary,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
