class ApiConfig {
  // Override at compile time:  --dart-define=API_BASE_URL=https://yourdomain.com
  static const String compileTimeBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: '');

  // Production EC2 server (ap-south-1). Routed through nginx/TLS at
  // jagopro.org (verified: serves /api/app/* and wss:// socket.io upgrades)
  // instead of the raw HTTP IP, so all traffic — driver tokens, OTPs, live
  // GPS, wallet/earnings data — is encrypted.
  static const String _prodUrl = 'https://jagopro.org';

  static String get baseUrl {
    if (compileTimeBaseUrl.isNotEmpty) {
      final u = compileTimeBaseUrl;
      return u.endsWith('/') ? u.substring(0, u.length - 1) : u;
    }
    return _prodUrl;
  }

  // MUST be supplied at build time:
  //   flutter build apk --dart-define=GOOGLE_MAPS_KEY=AIzaSy...
  // Never commit a real key as the defaultValue.
  static const String googleMapsApiKey =
      String.fromEnvironment('GOOGLE_MAPS_KEY', defaultValue: '');

  // Socket.IO base URL (same server, no path)
  static String get socketUrl => baseUrl;

  static String get loginPassword => '$baseUrl/api/app/login-password';
  static String get sendOtp => '$baseUrl/api/app/send-otp';
  static String get verifyOtp => '$baseUrl/api/app/verify-otp';
  static String get registerAccount => '$baseUrl/api/app/register';
  static String get forgotPassword => '$baseUrl/api/app/forgot-password';
  static String get logout => '$baseUrl/api/app/logout';
  static String get fcmToken => '$baseUrl/api/app/fcm-token';
  static String get configs => '$baseUrl/api/app/configs';
  static String get sos => '$baseUrl/api/app/sos';
  static String get notifications => '$baseUrl/api/app/notifications';
  static String get notificationsReadAll => '$baseUrl/api/app/notifications/read-all';
  static String get emergencyContacts => '$baseUrl/api/app/emergency-contacts';
  static String get tripShare => '$baseUrl/api/app/trip-share';

  static String get driverProfile => '$baseUrl/api/app/driver/profile';
  static String get driverLocation => '$baseUrl/api/app/driver/location';
  static String get driverOnlineStatus => '$baseUrl/api/app/driver/online-status';
  static String get driverActiveTrip => '$baseUrl/api/app/driver/active-trip';
  static String get driverIncomingTrip => '$baseUrl/api/app/driver/incoming-trip';
  static String get driverAcceptTrip => '$baseUrl/api/app/driver/accept-trip';
  static String get driverRejectTrip => '$baseUrl/api/app/driver/reject-trip';
  static String get driverArrived => '$baseUrl/api/app/driver/arrived';
  static String get driverVerifyOtp => '$baseUrl/api/app/driver/verify-pickup-otp';
  static String get driverCompleteTrip => '$baseUrl/api/app/driver/complete-trip';
  static String get driverCancelTrip => '$baseUrl/api/app/driver/cancel-trip';
  static String get driverTrips => '$baseUrl/api/app/driver/trips';
  static String get driverWallet => '$baseUrl/api/app/driver/wallet';
  static String get driverEarnings => '$baseUrl/api/app/driver/earnings';
  static String get driverRateCustomer => '$baseUrl/api/app/driver/rate-customer';
  static String get updateProfile => '$baseUrl/api/app/driver/profile';
  static String get changePassword => '$baseUrl/api/app/change-password';
  static String get referral => '$baseUrl/api/app/referral';
  static String get resetPassword => '$baseUrl/api/app/reset-password';
  static String get refreshSession => '$baseUrl/api/app/auth/refresh';
  static String get runtimeConfig => '$baseUrl/api/app/runtime-config';

  // ── Local Pool (driver session) ────────────────────────────────────────
  static String get localPoolSessionStart => '$baseUrl/api/app/driver/pool/session/start';
  static String get localPoolSessionEnd => '$baseUrl/api/app/driver/pool/session/end';
  static String get localPoolSessionAccepting => '$baseUrl/api/app/driver/pool/session/accepting';
  static String get localPoolSessionActive => '$baseUrl/api/app/driver/pool/session/active';
  static String get localPoolLocation => '$baseUrl/api/app/driver/pool/location';
  static String localPoolAcceptPassenger(String requestId) => '$baseUrl/api/app/driver/pool/passengers/$requestId/accept';
  static String localPoolSkipPassenger(String requestId) => '$baseUrl/api/app/driver/pool/passengers/$requestId/skip';
  static String localPoolPickup(String requestId) => '$baseUrl/api/app/driver/pool/passengers/$requestId/pickup';
  static String localPoolDrop(String requestId) => '$baseUrl/api/app/driver/pool/passengers/$requestId/drop';
  static String localPoolNoShow(String requestId) => '$baseUrl/api/app/driver/pool/passengers/$requestId/no-show';
  static String localPoolRatePassenger(String requestId) => '$baseUrl/api/app/driver/pool/requests/$requestId/rate-passenger';

  // ── Pool sharing / safety (driver side) ──────────────────────────────────
  static String get poolShare => '$baseUrl/api/app/driver/pool/share';
  static String get poolBlockUser => '$baseUrl/api/app/driver/pool/block-user';

  // ── Outstation Pool (driver rating) ──────────────────────────────────────
  static String outstationPoolRatePassenger(String bookingId) => '$baseUrl/api/app/driver/outstation-pool/bookings/$bookingId/rate-passenger';

  // ── Outstation Pool (auto-match: driver goes available for a route + time window) ─
  static String get outstationPoolAvailability => '$baseUrl/api/app/driver/outstation-pool/availability';
  static String get outstationPoolAvailabilityMine => '$baseUrl/api/app/driver/outstation-pool/availability/mine';
  static String outstationPoolAvailabilityEnd(String id) => '$baseUrl/api/app/driver/outstation-pool/availability/$id/end';
  static String outstationPoolRequestAccept(String requestId) => '$baseUrl/api/app/driver/outstation-pool/requests/$requestId/accept';
  static String outstationPoolRequestSkip(String requestId) => '$baseUrl/api/app/driver/outstation-pool/requests/$requestId/skip';

  static String get checkVerification => '$baseUrl/api/app/driver/check-verification';
  static String get faceVerify => '$baseUrl/api/app/driver/face-verify';
  static String get uploadDocument => '$baseUrl/api/app/driver/upload-document';
  static String get driverDocuments => '$baseUrl/api/app/driver/documents';
  static String get driverDashboard => '$baseUrl/api/app/driver/dashboard';
  static String get performance => '$baseUrl/api/app/driver/performance';
  static String get weeklyEarnings => '$baseUrl/api/app/driver/weekly-earnings';

  // ── Support Chat ─────────────────────────────────────────────────────
  static String get supportChat => '$baseUrl/api/app/driver/support-chat';
  static String get supportChatSend => '$baseUrl/api/app/driver/support-chat/send';

  // ── Unique Features ─────────────────────────────────────────────────
  static String get breakMode => '$baseUrl/api/app/driver/break';
  static String get fatigueStatus  => '$baseUrl/api/app/driver/fatigue-status';
  static String get tipDriver => '$baseUrl/api/app/tip-driver';
  static String get lostFound => '$baseUrl/api/app/lost-found';
  static String get driverWithdrawRequest => '$baseUrl/api/app/driver/withdraw-request';
  static String get deleteAccount => '$baseUrl/api/app/driver/account';
  static String get verifyDeliveryOtp => '$baseUrl/api/app/driver/verify-delivery-otp';
  static String get tripPhoto => '$baseUrl/api/app/driver/trip-photo';

  // ── KYC ──────────────────────────────────────────────────────────────
  static String get kycUpload => '$baseUrl/api/app/driver/kyc/upload';
  static String get kycStatus => '$baseUrl/api/app/driver/kyc/status';

  // ── Trip Receipt ─────────────────────────────────────────────────────
  static String tripReceipt(String tripId) => '$baseUrl/api/app/driver/trip-receipt/$tripId';

  // ── Free Period (30-day onboarding benefit) ──────────────────────────
  static String get launchBenefit => '$baseUrl/api/app/driver/launch-benefit';

  // ── Subscription Plans ───────────────────────────────────────────────
  static String get subscriptionPlans => '$baseUrl/api/app/driver/subscription/plans';
  static String get subscriptionCreateOrder => '$baseUrl/api/app/driver/subscription/create-order';
  static String get subscriptionVerify => '$baseUrl/api/app/driver/subscription/verify-payment';
  static String get walletCreateOrder => '$baseUrl/api/app/driver/wallet/create-order';
  static String get walletVerifyPayment => '$baseUrl/api/app/driver/wallet/verify-payment';

  // ── Parcel Delivery ───────────────────────────────────────────────────
  static String get driverParcelPending => '$baseUrl/api/app/driver/parcel/pending';
  static String get driverParcelActive => '$baseUrl/api/app/driver/parcel/active';
  static String driverParcelAccept(String id) => '$baseUrl/api/app/driver/parcel/$id/accept';
  static String driverParcelPickupOtp(String id) => '$baseUrl/api/app/driver/parcel/$id/pickup-otp';
  static String driverParcelDropOtp(String id) => '$baseUrl/api/app/driver/parcel/$id/drop-otp';

  // Outstation Pool
  static String get driverOutstationPoolRides => '$baseUrl/api/app/driver/outstation-pool/rides';
  static String driverOutstationPoolRide(String id) => '$baseUrl/api/app/driver/outstation-pool/rides/$id';
  static String driverCompleteOutstationPoolRide(String id) => '$baseUrl/api/app/driver/outstation-pool/rides/$id/complete';
  static String driverOutstationPoolBookings(String rideId) =>
      '$baseUrl/api/app/driver/outstation-pool/rides/$rideId/passengers';
  static String driverOutstationPoolStart(String rideId) =>
      '$baseUrl/api/app/driver/outstation-pool/rides/$rideId/start';
  static String driverOutstationPoolLocation(String rideId) =>
      '$baseUrl/api/app/driver/outstation-pool/rides/$rideId/location';

  // Local Pool (City Car Sharing — driver side)
  static String get driverCarSharingRides => '$baseUrl/api/app/driver/car-sharing/rides';
  static String get driverCarSharingCreate => '$baseUrl/api/app/driver/car-sharing/create';
  static String driverCarSharingRide(String id) => '$baseUrl/api/app/driver/car-sharing/rides/$id';
  static String driverCarSharingManifest(String rideId) =>
      '$baseUrl/api/app/driver/car-sharing/rides/$rideId/manifest';
  static String driverCarSharingStart(String rideId) =>
      '$baseUrl/api/app/driver/car-sharing/rides/$rideId/start';
  static String driverCarSharingComplete(String rideId) =>
      '$baseUrl/api/app/driver/car-sharing/rides/$rideId/complete';
  static String driverCarSharingCancel(String rideId) =>
      '$baseUrl/api/app/driver/car-sharing/rides/$rideId/cancel';

  // ── Heatmap Earnings Predictor ────────────────────────────────────────
  static String driverHeatmap({double lat = 17.38, double lng = 78.49, double radius = 10}) =>
      '$baseUrl/api/app/driver/heatmap?lat=$lat&lng=$lng&radius=$radius';
  static String driverHeatmapSuggestion({double lat = 17.38, double lng = 78.49}) =>
      '$baseUrl/api/app/driver/heatmap/suggestion?lat=$lat&lng=$lng';

  // ── Eligible Services (vehicle-type based) ────────────────────────────
  static String get eligibleServices => '$baseUrl/api/app/driver/eligible-services';

  // ── Module Revenue Config ─────────────────────────────────────────────
  static String get revenueConfig => '$baseUrl/api/app/revenue-config';

  // ── Mapping (proxied through server — avoids hardcoded key) ─────────────
  static String get reverseGeocode => '$baseUrl/api/app/reverse-geocode';
  static String get routeMultiWaypoint => '$baseUrl/api/app/route/multi-waypoint';
}
