import 'dart:math' as math;
import 'dart:typed_data';
import 'package:audioplayers/audioplayers.dart';

/// Customer-side notification sound service.
/// Plays a pleasant two-tone "ding-dong" chime when a driver is assigned.
/// Generates WAV in memory — no asset file needed.
class AlarmService {
  static final AlarmService _instance = AlarmService._internal();
  factory AlarmService() => _instance;
  AlarmService._internal();

  AudioPlayer? _player;
  bool _playing = false;

  static final Uint8List _chimeWav = _buildChimeWav();

  bool get isPlaying => _playing;

  /// Play the chime once (not looping). Safe to call multiple times.
  Future<void> playChime() async {
    if (_playing) return;
    _playing = true;
    try {
      await _player?.dispose();
      _player = AudioPlayer();
      await _player!.setAudioContext(AudioContext(
        android: AudioContextAndroid(
          isSpeakerphoneOn: false,
          stayAwake: false,
          contentType: AndroidContentType.sonification,
          usageType: AndroidUsageType.notificationRingtone,
          audioFocus: AndroidAudioFocus.gain,
        ),
        iOS: AudioContextIOS(
          category: AVAudioSessionCategory.ambient,
          options: {AVAudioSessionOptions.defaultToSpeaker},
        ),
      ));
      await _player!.setVolume(1.0);
      await _player!.setReleaseMode(ReleaseMode.release);
      await _player!.play(BytesSource(_chimeWav));
      _player!.onPlayerComplete.listen((_) { _playing = false; });
    } catch (_) {
      _playing = false;
    }
  }

  Future<void> stopAlarm() async {
    _playing = false;
    try {
      await _player?.stop();
      await _player?.dispose();
      _player = null;
    } catch (_) {}
  }

  // ── WAV Generator ──────────────────────────────────────────────────────────
  // Two-note "ding-dong" chime: 880Hz (0.25s) + 100ms silence + 660Hz (0.3s)
  static Uint8List _buildChimeWav() {
    const sr = 22050;
    const note1Ms = 250; // ding
    const gapMs = 80;
    const note2Ms = 350; // dong
    final n1 = sr * note1Ms ~/ 1000;
    final nGap = sr * gapMs ~/ 1000;
    final n2 = sr * note2Ms ~/ 1000;
    final nTotal = n1 + nGap + n2;

    final buf = ByteData(44 + nTotal * 2); // 16-bit PCM

    void ws(int off, String s) {
      for (int i = 0; i < s.length; i++) buf.setUint8(off + i, s.codeUnitAt(i));
    }

    ws(0, 'RIFF');
    buf.setUint32(4, 36 + nTotal * 2, Endian.little);
    ws(8, 'WAVE');
    ws(12, 'fmt ');
    buf.setUint32(16, 16, Endian.little);
    buf.setUint16(20, 1, Endian.little);       // PCM
    buf.setUint16(22, 1, Endian.little);       // Mono
    buf.setUint32(24, sr, Endian.little);
    buf.setUint32(28, sr * 2, Endian.little);  // ByteRate
    buf.setUint16(32, 2, Endian.little);       // BlockAlign
    buf.setUint16(34, 16, Endian.little);      // 16-bit
    ws(36, 'data');
    buf.setUint32(40, nTotal * 2, Endian.little);

    int off = 44;
    // Note 1: 880Hz with fade-out envelope
    for (int i = 0; i < n1; i++) {
      final t = i / sr;
      final env = (1.0 - i / n1) * 0.8 + 0.2;
      final val = (math.sin(2 * math.pi * 880 * t) * env * 28000).clamp(-32768, 32767).toInt();
      buf.setInt16(off, val, Endian.little);
      off += 2;
    }
    // Gap: silence
    for (int i = 0; i < nGap; i++) { buf.setInt16(off, 0, Endian.little); off += 2; }
    // Note 2: 660Hz with fade-out
    for (int i = 0; i < n2; i++) {
      final t = i / sr;
      final env = (1.0 - i / n2) * 0.9 + 0.1;
      final val = (math.sin(2 * math.pi * 660 * t) * env * 24000).clamp(-32768, 32767).toInt();
      buf.setInt16(off, val, Endian.little);
      off += 2;
    }

    return buf.buffer.asUint8List();
  }
}
