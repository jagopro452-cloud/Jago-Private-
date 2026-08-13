class ApiConfig {
  // Override at compile time:  --dart-define=API_BASE_URL=https://yourdomain.com
  static const String compileTimeBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: '');

  // Production EC2 server (ap-south-1) — same backend driver_app uses.
  // Routed through nginx/TLS at jagopro.org (verified: serves /api/app/* and
  // wss:// socket.io upgrades) instead of the raw HTTP IP, so all traffic —
  // credentials, OTPs, payment confirmations, live location — is encrypted.
  static const String _prodUrl = 'https://jagopro.org';

  // For Android Emulator use 10.0.2.2. For Physical Device use your PC's IP (e.g. 192.168.0.x)
  static const String _lanDevUrl = 'http://192.168.1.89:5000'; // Target specific physical IP

  static bool _isProd = true; // PRODUCTION BUILD

  static String get baseUrl {
    if (compileTimeBaseUrl.isNotEmpty) {
      final u = compileTimeBaseUrl;
      return u.endsWith('/') ? u.substring(0, u.length - 1) : u;
    }
    return _isProd ? _prodUrl : _lanDevUrl;
  }
  static bool get isDev => !_isProd;
  static void useProduction() => _isProd = true;
  static void useDevelopment() => _isProd = false;

  // Set at build time: --dart-define=GOOGLE_MAPS_KEY=AIzaSy...
  // Never hardcode — key must be rotated in Google Cloud Console
  static const String googleMapsApiKey = String.fromEnvironment('GOOGLE_MAPS_KEY');

  // Socket.IO base URL (same server, no path)
  static String get socketUrl => baseUrl;

  static String get loginPassword => '$baseUrl/api/app/login-password';
  static String get sendOtp => '$baseUrl/api/app/send-otp';
  static String get verifyOtp => '$baseUrl/api/app/verify-otp';
  static String get forgotPassword => '$baseUrl/api/app/forgot-password';
  static String get resetPassword => '$baseUrl/api/app/reset-password';
  static String get registerAccount => '$baseUrl/api/app/register';
  static String get refreshSession => '$baseUrl/api/app/auth/refresh';
  static String get changePassword => '$baseUrl/api/app/change-password';
  static String get logout => '$baseUrl/api/app/logout';
  static String get configs => '$baseUrl/api/app/configs';
  static String get runtimeConfig => '$baseUrl/api/app/runtime-config';
  static String get nearbyDrivers => '$baseUrl/api/app/nearby-drivers';
  static String get notifications => '$baseUrl/api/app/notifications';
  static String get notificationsReadAll => '$baseUrl/api/app/notifications/read-all';
  static String get emergencyContacts => '$baseUrl/api/app/emergency-contacts';
  static String get tripShare => '$baseUrl/api/app/trip-share';
  static String get trackPrefix => '$baseUrl/api/app/track';

  static String get customerProfile => '$baseUrl/api/app/customer/profile';
  static String get customerHomeData => '$baseUrl/api/app/customer/home-data';
  static String get popularLocations => '$baseUrl/api/popular-locations';
  static String get estimateFare => '$baseUrl/api/app/customer/estimate-fare';
  static String get bookRide => '$baseUrl/api/app/customer/book-ride';
  static String get activeTrip => '$baseUrl/api/app/customer/active-trip';
  static String get activeBooking => '$baseUrl/api/app/customer/active-booking';
  static String get trackTrip => '$baseUrl/api/app/customer/track-trip';
  static String get cancelTrip => '$baseUrl/api/app/customer/cancel-trip';
  static String get rateDriver => '$baseUrl/api/app/customer/rate-driver';
  static String get trips => '$baseUrl/api/app/customer/trips';
  static String get wallet => '$baseUrl/api/app/customer/wallet';
  static String get walletRecharge => '$baseUrl/api/app/customer/wallet/recharge';
  static String get walletCreateOrder => '$baseUrl/api/app/customer/wallet/create-order';
  static String get walletVerifyPayment => '$baseUrl/api/app/customer/wallet/verify-payment';
  static String get savedPlaces => '$baseUrl/api/app/customer/saved-places';
  static String get applyCoupon => '$baseUrl/api/app/customer/apply-coupon';
  static String get rideCreateOrder => '$baseUrl/api/app/customer/ride/create-order';
  static String get rideVerifyPayment => '$baseUrl/api/app/customer/ride/verify-payment';
  static String get ridePendingRecovery => '$baseUrl/api/app/customer/ride/pending-recovery';
  static String get rideRecoverBooking => '$baseUrl/api/app/customer/ride/recover-booking';
  static String carSharingCancelBooking(String bookingId) =>
      '$baseUrl/api/app/customer/car-sharing/bookings/$bookingId/cancel';
  static String get customerOffers => '$baseUrl/api/app/customer/offers';
  static String get updateProfile => '$baseUrl/api/app/customer/profile';
  static String get scheduleRide => '$baseUrl/api/app/customer/schedule-ride';
  static String get scheduledRides => '$baseUrl/api/app/customer/scheduled-rides';
  static String get sos => '$baseUrl/api/app/sos';

  // ── Intercity ────────────────────────────────────────────────────────
  static String get intercityRoutes => '$baseUrl/api/intercity-routes';
  static String get intercityBook => '$baseUrl/api/app/customer/intercity-book';

  // ── Support Chat ─────────────────────────────────────────────────────
  static String get supportChat => '$baseUrl/api/app/customer/support-chat';
  static String get supportChatSend => '$baseUrl/api/app/customer/support-chat/send';

  // ── Unique Features ─────────────────────────────────────────────────
  static String get coins => '$baseUrl/api/app/customer/coins';
  static String get redeemCoins => '$baseUrl/api/app/customer/redeem-coins';
  static String get spinWheel => '$baseUrl/api/app/customer/spin-wheel';
  static String get spinWheelPlay => '$baseUrl/api/app/customer/spin-wheel/play';
  static String get monthlyPass => '$baseUrl/api/app/customer/monthly-pass';
  static String get buyMonthlyPass => '$baseUrl/api/app/customer/monthly-pass/buy';
  static String get preferences => '$baseUrl/api/app/customer/preferences';
  static String get customerLostFound => '$baseUrl/api/app/customer/lost-found';
  static String get lostFound => '$baseUrl/api/app/lost-found';
  static String get tipDriver => '$baseUrl/api/app/tip-driver';
  static String get surgeAlert => '$baseUrl/api/app/customer/surge-alert';
  static String get fcmToken => '$baseUrl/api/app/fcm-token';
  static String get referral => '$baseUrl/api/app/referral';
  static String get deleteAccount => '$baseUrl/api/app/customer/account';

  // ── Trip Receipt ─────────────────────────────────────────────────────
  static String tripReceipt(String tripId) => '$baseUrl/api/app/customer/trip-receipt/$tripId';

  // ── Boost Fare ───────────────────────────────────────────────────────
  static String boostFare(String tripId) => '$baseUrl/api/app/customer/trip/$tripId/boost-fare';

  // ── Mapping / Geocoding (proxied through server — avoids Android key restriction) ──
  static String get reverseGeocode => '$baseUrl/api/app/reverse-geocode';
  static String get placesAutocomplete => '$baseUrl/api/app/places/autocomplete';
  static String get placeDetails => '$baseUrl/api/app/places/details';
  static String get placesNearby => '$baseUrl/api/app/places/nearby';
  static String get route => '$baseUrl/api/app/route';
  static String get routeMultiWaypoint => '$baseUrl/api/app/route/multi-waypoint';

  // ── Parcel ───────────────────────────────────────────────────────────
  static String get parcelBook => '$baseUrl/api/app/parcel/book';
  static String get parcelQuote => '$baseUrl/api/app/parcel/quote';
  static String get estimateParcelFare => '$baseUrl/api/app/customer/estimate-parcel-fare';
  static String get parcelOrders => '$baseUrl/api/app/parcel/orders';
  static String get parcelOptimizeRoute => '$baseUrl/api/app/parcel/optimize-route';
  static String parcelTrack(String id) => '$baseUrl/api/app/parcel/$id/track';
  static String parcelReceipt(String id) => '$baseUrl/api/app/parcel/$id/receipt';
  static String parcelCancel(String id) => '$baseUrl/api/app/parcel/$id/cancel';

  // ── B2B ──────────────────────────────────────────────────────────────
  static String get b2bRegister => '$baseUrl/api/app/b2b/register';
  static String get b2bDashboard => '$baseUrl/api/app/b2b/dashboard';
  static String get b2bLogin => '$baseUrl/api/app/b2b/login';
  static String get b2bSetPassword => '$baseUrl/api/app/b2b/set-password';
  static String get b2bDashboardById => '$baseUrl/api/app/b2b/dashboard-by-id';

  // ── Carpool / Outstation Pool ─────────────────────────────────────────
  static String get outstationPoolSearch => '$baseUrl/api/app/customer/outstation-pool/v2/search';
  static String get outstationPoolBook => '$baseUrl/api/app/customer/outstation-pool/v2/book';
  static String get outstationPoolBookings => '$baseUrl/api/app/customer/outstation-pool/v2/bookings';
  static String outstationPoolCancel(String bookingId) => '$baseUrl/api/app/customer/outstation-pool/v2/bookings/$bookingId/cancel';
  static String outstationPoolCoPassengers(String bookingId) => '$baseUrl/api/app/customer/outstation-pool/v2/bookings/$bookingId/co-passengers';
  static String outstationPoolRateDriver(String bookingId) => '$baseUrl/api/app/customer/outstation-pool/v2/bookings/$bookingId/rate-driver';
  static String get localPoolBook => '$baseUrl/api/app/customer/pool/book';
  static String localPoolStatus(String requestId) => '$baseUrl/api/app/customer/pool/status/$requestId';
  static String localPoolCancel(String requestId) => '$baseUrl/api/app/customer/pool/cancel/$requestId';
  static String localPoolCoPassengers(String requestId) => '$baseUrl/api/app/customer/pool/co-passengers/$requestId';
  static String localPoolRateDriver(String requestId) => '$baseUrl/api/app/customer/pool/requests/$requestId/rate-driver';
  static String get localPoolHistory => '$baseUrl/api/app/customer/pool/history';
  static String get poolIssueReport => '$baseUrl/api/app/customer/pool/issues';
  static String poolIssueDetail(String issueId) => '$baseUrl/api/app/customer/pool/issues/$issueId';
  static String poolIssueList({String? module, String? referenceId}) =>
      '$baseUrl/api/app/customer/pool/issues?module=${module ?? 'all'}${referenceId != null && referenceId.isNotEmpty ? '&referenceId=$referenceId' : ''}';
  static String get poolShare => '$baseUrl/api/app/customer/pool/share';
  static String get poolBlockUser => '$baseUrl/api/app/customer/pool/block-user';

  // ── Voice Booking ────────────────────────────────────────────────────
  static String get voiceBookingParse => '$baseUrl/api/app/voice-booking/parse';

  // ── Dynamic Services (admin-controlled Phase rollout) ─────────────────
  static String get activeServices => '$baseUrl/api/app/services/active';
  static String get servicesForLocation => '$baseUrl/api/app/services/location';
  static String get parcelVehicles => '$baseUrl/api/app/parcel-vehicles';
  static String get parcelVehicleRecommend => '$baseUrl/api/app/parcel-vehicles/recommend';

  // ── App-level public endpoints ────────────────────────────────────────
  static String get appBanners => '$baseUrl/api/app/banners';
  static String get featureFlags => '$baseUrl/api/app/feature-flags';
  static String get platformServices => '$baseUrl/api/app/platform-services';
}
