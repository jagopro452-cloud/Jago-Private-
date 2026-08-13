import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';
import 'package:flutter/services.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../services/auth_service.dart';

class EmergencyContactsScreen extends StatefulWidget {
  const EmergencyContactsScreen({super.key});

  @override
  State<EmergencyContactsScreen> createState() => _EmergencyContactsScreenState();
}

class _EmergencyContactsScreenState extends State<EmergencyContactsScreen> {
  List<dynamic> _contacts = [];
  bool _loading = true;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() => _loading = true);
    final headers = await AuthService.getHeaders();
    final res = await http.get(Uri.parse(ApiConfig.emergencyContacts), headers: headers);
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body);
      if (mounted) setState(() { _contacts = data['contacts'] ?? []; _loading = false; });
    } else {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _addContact() {
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    String relation = 'Family';
    showDialog(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (ctx, setS) => AlertDialog(
          title: const Text('Add Emergency Contact', style: TextStyle(fontWeight: FontWeight.w500, color: JT.textPrimary)),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Name', border: OutlineInputBorder(), prefixIcon: Icon(Icons.person))),
            const SizedBox(height: 10),
            TextField(controller: phoneCtrl, keyboardType: TextInputType.phone, inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)], decoration: const InputDecoration(labelText: 'Phone', border: OutlineInputBorder(), prefixIcon: Icon(Icons.phone), prefixText: '+91 ')),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: relation,
              items: ['Family', 'Friend', 'Spouse', 'Parent', 'Sibling', 'Other'].map((r) => DropdownMenuItem(value: r, child: Text(r))).toList(),
              onChanged: (v) => setS(() => relation = v!),
              decoration: const InputDecoration(labelText: 'Relation', border: OutlineInputBorder()),
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2563EB), foregroundColor: Colors.white),
              onPressed: () async {
                if (nameCtrl.text.isEmpty || phoneCtrl.text.length < 10) {
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter valid name and 10-digit phone')));
                  return;
                }
                Navigator.pop(ctx);
                final headers = await AuthService.getHeaders();
                await http.post(Uri.parse(ApiConfig.emergencyContacts), headers: headers,
                  body: jsonEncode({'name': nameCtrl.text, 'phone': phoneCtrl.text, 'relation': relation}));
                if (mounted) _load();
              },
              child: const Text('Add Contact'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _delete(int id) async {
    final headers = await AuthService.getHeaders();
    await http.delete(Uri.parse('${ApiConfig.emergencyContacts}/$id'), headers: headers);
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        leading: IconButton(icon: const Icon(Icons.arrow_back_ios, color: JT.textPrimary), onPressed: () => Navigator.pop(context)),
        title: const Text('Emergency Contacts', style: TextStyle(fontWeight: FontWeight.w500, color: JT.textPrimary)),
        actions: [if (_contacts.length < 3) IconButton(icon: const Icon(Icons.add, color: Color(0xFF2563EB)), onPressed: _addContact)],
      ),
      body: Column(
        children: [
          Container(
            margin: const EdgeInsets.all(16),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: const Color(0xFFFEF2F2), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFFECACA))),
            child: const Row(children: [
              Icon(Icons.emergency, color: Colors.red, size: 22),
              SizedBox(width: 10),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Emergency Contacts', style: TextStyle(color: Colors.red, fontWeight: FontWeight.w500, fontSize: 14)),
                SizedBox(height: 2),
                Text('These contacts will be notified if you trigger SOS during a ride. Max 3 contacts.', style: TextStyle(color: Color(0xFF7F1D1D), fontSize: 11)),
              ])),
            ]),
          ),
          if (_loading)
            const Expanded(child: Center(child: CircularProgressIndicator(color: Color(0xFF2563EB))))
          else if (_contacts.isEmpty)
            Expanded(child: Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              const Icon(Icons.contact_phone, size: 60, color: Color(0xFFCBD5E1)),
              const SizedBox(height: 12),
              const Text('No emergency contacts', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 15)),
              const SizedBox(height: 8),
              ElevatedButton.icon(
                onPressed: _addContact,
                icon: const Icon(Icons.add), label: const Text('Add Contact'),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
              ),
            ])))
          else
            Expanded(
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: _contacts.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (_, i) {
                  final c = _contacts[i];
                  return Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: const Color(0xFFF8FAFC), borderRadius: BorderRadius.circular(14), border: Border.all(color: const Color(0xFFE2E8F0))),
                    child: Row(children: [
                      Container(width: 48, height: 48, decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFFFEF2F2)), child: const Icon(Icons.person, color: Colors.red, size: 24)),
                      const SizedBox(width: 12),
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(c['name'] ?? '', style: const TextStyle(fontWeight: FontWeight.w500, color: JT.textPrimary, fontSize: 15)),
                        Text('+91 ${c['phone'] ?? ''}', style: const TextStyle(color: Color(0xFF64748B), fontSize: 13)),
                        Container(margin: const EdgeInsets.only(top: 4), padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3), decoration: BoxDecoration(color: const Color(0xFFEFF6FF), borderRadius: BorderRadius.circular(6)), child: Text(c['relation'] ?? '', style: const TextStyle(color: Color(0xFF2563EB), fontSize: 11))),
                      ])),
                      IconButton(icon: const Icon(Icons.delete_outline, color: Colors.red, size: 22), onPressed: () => _delete(c['id'])),
                    ]),
                  );
                },
              ),
            ),
          if (_contacts.length < 3)
            Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: double.infinity, height: 48,
                child: OutlinedButton.icon(
                  onPressed: _addContact,
                  icon: const Icon(Icons.add, color: Colors.red),
                  label: const Text('Add Emergency Contact', style: TextStyle(color: Colors.red)),
                  style: OutlinedButton.styleFrom(side: const BorderSide(color: Colors.red), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
