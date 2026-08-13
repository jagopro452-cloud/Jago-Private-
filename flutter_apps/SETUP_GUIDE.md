# JAGO Flutter Apps — Setup Guide
## MindWhile IT Solutions Pvt Ltd | jagopro.org

---

## Apps Summary

| App | Folder | Style | Target |
|-----|--------|-------|--------|
| JAGO Pilot | `driver_app/` | Dark Navy + Blue | Driver Android APK |
| JAGO | `customer_app/` | White + Blue | Customer Android APK |

---

## Prerequisites

1. Flutter SDK 3.0+ → https://docs.flutter.dev/get-started/install
2. Android Studio or VS Code + Flutter plugin
3. Google Maps API Key (from Google Cloud Console)
4. Backend running at jagopro.org

---

## Step 1: Google Maps API Key

1. Visit https://console.cloud.google.com
2. Enable: Maps SDK for Android + Maps SDK for iOS + Places API
3. Create API Key → Restrict to app package name
4. Replace `YOUR_GOOGLE_MAPS_API_KEY` in:
   - `driver_app/android/app/src/main/AndroidManifest.xml`
   - `customer_app/android/app/src/main/AndroidManifest.xml`
   - Both `lib/config/api_config.dart` files

---

## Step 2: Install and Run

```bash
# Driver App
cd driver_app
flutter pub get
flutter run

# Customer App
cd customer_app
flutter pub get
flutter run
```

---

## Step 3: Build Release APK

```bash
cd driver_app
flutter build apk --release
# Output: build/app/outputs/flutter-apk/app-release.apk

cd customer_app
flutter build apk --release
```

---

## DRIVER APP — Feature List (JAGO Pilot)

### Authentication
- Phone OTP login
- Secure token storage
- Auto-login on app open

### Face Verification (Rapido-style safety)
- Triggers automatically:
  - **Day 1**: First time opening app (first_time)
  - **Daily**: Every 24 hours when opening app (daily_check)
  - **After 10 trips**: After every 10 completed rides (after_10_trips)
- Front camera selfie capture with oval face guide
- 3-second countdown before photo
- Retake option available
- ✅ Success screen on verification

### KYC Documents
- Upload 6 documents: DL Front, DL Back, RC, Aadhar Front, Aadhar Back, Insurance
- Status tracking: Not uploaded → Under Review → Approved/Rejected
- Progress bar showing KYC completion %
- Re-upload option for rejected docs

### Home Screen (Map)
- Google Maps with real GPS location
- Online/Offline toggle switch
- Earnings summary card (wallet, trips, rating)
- Smooth animated toggle

### Incoming Trip
- Full-screen bottom sheet with:
  - Customer name + rating
  - Pickup & destination with distance
  - Estimated fare in large text
  - Vehicle type + payment method
  - 30-second countdown auto-reject timer
  - Accept (blue) / Decline (red) buttons

### Active Trip Flow
1. Navigate to Pickup (Google Maps directions)
2. Mark Arrived → 4-digit OTP entry
3. Verify OTP → Start Ride
4. Complete Trip → Rating screen

### Performance Dashboard
- Score out of 100 (Bronze/Silver/Gold level)
- Daily Goal: target 10 trips/day with progress bar
- Weekly Goal: target 50 trips/week with progress bar
- This month stats
- Recent 5 trips
- Tips & suggestions

### Wallet & Earnings
- Balance card with gradient
- Request Withdrawal (specify amount)
- Earnings by period: Today / This Week / This Month / All Time
- Net earnings (after commission)
- Transaction history

### Profile
- Driver avatar + rating + status
- Trip count, wallet balance
- Lock warning if balance < -₹100
- Menu: Performance, KYC, Refer & Earn, Trip History, Support

---

## CUSTOMER APP — Feature List (JAGO)

### Authentication
- Phone OTP login (6-digit)
- Auto-login
- Resend OTP with 60s countdown

### Home Screen
- Full screen Google Maps
- Search bar (tap to book)
- Quick action tiles (Home / Work / Saved)
- "Book a Ride" CTA button
- My location button
- Active trip auto-detection (polls every 10s)

### Booking Flow
1. Tap on map OR search bar
2. Select destination by tapping on map
3. Tap "See Available Rides"
4. Choose vehicle category (with fare + ETA + seats)
5. Select payment: Cash / Wallet / UPI
6. Apply coupon (discount code)
7. Confirm Booking

### Live Tracking
- Real-time driver location on map
- Status bar: Finding → Coming → Arrived → In Progress
- Driver name, vehicle number, rating
- YOUR OTP displayed prominently when driver arrives
- Cancel ride option (with reason)
- Live fare display

### Rating
- 5-star rating after trip complete
- Skip option

### Scheduled Rides
- Book rides for future date/time
- Date + time picker
- View all upcoming scheduled rides
- Calendar-style UI

### Wallet
- Balance card with gradient
- Add Money (choose ₹50/100/200/500/1000)
- UPI payment reference entry
- Transaction history with credit/debit icons

### Saved Places
- Add Home / Work / Other places
- Max unlimited places
- Delete with swipe
- Used in quick booking

### Emergency Contacts
- Add up to 3 emergency contacts
- Name, phone, relation (Family/Friend/Spouse etc)
- Auto-notified on SOS trigger

### Safety
- SOS button (sends GPS location to server + contacts)
- Trip sharing → generates share link
- Emergency contacts management

### Profile
- Avatar with edit button
- Stats: Total trips, Wallet, Total spent
- Menu: Saved Places, Scheduled Rides, Coupons, Refer & Earn
- Safety section: Emergency Contacts, SOS, Live Sharing
- Info: Support, Privacy Policy, Terms

---

## API Endpoints Used

| App | Endpoint | Purpose |
|-----|----------|---------|
| Driver | GET /driver/check-verification | Check if face verify needed |
| Driver | POST /driver/face-verify | Submit selfie |
| Driver | POST /driver/upload-document | Upload KYC doc |
| Driver | GET /driver/documents | Get doc status |
| Driver | GET /driver/dashboard | Advanced stats + goals |
| Driver | GET /driver/performance | Score + acceptance rate |
| Customer | GET /customer/home-data | Home screen data |
| Customer | POST /customer/schedule-ride | Book scheduled ride |
| Customer | GET /customer/scheduled-rides | List scheduled rides |
| Both | POST /trip-share | Generate share link |
| Both | GET /emergency-contacts | List contacts |
| Both | POST /emergency-contacts | Add contact |
| Both | DELETE /emergency-contacts/:id | Remove contact |
| Both | GET /notifications | In-app notifications |

---

## Contact

- **Email**: info@jagopro.org
- **Website**: https://jagopro.org
- **Company**: MindWhile IT Solutions Pvt Ltd
