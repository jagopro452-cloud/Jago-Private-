class TripModel {
  final String id;
  final String refId;
  final String pickupAddress;
  final double pickupLat;
  final double pickupLng;
  final String destinationAddress;
  final double destinationLat;
  final double destinationLng;
  final double estimatedFare;
  final double? actualFare;
  final double estimatedDistance;
  final String currentStatus;
  final String paymentMethod;
  final String? pickupOtp;
  final String? customerName;
  final String? customerPhone;
  final double customerRating;
  final String? vehicleName;
  final DateTime? createdAt;

  TripModel({
    required this.id,
    required this.refId,
    required this.pickupAddress,
    required this.pickupLat,
    required this.pickupLng,
    required this.destinationAddress,
    required this.destinationLat,
    required this.destinationLng,
    required this.estimatedFare,
    this.actualFare,
    required this.estimatedDistance,
    required this.currentStatus,
    required this.paymentMethod,
    this.pickupOtp,
    this.customerName,
    this.customerPhone,
    this.customerRating = 5.0,
    this.vehicleName,
    this.createdAt,
  });

  factory TripModel.fromJson(Map<String, dynamic> json) {
    final t = json['trip'] ?? json['activeTrip'] ?? json;
    return TripModel(
      id: t['id'] ?? '',
      refId: t['refId'] ?? t['ref_id'] ?? '',
      pickupAddress: t['pickupAddress'] ?? t['pickup_address'] ?? '',
      pickupLat: double.tryParse(t['pickupLat']?.toString() ?? t['pickup_lat']?.toString() ?? '0') ?? 0,
      pickupLng: double.tryParse(t['pickupLng']?.toString() ?? t['pickup_lng']?.toString() ?? '0') ?? 0,
      destinationAddress: t['destinationAddress'] ?? t['destination_address'] ?? '',
      destinationLat: double.tryParse(t['destinationLat']?.toString() ?? t['destination_lat']?.toString() ?? '0') ?? 0,
      destinationLng: double.tryParse(t['destinationLng']?.toString() ?? t['destination_lng']?.toString() ?? '0') ?? 0,
      estimatedFare: double.tryParse(t['estimatedFare']?.toString() ?? t['estimated_fare']?.toString() ?? '0') ?? 0,
      actualFare: t['actualFare'] != null ? double.tryParse(t['actualFare'].toString()) : null,
      estimatedDistance: double.tryParse(t['estimatedDistance']?.toString() ?? t['estimated_distance']?.toString() ?? '0') ?? 0,
      currentStatus: t['currentStatus'] ?? t['current_status'] ?? 'searching',
      paymentMethod: t['paymentMethod'] ?? t['payment_method'] ?? 'cash',
      pickupOtp: t['pickupOtp'] ?? t['pickup_otp'],
      customerName: t['customerName'] ?? t['customer_name'],
      customerPhone: t['customerPhone'] ?? t['customer_phone'],
      customerRating: double.tryParse(t['customerRating']?.toString() ?? t['customer_rating']?.toString() ?? '5.0') ?? 5.0,
      vehicleName: t['vehicleName'] ?? t['vehicle_name'],
      createdAt: t['createdAt'] != null ? DateTime.tryParse(t['createdAt']) : null,
    );
  }
}

class WalletTransaction {
  final String id;
  final double amount;
  final String type;
  final String description;
  final String status;
  final DateTime createdAt;

  WalletTransaction({
    required this.id,
    required this.amount,
    required this.type,
    required this.description,
    required this.status,
    required this.createdAt,
  });

  factory WalletTransaction.fromJson(Map<String, dynamic> json) {
    return WalletTransaction(
      id: json['id'] ?? '',
      amount: double.tryParse(json['amount']?.toString() ?? '0') ?? 0,
      type: json['type'] ?? 'debit',
      description: json['description'] ?? '',
      status: json['status'] ?? 'completed',
      createdAt: DateTime.tryParse(json['createdAt'] ?? json['created_at'] ?? '') ?? DateTime.now(),
    );
  }
}
