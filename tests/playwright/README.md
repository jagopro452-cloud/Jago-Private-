JAGO Playwright Suite

Commands:
- `npm run test:e2e`
- `npm run test:e2e:headed`
- `npm run test:e2e:debug`
- `npm run test:e2e:report`

Default behavior:
- Starts a local Vite web server for the client.
- Starts a local mock JAGO backend for bookings, OTP, payments, and sockets.
- Writes HTML reports to `playwright-report/`.
- Keeps screenshots, video, and traces for failures and retries.

Optional environment setup:
- Copy `.env.playwright.example` to `.env.playwright.local`.
- Change values only if you want custom ports, credentials, or live backend wiring.

Live modes:
- `npm run test:e2e:live`
- `npm run test:e2e:staging`
- `npm run test:e2e:smoke-live`

Environment profiles:
- `.env.live` targets deployed production infrastructure and disables local mock services.
- `.env.staging` targets deployed staging infrastructure and disables local mock services.

Live-mode safety:
- Live tests run serially by default through `PW_WORKERS=1`.
- All created records should use QA tags from `runtime.qaRunId`.
- Payment success-path validation must stay on non-chargeable flows unless a dedicated UAT path is available.
