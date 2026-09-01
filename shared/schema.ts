import { pgTable, text, varchar, boolean, timestamp, doublePrecision, numeric, integer, uuid, jsonb, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const admins = pgTable("admins", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 191 }).notNull().unique(),
  password: varchar("password", { length: 191 }).notNull(),
  role: varchar("role", { length: 50 }).notNull().default("admin"),
  isActive: boolean("is_active").notNull().default(true),
  authToken: text("auth_token"),
  authTokenExpiresAt: timestamp("auth_token_expires_at"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  fullName: varchar("full_name", { length: 255 }),
  firstName: varchar("first_name", { length: 191 }),
  lastName: varchar("last_name", { length: 191 }),
  email: varchar("email", { length: 191 }).unique(),
  phone: varchar("phone", { length: 20 }),
  profileImage: varchar("profile_image", { length: 191 }),
  userType: varchar("user_type", { length: 25 }).notNull().default("customer"),
  isActive: boolean("is_active").notNull().default(true),
  loyaltyPoints: doublePrecision("loyalty_points").notNull().default(0),
  // Driver verification fields
  verificationStatus: varchar("verification_status", { length: 30 }).notNull().default("pending"),
  licenseNumber: varchar("license_number", { length: 100 }),
  licenseImage: varchar("license_image", { length: 500 }),
  vehicleImage: varchar("vehicle_image", { length: 500 }),
  vehicleNumber: varchar("vehicle_number", { length: 50 }),
  vehicleModel: varchar("vehicle_model", { length: 100 }),
  rejectionNote: text("rejection_note"),
  passwordHash: varchar("password_hash", { length: 255 }),
  resetOtp: varchar("reset_otp", { length: 10 }),
  resetOtpExpiry: timestamp("reset_otp_expiry"),
  // Launch Benefit System
  onboardDate: timestamp("onboard_date"),
  freePeriodEnd: timestamp("free_period_end"),
  launchFreeActive: boolean("launch_free_active").default(false),
  // Commission Settlement — driver pending balances
  pendingCommissionBalance: numeric("pending_commission_balance", { precision: 12, scale: 2 }).default("0"),
  pendingGstBalance: numeric("pending_gst_balance", { precision: 12, scale: 2 }).default("0"),
  totalPendingBalance: numeric("total_pending_balance", { precision: 12, scale: 2 }).default("0"),
  lockThreshold: numeric("lock_threshold", { precision: 10, scale: 2 }).default("200"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const parcelAttributes = pgTable("parcel_attributes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  type: varchar("type", { length: 50 }).notNull().default("category"),
  name: varchar("name", { length: 255 }).notNull(),
  icon: varchar("icon", { length: 100 }),
  minValue: numeric("min_value", { precision: 10, scale: 2 }),
  maxValue: numeric("max_value", { precision: 10, scale: 2 }),
  unit: varchar("unit", { length: 30 }),
  extraFare: numeric("extra_fare", { precision: 10, scale: 2 }).default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const vehicleCategories = pgTable("vehicle_categories", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  icon: varchar("icon", { length: 255 }),
  type: varchar("type", { length: 50 }).default("ride"),
  vehicleType: varchar("vehicle_type", { length: 50 }),  // bike, auto, mini_car, sedan, suv, carpool
  serviceType: varchar("service_type", { length: 30 }).default("ride"),
  // Pricing fields (zone-specific overrides live in trip_fares)
  baseFare: numeric("base_fare", { precision: 10, scale: 2 }).default("0"),
  farePerKm: numeric("fare_per_km", { precision: 10, scale: 2 }).default("0"),
  minimumFare: numeric("minimum_fare", { precision: 10, scale: 2 }).default("0"),
  waitingChargePerMin: numeric("waiting_charge_per_min", { precision: 10, scale: 2 }).default("0"),
  // Car Pool fields
  totalSeats: integer("total_seats").default(0),
  isCarpool: boolean("is_carpool").default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const zones = pgTable("zones", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  coordinates: text("coordinates"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  radiusKm: doublePrecision("radius_km").default(5),
  serviceType: varchar("service_type", { length: 50 }).notNull().default("both"),
  surgeFactor: doublePrecision("surge_factor").notNull().default(1.0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const bookingIntents = pgTable("booking_intents", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: uuid("customer_id").notNull().references(() => users.id),
  status: varchar("status", { length: 40 }).notNull().default("initiated"),
  quotedAmount: numeric("quoted_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paymentMethod: varchar("payment_method", { length: 40 }),
  tripType: varchar("trip_type", { length: 40 }).notNull().default("normal"),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  razorpayOrderId: varchar("razorpay_order_id", { length: 120 }),
  razorpayPaymentId: varchar("razorpay_payment_id", { length: 120 }),
  tripId: uuid("trip_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const tripRequests = pgTable("trip_requests", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  refId: varchar("ref_id", { length: 20 }).notNull().unique(),
  customerId: uuid("customer_id").references(() => users.id),
  driverId: uuid("driver_id").references(() => users.id),
  vehicleCategoryId: uuid("vehicle_category_id").references(() => vehicleCategories.id),
  zoneId: uuid("zone_id").references(() => zones.id),
  bookingIntentId: uuid("booking_intent_id").references(() => bookingIntents.id),
  pickupAddress: text("pickup_address"),
  destinationAddress: text("destination_address"),
  pickupLat: doublePrecision("pickup_lat"),
  pickupLng: doublePrecision("pickup_lng"),
  destinationLat: doublePrecision("destination_lat"),
  destinationLng: doublePrecision("destination_lng"),
  estimatedFare: numeric("estimated_fare", { precision: 23, scale: 3 }).notNull().default("0"),
  actualFare: numeric("actual_fare", { precision: 23, scale: 3 }).default("0"),
  estimatedDistance: doublePrecision("estimated_distance").default(0),
  actualDistance: doublePrecision("actual_distance"),
  paymentMethod: varchar("payment_method", { length: 50 }).default("cash"),
  paymentStatus: varchar("payment_status", { length: 50 }).default("unpaid"),
  type: varchar("type", { length: 50 }).default("ride"),
  tripType: varchar("trip_type", { length: 30 }).notNull().default("ride"),
  currentStatus: varchar("current_status", { length: 50 }).default("pending"),
  isScheduled: boolean("is_scheduled").default(false),
  scheduledAt: timestamp("scheduled_at"),
  // Pricing & launch offer fields
  rideFullFare: numeric("ride_full_fare", { precision: 23, scale: 3 }).default("0"),
  userDiscount: numeric("user_discount", { precision: 23, scale: 3 }).default("0"),
  userPayable: numeric("user_payable", { precision: 23, scale: 3 }).default("0"),
  gstAmount: numeric("gst_amount", { precision: 23, scale: 3 }).default("0"),
  driverWalletCredit: numeric("driver_wallet_credit", { precision: 23, scale: 3 }).default("0"),
  // Vehicle & carpool fields
  vehicleTypeName: varchar("vehicle_type_name", { length: 100 }),
  seatsBooked: integer("seats_booked").default(1),
  seatPrice: numeric("seat_price", { precision: 10, scale: 2 }).default("0"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id),
  tripId: uuid("trip_id").references(() => tripRequests.id),
  account: varchar("account", { length: 50 }),
  debit: numeric("debit", { precision: 23, scale: 3 }).default("0"),
  credit: numeric("credit", { precision: 23, scale: 3 }).default("0"),
  balance: numeric("balance", { precision: 23, scale: 3 }).default("0"),
  transactionType: varchar("transaction_type", { length: 100 }),
  refTransactionId: varchar("ref_transaction_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const businessSettings = pgTable("business_settings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  keyName: varchar("key_name", { length: 191 }).notNull().unique(),
  value: text("value").notNull(),
  settingsType: varchar("settings_type", { length: 191 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const tripFares = pgTable("trip_fares", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  zoneId: uuid("zone_id").references(() => zones.id),
  vehicleCategoryId: uuid("vehicle_category_id").references(() => vehicleCategories.id),
  baseFare: numeric("base_fare", { precision: 23, scale: 3 }).default("0"),
  farePerKm: numeric("fare_per_km", { precision: 23, scale: 3 }).default("0"),
  farePerMin: numeric("fare_per_min", { precision: 23, scale: 3 }).default("0"),
  minimumFare: numeric("minimum_fare", { precision: 23, scale: 3 }).default("0"),
  cancellationFee: numeric("cancellation_fee", { precision: 23, scale: 3 }).default("0"),
  waitingChargePerMin: numeric("waiting_charge_per_min", { precision: 23, scale: 3 }).default("0"),
  helperCharge: numeric("helper_charge", { precision: 23, scale: 3 }).default("0"),
  nightChargeMultiplier: numeric("night_charge_multiplier", { precision: 23, scale: 3 }).default("1"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const couponSetups = pgTable("coupon_setups", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  discountAmount: numeric("discount_amount", { precision: 23, scale: 3 }).default("0"),
  discountType: varchar("discount_type", { length: 50 }).default("amount"),
  minTripAmount: numeric("min_trip_amount", { precision: 23, scale: 3 }).default("0"),
  maxDiscountAmount: numeric("max_discount_amount", { precision: 23, scale: 3 }).default("0"),
  limitPerUser: integer("limit_per_user").default(1),
  totalUsageLimit: integer("total_usage_limit"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tripId: uuid("trip_id").references(() => tripRequests.id),
  reviewerId: uuid("reviewer_id").references(() => users.id),
  revieweeId: uuid("reviewee_id").references(() => users.id),
  reviewerType: varchar("reviewer_type", { length: 50 }),
  rating: numeric("rating", { precision: 3, scale: 1 }),
  feedback: text("feedback"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const driverDetails = pgTable("driver_details", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").unique().references(() => users.id),
  drivingLicenseId: varchar("driving_license_id", { length: 191 }),
  vehicleCategoryId: uuid("vehicle_category_id").references(() => vehicleCategories.id),
  zoneId: uuid("zone_id").references(() => zones.id),
  availabilityStatus: varchar("availability_status", { length: 50 }).default("offline"),
  isOnline: boolean("is_online").default(false),
  totalTrips: integer("total_trips").default(0),
  avgRating: numeric("avg_rating", { precision: 3, scale: 2 }).default("0"),
  carShareEnabled: boolean("car_share_enabled").default(false),
  intercityEnabled: boolean("intercity_enabled").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const cancellationReasons = pgTable("cancellation_reasons", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  reason: text("reason").notNull(),
  userType: varchar("user_type", { length: 50 }).default("customer"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const blogs = pgTable("blogs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).unique(),
  content: text("content"),
  image: varchar("image", { length: 255 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const withdrawRequests = pgTable("withdraw_requests", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id),
  driverPaymentId: uuid("driver_payment_id"),
  amount: numeric("amount", { precision: 23, scale: 3 }).default("0"),
  note: text("note"),
  status: varchar("status", { length: 50 }).default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const banners = pgTable("banners", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 255 }).notNull(),
  imageUrl: text("image_url"),
  redirectUrl: text("redirect_url"),
  zone: varchar("zone", { length: 255 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const discounts = pgTable("discounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  discountAmount: numeric("discount_amount", { precision: 23, scale: 3 }).default("0"),
  discountType: varchar("discount_type", { length: 50 }).default("percentage"),
  minOrderAmount: numeric("min_order_amount", { precision: 23, scale: 3 }).default("0"),
  maxDiscountAmount: numeric("max_discount_amount", { precision: 23, scale: 3 }).default("0"),
  isActive: boolean("is_active").default(true),
  serviceType: varchar("service_type", { length: 50 }).default("both"),
  vehicleCategoryId: uuid("vehicle_category_id").references(() => vehicleCategories.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const spinWheelItems = pgTable("spin_wheel_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  label: varchar("label", { length: 255 }).notNull(),
  rewardAmount: numeric("reward_amount", { precision: 23, scale: 3 }).default("0"),
  rewardType: varchar("reward_type", { length: 50 }).default("wallet"),
  probability: numeric("probability", { precision: 5, scale: 2 }).default("0"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userLevels = pgTable("user_levels", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  userType: varchar("user_type", { length: 50 }).notNull().default("driver"),
  minPoints: doublePrecision("min_points").default(0),
  maxPoints: doublePrecision("max_points").default(0),
  reward: doublePrecision("reward").default(0),
  rewardType: varchar("reward_type", { length: 50 }).default("cashback"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 191 }).notNull().unique(),
  phone: varchar("phone", { length: 20 }),
  role: varchar("role", { length: 50 }).default("employee"),
  zoneId: uuid("zone_id").references(() => zones.id),
  passwordHash: varchar("password_hash", { length: 255 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  // Links this HR profile record to its authentication identity in `admins`.
  // Employees do not authenticate directly (see admin_id) — admins is the
  // sole identity/session/authorization source.
  adminId: uuid("admin_id").references(() => admins.id),
});

export const b2bCompanies = pgTable("b2b_companies", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // Admin-managed fields
  companyName: varchar("company_name", { length: 255 }).notNull(),
  contactPerson: varchar("contact_person", { length: 255 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 191 }).unique(),
  gstNumber: varchar("gst_number", { length: 50 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }).default("10"),
  walletBalance: numeric("wallet_balance", { precision: 12, scale: 2 }).default("0"),
  totalTrips: integer("total_trips").default(0),
  // App-registration fields (added via ALTER TABLE migration)
  ownerId: uuid("owner_id").references(() => users.id),
  contactName: varchar("contact_name", { length: 255 }),
  contactPhone: varchar("contact_phone", { length: 20 }),
  deliveryPlan: varchar("delivery_plan", { length: 50 }).default("pay_per_delivery"),
  creditLimit: numeric("credit_limit", { precision: 10, scale: 2 }).default("0"),
  isActive: boolean("is_active").default(true),
  webhookUrl: text("webhook_url"),
  webhookSecret: varchar("webhook_secret", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const parcelCategories = pgTable("parcel_categories", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const parcelWeights = pgTable("parcel_weights", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  label: varchar("label", { length: 255 }).notNull(),
  minWeight: doublePrecision("min_weight").default(0),
  maxWeight: doublePrecision("max_weight").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const vehicleBrands = pgTable("vehicle_brands", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const vehicleModels = pgTable("vehicle_models", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  brandId: uuid("brand_id").references(() => vehicleBrands.id),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const parcelFares = pgTable("parcel_fares", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  zoneId: uuid("zone_id").references(() => zones.id),
  baseFare: numeric("base_fare", { precision: 23, scale: 3 }).default("0"),
  farePerKm: numeric("fare_per_km", { precision: 23, scale: 3 }).default("0"),
  farePerKg: numeric("fare_per_kg", { precision: 23, scale: 3 }).default("0"),
  minimumFare: numeric("minimum_fare", { precision: 23, scale: 3 }).default("0"),
  loadingCharge: numeric("loading_charge", { precision: 23, scale: 3 }).default("0"),
  helperChargePerHour: numeric("helper_charge_per_hour", { precision: 23, scale: 3 }).default("0"),
  maxHelpers: integer("max_helpers").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const surgePricing = pgTable("surge_pricing", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  zoneId: uuid("zone_id").references(() => zones.id),
  startTime: varchar("start_time", { length: 10 }),
  endTime: varchar("end_time", { length: 10 }),
  multiplier: numeric("multiplier", { precision: 5, scale: 2 }).default("1"),
  reason: varchar("reason", { length: 255 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const vehicleRequests = pgTable("vehicle_requests", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: uuid("driver_id").references(() => users.id),
  vehicleName: varchar("vehicle_name", { length: 255 }),
  registrationNo: varchar("registration_no", { length: 100 }),
  status: varchar("status", { length: 50 }).default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const walletBonuses = pgTable("wallet_bonuses", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  bonusAmount: numeric("bonus_amount", { precision: 23, scale: 3 }).default("0"),
  bonusType: varchar("bonus_type", { length: 50 }).default("percentage"),
  minimumAddAmount: numeric("minimum_add_amount", { precision: 23, scale: 3 }).default("0"),
  maxBonusAmount: numeric("max_bonus_amount", { precision: 23, scale: 3 }).default("0"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const subscriptionPlans = pgTable("subscription_plans", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  price: numeric("price", { precision: 23, scale: 3 }).default("0"),
  durationDays: integer("duration_days").default(30),
  features: text("features"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const referrals = pgTable("referrals", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  referrerId: uuid("referrer_id").notNull().references(() => users.id),
  referredId: uuid("referred_id").references(() => users.id),
  referralCode: varchar("referral_code", { length: 30 }).notNull(),
  referralType: varchar("referral_type", { length: 30 }).notNull().default("customer"),
  rewardAmount: numeric("reward_amount", { precision: 10, scale: 2 }).default("0"),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const franchiseServiceAssignments = pgTable("franchise_service_assignments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  franchiseeId: uuid("franchisee_id").notNull(),
  serviceKey: varchar("service_key", { length: 80 }).notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  updatedBy: varchar("updated_by", { length: 191 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const notificationLogs = pgTable("notification_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  target: varchar("target", { length: 80 }).notNull().default("all"),
  userType: varchar("user_type", { length: 80 }).notNull().default("all"),
  recipientCount: integer("recipient_count").default(0),
  status: varchar("status", { length: 80 }).notNull().default("sent"),
  sentAt: timestamp("sent_at").defaultNow(),
});

export const savedPlaces = pgTable("saved_places", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id),
  label: varchar("label", { length: 50 }).notNull(),
  address: text("address").notNull(),
  lat: doublePrecision("lat").notNull().default(0),
  lng: doublePrecision("lng").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTripSchema = createInsertSchema(tripRequests).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCouponSchema = createInsertSchema(couponSetups).omit({ id: true, createdAt: true });
export const insertZoneSchema = createInsertSchema(zones).omit({ id: true, createdAt: true });
export const insertVehicleCategorySchema = createInsertSchema(vehicleCategories).omit({ id: true, createdAt: true });
export const insertBlogSchema = createInsertSchema(blogs).omit({ id: true, createdAt: true });

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type TripRequest = typeof tripRequests.$inferSelect;
export type InsertTripRequest = z.infer<typeof insertTripSchema>;
export type VehicleCategory = typeof vehicleCategories.$inferSelect;
export type Zone = typeof zones.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type BusinessSetting = typeof businessSettings.$inferSelect;
export const appLanguages = pgTable("app_languages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 10 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  nativeName: varchar("native_name", { length: 100 }).notNull(),
  flag: varchar("flag", { length: 10 }).notNull().default("🌐"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAppLanguageSchema = createInsertSchema(appLanguages).omit({ id: true, createdAt: true });
export type InsertAppLanguage = z.infer<typeof insertAppLanguageSchema>;
export type AppLanguage = typeof appLanguages.$inferSelect;

export const tripMessages = pgTable("trip_messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  tripId: uuid("trip_id").notNull().references(() => tripRequests.id),
  senderId: uuid("sender_id").notNull().references(() => users.id),
  senderType: varchar("sender_type", { length: 20 }).notNull().default("customer"),
  senderName: varchar("sender_name", { length: 255 }),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTripMessageSchema = createInsertSchema(tripMessages).omit({ id: true, createdAt: true });
export type InsertTripMessage = z.infer<typeof insertTripMessageSchema>;
export type TripMessage = typeof tripMessages.$inferSelect;

// Local pool rides — dynamic on-demand seat matching for city carpool
export const localPoolRides = pgTable("local_pool_rides", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: uuid("driver_id").references(() => users.id),
  vehicleCategoryId: uuid("vehicle_category_id").references(() => vehicleCategories.id),
  pickupLat: doublePrecision("pickup_lat"),
  pickupLng: doublePrecision("pickup_lng"),
  destinationLat: doublePrecision("destination_lat"),
  destinationLng: doublePrecision("destination_lng"),
  routeBearingDeg: doublePrecision("route_bearing_deg"),
  pickupAddress: text("pickup_address"),
  destinationAddress: text("destination_address"),
  maxSeats: integer("max_seats").default(4),
  bookedSeats: integer("booked_seats").default(0),
  farePerSeat: numeric("fare_per_seat", { precision: 10, scale: 2 }).default("0"),
  distanceKm: doublePrecision("distance_km").default(0),
  status: varchar("status", { length: 30 }).default("collecting"),
  collectionDeadline: timestamp("collection_deadline"),
  zoneId: uuid("zone_id").references(() => zones.id),
  dispatchTripId: uuid("dispatch_trip_id").references(() => tripRequests.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Passengers within a local pool ride
export const localPoolPassengers = pgTable("local_pool_passengers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  poolRideId: uuid("pool_ride_id").notNull().references(() => localPoolRides.id),
  tripRequestId: uuid("trip_request_id").references(() => tripRequests.id),
  customerId: uuid("customer_id").notNull().references(() => users.id),
  pickupLat: doublePrecision("pickup_lat"),
  pickupLng: doublePrecision("pickup_lng"),
  dropLat: doublePrecision("drop_lat"),
  dropLng: doublePrecision("drop_lng"),
  pickupAddress: text("pickup_address"),
  dropAddress: text("drop_address"),
  seatsBooked: integer("seats_booked").default(1),
  farePerSeat: numeric("fare_per_seat", { precision: 10, scale: 2 }).default("0"),
  totalFare: numeric("total_fare", { precision: 10, scale: 2 }).default("0"),
  distanceKm: doublePrecision("distance_km").default(0),
  paymentMethod: varchar("payment_method", { length: 40 }).default("cash"),
  status: varchar("status", { length: 30 }).default("booked"),
  pickupOrder: integer("pickup_order").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type LocalPoolRide = typeof localPoolRides.$inferSelect;
export type LocalPoolPassenger = typeof localPoolPassengers.$inferSelect;

export type TripFare = typeof tripFares.$inferSelect;
export type CouponSetup = typeof couponSetups.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type DriverDetail = typeof driverDetails.$inferSelect;
export type CancellationReason = typeof cancellationReasons.$inferSelect;
export type Blog = typeof blogs.$inferSelect;
export type WithdrawRequest = typeof withdrawRequests.$inferSelect;
export type Admin = typeof admins.$inferSelect;

// ── Financial / franchisee tables (typed additively — schema was previously
// raw-SQL only; these definitions are read-only additions, no existing query
// was changed to use them). Column shapes verified against
// migrations/0000_baseline.sql (and cross-checked for later ALTER TABLE
// drift, of which none was found for these tables). ──────────────────────────

export const customerPayments = pgTable("customer_payments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: uuid("customer_id").notNull().references(() => users.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paymentType: varchar("payment_type", { length: 60 }).notNull().default("wallet_topup"),
  razorpayOrderId: varchar("razorpay_order_id", { length: 120 }),
  razorpayPaymentId: varchar("razorpay_payment_id", { length: 120 }),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  failureReason: text("failure_reason"),
  description: text("description"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  tripId: uuid("trip_id").references(() => tripRequests.id),
  bookingIntentId: uuid("booking_intent_id"),
  paymentContext: jsonb("payment_context").notNull().default({}),
});

export const driverPayments = pgTable("driver_payments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: uuid("driver_id").notNull().references(() => users.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paymentType: varchar("payment_type", { length: 60 }).notNull().default("commission_debit"),
  razorpayOrderId: varchar("razorpay_order_id", { length: 120 }),
  razorpayPaymentId: varchar("razorpay_payment_id", { length: 120 }),
  tripId: uuid("trip_id").references(() => tripRequests.id),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  description: text("description"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  failureReason: text("failure_reason"),
  paymentPurpose: varchar("payment_purpose", { length: 60 }).notNull().default("driver_payment"),
  customerId: uuid("customer_id"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  planId: uuid("plan_id"),
  insurancePlanId: uuid("insurance_plan_id"),
  paymentContext: jsonb("payment_context").notNull().default({}),
});

export const commissionSettlements = pgTable("commission_settlements", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: uuid("driver_id").references(() => users.id),
  tripId: uuid("trip_id").references(() => tripRequests.id),
  settlementType: varchar("settlement_type", { length: 50 }).default("commission"),
  commissionAmount: numeric("commission_amount", { precision: 12, scale: 2 }).default("0"),
  gstAmount: numeric("gst_amount", { precision: 12, scale: 2 }).default("0"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).default("0"),
  direction: varchar("direction", { length: 20 }).default("debit"),
  balanceBefore: numeric("balance_before", { precision: 12, scale: 2 }).default("0"),
  balanceAfter: numeric("balance_after", { precision: 12, scale: 2 }).default("0"),
  serviceType: varchar("service_type", { length: 50 }),
  paymentMethod: varchar("payment_method", { length: 30 }),
  razorpayPaymentId: text("razorpay_payment_id"),
  razorpayOrderId: text("razorpay_order_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  rideFare: numeric("ride_fare", { precision: 12, scale: 2 }).default("0"),
  description: text("description"),
});

export const walletEvents = pgTable("wallet_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  type: varchar("type", { length: 16 }).notNull(),
  reason: text("reason").notNull(),
  refId: text("ref_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companyWalletEvents = pgTable("company_wallet_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: uuid("company_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  type: varchar("type", { length: 16 }).notNull(),
  reason: text("reason").notNull(),
  refId: text("ref_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const franchisees = pgTable("franchisees", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  ownerName: varchar("owner_name", { length: 255 }).notNull(),
  email: varchar("email", { length: 191 }).notNull(),
  password: varchar("password", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  whatsapp: varchar("whatsapp", { length: 30 }),
  zoneId: uuid("zone_id").references(() => zones.id),
  commissionType: varchar("commission_type", { length: 20 }).notNull().default("percentage"),
  commissionPercent: numeric("commission_percent", { precision: 8, scale: 2 }).default("0"),
  commissionFlat: numeric("commission_flat", { precision: 10, scale: 2 }).default("0"),
  isActive: boolean("is_active").notNull().default(true),
  address: text("address"),
  city: varchar("city", { length: 120 }),
  state: varchar("state", { length: 120 }),
  pincode: varchar("pincode", { length: 12 }),
  bankName: varchar("bank_name", { length: 120 }),
  bankAccount: varchar("bank_account", { length: 64 }),
  bankIfsc: varchar("bank_ifsc", { length: 20 }),
  bankHolderName: varchar("bank_holder_name", { length: 120 }),
  gstNumber: varchar("gst_number", { length: 20 }),
  panNumber: varchar("pan_number", { length: 20 }),
  agreementDate: date("agreement_date"),
  contractEndDate: date("contract_end_date"),
  minGuaranteed: numeric("min_guaranteed", { precision: 12, scale: 2 }).default("0"),
  payoutCycle: varchar("payout_cycle", { length: 20 }).default("monthly"),
  totalPaidOut: numeric("total_paid_out", { precision: 14, scale: 2 }).default("0"),
  notes: text("notes"),
  photoUrl: text("photo_url"),
  altContactName: varchar("alt_contact_name", { length: 120 }),
  altContactPhone: varchar("alt_contact_phone", { length: 30 }),
  franchiseType: varchar("franchise_type", { length: 30 }).default("area"),
  serviceAreaDesc: text("service_area_desc"),
  website: text("website"),
  authToken: text("auth_token"),
  authTokenExpiresAt: timestamp("auth_token_expires_at"),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const franchisePayouts = pgTable("franchise_payouts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  franchiseeId: uuid("franchisee_id").notNull().references(() => franchisees.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  status: varchar("status", { length: 20 }).default("paid"),
  paymentMethod: varchar("payment_method", { length: 40 }),
  paymentRef: varchar("payment_ref", { length: 120 }),
  notes: text("notes"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CustomerPayment = typeof customerPayments.$inferSelect;
export type DriverPayment = typeof driverPayments.$inferSelect;
export type CommissionSettlement = typeof commissionSettlements.$inferSelect;
export type WalletEvent = typeof walletEvents.$inferSelect;
export type CompanyWalletEvent = typeof companyWalletEvents.$inferSelect;
export type Franchisee = typeof franchisees.$inferSelect;
export type FranchisePayout = typeof franchisePayouts.$inferSelect;
