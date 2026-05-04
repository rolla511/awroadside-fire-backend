## UI Rollback Scan
Date: 2026-04-27
Timezone: America/New_York

### Purpose

This file records the post-rollback UI compatibility point after comparing the active backend event surface against the current web and mobile UI.

### Rollback Reference Chain

- `TESTING_ROLLBACK_STATUS.md`
  - April 24, 2026: backend moved beyond the earlier rollback point with location, wallet, and queue filtering work.
  - April 25, 2026: active mobile authority remained `awroadside-fire-work/`; backend/web authority remained the root runtime.
- `AWroadside-next-session.txt`
  - April 25, 2026: identified unresolved UI drift around provider work history, wallet history, service quote/agreement flow, and backend assignment enforcement.
- `UI_PAGE_EVENT_MAP.json`
  - Updated on April 27, 2026 to reflect the current event surface after this scan.

### Current Compatibility Point

- Web customer UI now reflects:
  - request submit
  - service quote
  - service price agreement
  - payment order create/capture
  - provider feedback submit
  - local request history and dispatch replay panels
- Web provider UI now reflects:
  - queue load
  - accept, eta, soft-contact, hard-contact, arrived, completed
  - note exchange and note submission
- Web admin UI now reflects:
  - provider approval
  - request reset
  - refund
  - payout completion
  - provider training schedule/complete
  - backend payment-event replay from dashboard payload
- Mobile admin/provider UI now reflects:
  - provider training state
  - training schedule/complete actions

### Remaining Drift

- Customer request status is still a local mirror and not a dedicated server-polled status page.
- Subscriber-specific ETA acceptance, arrival confirmation, and completion confirmation remain stronger in the mobile app than the web pages.
- Provider PayPal connect/status/refresh still lacks a dedicated UI flow even though wallet records exist.
- Admin dashboard exposes recent backend payment events, but a dedicated admin audit-history feed is still not present as a separate backend collection.

### Ready State

- `web/` is now closer to the active backend route model than the April 25 rollback notes.
- `awroadside-fire-work/` remains the mobile authority path and now includes provider training controls that match the backend.
- Next UI pass should target:
  1. subscriber request status confirmations on web
  2. provider PayPal connect/status/refresh UI
  3. admin audit-history endpoint if backend exposes it separately
