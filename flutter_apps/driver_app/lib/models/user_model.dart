class UserModel {
  final String id;
  final String fullName;
  final String phone;
  final String? email;
  final String? profilePhoto;
  final double rating;
  final double walletBalance;
  final bool isLocked;
  final String? lockReason;
  final bool isOnline;
  final String? vehicleNumber;
  final String? vehicleModel;
  final String? vehicleCategory;
  final String? status;
  final String? referralCode;
  final DriverStats stats;

  UserModel({
    required this.id,
    required this.fullName,
    required this.phone,
    this.email,
    this.profilePhoto,
    this.rating = 5.0,
    this.walletBalance = 0,
    this.isLocked = false,
    this.lockReason,
    this.isOnline = false,
    this.vehicleNumber,
    this.vehicleModel,
    this.vehicleCategory,
    this.status,
    this.referralCode,
    required this.stats,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    final user = json['user'] ?? json;
    return UserModel(
      id: user['id'] ?? '',
      fullName: user['fullName'] ?? user['full_name'] ?? '',
      phone: user['phone'] ?? '',
      email: user['email'],
      profilePhoto: user['profilePhoto'] ?? user['profile_photo'],
      rating: double.tryParse(user['rating']?.toString() ?? '5.0') ?? 5.0,
      walletBalance: double.tryParse(user['walletBalance']?.toString() ?? '0') ?? 0,
      isLocked: user['isLocked'] ?? user['is_locked'] ?? false,
      lockReason: user['lockReason'] ?? user['lock_reason'],
      isOnline: user['isOnline'] ?? user['is_online'] ?? false,
      vehicleNumber: user['vehicleNumber'] ?? user['vehicle_number'],
      vehicleModel: user['vehicleModel'] ?? user['vehicle_model'],
      vehicleCategory: user['vehicleCategory'] ?? user['vehicle_category'],
      status: user['status'],
      referralCode: user['referralCode'] ?? user['referral_code'],
      stats: DriverStats.fromJson(user['stats'] ?? {}),
    );
  }
}

class DriverStats {
  final int completedTrips;
  final double totalEarned;
  final int cancelledTrips;
  final double weeklyEarnings;

  DriverStats({
    this.completedTrips = 0,
    this.totalEarned = 0,
    this.cancelledTrips = 0,
    this.weeklyEarnings = 0,
  });

  factory DriverStats.fromJson(Map<String, dynamic> json) {
    return DriverStats(
      completedTrips: int.tryParse(json['completedTrips']?.toString() ?? '0') ?? 0,
      totalEarned: double.tryParse(json['totalEarned']?.toString() ?? '0') ?? 0,
      cancelledTrips: int.tryParse(json['cancelledTrips']?.toString() ?? '0') ?? 0,
      weeklyEarnings: double.tryParse(json['weeklyEarnings']?.toString() ?? '0') ?? 0,
    );
  }
}
