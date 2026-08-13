# JAGO Pro Master Prompt (Corrected)

Act as a world-class software architect, product designer, and AI engineer.

Design and generate the full architecture and development blueprint for a futuristic AI-powered mobility super app called **JAGO**.

The system must be scalable, modular, secure, and capable of serving millions of users.

## Platform Components

1. Customer Mobile Application
2. Driver/Pilot Mobile Application
3. Admin Web Dashboard
4. AI Voice Assistant Engine
5. Real-time Ride Matching Engine
6. Intelligent Safety Monitoring System
7. Hyperlocal Delivery System

## Primary Goal

Create an advanced mobility and services super app with intelligent automation, AI capabilities, and premium UI/UX.

The application must combine ride services, parcel delivery, car sharing, intercity travel, and hyperlocal services in one platform.

## Core Services

- Bike rides
- Auto rides
- Car rides
- Parcel delivery
- Car sharing
- Intercity rides
- Hyperlocal delivery services

Each service should use a unified booking engine, while retaining separate service modules.

## AI Voice Assistant

Wake command: **"Hey JAGO Pro"**

Example flow:
- User: "Hey JAGO Pro"
- AI: "Where do you want to go?"
- User: "Benz Circle nundi Railway Station ki vellali"

The system must automatically:
1. Detect pickup from GPS
2. Extract destination from voice
3. Calculate route and distance
4. Suggest services (Bike/Auto/Car/Parcel)
5. Confirm booking through voice

Example:
- User: "Bike book chey"
- System should create the ride instantly.

## Advanced AI Features

- Predictive ride booking from user habits
- AI service suggestions by location/time
- Smart parcel type detection using camera
- Ride pooling recommendations
- Surge demand forecasting
- Route deviation detection
- Driver behavior monitoring
- AI safety guardian during trips

## Safety System

- SOS emergency button
- Real-time ride tracking
- Family live-trip sharing
- Route deviation alerts
- Driver identity verification
- Shake-to-emergency activation
- Female passenger safety escalation call routing

## Booking Flow Requirements

- Real-time driver matching
- Demand-aware dispatch
- Request broadcasting to nearby drivers
- Timer-based accept/reject window
- OTP-based trip verification

Customer trip screen must show:
- Driver photo
- Driver rating
- Vehicle details
- ETA
- Live map tracking
- Call action
- SOS action

## Driver App Requirements

- Incoming ride alert with voice prompt ("Lift Please")
- Accept/reject actions
- Navigation to pickup
- Earnings dashboard
- Daily history
- Surge heatmap
- Performance analytics
- Safety controls

## Admin Dashboard Requirements

- Professional superadmin control center with enterprise-grade information hierarchy
- User and driver lifecycle management (KYC, status, risk flags, block/unblock, audit history)
- Driver onboarding and document verification with queue-based workflows
- Live trip monitoring with map + incident timeline + quick intervention actions
- Revenue and commission analytics with trend cards, drilldowns, and export options
- World-class analytics surfaces with multiple chart types (Area, Bar, Pie/Donut, Trend comparisons)
- Surge and pricing configuration with rule preview and impact simulation
- Service and city configuration with validation and rollback-safe updates
- AI insights dashboard (demand anomalies, fraud signals, dispatch quality)
- Safety operations module (SOS events, escalation matrix, response SLA tracking)
- Role-based views for superadmin, admin, ops, finance, and support teams
- Activity logs and admin audit trail for all sensitive actions

### Superadmin Panel UI Rules (Must Follow)

- Use a consistent 8px spacing system only (8/12/16/24/32/40/48)
- Enforce strict alignment: all cards, table headers, filters, and buttons on shared grid columns
- Dashboard shell: sticky top bar + left navigation + content container with max-width and centered layout
- Section rhythm: page title, KPI row, filters row, content blocks (no random vertical gaps)
- Card system: uniform corner radius, elevation scale, and internal padding (minimum 16px)
- Tables: sticky header, zebra or subtle row separators, compact/comfortable density toggle
- Filters: place in one horizontal toolbar with predictable order (search -> date -> status -> actions)
- Action buttons: primary action right-aligned, secondary actions grouped, destructive actions isolated
- Forms: two-column desktop grid, single-column mobile, clear required/optional indicators
- Empty/loading/error/success states must be designed for every module (no blank screens)
- Use clear visual hierarchy: primary metrics first, operational alerts second, detailed data third
- Avoid floating/misaligned elements, overlapping widgets, and inconsistent paddings

### Superadmin All-Pages Compliance Checklist (Non-Negotiable)

- Apply the same layout system to every admin route, not only dashboard pages
- Every admin page must use one shared content shell with fixed max-width and centered alignment
- Every page must follow the same top structure order:
Page title row
Filter/action row
Main data content
- All page headers must use the same vertical rhythm and spacing tokens
- All forms must use identical input heights, label spacing, help text spacing, and button alignment
- All table pages must use the same header style, row density, sticky header behavior, and empty state design
- All modal dialogs must use the same padding scale, section spacing, and action button placement
- No per-page random margins or one-off pixel values unless there is a clear documented reason
- Add design QA checks before release for desktop, tablet, and mobile on every admin module
- Reject implementation if any screen has inconsistent padding, off-grid elements, or broken alignment
- Reports pages must always include visual analytics, not table-only output
- Minimum reports standard: KPI summary cards + trend chart + distribution chart + detailed table + export actions

## Map Requirements

- Real-time GPS tracking
- Route and distance calculation
- ETA prediction
- Traffic awareness

## UI/UX Requirements

- Premium, modern, production-ready visual language with clear hierarchy
- Pixel-consistent spacing and alignment across all pages and breakpoints
- Fast loading with skeleton states and progressive rendering for heavy dashboards
- Card-based layout with predictable grids (12-column desktop, 6 tablet, 4 mobile)
- Light and dark themes with WCAG-compliant contrast ratios
- One-hand mobile usability for critical operations and approval flows
- Strong typography system with defined scale (H1/H2/H3/body/caption) and consistent line-heights
- Component consistency: same button heights, input heights, corner radius, and icon sizing
- Responsive behavior rules for tables/charts/filters (collapse strategy explicitly defined)
- Micro-interactions only where meaningful: hover, focus, state change, confirmation feedback
- Clear and quick service selection with reduced cognitive load and explicit labels
- Accessibility first: keyboard navigation, focus visibility, and semantic form/error messaging

## Futuristic Capabilities

- Voice-based trip tracking
- Offline ride request fallback
- Ride negotiation option
- Predictive suggestions
- Intelligent dispatch algorithm
- AI health monitoring and auto anomaly detection

## Technology Stack

### Mobile
- Android: Kotlin
- iOS: Swift

### Backend
- Node.js microservices architecture

### Data
- PostgreSQL

### Real-time
- WebSocket infrastructure

### AI
- Speech recognition
- NLP
- ML model serving

## Architecture Requirements

- API gateway
- Microservices
- Ride matching service
- Driver location service
- Notification service
- AI voice processing service
- Analytics engine

## Deliverables

Generate:
- Full architecture diagram
- Microservice structure
- Database schema
- API endpoint structure
- Customer app screen hierarchy
- Driver app workflow
- Admin dashboard module structure
- AI assistant architecture

Ensure all outputs are production-ready, scalable, secure, and backward-compatible with existing JAGO features.
