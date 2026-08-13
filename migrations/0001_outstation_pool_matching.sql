-- Outstation Pool upgrade: scheduled auto-assignment.
-- Adds a driver-availability queue and a customer-request queue, matched by
-- a periodic job (mirrors driver_pool_sessions / pool_ride_requests used by
-- the existing Local Pool matcher). Once matched, rows are created in the
-- existing outstation_pool_rides / outstation_pool_bookings tables, whose
-- execution pipeline (start/pickup/drop/complete) is unchanged.

CREATE TABLE IF NOT EXISTS public.outstation_driver_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    driver_id uuid NOT NULL,
    vehicle_category_id uuid,
    from_city character varying(120) NOT NULL,
    to_city character varying(120) NOT NULL,
    from_lat double precision,
    from_lng double precision,
    to_lat double precision,
    to_lng double precision,
    seat_capacity integer DEFAULT 4 NOT NULL,
    available_seats integer DEFAULT 4 NOT NULL,
    price_per_km_per_seat numeric(10,2) DEFAULT 0,
    earliest_departure timestamp without time zone NOT NULL,
    latest_departure timestamp without time zone NOT NULL,
    status character varying(20) DEFAULT 'available'::character varying NOT NULL,
    matched_ride_id uuid,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    ended_at timestamp without time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outstation_driver_avail_status_route
    ON public.outstation_driver_availability (status, from_city, to_city);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outstation_driver_avail_driver
    ON public.outstation_driver_availability (driver_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.outstation_pool_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    customer_id uuid NOT NULL,
    vehicle_category_id uuid,
    from_city character varying(120) NOT NULL,
    to_city character varying(120) NOT NULL,
    from_lat double precision,
    from_lng double precision,
    to_lat double precision,
    to_lng double precision,
    pickup_address text,
    drop_address text,
    seats_requested integer DEFAULT 1 NOT NULL,
    earliest_departure timestamp without time zone NOT NULL,
    latest_departure timestamp without time zone NOT NULL,
    status character varying(20) DEFAULT 'searching'::character varying NOT NULL,
    proposed_availability_id uuid,
    matched_ride_id uuid,
    matched_booking_id uuid,
    seat_lock_expires_at timestamp without time zone,
    advance_amount numeric(10,2) DEFAULT 0,
    advance_status character varying(20) DEFAULT 'pending'::character varying,
    searched_at timestamp without time zone DEFAULT now(),
    matched_at timestamp without time zone,
    cancelled_at timestamp without time zone,
    cancel_reason text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outstation_pool_requests_status_route
    ON public.outstation_pool_requests (status, from_city, to_city);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outstation_pool_requests_customer
    ON public.outstation_pool_requests (customer_id);
--> statement-breakpoint

-- Track which pipeline formed a ride, and per-booking advance/notification state.
ALTER TABLE public.outstation_pool_rides
    ADD COLUMN IF NOT EXISTS formed_via character varying(20) DEFAULT 'manual'::character varying;
--> statement-breakpoint
ALTER TABLE public.outstation_pool_bookings
    ADD COLUMN IF NOT EXISTS advance_amount numeric(10,2) DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.outstation_pool_bookings
    ADD COLUMN IF NOT EXISTS advance_status character varying(20) DEFAULT 'pending'::character varying;
--> statement-breakpoint
ALTER TABLE public.outstation_pool_bookings
    ADD COLUMN IF NOT EXISTS notified_1h boolean DEFAULT false;
