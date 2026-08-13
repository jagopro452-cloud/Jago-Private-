# Jago Application - Manual Testing Guide

This manual outlines the step-by-step procedures for manually testing the end-to-end functionality of the Jago ecosystem (Customer App, Driver App, and Backend). 

## 1. Prerequisites Setup

Before starting the manual testing, ensure the following environments are set up:
- **Backend:** Running locally (`npm run dev`) or accessible via staging URL.
- **Database:** PostgreSQL database connected with initial seed data (vehicles, pricing).
- **Devices:** Two physical devices or emulators (Device A for Customer App, Device B for Driver App).

---

## 2. Core Flows (Smoke Testing)

### 2.1 Authentication Flow
**Customer App / Driver App**
1. **Action:** Enter a valid 10-digit phone number.
2. **Expected:** App validates the number format and requests an OTP.
3. **Action:** Enter the mock OTP (e.g., `123456`) or the one received via SMS.
4. **Expected:** Successful login, redirects to Home Screen / Map View.
5. **Action:** Logout from the app.
6. **Expected:** Session terminates, user is redirected to the login screen.

### 2.2 Ride Booking Flow (End-to-End)
This test ensures WebSockets and Real-Time systems correspond perfectly.

**1. Customer Requests Ride (Device A)**
- Search and select a destination on the Map.
- Select a specific vehicle category (e.g., "Auto", "Mini").
- Confirm the pickup location.
- **Expected:** Customer app shows "Searching for driver", backend emits `ride_requested` to nearest drivers matching the vehicle category.

**2. Driver Receives Request (Device B)**
- Driver app should be 'Online'.
- **Expected:** Popup or bottom sheet appears with the estimated fare, pickup distance, and destination. 
- **Action:** Driver accepts the ride within the 15-second timeout.
- **Expected:** Backend processes the acceptance and transitions the ride state to `accepted`.

**3. Ride Synchronization (Device A & B)**
- **Customer App (A):** Screen updates to "Driver Accepted". Displays the Driver's Name, Vehicle info, and the Pickup OTP. Map zooms to show driver location.
- **Driver App (B):** Screen transitions to "Navigate to Pickup".

**4. Driver Arrives & OTP Verification (Device B)**
- **Action:** Driver reaches the pickup location and swipes/clicks "Arrived".
- **Customer App (A):** Receives an alert: "Your driver is here."
- **Action:** Driver asks for the 4-digit Pickup OTP shown on the Customer App.
- **Expected:** Driver enters the correct OTP, the trip transitions to `in_progress`. 

**5. Trip Completion & Payment**
- **Action:** Driver reaches the destination and swipes "End Trip".
- **Expected Both Apps:** Fare summary is displayed.
- **Customer App (A):** Option to pay via Wallet, UPI (Razorpay), or Cash.
- **Driver App (B):** Once payment is marked received, both users are prompted to rate each other.

---

## 3. Edge Cases & Resilience Testing

- **Socket Disconnections:**
  - *Action:* Turn off WiFi/Data on Device A while in "Searching for driver" status. Wait 10 seconds, turn it back on.
  - *Expected:* Socket reconnects automatically and fetches the latest ride status seamlessly without crashing.
  
- **GPS / Location Denied or Disabled:**
  - *Action:* Deny location permission during app launch.
  - *Expected:* A clear fallback UI asking the user to manually enter a pickup address or enable settings.

- **Fare Changes in Bad Networks:**
  - *Action:* Book a ride, turn on airplane mode, wait, and turn off airplane mode.
  - *Expected:* Ensure the fare calculated remains consistent and idempotency prevents dual bookings.

- **Concurrent Ride Grabs (Race Condition Test):**
  - *Action:* Set up two drivers. Have them tap "Accept" on the exact same broadcasted ride at the same time.
  - *Expected:* The backend successfully assigns it to the first request parsed; the second driver receives a "Trip already accepted" gracefully.

- **Mid-trip App Kill:**
  - *Action:* Force close the Customer app while a trip is active. Re-open the app.
  - *Expected:* The UI instantly jumps to the active trip tracking screen instead of the default home page.

---

## 4. Wallet & Payments Manual Checks

1. **Wallet Recharge:** Add funds using the dummy Razorpay flow. Ensure Wallet Balance updates instantly.
2. **Cancellation Penalties:** Cancel a trip as a Customer after the driver has traveled halfway. Ensure the cancellation penalty logic automatically deducts from the wallet.
3. **Driver Wallets:** Verify commission is deducted instantly up upon completing a cash trip. Verify the Driver App prevents going online if the wallet drops below Rs. -50 (negative balance lock).
