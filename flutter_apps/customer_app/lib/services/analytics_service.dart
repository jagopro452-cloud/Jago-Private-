import 'package:flutter/foundation.dart';

/// No-op analytics stub for local/dev builds — this app has no
/// firebase_analytics dependency or Firebase project configured locally.
/// Swap for a real implementation before shipping analytics to production.
class AnalyticsService {
  static final AnalyticsService _instance = AnalyticsService._internal();
  factory AnalyticsService() => _instance;
  AnalyticsService._internal();

  Future<void> setUserId(String? userId) async {
    debugPrint('[Analytics] setUserId($userId)');
  }

  Future<void> logLogin() async {
    debugPrint('[Analytics] logLogin');
  }

  Future<void> logRideBooked({
    required String rideId,
    required double fare,
    required String rideType,
  }) async {
    debugPrint('[Analytics] logRideBooked($rideId, $fare, $rideType)');
  }

  Future<void> logRideCancelled({
    required String rideId,
    required String stage,
  }) async {
    debugPrint('[Analytics] logRideCancelled($rideId, $stage)');
  }

  Future<void> logRideCompleted({
    required String rideId,
    required double finalFare,
  }) async {
    debugPrint('[Analytics] logRideCompleted($rideId, $finalFare)');
  }

  Future<void> logPaymentSuccess({
    required String orderId,
    required double amount,
    required String method,
  }) async {
    debugPrint('[Analytics] logPaymentSuccess($orderId, $amount, $method)');
  }

  Future<void> logPaymentFailed({
    required String reason,
    required String method,
  }) async {
    debugPrint('[Analytics] logPaymentFailed($reason, $method)');
  }

  Future<void> logWalletRecharge({
    required double amount,
    required bool success,
  }) async {
    debugPrint('[Analytics] logWalletRecharge($amount, $success)');
  }
}
