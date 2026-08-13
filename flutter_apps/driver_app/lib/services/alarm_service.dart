import 'dart:math' as math;
import 'dart:typed_data';
import 'package:audioplayers/audioplayers.dart';

/// Maximum-volume alarm service for incoming ride alerts.
/// Uses 22050 Hz 16-bit PCM square-wave siren routed through Android ALARM
/// audio channel — plays LOUD even at medium system volume, cuts through
/// traffic noise, audible to bystanders 5+ metres away.
class AlarmService {
  static final AlarmService _instance = AlarmService._internal();
  factory AlarmService() => _instance;
  AlarmService._internal();

  AudioPlayer? _player;
  bool _playing = false;

  // Built once — 22050 Hz 16-bit square-wave ambulance siren
  static final Uint8List _alarmWav = _buildAlarmWav();

  bool get isPlaying => _playing;

  /// Start looping alarm. Idempotent.
  Future<void> startAlarm() async {
    if (_playing) return;
    _playing = true;
    try {
      await _player?.dispose();
      _player = AudioPlayer();

      // ALARM usage → routed through Android alarm volume channel
      // stayAwake: true → screen can be off
      // gainTransientExclusive → ducks everything else (music/nav)
      await _player!.setAudioContext(AudioContext(
        android: AudioContextAndroid(
          isSpeakerphoneOn: true,   // force loudspeaker
          stayAwake: true,
          contentType: AndroidContentType.sonification,
          usageType: AndroidUsageType.alarm,
          audioFocus: AndroidAudioFocus.gainTransientExclusive,
        ),
        iOS: AudioContextIOS(
          category: AVAudioSessionCategory.playback,
          options: {
            AVAudioSessionOptions.defaultToSpeaker,
            AVAudioSessionOptions.duckOthers,
          },
        ),
      ));

      await _player!.setVolume(1.0);
      await _player!.setReleaseMode(ReleaseMode.loop);
      await _player!.play(BytesSource(_alarmWav));
    } catch (_) {
      _playing = false;
    }
  }

  /// Stop alarm and release resources.
  Future<void> stopAlarm() async {
    _playing = false;
    try {
      await _player?.stop();
      await _player?.dispose();
      _player = null;
    } catch (_) {}
  }

  /// Single short chime (for arrival / trip-started events).
  Future<void> playChime() async {
    try {
      final chimePlayer = AudioPlayer();
      await chimePlayer.setAudioContext(AudioContext(
        android: AudioContextAndroid(
          isSpeakerphoneOn: false,
          stayAwake: false,
          contentType: AndroidContentType.sonification,
          usageType: AndroidUsageType.notificationEvent,
          audioFocus: AndroidAudioFocus.gainTransient,
        ),
      ));
      await chimePlayer.setVolume(1.0);
      await chimePlayer.play(BytesSource(_buildChimeWav()));
      await Future.delayed(const Duration(milliseconds: 600));
      await chimePlayer.dispose();
    } catch (_) {}
  }

  // ── WAV Generator — 22050 Hz 16-bit Mono Square Wave Ambulance Siren ─────
  // Pattern: 220ms @ 880 Hz  →  220ms @ 1400 Hz  →  60ms silence = 500ms loop
  // Square wave = maximum spectral energy = loudest perceived sound possible.
  // At 22050 Hz 16-bit, this clips through traffic noise at any volume level.
  static Uint8List _buildAlarmWav() {
    const sr = 22050;
    const loHz = 880;
    const hiHz = 1400;
    const loMs = 220;
    const hiMs = 220;
    const silMs = 60;

    final nLo  = sr * loMs ~/ 1000;
    final nHi  = sr * hiMs ~/ 1000;
    final nSil = sr * silMs ~/ 1000;
    final nTotal = nLo + nHi + nSil;
    final dataBytes = nTotal * 2; // 16-bit = 2 bytes/sample

    final buf = ByteData(44 + dataBytes);

    void ws(int off, String s) {
      for (int i = 0; i < s.length; i++) buf.setUint8(off + i, s.codeUnitAt(i));
    }

    // WAV header
    ws(0, 'RIFF');
    buf.setUint32(4, 36 + dataBytes, Endian.little);
    ws(8, 'WAVE');
    ws(12, 'fmt ');
    buf.setUint32(16, 16, Endian.little);       // PCM chunk
    buf.setUint16(20, 1, Endian.little);         // PCM format
    buf.setUint16(22, 1, Endian.little);         // Mono
    buf.setUint32(24, sr, Endian.little);        // SampleRate
    buf.setUint32(28, sr * 2, Endian.little);    // ByteRate
    buf.setUint16(32, 2, Endian.little);         // BlockAlign
    buf.setUint16(34, 16, Endian.little);        // BitsPerSample
    ws(36, 'data');
    buf.setUint32(40, dataBytes, Endian.little);

    int offset = 44;

    // Square wave generator — period in samples, half-period each polarity
    void writeSquare(int n, int hz) {
      final period = sr / hz;
      for (int i = 0; i < n; i++) {
        final phase = i % period;
        // Max amplitude ±32767 with slight envelope to avoid click
        final env = (i < 441 || i > n - 441)
            ? math.min(i, n - i) / 441.0
            : 1.0;
        final raw = (phase < period / 2 ? 32767 : -32768) * env;
        buf.setInt16(offset, raw.clamp(-32768, 32767).toInt(), Endian.little);
        offset += 2;
      }
    }

    writeSquare(nLo, loHz);
    writeSquare(nHi, hiHz);

    // Silence
    for (int i = 0; i < nSil; i++) {
      buf.setInt16(offset, 0, Endian.little);
      offset += 2;
    }

    return buf.buffer.asUint8List();
  }

  // Short double-beep chime for arrival/trip events
  static Uint8List _buildChimeWav() {
    const sr = 22050;
    const hz = 1047; // C6
    const beepMs = 120;
    const gapMs = 60;
    final nBeep = sr * beepMs ~/ 1000;
    final nGap  = sr * gapMs  ~/ 1000;
    final nTotal = nBeep * 2 + nGap;
    final dataBytes = nTotal * 2;

    final buf = ByteData(44 + dataBytes);
    void ws(int off, String s) {
      for (int i = 0; i < s.length; i++) buf.setUint8(off + i, s.codeUnitAt(i));
    }
    ws(0, 'RIFF');
    buf.setUint32(4, 36 + dataBytes, Endian.little);
    ws(8, 'WAVE'); ws(12, 'fmt ');
    buf.setUint32(16, 16, Endian.little);
    buf.setUint16(20, 1, Endian.little);
    buf.setUint16(22, 1, Endian.little);
    buf.setUint32(24, sr, Endian.little);
    buf.setUint32(28, sr * 2, Endian.little);
    buf.setUint16(32, 2, Endian.little);
    buf.setUint16(34, 16, Endian.little);
    ws(36, 'data');
    buf.setUint32(40, dataBytes, Endian.little);

    int offset = 44;
    for (int b = 0; b < 2; b++) {
      for (int i = 0; i < nBeep; i++) {
        final env = math.sin(math.pi * i / nBeep); // smooth envelope
        final sample = (math.sin(2 * math.pi * hz * i / sr) * 28000 * env).toInt();
        buf.setInt16(offset, sample.clamp(-32768, 32767), Endian.little);
        offset += 2;
      }
      if (b == 0) {
        for (int i = 0; i < nGap; i++) { buf.setInt16(offset, 0, Endian.little); offset += 2; }
      }
    }

    return buf.buffer.asUint8List();
  }
}
