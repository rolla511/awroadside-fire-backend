# UI Event Test Checklist

Use this checklist against the current backend event map before marketplace introduction.

Reference map:
- `UI_PAGE_EVENT_MAP.json` is the current page-to-event and endpoint inventory for the active web flow.

## Guest

- [ ] Guest request form submits each service type and creates a request reference.
- [ ] Guest request status cards show mapped service labels, request status labels, and payment status labels.
- [ ] Guest service price check shows user-facing copy only.
- [ ] Guest service price agreement works after quote retrieval.
- [ ] Guest payment order creation updates the UI with mapped payment state.
- [ ] Guest payment capture updates the request/payment state without exposing backend debug text.

## Subscriber

- [ ] Subscriber sign-in loads subscriber profile data.
- [ ] Subscriber signup creates a member account and shows clean user-facing success text.
- [ ] Subscriber request flow uses saved profile data when requested.
- [ ] Subscriber request history merges current-session requests with stored profile history.
- [ ] Subscriber ETA acceptance, arrival confirmation, and completion confirmation update the displayed request state.
- [ ] Subscriber request/payment statuses use mapped UI labels instead of raw backend enum values.

## Provider

- [ ] Provider sign-in loads provider profile, status, services, and vehicle summary.
- [ ] Provider status displays mapped provider-state labels.
- [ ] Provider service list displays mapped service labels.
- [ ] Provider queue cards display mapped service labels and request-status labels.
- [ ] Provider actions (`accept`, `eta`, `soft-contact`, `hard-contact`, `arrived`, `completed`, `note`) return clean dispatch-facing copy.
- [ ] Provider log shows mapped request and payout statuses.
- [ ] Provider wallet shows mapped request/payout statuses and wallet display terms.

## Admin

- [ ] Admin sign-in loads dashboard, providers, subscribers, queue, and financial controls.
- [ ] Admin queue cards display mapped service labels and request-status labels.
- [ ] Admin provider list displays mapped provider statuses and service labels.
- [ ] Admin financial list displays mapped payout and payment statuses.
- [ ] Admin refund, payout, reset, and provider approval actions return clear admin-facing results.
- [ ] Wallet discrepancy terms are visible in admin financial controls.

## Payments And Event Coverage

- [ ] UI covers request lifecycle events from `SUBMITTED` through `COMPLETED`.
- [ ] UI covers payment lifecycle states including `NOT_PAID`, `ORDER_CREATED`, `PENDING_CAPTURE`, `CAPTURED`, `DECLINED`, `REFUNDED`, and `CANCELLED`.
- [ ] UI covers provider lifecycle states including `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `ACTIVE`, `SUSPENDED`, and `INACTIVE`.
- [ ] UI covers payout lifecycle states including `UNASSIGNED`, `PENDING`, `PROCESSING`, `COMPLETED`, `ON_HOLD`, `HELD`, `BLOCKED`, `FAILED`, and `UNCLAIMED`.
- [ ] UI shows service labels consistently for Jump Start, Lockout, Tire Change, Gas Delivery, and Battery Install.

## Copy Cleanup

- [ ] Customer-facing screens do not expose raw backend/debug wording.
- [ ] Provider-facing screens do not expose raw backend/debug wording.
- [ ] Customer/provider messages do not expose raw backend error payloads.
- [ ] Visible status chips/rows do not expose raw enum tokens where mapped labels exist.
- [ ] Testing notes capture any remaining mismatch between displayed wallet balance and third-party balance records.
