import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart';

class NavigationStepModel {
  final String instruction;
  final String roadName;
  final String maneuver;
  final int distanceMeters;
  final int durationSeconds;
  final double endLat;
  final double endLng;

  const NavigationStepModel({
    required this.instruction,
    required this.roadName,
    required this.maneuver,
    required this.distanceMeters,
    required this.durationSeconds,
    required this.endLat,
    required this.endLng,
  });

  factory NavigationStepModel.fromJson(Map<String, dynamic> json) {
    return NavigationStepModel(
      instruction: (json['plainInstruction'] ?? json['instruction'] ?? 'Continue')
          .toString(),
      roadName: (json['roadName'] ?? '').toString(),
      maneuver: (json['maneuver'] ?? 'continue').toString(),
      distanceMeters: (json['distanceMeters'] as num?)?.round() ?? 0,
      durationSeconds: (json['durationSeconds'] as num?)?.round() ?? 0,
      endLat: (json['endLocation']?['lat'] as num?)?.toDouble() ?? 0,
      endLng: (json['endLocation']?['lng'] as num?)?.toDouble() ?? 0,
    );
  }
}

class NavigationProgress {
  final int stepIndex;
  final NavigationStepModel? activeStep;
  final int remainingDistanceMeters;
  final int remainingDurationSeconds;

  const NavigationProgress({
    required this.stepIndex,
    required this.activeStep,
    required this.remainingDistanceMeters,
    required this.remainingDurationSeconds,
  });
}

class NavigationService {
  NavigationService._();
  static final NavigationService instance = NavigationService._();

  final FlutterTts _tts = FlutterTts();
  bool _initialized = false;
  String? _lastSpokenKey;

  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;
    await _tts.setLanguage('en-IN');
    await _tts.setSpeechRate(0.48);
    await _tts.setVolume(1.0);
  }

  List<NavigationStepModel> parseSteps(dynamic rawSteps) {
    if (rawSteps is! List) return const [];
    return rawSteps
        .whereType<Map>()
        .map((step) => NavigationStepModel.fromJson(Map<String, dynamic>.from(step)))
        .toList();
  }

  NavigationProgress computeProgress({
    required List<NavigationStepModel> steps,
    required double currentLat,
    required double currentLng,
    required int fallbackRemainingDistanceMeters,
    required int fallbackRemainingDurationSeconds,
  }) {
    if (steps.isEmpty) {
      return NavigationProgress(
        stepIndex: 0,
        activeStep: null,
        remainingDistanceMeters: fallbackRemainingDistanceMeters,
        remainingDurationSeconds: fallbackRemainingDurationSeconds,
      );
    }

    int activeIndex = 0;
    for (int i = 0; i < steps.length; i++) {
      final step = steps[i];
      if (step.endLat == 0 || step.endLng == 0) {
        activeIndex = i;
        break;
      }
      final distanceToStepEnd = Geolocator.distanceBetween(
        currentLat,
        currentLng,
        step.endLat,
        step.endLng,
      );
      if (distanceToStepEnd > 35) {
        activeIndex = i;
        break;
      }
      activeIndex = i == steps.length - 1 ? i : i + 1;
    }

    final activeStep = steps[activeIndex];
    final remainingDistance = steps
        .skip(activeIndex)
        .fold<int>(0, (sum, step) => sum + step.distanceMeters);
    final remainingDuration = steps
        .skip(activeIndex)
        .fold<int>(0, (sum, step) => sum + step.durationSeconds);

    return NavigationProgress(
      stepIndex: activeIndex,
      activeStep: activeStep,
      remainingDistanceMeters: remainingDistance > 0
          ? remainingDistance
          : fallbackRemainingDistanceMeters,
      remainingDurationSeconds: remainingDuration > 0
          ? remainingDuration
          : fallbackRemainingDurationSeconds,
    );
  }

  Future<void> announceStep(
    NavigationProgress progress, {
    required bool muted,
  }) async {
    if (muted || progress.activeStep == null) return;
    final step = progress.activeStep!;
    final speakKey = '${progress.stepIndex}:${step.instruction}';
    if (_lastSpokenKey == speakKey) return;
    _lastSpokenKey = speakKey;
    await _tts.stop();
    await _tts.speak(step.instruction);
  }
}
