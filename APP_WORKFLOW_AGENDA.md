# AW Roadside Fire - App Workflow Agenda

This document maps the complete functional scope of the **Mobile App Variant** (Android/iOS) located in `awroadside-fire-work/`. This variant is designed for standalone mobile deployment and handles all user roles within a single React Native (Expo) environment.

## 1. Guest/Customer Flow (Immediate Service)
- **Screen:** `home`
- **Actions:**
  - Submit Roadside Request (Name, Phone, Service, Location).
  - View Request Status (Polling).
  - Fetch Service Quote (Triggered once Provider confirms ETA).
  - PayPal Service Payment (Guest Rate: $55.00).

## 2. Subscriber Flow (Membership & Discounts)
- **Screen:** `subscriber`
- **Sub-Screens:**
  - **Signup:** Full Profile creation (Email, Vehicle Year/Make/Model/Color, Payment Method).
  - **Signin:** Access membership benefits.
  - **Profile:** Manage vehicle info and view membership status.
- **Workflow:**
  - Automated discount application (Subscriber Rate: $40.00).
  - Priority handling for service requests.

## 3. Provider Flow (Service Management)
- **Screen:** `provider`
- **Sub-Screens:**
  - **Signup/Application:** Detailed onboarding (Vehicle info, Document verification: License/Registration/Insurance, Experience, Service selection).
  - **Work Screen (Request Queue):** View active dispatch requests.
  - **Action Flow:** Accept Request -> Set ETA (Triggers Customer Quote) -> Mark as En Route -> Complete Service.
  - **Wallet/Profile:** View payout status and update provider credentials.

## 4. Admin Flow (System Governance)
- **Screen:** `admin` (Requires 2FA/Trusted Zone)
- **Sub-Screens:**
  - **Dashboard:** Real-time overview of all system requests.
  - **Account Review:** Verify and approve Provider applications.
  - **Security:** Monitor system logs and "Fire" status.

## 5. Technical Chain of Events (Backend Sync)
1. **Request Creation:** Mobile App POSTs to `/requests/create`.
2. **Provider Assignment:** Provider mobile UI POSTs `/requests/:id/eta`.
3. **Quote Generation:** Backend calculates math based on `role` (Guest vs Subscriber).
4. **Payment Hook:** Mobile App initiates PayPal; PayPal Webhook updates request to `PAID`.
5. **Provider Payout:** Backend calculates Provider share after platform fees ($39.50 Guest / $33.70 Subscriber).

---
*Status: All legacy web files in `web/` have been restored to their individual forms for WordPress compatibility. The above agenda defines the development path for the Mobile App Variant.*
