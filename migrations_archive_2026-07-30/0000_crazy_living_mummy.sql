CREATE TABLE IF NOT EXISTS "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(191) NOT NULL,
	"password" varchar(191) NOT NULL,
	"role" varchar(50) DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" varchar(100) NOT NULL,
	"native_name" varchar(100) NOT NULL,
	"flag" varchar(10) DEFAULT '🌐' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "app_languages_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "b2b_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"contact_person" varchar(255),
	"phone" varchar(20),
	"email" varchar(191),
	"gst_number" varchar(50),
	"address" text,
	"city" varchar(100),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"commission_pct" numeric(5, 2) DEFAULT '10',
	"wallet_balance" numeric(12, 2) DEFAULT '0',
	"total_trips" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "b2b_companies_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"image_url" text,
	"redirect_url" text,
	"zone" varchar(255),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"slug" varchar(255),
	"content" text,
	"image" varchar(255),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "blogs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_name" varchar(191) NOT NULL,
	"value" text NOT NULL,
	"settings_type" varchar(191) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "business_settings_key_name_unique" UNIQUE("key_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cancellation_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reason" text NOT NULL,
	"user_type" varchar(50) DEFAULT 'customer',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coupon_setups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(100) NOT NULL,
	"discount_amount" numeric(23, 3) DEFAULT '0',
	"discount_type" varchar(50) DEFAULT 'amount',
	"min_trip_amount" numeric(23, 3) DEFAULT '0',
	"max_discount_amount" numeric(23, 3) DEFAULT '0',
	"limit_per_user" integer DEFAULT 1,
	"total_usage_limit" integer,
	"start_date" timestamp,
	"end_date" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "coupon_setups_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"discount_amount" numeric(23, 3) DEFAULT '0',
	"discount_type" varchar(50) DEFAULT 'percentage',
	"min_order_amount" numeric(23, 3) DEFAULT '0',
	"max_discount_amount" numeric(23, 3) DEFAULT '0',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"driving_license_id" varchar(191),
	"vehicle_category_id" uuid,
	"zone_id" uuid,
	"availability_status" varchar(50) DEFAULT 'offline',
	"is_online" boolean DEFAULT false,
	"total_trips" integer DEFAULT 0,
	"avg_rating" numeric(3, 2) DEFAULT '0',
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "driver_details_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(191) NOT NULL,
	"phone" varchar(20),
	"role" varchar(50) DEFAULT 'employee',
	"zone_id" uuid,
	"password_hash" varchar(255),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "employees_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"target" varchar(50) DEFAULT 'all' NOT NULL,
	"user_type" varchar(50) DEFAULT 'all' NOT NULL,
	"recipient_count" integer DEFAULT 0,
	"status" varchar(30) DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parcel_attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) DEFAULT 'category' NOT NULL,
	"name" varchar(255) NOT NULL,
	"icon" varchar(100),
	"min_value" numeric(10, 2),
	"max_value" numeric(10, 2),
	"unit" varchar(30),
	"extra_fare" numeric(10, 2) DEFAULT '0',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parcel_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parcel_fares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid,
	"base_fare" numeric(23, 3) DEFAULT '0',
	"fare_per_km" numeric(23, 3) DEFAULT '0',
	"fare_per_kg" numeric(23, 3) DEFAULT '0',
	"minimum_fare" numeric(23, 3) DEFAULT '0',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parcel_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" varchar(255) NOT NULL,
	"min_weight" double precision DEFAULT 0,
	"max_weight" double precision DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referred_id" uuid,
	"referral_code" varchar(20) NOT NULL,
	"referral_type" varchar(30) DEFAULT 'customer' NOT NULL,
	"reward_amount" numeric(10, 2) DEFAULT '0',
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid,
	"reviewer_id" uuid,
	"reviewee_id" uuid,
	"reviewer_type" varchar(50),
	"rating" numeric(3, 1),
	"feedback" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" varchar(50) NOT NULL,
	"address" text NOT NULL,
	"lat" double precision DEFAULT 0 NOT NULL,
	"lng" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "spin_wheel_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" varchar(255) NOT NULL,
	"reward_amount" numeric(23, 3) DEFAULT '0',
	"reward_type" varchar(50) DEFAULT 'amount',
	"probability" numeric(5, 2) DEFAULT '0',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"price" numeric(23, 3) DEFAULT '0',
	"duration_days" integer DEFAULT 30,
	"features" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "surge_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid,
	"start_time" varchar(10),
	"end_time" varchar(10),
	"multiplier" numeric(5, 2) DEFAULT '1',
	"reason" varchar(255),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"trip_id" uuid,
	"account" varchar(50),
	"debit" numeric(23, 3) DEFAULT '0',
	"credit" numeric(23, 3) DEFAULT '0',
	"balance" numeric(23, 3) DEFAULT '0',
	"transaction_type" varchar(100),
	"ref_transaction_id" varchar(255),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_fares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid,
	"vehicle_category_id" uuid,
	"base_fare" numeric(23, 3) DEFAULT '0',
	"fare_per_km" numeric(23, 3) DEFAULT '0',
	"fare_per_min" numeric(23, 3) DEFAULT '0',
	"minimum_fare" numeric(23, 3) DEFAULT '0',
	"cancellation_fee" numeric(23, 3) DEFAULT '0',
	"waiting_charge_per_min" numeric(23, 3) DEFAULT '0',
	"helper_charge" numeric(23, 3) DEFAULT '0',
	"night_charge_multiplier" numeric(23, 3) DEFAULT '1',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"sender_type" varchar(20) DEFAULT 'customer' NOT NULL,
	"sender_name" varchar(255),
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref_id" varchar(20) NOT NULL,
	"customer_id" uuid,
	"driver_id" uuid,
	"vehicle_category_id" uuid,
	"zone_id" uuid,
	"pickup_address" text,
	"destination_address" text,
	"pickup_lat" double precision,
	"pickup_lng" double precision,
	"destination_lat" double precision,
	"destination_lng" double precision,
	"estimated_fare" numeric(23, 3) DEFAULT '0' NOT NULL,
	"actual_fare" numeric(23, 3) DEFAULT '0',
	"estimated_distance" double precision DEFAULT 0,
	"actual_distance" double precision,
	"payment_method" varchar(50) DEFAULT 'cash',
	"payment_status" varchar(50) DEFAULT 'unpaid',
	"type" varchar(50) DEFAULT 'ride',
	"trip_type" varchar(30) DEFAULT 'ride' NOT NULL,
	"current_status" varchar(50) DEFAULT 'pending',
	"is_scheduled" boolean DEFAULT false,
	"scheduled_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "trip_requests_ref_id_unique" UNIQUE("ref_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"user_type" varchar(50) DEFAULT 'driver' NOT NULL,
	"min_points" double precision DEFAULT 0,
	"max_points" double precision DEFAULT 0,
	"reward" double precision DEFAULT 0,
	"reward_type" varchar(50) DEFAULT 'cashback',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(255),
	"first_name" varchar(191),
	"last_name" varchar(191),
	"email" varchar(191),
	"phone" varchar(20),
	"profile_image" varchar(191),
	"user_type" varchar(25) DEFAULT 'customer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"loyalty_points" double precision DEFAULT 0 NOT NULL,
	"verification_status" varchar(30) DEFAULT 'pending' NOT NULL,
	"license_number" varchar(100),
	"license_image" varchar(500),
	"vehicle_image" varchar(500),
	"vehicle_number" varchar(50),
	"vehicle_model" varchar(100),
	"rejection_note" text,
	"password_hash" varchar(255),
	"reset_otp" varchar(10),
	"reset_otp_expiry" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"icon" varchar(255),
	"type" varchar(50) DEFAULT 'ride',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"brand_id" uuid,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid,
	"vehicle_name" varchar(255),
	"registration_no" varchar(100),
	"status" varchar(50) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_bonuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"bonus_amount" numeric(23, 3) DEFAULT '0',
	"bonus_type" varchar(50) DEFAULT 'percentage',
	"minimum_add_amount" numeric(23, 3) DEFAULT '0',
	"max_bonus_amount" numeric(23, 3) DEFAULT '0',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "withdraw_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"amount" numeric(23, 3) DEFAULT '0',
	"note" text,
	"status" varchar(50) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"coordinates" text,
	"service_type" varchar(50) DEFAULT 'both' NOT NULL,
	"surge_factor" double precision DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
