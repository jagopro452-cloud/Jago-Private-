# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: admin-panel.spec.ts >> Admin Panel >> dashboard loads live cards and navigation search
- Location: tests\playwright\specs\admin-panel.spec.ts:10:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('dashboard-banner')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByTestId('dashboard-banner')

```

```yaml
- region "Notifications (F8)":
  - list
- complementary:
  - link "JAGO ADMIN PANEL":
    - /url: /admin/dashboard
    - img "JAGO"
    - text: ADMIN PANEL
  - button ""
  - text: JQ JAGO QA Admin superadmin 
  - searchbox "Search Here"
  - list:
    - listitem:
      - list:
        - listitem "Dashboard"
        - listitem:
          - link " Dashboard":
            - /url: /admin/dashboard
        - listitem:
          - link " Realtime Ops":
            - /url: /admin/realtime-ops
        - listitem:
          - link " System Health":
            - /url: /admin/system-health
        - listitem:
          - link " Service Management":
            - /url: /admin/service-management
        - listitem:
          - link " Heat Map":
            - /url: /admin/heat-map
        - listitem:
          - link " Fleet View":
            - /url: /admin/fleet-view
    - listitem:
      - list:
        - listitem "Fare Management"
        - listitem:
          - link " Fare Overview":
            - /url: /admin/fare-management
        - listitem:
          - link " Trip Fare Setup":
            - /url: /admin/fares
        - listitem:
          - link " Parcel Delivery Fare":
            - /url: /admin/parcel-fares
        - listitem:
          - link " Local Pool Pricing":
            - /url: /admin/local-pool?openSettings=1
        - listitem:
          - link " Outstation Pool Pricing":
            - /url: /admin/outstation-pool?tab=settings
        - listitem:
          - link " Car Sharing Pricing":
            - /url: /admin/car-sharing?tab=settings
        - listitem:
          - link " Surge Pricing":
            - /url: /admin/surge-pricing
        - listitem:
          - link " Commission Rules":
            - /url: /admin/revenue-model
        - listitem:
          - link " Cancel Reasons":
            - /url: /admin/cancellation-reasons
        - listitem:
          - link " Fare Simulator":
            - /url: /admin/fare-simulator
        - listitem:
          - link " Pricing Audit Logs":
            - /url: /admin/pricing-audit-logs
    - listitem:
      - list:
        - listitem "Zone Management"
        - listitem:
          - link " Zone Setup":
            - /url: /admin/zones
        - listitem:
          - link " Franchise Setup":
            - /url: /admin/franchisees
    - listitem:
      - list:
        - listitem "Trip Management"
        - listitem:
          - link " All Trips":
            - /url: /admin/trips
        - listitem:
          - link " Local Pool":
            - /url: /admin/local-pool
        - listitem:
          - link " Intercity Pool":
            - /url: /admin/intercity-pool
        - listitem:
          - link " Outstation Pool":
            - /url: /admin/outstation-pool
        - listitem:
          - link " Intercity Routes":
            - /url: /admin/intercity-routes
        - listitem:
          - link " Parcel Refund Request":
            - /url: /admin/parcel-refunds
        - listitem:
          - link " Safety & Emergency":
            - /url: /admin/safety-alerts
    - listitem:
      - list:
        - listitem "Promotion Management"
        - listitem:
          - link " Banner Setup":
            - /url: /admin/banners
        - listitem:
          - link " Coupon Setup":
            - /url: /admin/coupons
        - listitem:
          - link " Discount Setup":
            - /url: /admin/discounts
        - listitem:
          - link " Referral Management":
            - /url: /admin/referrals
        - listitem:
          - link " Spin Wheel":
            - /url: /admin/spin-wheel
        - listitem:
          - link " Send Notification":
            - /url: /admin/notifications
    - listitem:
      - list:
        - listitem "User Management"
        - listitem:
          - link " Driver Verification":
            - /url: /admin/driver-verification
        - listitem:
          - link " Driver Level Setup":
            - /url: /admin/driver-levels
        - listitem:
          - link " Driver Setup":
            - /url: /admin/drivers
        - listitem:
          - link " Insurance Plans":
            - /url: /admin/insurance
        - listitem:
          - link " Withdraw Requests":
            - /url: /admin/withdrawals
        - listitem:
          - link " Customer Level Setup":
            - /url: /admin/customer-levels
        - listitem:
          - link " Customer Setup":
            - /url: /admin/customers
        - listitem:
          - link " Customer Wallet":
            - /url: /admin/customer-wallet
        - listitem:
          - link " Wallet Bonus":
            - /url: /admin/wallet-bonus
        - listitem:
          - link " Employee Setup":
            - /url: /admin/employees
        - listitem:
          - link " Subscription Plans":
            - /url: /admin/subscriptions
    - listitem:
      - list:
        - listitem "Parcel Management"
        - listitem:
          - link " Parcel Orders":
            - /url: /admin/parcel-orders
        - listitem:
          - link " Parcel Attributes":
            - /url: /admin/parcel-attributes
    - listitem:
      - list:
        - listitem "B2B / Porter"
        - listitem:
          - link " B2B Companies":
            - /url: /admin/b2b-companies
    - listitem:
      - list:
        - listitem "Vehicle Management"
        - listitem:
          - link " Vehicle Attribute Setup":
            - /url: /admin/vehicle-attributes
        - listitem:
          - link " Vehicle Categories":
            - /url: /admin/vehicles
        - listitem:
          - link " Vehicle Requests":
            - /url: /admin/vehicle-requests
    - listitem:
      - list:
        - listitem "Transactions & Reports"
        - listitem:
          - link " Transactions":
            - /url: /admin/transactions
        - listitem:
          - link " Reports":
            - /url: /admin/reports
        - listitem:
          - link " Driver Earnings":
            - /url: /admin/driver-earnings
        - listitem:
          - link " Driver Wallet":
            - /url: /admin/driver-wallet
    - listitem:
      - list:
        - listitem "Help & Support"
        - listitem:
          - link " Chatting":
            - /url: /admin/chatting
        - listitem:
          - link " Call Logs":
            - /url: /admin/call-logs
        - listitem:
          - link " Refund Requests":
            - /url: /admin/refund-requests
    - listitem:
      - list:
        - listitem "Developer"
        - listitem:
          - link " API Reference":
            - /url: /admin/api-docs
        - listitem:
          - link " App UI Design":
            - /url: /admin/app-design
    - listitem:
      - list:
        - listitem "Reviews"
        - listitem:
          - link " Reviews":
            - /url: /admin/reviews
    - listitem:
      - list:
        - listitem "Business Management"
        - listitem:
          - link " Business Setup":
            - /url: /admin/business-setup
        - listitem:
          - link " Pages & Media":
            - /url: /admin/pages-media
        - listitem:
          - link " App Languages":
            - /url: /admin/languages
        - listitem:
          - link " Configurations":
            - /url: /admin/configurations
        - listitem:
          - link " System Settings":
            - /url: /admin/settings
  - button " Sign Out"
- banner:
  - text: Dashboard  Dashboard
  - list:
    - listitem:  11:37 am
    - listitem:
      - button ""
    - listitem:
      - button ""
    - listitem:
      - button "JQ"
- text: 🌅
- heading "Good morning, JAGO QA Admin!" [level=3]
- paragraph: Here is your platform overview for today
- text:  Saturday, 1 August 2026 118 Live Trips 1830 Online Pilots ₹48,25,000 Total Revenue 12 Active Zones  Pricing Health
- link "⚠ Local Pool Pricing Incomplete":
  - /url: /admin/local-pool?openSettings=1
- link "⚠ Outstation Pricing Not Configured":
  - /url: /admin/outstation-pool?tab=settings
- link "⚠ Commission Rules Missing":
  - /url: /admin/revenue-model
- link "Open Fare Management →":
  - /url: /admin/fare-management
- link " Total Customers 12,480 +12% ":
  - /url: /admin/customers
- link " Total Drivers 2,860 +5% ":
  - /url: /admin/drivers
- link " Total Revenue ₹48,25,000 +18% ":
  - /url: /admin/reports
- link " Total Trips 93,840 +8% ":
  - /url: /admin/trips
- text: Services Overview ₹42,000 pending commission
- link " City Rides subscription 5,100 Trips ₹8,20,000 Revenue":
  - /url: /admin/trips
- link " Parcels commission 850 Trips ₹1,32,000 Revenue":
  - /url: /admin/parcel-orders
- link " Intercity Pool commission 260 Trips ₹51,000 Revenue":
  - /url: /admin/intercity-carsharing
- link " Outstation Pool Active 72 Trips ₹68,000 Revenue":
  - /url: /admin/outstation-pool
- text: Live Operations Live · refreshes every 15s  18 Searching  6 Dispatching  118 In Progress  94 Done (1h)  7 Cancelled (1h)  4m Avg Wait Weekly Revenue Revenue & trips — last 7 days
- img: Mon Tue Wed Thu Fri Sat Sun 0 45000 90000 135000 180000
- text: Trip Distribution Status breakdown
- img:
  - img
  - img
  - img
  - text: 94%
- list:
  - listitem:
    - img
    - text: Completed
  - listitem:
    - img
    - text: Ongoing
  - listitem:
    - img
    - text: Cancelled
- text: Recent Trips Latest platform activity
- link "View All ":
  - /url: /admin/trips
- table:
  - rowgroup:
    - row "Trip ID Customer Vehicle Type Fare Payment Status Date":
      - columnheader "Trip ID"
      - columnheader "Customer"
      - columnheader "Vehicle"
      - columnheader "Type"
      - columnheader "Fare"
      - columnheader "Payment"
      - columnheader "Status"
      - columnheader "Date"
  - rowgroup:
    - row "TRPQA001 AS Anita Sharma Cab Ride ₹189 Paid Completed 1/8/2026":
      - cell "TRPQA001"
      - cell "AS Anita Sharma"
      - cell "Cab"
      - cell "Ride"
      - cell "₹189"
      - cell "Paid"
      - cell "Completed"
      - cell "1/8/2026"
- text: Local Time 11:37 :22 AM Saturday, 1 August 2026 Quick Stats  88210 Completed  118 Ongoing  5512 Cancelled  14 Withdrawals  4210 Reviews  12 Zones Quick Actions
- link " All Trips":
  - /url: /admin/trips
- link " Drivers":
  - /url: /admin/drivers
- link " Withdrawals":
  - /url: /admin/withdrawals
- link " Reports":
  - /url: /admin/reports
- text:  Notifications
- link "View all":
  - /url: /admin/notifications
- text:  Trip assigned Driver Ravi Kumar accepted TRPQA001 5m ago
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import { installAdminUiMocks, seedAdminSession } from "../support/ui-mocks";
  3  | 
  4  | test.describe("Admin Panel", () => {
  5  |   test.beforeEach(async ({ page }) => {
  6  |     await installAdminUiMocks(page);
  7  |     await seedAdminSession(page);
  8  |   });
  9  | 
  10 |   test("dashboard loads live cards and navigation search", async ({ page }) => {
  11 |     await page.goto("/admin/dashboard");
> 12 |     await expect(page.getByTestId("dashboard-banner")).toBeVisible();
     |                                                        ^ Error: expect(locator).toBeVisible() failed
  13 |     await expect(page.getByTestId("stat-card-total-customers")).toBeVisible();
  14 |     await page.getByTestId("sidebar-search").fill("settings");
  15 |     await expect(page.getByTestId("nav-system-settings")).toBeVisible();
  16 |   });
  17 | 
  18 |   test("otp settings save through stable controls", async ({ page }) => {
  19 |     await page.goto("/admin/settings");
  20 |     await page.getByTestId("settings-tab-otp").click();
  21 |     await page.getByTestId("otp-toggle-fallbackEnabled").click();
  22 |     await page.getByTestId("otp-expiry-seconds").fill("180");
  23 |     await page.getByTestId("btn-save-otp-settings").click();
  24 |     await expect(page.getByTestId("btn-save-otp-settings")).toBeVisible();
  25 |   });
  26 | });
  27 | 
```