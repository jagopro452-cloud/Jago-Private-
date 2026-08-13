import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../services/localization_service.dart';
import '../auth/login_screen.dart';

class LanguageSelectScreen extends StatefulWidget {
  final bool fromProfile;
  const LanguageSelectScreen({super.key, this.fromProfile = false});
  @override
  State<LanguageSelectScreen> createState() => _LanguageSelectScreenState();
}

class _LanguageSelectScreenState extends State<LanguageSelectScreen>
    with SingleTickerProviderStateMixin {
  String _selectedCode = 'en';
  late AnimationController _animCtrl;
  late Animation<double> _fadeAnim;

  static const _primary = Color(0xFF2F7BFF);
  static const _navy = Color(0xFF0F1829);

  @override
  void initState() {
    super.initState();
    _selectedCode = L.lang;
    _animCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 500));
    _fadeAnim = CurvedAnimation(parent: _animCtrl, curve: Curves.easeOut);
    _animCtrl.forward();
  }

  @override
  void dispose() {
    _animCtrl.dispose();
    super.dispose();
  }

  Future<void> _confirmLanguage() async {
    await L.setLanguage(_selectedCode);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('language_selected', true);
    if (!mounted) return;
    if (widget.fromProfile) {
      Navigator.pop(context);
    } else {
      Navigator.pushReplacement(context,
        MaterialPageRoute(builder: (_) => const LoginScreen()));
    }
  }

  @override
  Widget build(BuildContext context) {
    
    final sheetBg = Colors.white;
    final cardBg = const Color(0xFFF9FAFB);
    final textMain = const Color(0xFF111827);
    final textSub = Colors.grey.shade500;

    return Scaffold(
      backgroundColor: _navy,
      body: Column(children: [
        _buildTopSection(),
        Expanded(
          child: Container(
            decoration: BoxDecoration(
              color: sheetBg,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
            ),
            child: FadeTransition(
              opacity: _fadeAnim,
              child: Column(children: [
                const SizedBox(height: 24),
                Text('Select App Language',
                  style: TextStyle(
                    fontSize: 20, fontWeight: FontWeight.w500,
                    color: textMain, letterSpacing: -0.5)),
                const SizedBox(height: 6),
                Text('Choose your preferred language',
                  style: TextStyle(fontSize: 13, color: textSub)),
                const SizedBox(height: 20),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: GridView.builder(
                      physics: const BouncingScrollPhysics(),
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2,
                        childAspectRatio: 2.4,
                        crossAxisSpacing: 12,
                        mainAxisSpacing: 12,
                      ),
                      itemCount: L.supportedLanguages.length,
                      itemBuilder: (_, i) {
                        final lang = L.supportedLanguages[i];
                        final code = lang['code']!;
                        final selected = code == _selectedCode;
                        return GestureDetector(
                          onTap: () => setState(() => _selectedCode = code),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 200),
                            decoration: BoxDecoration(
                              color: selected ? _primary.withValues(alpha: 0.08) : cardBg,
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: selected ? _primary : (const Color(0xFFE5E7EB)),
                                width: selected ? 2 : 1,
                              ),
                              boxShadow: selected ? [
                                BoxShadow(color: _primary.withValues(alpha: 0.2), blurRadius: 10, offset: const Offset(0, 3)),
                              ] : null,
                            ),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                              child: Row(children: [
                                Expanded(child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Text(lang['nativeName']!,
                                      style: TextStyle(
                                        fontSize: 15,
                                        fontWeight: FontWeight.w400,
                                        color: selected ? _primary : textMain,
                                      )),
                                    Text(lang['name']!,
                                      style: TextStyle(
                                        fontSize: 11,
                                        color: selected ? _primary.withValues(alpha: 0.7) : textSub,
                                        fontWeight: FontWeight.w500,
                                      )),
                                  ],
                                )),
                                AnimatedContainer(
                                  duration: const Duration(milliseconds: 200),
                                  width: 22, height: 22,
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: selected ? _primary : Colors.transparent,
                                    border: Border.all(
                                      color: selected ? _primary : (Colors.grey.shade300),
                                      width: 2,
                                    ),
                                  ),
                                  child: selected
                                    ? const Icon(Icons.check, color: Colors.white, size: 13)
                                    : null,
                                ),
                              ]),
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ),
                Padding(
                  padding: EdgeInsets.fromLTRB(20, 12, 20, MediaQuery.of(context).padding.bottom + 20),
                  child: SizedBox(
                    width: double.infinity,
                    height: 54,
                    child: ElevatedButton(
                      onPressed: _confirmLanguage,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _primary,
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                      ).copyWith(
                        overlayColor: WidgetStateProperty.all(Colors.white.withValues(alpha: 0.15)),
                      ),
                      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        Text(
                          _selectedCode == 'en' ? 'Continue' :
                          _selectedCode == 'hi' ? 'जारी रखें' :
                          _selectedCode == 'te' ? 'కొనసాగించు' :
                          _selectedCode == 'ta' ? 'தொடரவும்' :
                          _selectedCode == 'kn' ? 'ಮುಂದುವರಿಯಿರಿ' :
                          _selectedCode == 'ml' ? 'തുടരുക' :
                          _selectedCode == 'bn' ? 'এগিয়ে যান' :
                          _selectedCode == 'mr' ? 'पुढे जा' : 'Continue',
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w400),
                        ),
                        const SizedBox(width: 8),
                        const Icon(Icons.arrow_forward_rounded, size: 18),
                      ]),
                    ),
                  ),
                ),
              ]),
            ),
          ),
        ),
      ]),
    );
  }

  Widget _buildTopSection() {
    return Container(
      height: 260,
      width: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF4FA9FF), Color(0xFF2F7BFF)],
          begin: Alignment.topCenter, end: Alignment.bottomCenter),
      ),
      child: SafeArea(
        child: Stack(children: [
          if (widget.fromProfile)
            Positioned(
              top: 8, left: 12,
              child: GestureDetector(
                onTap: () => Navigator.pop(context),
                child: Container(
                  width: 40, height: 40,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.1),
                    shape: BoxShape.circle),
                  child: const Icon(Icons.arrow_back_rounded, color: Colors.white, size: 20)),
              ),
            ),
          Center(
            child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              const SizedBox(height: 12),
              RichText(
                text: const TextSpan(
                  children: [
                    TextSpan(text: 'JA', style: TextStyle(
                      fontSize: 38, fontWeight: FontWeight.w500,
                      color: _primary, letterSpacing: -1)),
                    TextSpan(text: 'GO ', style: TextStyle(
                      fontSize: 38, fontWeight: FontWeight.w500,
                      color: Color(0xFFFFD700), letterSpacing: -1)),
                    TextSpan(text: 'Pilot', style: TextStyle(
                      fontSize: 38, fontWeight: FontWeight.w500,
                      color: Colors.white, letterSpacing: -1)),
                  ],
                )),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                margin: const EdgeInsets.symmetric(horizontal: 32),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.07),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
                ),
                child: Column(children: [
                  const Text('👋', style: TextStyle(fontSize: 28)),
                  const SizedBox(height: 6),
                  const Text('Hello,',
                    style: TextStyle(color: Colors.white70, fontSize: 13)),
                  const Text('Welcome to JAGO Pro Pilot',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 17,
                      fontWeight: FontWeight.w400,
                      letterSpacing: -0.3)),
                ]),
              ),
            ]),
          ),
        ]),
      ),
    );
  }
}
