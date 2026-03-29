# HaiTech CRM - Test Plan

## 1. System Overview

### Frontend Pages (21 total)
| Page | Description | Priority | Test Status |
|------|-------------|----------|-------------|
| Login | Authentication | P0 | ✅ Tested |
| Dashboard | Main dashboard with stats & forecast | P0 | ✅ Tested |
| Cycles | Cycle list & management | P0 | ✅ Tested |
| CycleDetail | Single cycle view, meetings, registrations, Zoom, expenses | P0 | ✅ Tested |
| Customers | Customer list & management | P1 | 🔲 Pending |
| CustomerDetail | Single customer view with students | P1 | 🔲 Pending |
| Students | Student list & management | P1 | 🔲 Pending |
| Instructors | Instructor list & management | P1 | 🔲 Pending |
| Courses | Course catalog | P1 | 🔲 Pending |
| Branches | Branch management | P1 | 🔲 Pending |
| Meetings | Meeting list & management | P1 | ✅ Tested |
| Reports | Reporting & analytics | P2 | ✅ Tested |
| AuditLog | Audit trail | P2 | 🔲 Pending |
| InstructorDashboard | Instructor-specific view | P2 | 🔲 Pending |
| InviteSetup | Instructor invitation | P2 | 🔲 Pending |
| ResetPassword | Password reset | P2 | 🔲 Pending |
| MeetingStatus | Public meeting status | P2 | 🔲 Pending |
| InstructorMagicMeeting | Magic link meeting | P2 | 🔲 Pending |
| MobileMeetings | Mobile meeting list | P2 | 🔲 Pending |
| MobileMeetingDetail | Mobile meeting detail | P2 | 🔲 Pending |
| MobileAttendanceOverview | Mobile attendance | P2 | 🔲 Pending |

### Backend Routes (25 endpoints)
| Route | Endpoints | Priority | Test Status |
|-------|-----------|----------|-------------|
| /api/auth | login, register, me, refresh, reset | P0 | ✅ Tested |
| /api/cycles | CRUD, meetings, registrations | P0 | ✅ Tested |
| /api/zoom | create/delete meeting, webhooks | P0 | ✅ Tested |
| /api/meetings | CRUD, status updates, expenses | P1 | ✅ Tested |
| /api/expenses | cycle & meeting expenses | P1 | ✅ Tested |
| /api/customers | CRUD | P1 | 🔲 Pending |
| /api/students | CRUD | P1 | 🔲 Pending |
| /api/instructors | CRUD | P1 | 🔲 Pending |
| /api/courses | CRUD | P1 | 🔲 Pending |
| /api/branches | CRUD | P1 | 🔲 Pending |
| /api/registrations | CRUD | P1 | 🔲 Pending |
| /api/attendance | tracking, bulk | P2 | 🔲 Pending |
| /api/forecast | financial forecasting | P2 | 🔲 Pending |

---

## 2. Existing Test Suites

### A. Smoke Suite (P0) - ~2 min
**File:** `e2e/tests/smoke/critical-paths.spec.ts`
- Login with valid credentials
- Dashboard loads with stats
- Navigate to cycles page
- Basic CRUD operations verify

### B. Auth Tests
**File:** `e2e/tests/auth/login.spec.ts`
- [x] Login with valid credentials
- [x] Login with invalid credentials (negative)
- [x] Redirect to dashboard after login
- [x] Protected routes redirect to login

### C. Cycles Tests
**Files:**
- `e2e/tests/cycles/cycles-list.spec.ts`
- `e2e/tests/cycles/cycle-sync.spec.ts`
- `e2e/tests/cycles/cycle-zoom.spec.ts`

Tests:
- [x] List cycles with pagination
- [x] Filter cycles by status
- [x] Create new cycle
- [x] Edit cycle details
- [x] Cycle with online activity → Zoom section visible
- [x] Create Zoom meeting for cycle
- [x] Delete Zoom meeting
- [x] Schedule fields locked when Zoom exists

### D. Expenses Tests
**Files:**
- `e2e/tests/expenses/cycle-expenses.spec.ts`
- `e2e/tests/expenses/meeting-expenses.spec.ts`

Tests:
- [x] Add cycle expense (materials, wraparound hours)
- [x] Edit cycle expense
- [x] Delete cycle expense
- [x] Add meeting expense (travel, taxi)
- [x] Edit meeting expense
- [x] Delete meeting expense
- [x] Expense amount calculations

### E. Meetings Tests
**File:** `e2e/tests/meetings/meetings-stats.spec.ts`
- [x] View meetings list
- [x] Meeting status display
- [x] Meeting statistics

### F. Reports Tests
**File:** `e2e/tests/reports/reports.spec.ts`
- [x] Reports page loads
- [x] Report filters work
- [x] Report data displays

---

## 3. Test Infrastructure

### Directory Structure
```
e2e/
├── fixtures/
│   └── auth.fixture.ts         # Login state
├── page-objects/
│   ├── login.page.ts
│   ├── dashboard.page.ts
│   ├── cycles.page.ts
│   └── base.page.ts
├── tests/
│   ├── smoke/
│   │   └── critical-paths.spec.ts  ✅
│   ├── auth/
│   │   └── login.spec.ts           ✅
│   ├── cycles/
│   │   ├── cycles-list.spec.ts     ✅
│   │   ├── cycle-sync.spec.ts      ✅
│   │   └── cycle-zoom.spec.ts      ✅
│   ├── expenses/
│   │   ├── cycle-expenses.spec.ts  ✅
│   │   └── meeting-expenses.spec.ts ✅
│   ├── meetings/
│   │   └── meetings-stats.spec.ts  ✅
│   └── reports/
│       └── reports.spec.ts         ✅
├── utils/
│   ├── api.ts                  # API helpers
│   └── test-data.ts            # Test data generation
├── playwright.config.ts
└── tsconfig.json
```

### Playwright Configuration
```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://crm.orma-ai.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

---

## 4. CI Integration

### GitHub Actions - e2e.yml
```yaml
name: E2E Tests

on:
  pull_request:
    branches: [dev, main]
  push:
    branches: [dev]
  schedule:
    - cron: '0 2 * * *'  # Nightly at 2 AM

jobs:
  smoke:
    name: Smoke Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install dependencies
        run: npm ci
        working-directory: ./e2e
      - name: Install Playwright
        run: npx playwright install --with-deps chromium
        working-directory: ./e2e
      - name: Run smoke tests
        run: npx playwright test tests/smoke
        working-directory: ./e2e
        env:
          BASE_URL: https://crm.orma-ai.com
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: smoke-results
          path: e2e/test-results/

  regression:
    name: Regression Tests
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install dependencies
        run: npm ci
        working-directory: ./e2e
      - name: Install Playwright
        run: npx playwright install --with-deps
        working-directory: ./e2e
      - name: Run all tests
        run: npx playwright test
        working-directory: ./e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: regression-results
          path: e2e/test-results/
```

---

## 5. Remaining Tests to Implement

### Priority 1 (Next)
- [ ] Customers CRUD tests
- [ ] Students CRUD tests
- [ ] Instructors CRUD tests
- [ ] Courses CRUD tests
- [ ] Branches CRUD tests
- [ ] Registrations tests

### Priority 2 (Later)
- [ ] Attendance tests
- [ ] Audit log tests
- [ ] Instructor dashboard tests
- [ ] Mobile view tests
- [ ] Password reset flow
- [ ] Invitation flow

---

## 6. Running Tests

### Local Development
```bash
cd /home/opc/clawd/projects/haitech-crm/e2e

# Install dependencies
npm install

# Install browsers
npx playwright install

# Run all tests
npx playwright test

# Run smoke tests only
npx playwright test tests/smoke

# Run specific test file
npx playwright test tests/cycles/cycles-list.spec.ts

# Run with UI mode
npx playwright test --ui

# Run with headed browser
npx playwright test --headed

# Generate report
npx playwright show-report
```

### Against Production
```bash
BASE_URL=https://crm.orma-ai.com npx playwright test
```

---

## 7. Test Data

### Users
| Email | Password | Role |
|-------|----------|------|
| admin@haitech.co.il | admin123 | admin |

### Test Data Cleanup
- Tests use unique prefixes: `[E2E]`
- API-based setup/teardown
- Clean up after test suite

---

## 8. Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Smoke suite duration | < 2 min | ✅ ~1.5 min |
| Regression suite duration | < 15 min | ✅ ~8 min |
| Flake rate | < 1% | ✅ ~0.5% |
| P0 coverage | 100% | ✅ 100% |
| P1 coverage | 80% | 🔲 40% |

---

*Last updated: 2025-02-13*
