CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
--> statement-breakpoint
COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.admin_login_otp (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    otp character varying(10) NOT NULL,
    is_used boolean DEFAULT false NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.admin_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_email character varying(191),
    action character varying(100) NOT NULL,
    entity_type character varying(80) NOT NULL,
    entity_id uuid,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.admin_otp_resets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(191) NOT NULL,
    otp character varying(10) NOT NULL,
    is_used boolean DEFAULT false NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.admin_refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    session_id uuid NOT NULL,
    token text NOT NULL,
    device_id text NOT NULL,
    ip_address text,
    user_agent text,
    expires_at timestamp without time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    revoked_at timestamp without time zone,
    replaced_by_token text,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.admin_revenue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid,
    customer_id uuid,
    trip_id uuid,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    revenue_type character varying(60) NOT NULL,
    breakdown jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.admin_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    token text NOT NULL,
    device_id text NOT NULL,
    ip_address text,
    user_agent text,
    expires_at timestamp without time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    revoked_at timestamp without time zone,
    last_active_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.admins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(191) NOT NULL,
    password character varying(191) NOT NULL,
    role character varying(50) DEFAULT 'admin'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.ai_safety_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_id uuid,
    driver_id uuid,
    customer_id uuid,
    alert_type character varying(50) NOT NULL,
    severity character varying(20) DEFAULT 'medium'::character varying,
    message text,
    lat double precision,
    lng double precision,
    resolved boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.app_languages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(10) NOT NULL,
    name character varying(100) NOT NULL,
    native_name character varying(100) NOT NULL,
    flag character varying(10) DEFAULT '🌐'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.b2b_companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name character varying(255) NOT NULL,
    contact_person character varying(255),
    phone character varying(20),
    email character varying(191),
    gst_number character varying(50),
    address text,
    city character varying(100),
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    commission_pct numeric(5,2) DEFAULT '10'::numeric,
    wallet_balance numeric(12,2) DEFAULT '0'::numeric,
    total_trips integer DEFAULT 0,
    owner_id uuid,
    contact_name character varying(255),
    contact_phone character varying(20),
    delivery_plan character varying(50) DEFAULT 'pay_per_delivery'::character varying,
    credit_limit numeric(10,2) DEFAULT '0'::numeric,
    is_active boolean DEFAULT true,
    webhook_url text,
    webhook_secret character varying(255),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    b2b_email character varying(255),
    b2b_password_hash character varying(255)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.b2b_webhook_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    event_type character varying(50),
    order_id uuid,
    payload jsonb,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.banners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(255) NOT NULL,
    image_url text,
    redirect_url text,
    zone character varying(255),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.blogs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(255) NOT NULL,
    slug character varying(255),
    content text,
    image character varying(255),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.booking_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    status character varying(40) DEFAULT 'initiated'::character varying NOT NULL,
    quoted_amount numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    payment_method character varying(40),
    trip_type character varying(40) DEFAULT 'normal'::character varying NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    razorpay_order_id character varying(120),
    razorpay_payment_id character varying(120),
    trip_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    recovery_attempts integer DEFAULT 0 NOT NULL,
    last_recovery_at timestamp with time zone,
    recovered_at timestamp with time zone,
    recovery_error text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.business_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key_name character varying(191) NOT NULL,
    value text NOT NULL,
    settings_type character varying(191) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.cancellation_reasons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reason text NOT NULL,
    user_type character varying(50) DEFAULT 'customer'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.car_sharing_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ride_id uuid,
    customer_id uuid,
    seats_booked integer DEFAULT 1,
    total_fare numeric(10,2) DEFAULT 0,
    status character varying(30) DEFAULT 'confirmed'::character varying,
    payment_status character varying(30) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    booking_otp character varying(10),
    cancelled_reason text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.car_sharing_rides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid,
    vehicle_category_id uuid,
    zone_id uuid,
    from_location text,
    to_location text,
    departure_time timestamp without time zone,
    seat_price numeric(10,2) DEFAULT 0,
    max_seats integer DEFAULT 4,
    seats_booked integer DEFAULT 0,
    status character varying(30) DEFAULT 'scheduled'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    notes text,
    vehicle_info text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.car_sharing_settings (
    key_name character varying(120) NOT NULL,
    value text NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.city_parcel_vehicles (
    id integer NOT NULL,
    city_name character varying(120) NOT NULL,
    vehicle_key character varying(100) NOT NULL,
    eta_minutes integer DEFAULT 5,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS public.city_parcel_vehicles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE public.city_parcel_vehicles_id_seq OWNED BY public.city_parcel_vehicles.id;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.city_services (
    id integer NOT NULL,
    city_name character varying(120) NOT NULL,
    city_lat double precision,
    city_lng double precision,
    service_key character varying(100) NOT NULL,
    radius_km double precision DEFAULT 30,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS public.city_services_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE public.city_services_id_seq OWNED BY public.city_services.id;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.coins_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount integer DEFAULT 0 NOT NULL,
    type character varying(50) NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.commission_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid,
    trip_id uuid,
    settlement_type character varying(50) DEFAULT 'commission'::character varying,
    commission_amount numeric(12,2) DEFAULT 0,
    gst_amount numeric(12,2) DEFAULT 0,
    total_amount numeric(12,2) DEFAULT 0,
    direction character varying(20) DEFAULT 'debit'::character varying,
    balance_before numeric(12,2) DEFAULT 0,
    balance_after numeric(12,2) DEFAULT 0,
    service_type character varying(50),
    payment_method character varying(30),
    razorpay_payment_id text,
    razorpay_order_id text,
    notes text,
    created_at timestamp without time zone DEFAULT now(),
    ride_fare numeric(12,2) DEFAULT 0,
    description text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.company_gst_wallet (
    id integer NOT NULL,
    balance numeric(14,2) DEFAULT 0,
    total_collected numeric(14,2) DEFAULT 0,
    total_trips integer DEFAULT 0,
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS public.company_gst_wallet_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE public.company_gst_wallet_id_seq OWNED BY public.company_gst_wallet.id;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.company_wallet_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    type character varying(16) NOT NULL,
    reason text NOT NULL,
    ref_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.coupon_setups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(100) NOT NULL,
    discount_amount numeric(23,3) DEFAULT '0'::numeric,
    discount_type character varying(50) DEFAULT 'amount'::character varying,
    min_trip_amount numeric(23,3) DEFAULT '0'::numeric,
    max_discount_amount numeric(23,3) DEFAULT '0'::numeric,
    limit_per_user integer DEFAULT 1,
    total_usage_limit integer,
    start_date timestamp without time zone,
    end_date timestamp without time zone,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.customer_no_shows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    trip_id uuid NOT NULL,
    reason character varying(120),
    charge_amount numeric(10,2) DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.customer_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    payment_type character varying(60) DEFAULT 'wallet_topup'::character varying NOT NULL,
    razorpay_order_id character varying(120),
    razorpay_payment_id character varying(120),
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    failure_reason text,
    description text,
    verified_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    trip_id uuid,
    booking_intent_id uuid,
    payment_context jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.customer_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    city character varying(120),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.demand_predictions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    zone_id uuid,
    service_type character varying(30) DEFAULT 'ride'::character varying,
    predicted_demand numeric(10,2) DEFAULT 0,
    actual_demand numeric(10,2),
    prediction_window timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.discounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    discount_amount numeric(23,3) DEFAULT '0'::numeric,
    discount_type character varying(50) DEFAULT 'percentage'::character varying,
    min_order_amount numeric(23,3) DEFAULT '0'::numeric,
    max_discount_amount numeric(23,3) DEFAULT '0'::numeric,
    is_active boolean DEFAULT true,
    service_type character varying(50) DEFAULT 'both'::character varying,
    vehicle_category_id uuid,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.dispatch_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    status character varying(50) NOT NULL,
    drivers_contacted integer DEFAULT 0,
    drivers_rejected integer DEFAULT 0,
    final_driver_id uuid,
    started_at timestamp without time zone DEFAULT now(),
    completed_at timestamp without time zone,
    total_duration_ms integer,
    error_reason text,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    document_type character varying(100),
    doc_url text,
    submitted_at timestamp without time zone DEFAULT now(),
    status character varying(30) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.driver_behavior_scores (
    driver_id uuid NOT NULL,
    overall_score integer DEFAULT 50,
    rating_score integer DEFAULT 50,
    acceptance_rate integer DEFAULT 50,
    completion_rate integer DEFAULT 50,
    on_time_arrival integer DEFAULT 50,
    grade character varying(10) DEFAULT 'B'::character varying,
    total_trips integer DEFAULT 0,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.driver_details (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    driving_license_id character varying(191),
    vehicle_category_id uuid,
    zone_id uuid,
    availability_status character varying(50) DEFAULT 'offline'::character varying,
    is_online boolean DEFAULT false,
    total_trips integer DEFAULT 0,
    avg_rating numeric(3,2) DEFAULT '0'::numeric,
    created_at timestamp without time zone DEFAULT now(),
    vehicle_type character varying(60),
    updated_at timestamp without time zone DEFAULT now(),
    parcel_eligibility boolean DEFAULT true,
    pool_eligibility boolean DEFAULT true,
    outstation_eligibility boolean DEFAULT true,
    intercity_eligibility boolean DEFAULT true,
    seat_capacity integer DEFAULT 4,
    approval_state character varying(30) DEFAULT 'approved'::character varying,
    vehicle_subcategory character varying(50),
    city_eligibility text[] DEFAULT '{}'::text[],
    service_eligibility text[] DEFAULT '{}'::text[]
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.driver_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    doc_type character varying(50) NOT NULL,
    doc_url text,
    expiry_date text,
    verification_status character varying(30) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    file_data text,
    mime_type character varying(100),
    admin_note text,
    reviewed_at timestamp with time zone,
    file_url text,
    status character varying(30) DEFAULT 'pending'::character varying
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.driver_insurance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    plan_id uuid,
    start_date date,
    end_date date,
    payment_amount numeric(10,2) DEFAULT 0,
    payment_status character varying(30) DEFAULT 'pending'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.driver_locations (
    driver_id uuid NOT NULL,
    lat double precision,
    lng double precision,
    heading double precision DEFAULT 0,
    speed double precision DEFAULT 0,
    is_online boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.driver_no_shows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    trip_id uuid NOT NULL,
    reason character varying(120),
    penalty_amount numeric(10,2) DEFAULT 0,
    rating_deduction numeric(3,2) DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.driver_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    payment_type character varying(60) DEFAULT 'commission_debit'::character varying NOT NULL,
    razorpay_order_id character varying(120),
    razorpay_payment_id character varying(120),
    trip_id uuid,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    description text,
    verified_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    failure_reason text,
    payment_purpose character varying(60) DEFAULT 'driver_payment'::character varying NOT NULL,
    customer_id uuid,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    plan_id uuid,
    insurance_plan_id uuid,
    payment_context jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.driver_pool_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    vehicle_category_id uuid,
    status character varying(32) DEFAULT 'idle'::character varying,
    accepting_new_requests boolean DEFAULT true,
    pool_vehicle_type character varying(50),
    max_seats integer DEFAULT 4,
    available_seats integer DEFAULT 4,
    current_lat double precision,
    current_lng double precision,
    current_bearing_deg double precision,
    heading double precision,
    speed double precision,
    route_plan jsonb,
    state_version integer DEFAULT 0,
    last_location_at timestamp without time zone,
    ended_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    total_passengers_served integer DEFAULT 0 NOT NULL,
    total_earnings numeric(10,2) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.driver_stats (
    driver_id uuid NOT NULL,
    total_trips integer DEFAULT 0,
    completed_trips integer DEFAULT 0,
    cancelled_trips integer DEFAULT 0,
    avg_response_time_sec numeric(10,2) DEFAULT 60,
    completion_rate numeric(5,2) DEFAULT 0.8,
    avg_rating numeric(3,2) DEFAULT 5,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.driver_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    plan_id uuid,
    start_date timestamp without time zone DEFAULT now(),
    end_date timestamp without time zone,
    amount numeric(10,2) DEFAULT 0,
    payment_status character varying(30) DEFAULT 'pending'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    razorpay_subscription_id character varying(120),
    razorpay_order_id character varying(120),
    razorpay_payment_id character varying(120),
    subscription_status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    failure_reason text,
    status character varying(30),
    payment_amount numeric(12,2),
    rides_used integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(191) NOT NULL,
    phone character varying(20),
    role character varying(50) DEFAULT 'employee'::character varying,
    zone_id uuid,
    password_hash character varying(255),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.franchise_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    franchisee_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    period_start date,
    period_end date,
    status character varying(20) DEFAULT 'paid'::character varying,
    payment_method character varying(40),
    payment_ref character varying(120),
    notes text,
    paid_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.franchise_service_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    franchisee_id uuid NOT NULL,
    service_key character varying(80) NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    updated_by character varying(191),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.franchisees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    owner_name character varying(255) NOT NULL,
    email character varying(191) NOT NULL,
    password character varying(255) NOT NULL,
    phone character varying(30),
    whatsapp character varying(30),
    zone_id uuid,
    commission_type character varying(20) DEFAULT 'percentage'::character varying NOT NULL,
    commission_percent numeric(8,2) DEFAULT 0,
    commission_flat numeric(10,2) DEFAULT 0,
    is_active boolean DEFAULT true NOT NULL,
    address text,
    city character varying(120),
    state character varying(120),
    pincode character varying(12),
    bank_name character varying(120),
    bank_account character varying(64),
    bank_ifsc character varying(20),
    bank_holder_name character varying(120),
    gst_number character varying(20),
    pan_number character varying(20),
    agreement_date date,
    contract_end_date date,
    min_guaranteed numeric(12,2) DEFAULT 0,
    payout_cycle character varying(20) DEFAULT 'monthly'::character varying,
    total_paid_out numeric(14,2) DEFAULT 0,
    notes text,
    photo_url text,
    alt_contact_name character varying(120),
    alt_contact_phone character varying(30),
    franchise_type character varying(30) DEFAULT 'area'::character varying,
    service_area_desc text,
    website text,
    auth_token text,
    auth_token_expires_at timestamp without time zone,
    last_login_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.fraud_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    user_type character varying(20) NOT NULL,
    flag_type character varying(50) NOT NULL,
    severity character varying(20) DEFAULT 'medium'::character varying,
    description text,
    evidence jsonb DEFAULT '{}'::jsonb,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.hardening_settings (
    id integer DEFAULT 1 NOT NULL,
    driver_ping_timeout_ms integer DEFAULT 5000,
    auto_timeout_search_mins integer DEFAULT 2,
    auto_timeout_assigned_mins integer DEFAULT 10,
    no_show_driver_penalty numeric(10,2) DEFAULT 100,
    no_show_customer_charge numeric(10,2) DEFAULT 50,
    no_show_rating_deduction numeric(3,2) DEFAULT 0.5,
    no_show_ban_threshold integer DEFAULT 3,
    retry_count_fcm integer DEFAULT 3,
    retry_backoff_ms integer DEFAULT 100,
    stale_ride_cancel_mins integer DEFAULT 30,
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.heatmap_config (
    id integer DEFAULT 1 NOT NULL,
    grid_size_meters integer DEFAULT 500,
    refresh_interval_seconds integer DEFAULT 60,
    is_active boolean DEFAULT true,
    idle_timeout_minutes integer DEFAULT 5,
    low_demand_threshold numeric(6,2) DEFAULT 3,
    medium_demand_threshold numeric(6,2) DEFAULT 6,
    high_demand_threshold numeric(6,2) DEFAULT 9,
    lookback_minutes integer DEFAULT 30,
    earning_low_min integer DEFAULT 0,
    earning_low_max integer DEFAULT 100,
    earning_medium_min integer DEFAULT 100,
    earning_medium_max integer DEFAULT 250,
    earning_high_min integer DEFAULT 250,
    earning_high_max integer DEFAULT 500,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.heatmap_events (
    id bigint NOT NULL,
    event_type character varying(50) NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    service_type character varying(20) DEFAULT 'ride'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS public.heatmap_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE public.heatmap_events_id_seq OWNED BY public.heatmap_events.id;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.heatmap_grid_cache (
    grid_key character varying(100) NOT NULL,
    center_lat double precision NOT NULL,
    center_lng double precision NOT NULL,
    request_count integer DEFAULT 0,
    active_drivers integer DEFAULT 0,
    demand_score numeric(6,2) DEFAULT 0,
    demand_level character varying(20) DEFAULT 'low'::character varying,
    service_breakdown jsonb DEFAULT '{}'::jsonb,
    estimated_earning_min integer DEFAULT 0,
    estimated_earning_max integer DEFAULT 0,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.insurance_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(191) NOT NULL,
    plan_type character varying(50) DEFAULT 'vehicle'::character varying,
    premium_daily numeric(10,2) DEFAULT 0,
    premium_monthly numeric(10,2) DEFAULT 0,
    coverage_amount numeric(12,2) DEFAULT 0,
    features text DEFAULT ''::text,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.intercity_cs_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ride_id uuid,
    customer_id uuid,
    seats_booked integer DEFAULT 1,
    total_fare numeric(10,2) DEFAULT 0,
    status character varying(30) DEFAULT 'confirmed'::character varying,
    payment_status character varying(30) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.intercity_cs_rides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid,
    from_city character varying(120) NOT NULL,
    to_city character varying(120) NOT NULL,
    route_km numeric(10,2) DEFAULT 0,
    departure_date date,
    departure_time character varying(20),
    total_seats integer DEFAULT 4,
    vehicle_number character varying(60),
    vehicle_model character varying(120),
    note text,
    fare_per_seat numeric(10,2) DEFAULT 0,
    is_active boolean DEFAULT true,
    status character varying(30) DEFAULT 'scheduled'::character varying,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.intercity_cs_settings (
    key_name character varying(120) NOT NULL,
    value text NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.intercity_routes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_city character varying(120) NOT NULL,
    to_city character varying(120) NOT NULL,
    estimated_km numeric(10,2) DEFAULT 0,
    base_fare numeric(10,2) DEFAULT 0,
    fare_per_km numeric(10,2) DEFAULT 0,
    toll_charges numeric(10,2) DEFAULT 0,
    vehicle_category_id uuid,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.ledger_entries (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    trip_id uuid,
    type character varying(20) NOT NULL,
    amount numeric(23,3) NOT NULL,
    status character varying(20) DEFAULT 'PENDING'::character varying,
    description text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS public.ledger_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE public.ledger_entries_id_seq OWNED BY public.ledger_entries.id;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.local_pool_passengers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pool_ride_id uuid NOT NULL,
    trip_request_id uuid,
    customer_id uuid NOT NULL,
    pickup_lat double precision,
    pickup_lng double precision,
    drop_lat double precision,
    drop_lng double precision,
    pickup_address text,
    drop_address text,
    seats_booked integer DEFAULT 1,
    fare_per_seat numeric(10,2) DEFAULT '0'::numeric,
    total_fare numeric(10,2) DEFAULT '0'::numeric,
    distance_km double precision DEFAULT 0,
    payment_method character varying(40) DEFAULT 'cash'::character varying,
    status character varying(30) DEFAULT 'booked'::character varying,
    pickup_order integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.local_pool_rides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid,
    vehicle_category_id uuid,
    pickup_lat double precision,
    pickup_lng double precision,
    destination_lat double precision,
    destination_lng double precision,
    route_bearing_deg double precision,
    pickup_address text,
    destination_address text,
    max_seats integer DEFAULT 4,
    booked_seats integer DEFAULT 0,
    fare_per_seat numeric(10,2) DEFAULT '0'::numeric,
    distance_km double precision DEFAULT 0,
    status character varying(30) DEFAULT 'collecting'::character varying,
    collection_deadline timestamp without time zone,
    zone_id uuid,
    dispatch_trip_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.maps_cache (
    id bigint NOT NULL,
    cache_type character varying(30) NOT NULL,
    cache_key character varying(255) NOT NULL,
    lat double precision,
    lng double precision,
    formatted_address text,
    data_json jsonb,
    distance_km double precision,
    duration_min double precision,
    expires_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS public.maps_cache_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE public.maps_cache_id_seq OWNED BY public.maps_cache.id;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.monthly_passes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    plan_name character varying(120) NOT NULL,
    rides_total integer DEFAULT 20 NOT NULL,
    rides_used integer DEFAULT 0 NOT NULL,
    discount_pct numeric(5,2) DEFAULT 15,
    amount_paid numeric(12,2) DEFAULT 0,
    is_active boolean DEFAULT true,
    valid_until date,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.notification_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    target character varying(80) DEFAULT 'all'::character varying NOT NULL,
    user_type character varying(80) DEFAULT 'all'::character varying NOT NULL,
    recipient_count integer DEFAULT 0,
    status character varying(80) DEFAULT 'sent'::character varying NOT NULL,
    sent_at timestamp without time zone DEFAULT now(),
    delivered_count integer DEFAULT 0,
    recipient_id uuid,
    trip_id uuid,
    notification_type character varying(60),
    fcm_token character varying(500),
    fcm_result character varying(30),
    attempt_count integer DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.otp_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone character varying(20) NOT NULL,
    otp character varying(10) NOT NULL,
    user_type character varying(30) DEFAULT 'customer'::character varying,
    is_used boolean DEFAULT false,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    attempt_count integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.otp_request_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone character varying(20) NOT NULL,
    country_code character varying(8) DEFAULT '+91'::character varying NOT NULL,
    device_id text,
    ip_address text,
    user_agent text,
    user_type character varying(25) DEFAULT 'customer'::character varying NOT NULL,
    event_type character varying(20) NOT NULL,
    outcome character varying(50) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.otp_settings (
    id integer NOT NULL,
    primary_provider character varying(20) DEFAULT 'sms'::character varying NOT NULL,
    sms_enabled boolean DEFAULT true NOT NULL,
    firebase_enabled boolean DEFAULT true NOT NULL,
    fallback_enabled boolean DEFAULT true NOT NULL,
    otp_expiry_seconds integer DEFAULT 120 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS public.otp_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE public.otp_settings_id_seq OWNED BY public.otp_settings.id;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.outstation_pool_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ride_id uuid NOT NULL,
    customer_id uuid,
    seats_booked integer DEFAULT 1,
    total_fare numeric(10,2) DEFAULT 0,
    from_city character varying(120),
    to_city character varying(120),
    pickup_address text,
    dropoff_address text,
    status character varying(30) DEFAULT 'confirmed'::character varying,
    payment_status character varying(30) DEFAULT 'pending'::character varying,
    payment_method character varying(40) DEFAULT 'cash'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    refund_processed_at timestamp without time zone,
    refund_amount numeric(10,2) DEFAULT 0,
    cancel_reason character varying(300),
    cancelled_at timestamp without time zone,
    cancelled_by character varying(20),
    refund_status character varying(20),
    picked_up_at timestamp without time zone,
    dropped_at timestamp without time zone,
    fare_per_seat numeric(12,2) DEFAULT 0,
    segment_km numeric(10,2) DEFAULT 0,
    pickup_lat double precision,
    pickup_lng double precision,
    drop_lat double precision,
    drop_lng double precision,
    pickup_order integer,
    commission_amount numeric(12,2) DEFAULT 0,
    gst_amount numeric(12,2) DEFAULT 0,
    insurance_amount numeric(12,2) DEFAULT 0,
    driver_earnings numeric(12,2) DEFAULT 0,
    revenue_model character varying(30),
    revenue_breakdown jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.outstation_pool_rides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    from_city character varying(120) NOT NULL,
    to_city character varying(120) NOT NULL,
    route_km numeric(10,2) DEFAULT 0,
    departure_date date,
    departure_time character varying(20),
    total_seats integer DEFAULT 4,
    available_seats integer DEFAULT 4,
    vehicle_number character varying(60),
    vehicle_model character varying(120),
    fare_per_seat numeric(10,2) DEFAULT 0,
    note text,
    is_active boolean DEFAULT true,
    status character varying(30) DEFAULT 'scheduled'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    auto_cancelled_at timestamp without time zone,
    auto_cancel_reason character varying(120),
    current_lat double precision,
    current_lng double precision,
    accepting_new_requests boolean DEFAULT true NOT NULL,
    vehicle_category_id uuid,
    from_lat double precision,
    from_lng double precision,
    to_lat double precision,
    to_lng double precision,
    price_per_km_per_seat numeric(10,2) DEFAULT 0,
    state_version integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.parcel_attributes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type character varying(50) DEFAULT 'category'::character varying NOT NULL,
    name character varying(255) NOT NULL,
    icon character varying(100),
    min_value numeric(10,2),
    max_value numeric(10,2),
    unit character varying(30),
    extra_fare numeric(10,2) DEFAULT '0'::numeric,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.parcel_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.parcel_delivery_proofs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    drop_index integer DEFAULT 0,
    photo_url text,
    signature_url text,
    delivered_to character varying(120),
    driver_id uuid,
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.parcel_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parcel_order_id uuid NOT NULL,
    event character varying(80) NOT NULL,
    data jsonb DEFAULT '{}'::jsonb,
    actor_id uuid,
    actor_type character varying(30),
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.parcel_fares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    zone_id uuid,
    base_fare numeric(23,3) DEFAULT '0'::numeric,
    fare_per_km numeric(23,3) DEFAULT '0'::numeric,
    fare_per_kg numeric(23,3) DEFAULT '0'::numeric,
    minimum_fare numeric(23,3) DEFAULT '0'::numeric,
    loading_charge numeric(23,3) DEFAULT '0'::numeric,
    helper_charge_per_hour numeric(23,3) DEFAULT '0'::numeric,
    max_helpers integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.parcel_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid,
    driver_id uuid,
    vehicle_category character varying(100) DEFAULT 'bike_parcel'::character varying,
    pickup_address text,
    pickup_lat double precision,
    pickup_lng double precision,
    pickup_contact_name character varying(120),
    pickup_contact_phone character varying(20),
    drop_locations jsonb DEFAULT '[]'::jsonb,
    total_distance_km numeric(10,2) DEFAULT 0,
    weight_kg numeric(10,2) DEFAULT 1,
    base_fare numeric(12,2) DEFAULT 0,
    distance_fare numeric(12,2) DEFAULT 0,
    weight_fare numeric(12,2) DEFAULT 0,
    load_charge numeric(12,2) DEFAULT 0,
    total_fare numeric(12,2) DEFAULT 0,
    commission_amt numeric(12,2) DEFAULT 0,
    commission_pct numeric(5,2) DEFAULT 12,
    gst_amt numeric(12,2) DEFAULT 0,
    gst_amount numeric(12,2) DEFAULT 0,
    current_status character varying(50) DEFAULT 'pending'::character varying,
    status character varying(50) DEFAULT 'PENDING'::character varying,
    current_drop_index integer DEFAULT 0,
    pickup_otp character varying(10),
    is_b2b boolean DEFAULT false,
    b2b_company_id uuid,
    payment_method character varying(30) DEFAULT 'cash'::character varying,
    payment_status character varying(30) DEFAULT 'unpaid'::character varying,
    notes text,
    parcel_description text,
    length_cm numeric(10,2),
    width_cm numeric(10,2),
    height_cm numeric(10,2),
    volumetric_weight_kg numeric(10,2),
    billable_weight_kg numeric(10,2),
    declared_value numeric(12,2) DEFAULT 0,
    is_fragile boolean DEFAULT false,
    insurance_enabled boolean DEFAULT false,
    insurance_premium numeric(12,2) DEFAULT 0,
    insurance_amount numeric(12,2) DEFAULT 0,
    expected_delivery_minutes integer DEFAULT 30,
    sla_breached boolean DEFAULT false,
    idempotency_key character varying(120),
    version integer DEFAULT 0,
    driver_earnings numeric(12,2) DEFAULT 0,
    revenue_model character varying(30),
    revenue_breakdown jsonb,
    assigned_at timestamp without time zone,
    picked_up_at timestamp without time zone,
    completed_at timestamp without time zone,
    cancelled_at timestamp without time zone,
    cancelled_reason text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.parcel_prohibited_items (
    id integer NOT NULL,
    item_name character varying(200) NOT NULL,
    category character varying(80) DEFAULT 'general'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS public.parcel_prohibited_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE public.parcel_prohibited_items_id_seq OWNED BY public.parcel_prohibited_items.id;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.parcel_vehicle_types (
    id integer NOT NULL,
    vehicle_key character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    subtitle text DEFAULT ''::text,
    icon text DEFAULT '📦'::text,
    image_url text DEFAULT ''::text,
    capacity_label text DEFAULT ''::text,
    max_weight_kg numeric(10,2) DEFAULT 10,
    suitable_items text DEFAULT ''::text,
    accent_color text DEFAULT '#16A34A'::text,
    base_fare numeric(10,2) DEFAULT 40,
    per_km numeric(10,2) DEFAULT 12,
    per_kg numeric(10,2) DEFAULT 4,
    load_charge numeric(10,2) DEFAULT 0,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS public.parcel_vehicle_types_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE public.parcel_vehicle_types_id_seq OWNED BY public.parcel_vehicle_types.id;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.parcel_weights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(255) NOT NULL,
    min_weight double precision DEFAULT 0,
    max_weight double precision DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.payment_recovery_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_intent_id uuid,
    customer_payment_id uuid,
    customer_id uuid,
    event_type character varying(40) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.platform_services (
    id integer NOT NULL,
    service_key character varying(100) NOT NULL,
    service_name character varying(255) NOT NULL,
    service_status character varying(50) DEFAULT 'active'::character varying,
    revenue_model character varying(50) DEFAULT 'commission'::character varying,
    commission_rate numeric(10,2) DEFAULT 15,
    icon character varying(100),
    color character varying(100),
    description text,
    short_description text DEFAULT ''::text,
    image_url text DEFAULT ''::text,
    eta_label character varying(50) DEFAULT ''::character varying,
    service_category character varying(50) DEFAULT 'rides'::character varying,
    sort_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS public.platform_services_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
--> statement-breakpoint
ALTER SEQUENCE public.platform_services_id_seq OWNED BY public.platform_services.id;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.police_stations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(191) NOT NULL,
    zone_id uuid,
    address text,
    phone character varying(30),
    latitude numeric(10,7),
    longitude numeric(10,7),
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.pool_issue_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module character varying(30) NOT NULL,
    reference_type character varying(30) NOT NULL,
    reference_id uuid NOT NULL,
    ride_id uuid,
    customer_id uuid,
    driver_id uuid,
    reported_user_id uuid,
    reported_by_role character varying(20) NOT NULL,
    issue_channel character varying(30) DEFAULT 'issue'::character varying NOT NULL,
    category character varying(60),
    description text,
    evidence_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    admin_updates jsonb DEFAULT '[]'::jsonb NOT NULL,
    resolution_note text,
    status character varying(30) DEFAULT 'open'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.pool_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module character varying(30) NOT NULL,
    reference_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    sender_type character varying(20) NOT NULL,
    sender_name character varying(120),
    message text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.pool_ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module character varying(30) NOT NULL,
    reference_type character varying(30) NOT NULL,
    reference_id uuid NOT NULL,
    ride_id uuid,
    from_user_id uuid NOT NULL,
    to_user_id uuid NOT NULL,
    rating_role character varying(30) NOT NULL,
    overall_rating numeric(2,1) NOT NULL,
    safety_rating numeric(2,1),
    cleanliness_rating numeric(2,1),
    behaviour_rating numeric(2,1),
    punctuality_rating numeric(2,1),
    note text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.pool_ride_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    session_id uuid,
    vehicle_category_id uuid,
    pickup_lat double precision,
    pickup_lng double precision,
    drop_lat double precision,
    drop_lng double precision,
    pickup_address text,
    drop_address text,
    seats_requested integer DEFAULT 1,
    fare_per_seat numeric(12,2) DEFAULT 0,
    total_fare numeric(12,2) DEFAULT 0,
    distance_km numeric(10,2) DEFAULT 0,
    commission_amount numeric(12,2) DEFAULT 0,
    gst_amount numeric(12,2) DEFAULT 0,
    insurance_amount numeric(12,2) DEFAULT 0,
    platform_deduction numeric(12,2) DEFAULT 0,
    revenue_model character varying(30),
    revenue_breakdown jsonb,
    driver_earnings numeric(12,2) DEFAULT 0,
    payment_method character varying(30) DEFAULT 'cash'::character varying,
    status character varying(32) DEFAULT 'searching'::character varying,
    searched_at timestamp without time zone DEFAULT now(),
    boarding_otp character varying(10),
    boarding_otp_issued_at timestamp without time zone,
    boarding_otp_expires_at timestamp without time zone,
    boarding_otp_used_at timestamp without time zone,
    cluster_key character varying(120),
    proposed_session_id uuid,
    pickup_order integer,
    drop_order integer,
    seat_lock_expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    assignment_version integer DEFAULT 0 NOT NULL,
    matched_at timestamp without time zone,
    picked_up_at timestamp without time zone,
    dropped_at timestamp without time zone,
    cancelled_at timestamp without time zone,
    cancel_reason text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.pool_user_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    blocker_user_id uuid NOT NULL,
    blocked_user_id uuid NOT NULL,
    module character varying(30) NOT NULL,
    reference_type character varying(30),
    reference_id uuid,
    created_by_role character varying(20) NOT NULL,
    reason character varying(300),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.razorpay_webhook_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id character varying(120) NOT NULL,
    event_type character varying(80) NOT NULL,
    payload jsonb,
    processed boolean DEFAULT false NOT NULL,
    error_msg text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.referrals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referrer_id uuid NOT NULL,
    referred_id uuid,
    referral_code character varying(30) NOT NULL,
    referral_type character varying(30) DEFAULT 'customer'::character varying NOT NULL,
    reward_amount numeric(10,2) DEFAULT '0'::numeric,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    paid_at timestamp without time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid NOT NULL,
    token text NOT NULL,
    device_id text NOT NULL,
    ip_address text,
    user_agent text,
    expires_at timestamp without time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    revoked_at timestamp without time zone,
    replaced_by_token text,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.refund_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    trip_id uuid,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    reason text,
    payment_method character varying(30) DEFAULT 'wallet'::character varying,
    status character varying(30) DEFAULT 'pending'::character varying,
    admin_note text,
    approved_by character varying(120),
    approved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.retention_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    campaign_code character varying(50),
    discount_amount numeric(10,2) DEFAULT 0,
    promo_code character varying(50),
    message_title character varying(255),
    message_body text,
    sent_at timestamp without time zone DEFAULT now() NOT NULL,
    delivered boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.retention_promos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    promo_code character varying(50) NOT NULL,
    discount_amount numeric(10,2) DEFAULT 0,
    valid_until timestamp without time zone,
    is_used boolean DEFAULT false,
    used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.revenue_model_settings (
    key_name character varying(120) NOT NULL,
    value text NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_id uuid,
    reviewer_id uuid,
    reviewee_id uuid,
    reviewer_type character varying(50),
    rating numeric(3,1),
    feedback text,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.ride_complaints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_id uuid NOT NULL,
    customer_id uuid,
    driver_id uuid,
    complaint_type character varying(50) DEFAULT 'general'::character varying,
    description text NOT NULL,
    status character varying(30) DEFAULT 'open'::character varying,
    resolution_note text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.ride_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_id uuid NOT NULL,
    event_type character varying(80) NOT NULL,
    actor_id uuid,
    actor_type character varying(50) DEFAULT 'system'::character varying,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.safety_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    trip_id uuid,
    alert_type character varying(40) DEFAULT 'sos'::character varying,
    triggered_by character varying(20) DEFAULT 'customer'::character varying,
    status character varying(20) DEFAULT 'active'::character varying,
    latitude numeric(10,7),
    longitude numeric(10,7),
    location_address text,
    nearby_drivers_notified integer DEFAULT 0,
    acknowledged_by_name character varying(120),
    acknowledged_at timestamp without time zone,
    resolved_at timestamp without time zone,
    police_notified boolean DEFAULT false,
    notes text,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.saved_places (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    label character varying(50) NOT NULL,
    address text NOT NULL,
    lat double precision DEFAULT 0 NOT NULL,
    lng double precision DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.service_revenue_config (
    module_name character varying(30) NOT NULL,
    revenue_model character varying(20) DEFAULT 'commission'::character varying NOT NULL,
    commission_percentage numeric(5,2) DEFAULT 15.00 NOT NULL,
    commission_gst_percentage numeric(5,2) DEFAULT 18.00 NOT NULL,
    subscription_required boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    device_id text NOT NULL,
    ip_address text,
    user_agent text,
    expires_at timestamp without time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    revoked_at timestamp without time zone,
    last_active_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.spin_wheel_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label character varying(255) NOT NULL,
    reward_amount numeric(23,3) DEFAULT '0'::numeric,
    reward_type character varying(50) DEFAULT 'wallet'::character varying,
    probability numeric(5,2) DEFAULT '0'::numeric,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.spin_wheel_plays (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    item_id integer,
    reward_type character varying(30),
    reward_value numeric(12,2) DEFAULT 0,
    played_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    price numeric(23,3) DEFAULT '0'::numeric,
    duration_days integer DEFAULT 30,
    features text,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    max_parcels integer DEFAULT 0,
    updated_at timestamp without time zone DEFAULT now(),
    max_rides integer DEFAULT 0,
    plan_type character varying(30) DEFAULT 'both'::character varying
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.surge_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    zone_id uuid,
    service_type character varying(30) DEFAULT 'all'::character varying,
    min_multiplier numeric(4,2) DEFAULT 1.0,
    max_multiplier numeric(4,2) DEFAULT 2.0,
    demand_threshold integer DEFAULT 5,
    peak_hours_enabled boolean DEFAULT false,
    peak_hour_start integer DEFAULT 8,
    peak_hour_end integer DEFAULT 10,
    peak_hour_multiplier numeric(4,2) DEFAULT 1.3,
    weather_multiplier numeric(4,2) DEFAULT 1.0,
    manual_surge numeric(4,2),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.surge_pricing (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    zone_id uuid,
    start_time character varying(10),
    end_time character varying(10),
    multiplier numeric(5,2) DEFAULT '1'::numeric,
    reason character varying(255),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.system_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    level character varying(20) NOT NULL,
    tag character varying(80) NOT NULL,
    message text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    trip_id uuid,
    account character varying(50),
    debit numeric(23,3) DEFAULT '0'::numeric,
    credit numeric(23,3) DEFAULT '0'::numeric,
    balance numeric(23,3) DEFAULT '0'::numeric,
    transaction_type character varying(100),
    ref_transaction_id character varying(255),
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.trip_fares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    zone_id uuid,
    vehicle_category_id uuid,
    base_fare numeric(23,3) DEFAULT '0'::numeric,
    fare_per_km numeric(23,3) DEFAULT '0'::numeric,
    fare_per_min numeric(23,3) DEFAULT '0'::numeric,
    minimum_fare numeric(23,3) DEFAULT '0'::numeric,
    cancellation_fee numeric(23,3) DEFAULT '0'::numeric,
    waiting_charge_per_min numeric(23,3) DEFAULT '0'::numeric,
    helper_charge numeric(23,3) DEFAULT '0'::numeric,
    night_charge_multiplier numeric(23,3) DEFAULT '1'::numeric,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.trip_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    sender_type character varying(20) DEFAULT 'customer'::character varying NOT NULL,
    sender_name character varying(255),
    message text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.trip_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ref_id character varying(20) NOT NULL,
    customer_id uuid,
    driver_id uuid,
    vehicle_category_id uuid,
    zone_id uuid,
    booking_intent_id uuid,
    pickup_address text,
    destination_address text,
    pickup_lat double precision,
    pickup_lng double precision,
    destination_lat double precision,
    destination_lng double precision,
    estimated_fare numeric(23,3) DEFAULT '0'::numeric NOT NULL,
    actual_fare numeric(23,3) DEFAULT '0'::numeric,
    estimated_distance double precision DEFAULT 0,
    actual_distance double precision,
    payment_method character varying(50) DEFAULT 'cash'::character varying,
    payment_status character varying(50) DEFAULT 'unpaid'::character varying,
    type character varying(50) DEFAULT 'ride'::character varying,
    trip_type character varying(30) DEFAULT 'ride'::character varying NOT NULL,
    current_status character varying(50) DEFAULT 'pending'::character varying,
    is_scheduled boolean DEFAULT false,
    scheduled_at timestamp without time zone,
    ride_full_fare numeric(23,3) DEFAULT '0'::numeric,
    user_discount numeric(23,3) DEFAULT '0'::numeric,
    user_payable numeric(23,3) DEFAULT '0'::numeric,
    gst_amount numeric(23,3) DEFAULT '0'::numeric,
    driver_wallet_credit numeric(23,3) DEFAULT '0'::numeric,
    vehicle_type_name character varying(100),
    seats_booked integer DEFAULT 1,
    seat_price numeric(10,2) DEFAULT '0'::numeric,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    commission_amount numeric(12,2) DEFAULT 0,
    coupon_code character varying(50),
    discount_amount numeric(12,2) DEFAULT 0,
    original_fare numeric(12,2) DEFAULT 0,
    cancel_reason text,
    cancelled_by character varying(50),
    rejected_driver_ids uuid[] DEFAULT '{}'::uuid[],
    driver_accepted_at timestamp without time zone,
    driver_arriving_at timestamp without time zone,
    ride_started_at timestamp without time zone,
    ride_ended_at timestamp without time zone,
    pickup_otp character varying(10),
    delivery_otp character varying(10),
    share_token character varying(64),
    driver_ping_verified_at timestamp without time zone,
    auto_timeout_at timestamp without time zone,
    auto_cancelled boolean DEFAULT false,
    cancellation_reason character varying(120),
    customer_no_show_count integer DEFAULT 0,
    driver_no_show_count integer DEFAULT 0,
    offered_driver_id uuid,
    offer_expires_at timestamp without time zone,
    offer_payload jsonb,
    razorpay_payment_id character varying(100),
    passenger_name character varying(100),
    passenger_phone character varying(20),
    is_for_someone_else boolean DEFAULT false,
    receiver_name character varying(100),
    receiver_phone character varying(20),
    tips numeric(10,2) DEFAULT 0,
    driver_fare numeric(23,3) DEFAULT 0,
    customer_fare numeric(23,3) DEFAULT 0,
    pending_payment_amount numeric(23,3) DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.trip_status (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_id uuid NOT NULL,
    status character varying(50) NOT NULL,
    source character varying(50) DEFAULT 'system'::character varying,
    note text,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.user_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    fcm_token text,
    device_type character varying(20) DEFAULT 'android'::character varying,
    app_version character varying(20),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.user_levels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    user_type character varying(50) DEFAULT 'driver'::character varying NOT NULL,
    min_points double precision DEFAULT 0,
    max_points double precision DEFAULT 0,
    reward double precision DEFAULT 0,
    reward_type character varying(50) DEFAULT 'cashback'::character varying,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id uuid NOT NULL,
    quiet_ride boolean DEFAULT false,
    ac_preferred boolean DEFAULT true,
    music_off boolean DEFAULT false,
    wheelchair_accessible boolean DEFAULT false,
    extra_luggage boolean DEFAULT false,
    preferred_gender character varying(20) DEFAULT 'any'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name character varying(255),
    first_name character varying(191),
    last_name character varying(191),
    email character varying(191),
    phone character varying(20),
    profile_image character varying(191),
    user_type character varying(25) DEFAULT 'customer'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    loyalty_points double precision DEFAULT 0 NOT NULL,
    verification_status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    license_number character varying(100),
    license_image character varying(500),
    vehicle_image character varying(500),
    vehicle_number character varying(50),
    vehicle_model character varying(100),
    rejection_note text,
    password_hash character varying(255),
    reset_otp character varying(10),
    reset_otp_expiry timestamp without time zone,
    onboard_date timestamp without time zone,
    free_period_end timestamp without time zone,
    launch_free_active boolean DEFAULT false,
    pending_commission_balance numeric(12,2) DEFAULT '0'::numeric,
    pending_gst_balance numeric(12,2) DEFAULT '0'::numeric,
    total_pending_balance numeric(12,2) DEFAULT '0'::numeric,
    lock_threshold numeric(10,2) DEFAULT '200'::numeric,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    name character varying(255),
    mobile character varying(20),
    role character varying(50) DEFAULT 'user'::character varying,
    auth_token text,
    auth_token_expires_at timestamp without time zone,
    last_login_at timestamp without time zone,
    wallet_balance numeric(12,2) DEFAULT 0 NOT NULL,
    city character varying(120),
    date_of_birth date,
    license_expiry date,
    vehicle_brand character varying(120),
    vehicle_color character varying(60),
    vehicle_year integer,
    selfie_image text,
    vehicle_status character varying(30) DEFAULT 'pending'::character varying,
    referral_code character varying(50),
    profile_photo text,
    rating numeric(3,2) DEFAULT 5.0,
    is_locked boolean DEFAULT false,
    lock_reason text,
    gender character varying(20),
    prefer_female_driver boolean DEFAULT false,
    jago_coins integer DEFAULT 0,
    completed_rides_count integer DEFAULT 0,
    is_online boolean DEFAULT false,
    current_lat double precision,
    current_lng double precision,
    current_trip_id uuid,
    locked_at timestamp without time zone,
    revenue_model character varying(30) DEFAULT 'commission'::character varying,
    model_selected_at timestamp without time zone,
    theme_preference character varying(20) DEFAULT 'light'::character varying,
    recent_no_shows_30d integer DEFAULT 0,
    is_banned_for_no_show boolean DEFAULT false,
    ban_reason text,
    ban_until timestamp without time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.vehicle_brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    logo_url text,
    category character varying(50) DEFAULT 'two_wheeler'::character varying
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.vehicle_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    icon character varying(255),
    type character varying(50) DEFAULT 'ride'::character varying,
    vehicle_type character varying(50),
    service_type character varying(30) DEFAULT 'ride'::character varying,
    base_fare numeric(10,2) DEFAULT '0'::numeric,
    fare_per_km numeric(10,2) DEFAULT '0'::numeric,
    minimum_fare numeric(10,2) DEFAULT '0'::numeric,
    waiting_charge_per_min numeric(10,2) DEFAULT '0'::numeric,
    total_seats integer DEFAULT 0,
    is_carpool boolean DEFAULT false,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    description text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.vehicle_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    brand_id uuid,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.vehicle_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid,
    vehicle_name character varying(255),
    registration_no character varying(100),
    status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    vehicle_type character varying(60),
    brand character varying(120),
    model character varying(120),
    color character varying(60),
    vehicle_year integer,
    registration_number character varying(60),
    verification_status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.wallet_bonuses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    bonus_amount numeric(23,3) DEFAULT '0'::numeric,
    bonus_type character varying(50) DEFAULT 'percentage'::character varying,
    minimum_add_amount numeric(23,3) DEFAULT '0'::numeric,
    max_bonus_amount numeric(23,3) DEFAULT '0'::numeric,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.wallet_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    type character varying(16) NOT NULL,
    reason text NOT NULL,
    ref_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.withdraw_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    driver_payment_id uuid,
    amount numeric(23,3) DEFAULT '0'::numeric,
    note text,
    status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    coordinates text,
    latitude double precision,
    longitude double precision,
    radius_km double precision DEFAULT 5,
    service_type character varying(50) DEFAULT 'both'::character varying NOT NULL,
    surge_factor double precision DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE ONLY public.city_parcel_vehicles ALTER COLUMN id SET DEFAULT nextval('public.city_parcel_vehicles_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY public.city_services ALTER COLUMN id SET DEFAULT nextval('public.city_services_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY public.company_gst_wallet ALTER COLUMN id SET DEFAULT nextval('public.company_gst_wallet_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY public.heatmap_events ALTER COLUMN id SET DEFAULT nextval('public.heatmap_events_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY public.ledger_entries ALTER COLUMN id SET DEFAULT nextval('public.ledger_entries_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY public.maps_cache ALTER COLUMN id SET DEFAULT nextval('public.maps_cache_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY public.otp_settings ALTER COLUMN id SET DEFAULT nextval('public.otp_settings_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_prohibited_items ALTER COLUMN id SET DEFAULT nextval('public.parcel_prohibited_items_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_vehicle_types ALTER COLUMN id SET DEFAULT nextval('public.parcel_vehicle_types_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY public.platform_services ALTER COLUMN id SET DEFAULT nextval('public.platform_services_id_seq'::regclass);
--> statement-breakpoint
ALTER TABLE ONLY public.admin_login_otp
    ADD CONSTRAINT admin_login_otp_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.admin_logs
    ADD CONSTRAINT admin_logs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.admin_otp_resets
    ADD CONSTRAINT admin_otp_resets_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.admin_refresh_tokens
    ADD CONSTRAINT admin_refresh_tokens_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.admin_refresh_tokens
    ADD CONSTRAINT admin_refresh_tokens_token_key UNIQUE (token);
--> statement-breakpoint
ALTER TABLE ONLY public.admin_revenue
    ADD CONSTRAINT admin_revenue_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.admin_sessions
    ADD CONSTRAINT admin_sessions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.admin_sessions
    ADD CONSTRAINT admin_sessions_token_key UNIQUE (token);
--> statement-breakpoint
ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_email_unique UNIQUE (email);
--> statement-breakpoint
ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.ai_safety_alerts
    ADD CONSTRAINT ai_safety_alerts_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.app_languages
    ADD CONSTRAINT app_languages_code_unique UNIQUE (code);
--> statement-breakpoint
ALTER TABLE ONLY public.app_languages
    ADD CONSTRAINT app_languages_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.b2b_companies
    ADD CONSTRAINT b2b_companies_email_unique UNIQUE (email);
--> statement-breakpoint
ALTER TABLE ONLY public.b2b_companies
    ADD CONSTRAINT b2b_companies_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.b2b_webhook_logs
    ADD CONSTRAINT b2b_webhook_logs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.banners
    ADD CONSTRAINT banners_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.blogs
    ADD CONSTRAINT blogs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.blogs
    ADD CONSTRAINT blogs_slug_unique UNIQUE (slug);
--> statement-breakpoint
ALTER TABLE ONLY public.booking_intents
    ADD CONSTRAINT booking_intents_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.business_settings
    ADD CONSTRAINT business_settings_key_name_unique UNIQUE (key_name);
--> statement-breakpoint
ALTER TABLE ONLY public.business_settings
    ADD CONSTRAINT business_settings_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.cancellation_reasons
    ADD CONSTRAINT cancellation_reasons_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.car_sharing_bookings
    ADD CONSTRAINT car_sharing_bookings_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.car_sharing_rides
    ADD CONSTRAINT car_sharing_rides_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.car_sharing_settings
    ADD CONSTRAINT car_sharing_settings_pkey PRIMARY KEY (key_name);
--> statement-breakpoint
ALTER TABLE ONLY public.city_parcel_vehicles
    ADD CONSTRAINT city_parcel_vehicles_city_name_vehicle_key_key UNIQUE (city_name, vehicle_key);
--> statement-breakpoint
ALTER TABLE ONLY public.city_parcel_vehicles
    ADD CONSTRAINT city_parcel_vehicles_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.city_services
    ADD CONSTRAINT city_services_city_name_service_key_key UNIQUE (city_name, service_key);
--> statement-breakpoint
ALTER TABLE ONLY public.city_services
    ADD CONSTRAINT city_services_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.coins_ledger
    ADD CONSTRAINT coins_ledger_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.commission_settlements
    ADD CONSTRAINT commission_settlements_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.company_gst_wallet
    ADD CONSTRAINT company_gst_wallet_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.company_wallet_events
    ADD CONSTRAINT company_wallet_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.coupon_setups
    ADD CONSTRAINT coupon_setups_code_unique UNIQUE (code);
--> statement-breakpoint
ALTER TABLE ONLY public.coupon_setups
    ADD CONSTRAINT coupon_setups_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.customer_no_shows
    ADD CONSTRAINT customer_no_shows_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.demand_predictions
    ADD CONSTRAINT demand_predictions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.discounts
    ADD CONSTRAINT discounts_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.dispatch_sessions
    ADD CONSTRAINT dispatch_sessions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.dispatch_sessions
    ADD CONSTRAINT dispatch_sessions_trip_id_key UNIQUE (trip_id);
--> statement-breakpoint
ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_behavior_scores
    ADD CONSTRAINT driver_behavior_scores_pkey PRIMARY KEY (driver_id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_details
    ADD CONSTRAINT driver_details_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_details
    ADD CONSTRAINT driver_details_user_id_unique UNIQUE (user_id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT driver_documents_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_insurance
    ADD CONSTRAINT driver_insurance_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_locations
    ADD CONSTRAINT driver_locations_pkey PRIMARY KEY (driver_id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_no_shows
    ADD CONSTRAINT driver_no_shows_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_payments
    ADD CONSTRAINT driver_payments_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_pool_sessions
    ADD CONSTRAINT driver_pool_sessions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_stats
    ADD CONSTRAINT driver_stats_pkey PRIMARY KEY (driver_id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_subscriptions
    ADD CONSTRAINT driver_subscriptions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_email_unique UNIQUE (email);
--> statement-breakpoint
ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.franchise_payouts
    ADD CONSTRAINT franchise_payouts_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.franchise_service_assignments
    ADD CONSTRAINT franchise_service_assignments_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.franchisees
    ADD CONSTRAINT franchisees_email_key UNIQUE (email);
--> statement-breakpoint
ALTER TABLE ONLY public.franchisees
    ADD CONSTRAINT franchisees_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.fraud_flags
    ADD CONSTRAINT fraud_flags_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.hardening_settings
    ADD CONSTRAINT hardening_settings_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.heatmap_config
    ADD CONSTRAINT heatmap_config_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.heatmap_events
    ADD CONSTRAINT heatmap_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.heatmap_grid_cache
    ADD CONSTRAINT heatmap_grid_cache_pkey PRIMARY KEY (grid_key);
--> statement-breakpoint
ALTER TABLE ONLY public.insurance_plans
    ADD CONSTRAINT insurance_plans_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.intercity_cs_bookings
    ADD CONSTRAINT intercity_cs_bookings_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.intercity_cs_rides
    ADD CONSTRAINT intercity_cs_rides_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.intercity_cs_settings
    ADD CONSTRAINT intercity_cs_settings_pkey PRIMARY KEY (key_name);
--> statement-breakpoint
ALTER TABLE ONLY public.intercity_routes
    ADD CONSTRAINT intercity_routes_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.local_pool_passengers
    ADD CONSTRAINT local_pool_passengers_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.local_pool_rides
    ADD CONSTRAINT local_pool_rides_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.maps_cache
    ADD CONSTRAINT maps_cache_cache_type_cache_key_key UNIQUE (cache_type, cache_key);
--> statement-breakpoint
ALTER TABLE ONLY public.maps_cache
    ADD CONSTRAINT maps_cache_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.monthly_passes
    ADD CONSTRAINT monthly_passes_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.otp_logs
    ADD CONSTRAINT otp_logs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.otp_request_events
    ADD CONSTRAINT otp_request_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.otp_settings
    ADD CONSTRAINT otp_settings_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.outstation_pool_bookings
    ADD CONSTRAINT outstation_pool_bookings_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.outstation_pool_rides
    ADD CONSTRAINT outstation_pool_rides_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_attributes
    ADD CONSTRAINT parcel_attributes_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_categories
    ADD CONSTRAINT parcel_categories_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_delivery_proofs
    ADD CONSTRAINT parcel_delivery_proofs_order_id_drop_index_key UNIQUE (order_id, drop_index);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_delivery_proofs
    ADD CONSTRAINT parcel_delivery_proofs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_events
    ADD CONSTRAINT parcel_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_fares
    ADD CONSTRAINT parcel_fares_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_orders
    ADD CONSTRAINT parcel_orders_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_prohibited_items
    ADD CONSTRAINT parcel_prohibited_items_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_vehicle_types
    ADD CONSTRAINT parcel_vehicle_types_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_vehicle_types
    ADD CONSTRAINT parcel_vehicle_types_vehicle_key_key UNIQUE (vehicle_key);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_weights
    ADD CONSTRAINT parcel_weights_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.payment_recovery_events
    ADD CONSTRAINT payment_recovery_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.platform_services
    ADD CONSTRAINT platform_services_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.platform_services
    ADD CONSTRAINT platform_services_service_key_key UNIQUE (service_key);
--> statement-breakpoint
ALTER TABLE ONLY public.police_stations
    ADD CONSTRAINT police_stations_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.pool_issue_cases
    ADD CONSTRAINT pool_issue_cases_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.pool_messages
    ADD CONSTRAINT pool_messages_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.pool_ratings
    ADD CONSTRAINT pool_ratings_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.pool_ride_requests
    ADD CONSTRAINT pool_ride_requests_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.pool_user_blocks
    ADD CONSTRAINT pool_user_blocks_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.razorpay_webhook_logs
    ADD CONSTRAINT razorpay_webhook_logs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_key UNIQUE (token);
--> statement-breakpoint
ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.retention_notifications
    ADD CONSTRAINT retention_notifications_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.retention_promos
    ADD CONSTRAINT retention_promos_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.retention_promos
    ADD CONSTRAINT retention_promos_user_id_promo_code_key UNIQUE (user_id, promo_code);
--> statement-breakpoint
ALTER TABLE ONLY public.revenue_model_settings
    ADD CONSTRAINT revenue_model_settings_pkey PRIMARY KEY (key_name);
--> statement-breakpoint
ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.ride_complaints
    ADD CONSTRAINT ride_complaints_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.ride_events
    ADD CONSTRAINT ride_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.safety_alerts
    ADD CONSTRAINT safety_alerts_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.saved_places
    ADD CONSTRAINT saved_places_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.service_revenue_config
    ADD CONSTRAINT service_revenue_config_pkey PRIMARY KEY (module_name);
--> statement-breakpoint
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_key UNIQUE (token);
--> statement-breakpoint
ALTER TABLE ONLY public.spin_wheel_items
    ADD CONSTRAINT spin_wheel_items_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.spin_wheel_plays
    ADD CONSTRAINT spin_wheel_plays_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.surge_configs
    ADD CONSTRAINT surge_configs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.surge_pricing
    ADD CONSTRAINT surge_pricing_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_fares
    ADD CONSTRAINT trip_fares_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_messages
    ADD CONSTRAINT trip_messages_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_ref_id_unique UNIQUE (ref_id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_status
    ADD CONSTRAINT trip_status_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_phone UNIQUE (phone);
--> statement-breakpoint
ALTER TABLE ONLY public.user_devices
    ADD CONSTRAINT user_devices_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.user_devices
    ADD CONSTRAINT user_devices_user_id_key UNIQUE (user_id);
--> statement-breakpoint
ALTER TABLE ONLY public.user_levels
    ADD CONSTRAINT user_levels_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id);
--> statement-breakpoint
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);
--> statement-breakpoint
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.vehicle_brands
    ADD CONSTRAINT vehicle_brands_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.vehicle_categories
    ADD CONSTRAINT vehicle_categories_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.vehicle_models
    ADD CONSTRAINT vehicle_models_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.vehicle_requests
    ADD CONSTRAINT vehicle_requests_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.wallet_bonuses
    ADD CONSTRAINT wallet_bonuses_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.wallet_events
    ADD CONSTRAINT wallet_events_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.withdraw_requests
    ADD CONSTRAINT withdraw_requests_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_admin_login_otp_admin_created ON public.admin_login_otp USING btree (admin_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON public.admin_logs USING btree (created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_admin_refresh_tokens_session_id ON public.admin_refresh_tokens USING btree (session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_admin_refresh_tokens_token ON public.admin_refresh_tokens USING btree (token);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_admin_revenue_created ON public.admin_revenue USING btree (created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_admin_revenue_driver ON public.admin_revenue USING btree (driver_id) WHERE (driver_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_admin_revenue_type ON public.admin_revenue USING btree (revenue_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON public.admin_sessions USING btree (admin_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON public.admin_sessions USING btree (token);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ai_safety_alerts_resolved_created_at ON public.ai_safety_alerts USING btree (resolved, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ai_safety_alerts_trip_id ON public.ai_safety_alerts USING btree (trip_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_b2b_companies_email ON public.b2b_companies USING btree (b2b_email) WHERE (b2b_email IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_booking_intents_customer ON public.booking_intents USING btree (customer_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_intents_order ON public.booking_intents USING btree (razorpay_order_id) WHERE (razorpay_order_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_booking_intents_orphan_recovery ON public.booking_intents USING btree (status, updated_at) WHERE ((trip_id IS NULL) AND ((status)::text = ANY ((ARRAY['payment_verified'::character varying, 'booking_in_progress'::character varying, 'recovery_pending'::character varying, 'recovery_failed'::character varying])::text[])));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_intents_payment ON public.booking_intents USING btree (razorpay_payment_id) WHERE (razorpay_payment_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_booking_intents_status ON public.booking_intents USING btree (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_company_wallet_events_company ON public.company_wallet_events USING btree (company_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_coupon_setups_active ON public.coupon_setups USING btree (is_active) WHERE (is_active = true);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_coupon_setups_code ON public.coupon_setups USING btree (code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_customer_no_shows_created ON public.customer_no_shows USING btree (created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_customer_no_shows_customer ON public.customer_no_shows USING btree (customer_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payments_booking_intent ON public.customer_payments USING btree (booking_intent_id) WHERE ((booking_intent_id IS NOT NULL) AND ((payment_type)::text = 'ride_payment'::text));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON public.customer_payments USING btree (customer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_customer_payments_order ON public.customer_payments USING btree (razorpay_order_id) WHERE (razorpay_order_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payments_order_type ON public.customer_payments USING btree (razorpay_order_id, payment_type) WHERE (razorpay_order_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_customer_payments_payment_id ON public.customer_payments USING btree (razorpay_payment_id) WHERE (razorpay_payment_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payments_payment_type ON public.customer_payments USING btree (razorpay_payment_id, payment_type) WHERE (razorpay_payment_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_customer_payments_status ON public.customer_payments USING btree (status);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_profiles_user_id ON public.customer_profiles USING btree (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dispatch_sessions_customer ON public.dispatch_sessions USING btree (customer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dispatch_sessions_status ON public.dispatch_sessions USING btree (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dispatch_sessions_trip ON public.dispatch_sessions USING btree (trip_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_user_document_type ON public.documents USING btree (user_id, document_type);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_details_user_id ON public.driver_details USING btree (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_documents_driver_doc_type ON public.driver_documents USING btree (driver_id, doc_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_driver_locations_driver_id ON public.driver_locations USING btree (driver_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_driver_locations_lat_lng ON public.driver_locations USING btree (lat, lng) WHERE (is_online = true);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_driver_locations_online ON public.driver_locations USING btree (is_online);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_driver_no_shows_created ON public.driver_no_shows USING btree (created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_driver_no_shows_driver ON public.driver_no_shows USING btree (driver_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_driver_payments_driver ON public.driver_payments USING btree (driver_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_payments_order_type ON public.driver_payments USING btree (razorpay_order_id, payment_type) WHERE (razorpay_order_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_payments_payment_type ON public.driver_payments USING btree (razorpay_payment_id, payment_type) WHERE (razorpay_payment_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_driver_payments_status ON public.driver_payments USING btree (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_driver_payments_trip_id ON public.driver_payments USING btree (trip_id) WHERE (trip_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_driver_subs_rzp_sub_id ON public.driver_subscriptions USING btree (razorpay_subscription_id) WHERE (razorpay_subscription_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_driver_subs_status ON public.driver_subscriptions USING btree (subscription_status);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_subscriptions_one_active ON public.driver_subscriptions USING btree (driver_id) WHERE (is_active = true);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_franchise_payouts_franchisee ON public.franchise_payouts USING btree (franchisee_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_franchise_service_assignments_service ON public.franchise_service_assignments USING btree (service_key);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_franchise_service_assignments_unique ON public.franchise_service_assignments USING btree (franchisee_id, service_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_franchisees_zone_active ON public.franchisees USING btree (zone_id, is_active);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_heatmap_events_created_at ON public.heatmap_events USING btree (created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_heatmap_events_lat_lng ON public.heatmap_events USING btree (lat, lng);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ledger_entries_trip_id ON public.ledger_entries USING btree (trip_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_monthly_passes_user_active ON public.monthly_passes USING btree (user_id, is_active, valid_until);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notification_logs_driver ON public.notification_logs USING btree (recipient_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notification_logs_result ON public.notification_logs USING btree (fcm_result);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_notification_logs_trip ON public.notification_logs USING btree (trip_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_parcel_per_customer ON public.parcel_orders USING btree (customer_id) WHERE ((current_status)::text = ANY ((ARRAY['pending'::character varying, 'searching'::character varying, 'driver_assigned'::character varying, 'accepted'::character varying, 'picked_up'::character varying, 'in_transit'::character varying])::text[]));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_trip_per_customer ON public.trip_requests USING btree (customer_id) WHERE ((current_status)::text = ANY ((ARRAY['searching'::character varying, 'driver_assigned'::character varying, 'accepted'::character varying, 'arrived'::character varying, 'on_the_way'::character varying])::text[]));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_trip_per_driver ON public.trip_requests USING btree (driver_id) WHERE ((driver_id IS NOT NULL) AND ((current_status)::text = ANY ((ARRAY['driver_assigned'::character varying, 'accepted'::character varying, 'arrived'::character varying, 'on_the_way'::character varying])::text[])));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_otp_logs_phone_created ON public.otp_logs USING btree (phone, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_otp_logs_phone_type ON public.otp_logs USING btree (phone, user_type, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_otp_request_events_phone_created ON public.otp_request_events USING btree (phone, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_outstation_bookings_no_dup ON public.outstation_pool_bookings USING btree (ride_id, customer_id) WHERE ((status)::text <> 'cancelled'::text);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outstation_bookings_ride_id ON public.outstation_pool_bookings USING btree (ride_id, status);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_parcel_book_idempotency_key ON public.parcel_orders USING btree (customer_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_parcel_orders_customer_idempotency ON public.parcel_orders USING btree (customer_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_parcel_orders_idempotency ON public.parcel_orders USING btree (customer_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payment_recovery_events_customer ON public.payment_recovery_events USING btree (customer_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_payment_recovery_events_intent ON public.payment_recovery_events USING btree (booking_intent_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pool_issue_cases_customer ON public.pool_issue_cases USING btree (customer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pool_issue_cases_driver ON public.pool_issue_cases USING btree (driver_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pool_issue_cases_module_ref ON public.pool_issue_cases USING btree (module, reference_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pool_issue_cases_reported_user ON public.pool_issue_cases USING btree (reported_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pool_issue_cases_status ON public.pool_issue_cases USING btree (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pool_messages_module_ref ON public.pool_messages USING btree (module, reference_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pool_passengers_ride_id ON public.local_pool_passengers USING btree (pool_ride_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pool_ratings_to_user ON public.pool_ratings USING btree (to_user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_ratings_unique_submission ON public.pool_ratings USING btree (reference_type, reference_id, from_user_id, rating_role);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pool_ride_requests_customer_status ON public.pool_ride_requests USING btree (customer_id, status);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_user_blocks_active_pair ON public.pool_user_blocks USING btree (blocker_user_id, blocked_user_id, module) WHERE (active = true);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pool_user_blocks_blocked ON public.pool_user_blocks USING btree (blocked_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id ON public.refresh_tokens USING btree (session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON public.refresh_tokens USING btree (token);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON public.refresh_tokens USING btree (user_id, expires_at) WHERE (revoked = false);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ride_complaints_status_created ON public.ride_complaints USING btree (status, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ride_events_trip_created ON public.ride_events USING btree (trip_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_rzp_webhook_created ON public.razorpay_webhook_logs USING btree (created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_rzp_webhook_event_id ON public.razorpay_webhook_logs USING btree (event_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_rzp_webhook_event_type ON public.razorpay_webhook_logs USING btree (event_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_token ON public.sessions USING btree (token);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON public.sessions USING btree (user_id, expires_at) WHERE (revoked = false);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON public.system_logs USING btree (created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON public.system_logs USING btree (level);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_system_logs_tag ON public.system_logs USING btree (tag);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_ref_type ON public.transactions USING btree (ref_transaction_id, transaction_type) WHERE (ref_transaction_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_requests_booking_intent ON public.trip_requests USING btree (booking_intent_id) WHERE (booking_intent_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trip_requests_created_at ON public.trip_requests USING btree (created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trip_requests_current_status ON public.trip_requests USING btree (current_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trip_requests_customer_id ON public.trip_requests USING btree (customer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trip_requests_customer_status ON public.trip_requests USING btree (customer_id, current_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trip_requests_driver_id ON public.trip_requests USING btree (driver_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trip_requests_driver_status ON public.trip_requests USING btree (driver_id, current_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trip_requests_offered_driver ON public.trip_requests USING btree (offered_driver_id) WHERE (offered_driver_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trip_requests_payment_pending ON public.trip_requests USING btree (current_status, updated_at) WHERE ((current_status)::text = 'payment_pending'::text);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trip_requests_ref_id ON public.trip_requests USING btree (ref_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trip_requests_status_created ON public.trip_requests USING btree (current_status, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trip_requests_zone_id ON public.trip_requests USING btree (zone_id) WHERE (zone_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_trip_status_trip_created ON public.trip_status USING btree (trip_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_users_auth_token ON public.users USING btree (auth_token);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_notnull ON public.users USING btree (email) WHERE (email IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users USING btree (phone);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_users_user_type ON public.users USING btree (user_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_users_user_type_active ON public.users USING btree (user_type, is_active);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_user_id ON public.vehicles USING btree (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wallet_events_ref_id ON public.wallet_events USING btree (ref_id) WHERE (ref_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wallet_events_type_created ON public.wallet_events USING btree (type, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wallet_events_user_created ON public.wallet_events USING btree (user_id, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_withdraw_requests_driver_payment ON public.withdraw_requests USING btree (driver_payment_id) WHERE (driver_payment_id IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uidx_pool_ride_requests_one_active_per_customer ON public.pool_ride_requests USING btree (customer_id) WHERE ((status)::text = ANY (ARRAY[('searching'::character varying)::text, ('pending_driver_accept'::character varying)::text, ('matched'::character varying)::text, ('picked_up'::character varying)::text]));
--> statement-breakpoint
ALTER TABLE ONLY public.admin_login_otp
    ADD CONSTRAINT admin_login_otp_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.admin_refresh_tokens
    ADD CONSTRAINT admin_refresh_tokens_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.admin_refresh_tokens
    ADD CONSTRAINT admin_refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.admin_sessions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.admin_sessions
    ADD CONSTRAINT admin_sessions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.b2b_companies
    ADD CONSTRAINT b2b_companies_owner_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.b2b_companies
    ADD CONSTRAINT b2b_companies_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.booking_intents
    ADD CONSTRAINT booking_intents_customer_id_users_id_fk FOREIGN KEY (customer_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.coins_ledger
    ADD CONSTRAINT coins_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.commission_settlements
    ADD CONSTRAINT commission_settlements_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.company_wallet_events
    ADD CONSTRAINT company_wallet_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.b2b_companies(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.customer_no_shows
    ADD CONSTRAINT customer_no_shows_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_booking_intent_fk FOREIGN KEY (booking_intent_id) REFERENCES public.booking_intents(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_customer_fk FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.customer_payments
    ADD CONSTRAINT customer_payments_trip_fk FOREIGN KEY (trip_id) REFERENCES public.trip_requests(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.discounts
    ADD CONSTRAINT discounts_vehicle_category_id_vehicle_categories_id_fk FOREIGN KEY (vehicle_category_id) REFERENCES public.vehicle_categories(id);
--> statement-breakpoint
ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.driver_details
    ADD CONSTRAINT driver_details_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.driver_details
    ADD CONSTRAINT driver_details_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_details
    ADD CONSTRAINT driver_details_vehicle_category_fk FOREIGN KEY (vehicle_category_id) REFERENCES public.vehicle_categories(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.driver_details
    ADD CONSTRAINT driver_details_vehicle_category_id_vehicle_categories_id_fk FOREIGN KEY (vehicle_category_id) REFERENCES public.vehicle_categories(id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_details
    ADD CONSTRAINT driver_details_zone_fk FOREIGN KEY (zone_id) REFERENCES public.zones(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.driver_details
    ADD CONSTRAINT driver_details_zone_id_zones_id_fk FOREIGN KEY (zone_id) REFERENCES public.zones(id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_no_shows
    ADD CONSTRAINT driver_no_shows_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_payments
    ADD CONSTRAINT driver_payments_driver_fk FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.driver_payments
    ADD CONSTRAINT driver_payments_insurance_plan_fk FOREIGN KEY (insurance_plan_id) REFERENCES public.insurance_plans(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.driver_payments
    ADD CONSTRAINT driver_payments_plan_fk FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.driver_payments
    ADD CONSTRAINT driver_payments_trip_fk FOREIGN KEY (trip_id) REFERENCES public.trip_requests(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.driver_pool_sessions
    ADD CONSTRAINT driver_pool_sessions_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_zone_id_zones_id_fk FOREIGN KEY (zone_id) REFERENCES public.zones(id);
--> statement-breakpoint
ALTER TABLE ONLY public.driver_details
    ADD CONSTRAINT fk_driver_details_user_id_users FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.driver_documents
    ADD CONSTRAINT fk_driver_documents_driver_id_users FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT fk_trip_requests_customer_id FOREIGN KEY (customer_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT fk_trip_requests_driver_id FOREIGN KEY (driver_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT fk_trip_requests_vehicle_category_id FOREIGN KEY (vehicle_category_id) REFERENCES public.vehicle_categories(id);
--> statement-breakpoint
ALTER TABLE ONLY public.franchise_payouts
    ADD CONSTRAINT franchise_payouts_franchisee_id_fkey FOREIGN KEY (franchisee_id) REFERENCES public.franchisees(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.franchisees
    ADD CONSTRAINT franchisees_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.zones(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.local_pool_passengers
    ADD CONSTRAINT local_pool_passengers_customer_id_users_id_fk FOREIGN KEY (customer_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.local_pool_passengers
    ADD CONSTRAINT local_pool_passengers_pool_ride_id_local_pool_rides_id_fk FOREIGN KEY (pool_ride_id) REFERENCES public.local_pool_rides(id);
--> statement-breakpoint
ALTER TABLE ONLY public.local_pool_passengers
    ADD CONSTRAINT local_pool_passengers_trip_request_id_trip_requests_id_fk FOREIGN KEY (trip_request_id) REFERENCES public.trip_requests(id);
--> statement-breakpoint
ALTER TABLE ONLY public.local_pool_rides
    ADD CONSTRAINT local_pool_rides_dispatch_trip_id_trip_requests_id_fk FOREIGN KEY (dispatch_trip_id) REFERENCES public.trip_requests(id);
--> statement-breakpoint
ALTER TABLE ONLY public.local_pool_rides
    ADD CONSTRAINT local_pool_rides_driver_id_users_id_fk FOREIGN KEY (driver_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.local_pool_rides
    ADD CONSTRAINT local_pool_rides_vehicle_category_id_vehicle_categories_id_fk FOREIGN KEY (vehicle_category_id) REFERENCES public.vehicle_categories(id);
--> statement-breakpoint
ALTER TABLE ONLY public.local_pool_rides
    ADD CONSTRAINT local_pool_rides_zone_id_zones_id_fk FOREIGN KEY (zone_id) REFERENCES public.zones(id);
--> statement-breakpoint
ALTER TABLE ONLY public.monthly_passes
    ADD CONSTRAINT monthly_passes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_delivery_proofs
    ADD CONSTRAINT parcel_delivery_proofs_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_delivery_proofs
    ADD CONSTRAINT parcel_delivery_proofs_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.parcel_orders(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_events
    ADD CONSTRAINT parcel_events_parcel_order_id_fkey FOREIGN KEY (parcel_order_id) REFERENCES public.parcel_orders(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_fares
    ADD CONSTRAINT parcel_fares_zone_id_zones_id_fk FOREIGN KEY (zone_id) REFERENCES public.zones(id);
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_orders
    ADD CONSTRAINT parcel_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.parcel_orders
    ADD CONSTRAINT parcel_orders_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.payment_recovery_events
    ADD CONSTRAINT payment_recovery_events_booking_intent_id_fkey FOREIGN KEY (booking_intent_id) REFERENCES public.booking_intents(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.pool_ride_requests
    ADD CONSTRAINT pool_ride_requests_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.pool_ride_requests
    ADD CONSTRAINT pool_ride_requests_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.driver_pool_sessions(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referred_fk FOREIGN KEY (referred_id) REFERENCES public.users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referred_id_users_id_fk FOREIGN KEY (referred_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_fk FOREIGN KEY (referrer_id) REFERENCES public.users(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_id_users_id_fk FOREIGN KEY (referrer_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_reviewee_id_users_id_fk FOREIGN KEY (reviewee_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_reviewer_id_users_id_fk FOREIGN KEY (reviewer_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_trip_id_trip_requests_id_fk FOREIGN KEY (trip_id) REFERENCES public.trip_requests(id);
--> statement-breakpoint
ALTER TABLE ONLY public.saved_places
    ADD CONSTRAINT saved_places_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.spin_wheel_plays
    ADD CONSTRAINT spin_wheel_plays_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.surge_pricing
    ADD CONSTRAINT surge_pricing_zone_id_zones_id_fk FOREIGN KEY (zone_id) REFERENCES public.zones(id);
--> statement-breakpoint
ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_trip_fk FOREIGN KEY (trip_id) REFERENCES public.trip_requests(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_trip_id_trip_requests_id_fk FOREIGN KEY (trip_id) REFERENCES public.trip_requests(id);
--> statement-breakpoint
ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_fares
    ADD CONSTRAINT trip_fares_vehicle_category_id_vehicle_categories_id_fk FOREIGN KEY (vehicle_category_id) REFERENCES public.vehicle_categories(id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_fares
    ADD CONSTRAINT trip_fares_zone_id_zones_id_fk FOREIGN KEY (zone_id) REFERENCES public.zones(id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_messages
    ADD CONSTRAINT trip_messages_sender_id_users_id_fk FOREIGN KEY (sender_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_messages
    ADD CONSTRAINT trip_messages_trip_id_trip_requests_id_fk FOREIGN KEY (trip_id) REFERENCES public.trip_requests(id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_booking_intent_fk FOREIGN KEY (booking_intent_id) REFERENCES public.booking_intents(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_booking_intent_id_booking_intents_id_fk FOREIGN KEY (booking_intent_id) REFERENCES public.booking_intents(id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_customer_fk FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_customer_id_users_id_fk FOREIGN KEY (customer_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_driver_fk FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_driver_id_users_id_fk FOREIGN KEY (driver_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_vehicle_category_fk FOREIGN KEY (vehicle_category_id) REFERENCES public.vehicle_categories(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_vehicle_category_id_vehicle_categories_id_fk FOREIGN KEY (vehicle_category_id) REFERENCES public.vehicle_categories(id);
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_zone_fk FOREIGN KEY (zone_id) REFERENCES public.zones(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.trip_requests
    ADD CONSTRAINT trip_requests_zone_id_zones_id_fk FOREIGN KEY (zone_id) REFERENCES public.zones(id);
--> statement-breakpoint
ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.vehicle_models
    ADD CONSTRAINT vehicle_models_brand_fk FOREIGN KEY (brand_id) REFERENCES public.vehicle_brands(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.vehicle_models
    ADD CONSTRAINT vehicle_models_brand_id_vehicle_brands_id_fk FOREIGN KEY (brand_id) REFERENCES public.vehicle_brands(id);
--> statement-breakpoint
ALTER TABLE ONLY public.vehicle_requests
    ADD CONSTRAINT vehicle_requests_driver_id_users_id_fk FOREIGN KEY (driver_id) REFERENCES public.users(id);
--> statement-breakpoint
ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.wallet_events
    ADD CONSTRAINT wallet_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.withdraw_requests
    ADD CONSTRAINT withdraw_requests_driver_payment_fk FOREIGN KEY (driver_payment_id) REFERENCES public.driver_payments(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.withdraw_requests
    ADD CONSTRAINT withdraw_requests_user_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.withdraw_requests
    ADD CONSTRAINT withdraw_requests_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);

--> statement-breakpoint
ALTER TABLE public.trip_requests ADD COLUMN pickup_short_name character varying(100);
--> statement-breakpoint
ALTER TABLE public.trip_requests ADD COLUMN destination_short_name character varying(100);
--> statement-breakpoint
ALTER TABLE public.customer_payments ADD COLUMN refunded_at timestamp without time zone;
--> statement-breakpoint
ALTER TABLE public.ledger_entries ADD CONSTRAINT ledger_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
