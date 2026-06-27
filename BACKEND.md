# KIZ FARM Backend

This is the Express and MongoDB API for KIZ FARM.

## Tech Stack

- Node.js with Express
- MongoDB through Mongoose models
- JWT authentication
- Bcrypt password hashing and OTP verification
- Paystack verification for payments
- Cloudinary uploads for media
- Socket.IO setup in `index.mjs`

## Entry Points

- `index.mjs`: starts the HTTP and Socket.IO server.
- `src/app.mjs`: configures Express middleware and route mounts.
- `src/middleware/auth.mjs`: JWT parsing, user auth, and admin auth.

## Main Models

- `User`: buyer/admin identity, auth, balance, refund ledger.
- `Farmer`: seller/farmer profile, bank details, released funds ledger.
- `Product`: marketplace products.
- `Order`: buyer orders, transport fare, payment, delivery lifecycle.
- `Escrow`: held payments before release/refund.
- `Driver`: delivery drivers and assignment state.
- `Course`, `Tutor`, `Subscription`: learning hub and course payouts.
- `Chat`, `Message`: buyer/farmer messaging.
- `Cart`, `Address`, `Review`, `Otp`: supporting records.

## Auth Routes

Mounted at `/auth`.

- `POST /signup`: create user and send OTP.
- `POST /resend-otp`: send a new OTP.
- `POST /verify-otp`: verify email.
- `POST /login`: login buyer/farmer user. If the email is unverified, sends a fresh OTP and returns `needsVerification`.
- `POST /admin/login`: login demo/admin user.

## Buyer Routes

Mounted at `/buyer`.

- Dashboard, profile, addresses, cart, reviews, refunds.
- `POST /orders`: creates unpaid order(s), one per farmer, with status `awaiting_transport_quote`.
- `POST /orders/:id/pay`: verifies Paystack payment after admin adds transport fare, creates escrow, and moves order to `pending`.
- `GET /orders`, `GET /orders/:id`: buyer order list/detail.
- `POST /orders/:id/confirm-receipt`: buyer confirms delivery.
- `POST /orders/:id/rate-driver`: buyer rates driver.
- `POST /orders/:id/cancel`: buyer cancellation before fulfillment.

## Admin Routes

Mounted at `/admin`.

Core admin:

- Dashboard stats.
- Farmer verification.
- User/farmer list, detail, suspend, unsuspend, delete.
- Product and review moderation.
- Refund/order cancellation management.

Order and driver control:

- `GET /drivers`, `POST /drivers`, `PATCH /drivers/:id`, `DELETE /drivers/:id`.
- `GET /orders`, `GET /orders/:id`.
- `PATCH /orders/:id/transport-fare`: adds or updates transport fare and changes order to `awaiting_payment`.
- `PATCH /orders/:id/status`: admin lifecycle update.
- `POST /orders/:id/assign-driver`: assigns driver and changes order to `assigned`.
- `GET /stats`: driver/order summary.

Escrow:

- Mounted at `/admin/escrow`.
- List escrow records, view detail, release funds, refund funds.

## Farmer Routes

Mounted at `/farmer` and `/farmer-orders`.

- Farmer status, registration, verification upload, product CRUD, bank details, profile, payment history, payout history.
- Farmer order actions:
  - Accept pending order.
  - Reject pending order.
  - Pack confirmed order.

## Learning Routes

Mounted at `/learning`.

- Public tutors and courses.
- Admin tutor/course creation.
- Buyer-created courses and admin review.
- Course purchases and subscriptions.
- Course creator payout release through `POST /learning/admin/course-purchases/:id/release-payout`.

## Order Lifecycle

Current order states:

- `awaiting_transport_quote`
- `awaiting_payment`
- `pending`
- `accepted_by_farmer`
- `confirmed`
- `packed`
- `assigned`
- `in_transit`
- `delivered`
- `receipt_confirmed`
- `completed`
- `rejected`
- `cancelled`

The production checkout flow is:

1. Buyer submits order request.
2. Admin adds transport fare.
3. Buyer pays the quoted total.
4. Backend verifies Paystack.
5. Escrow is created.
6. Farmer/admin/driver fulfillment begins.
7. Buyer confirms receipt.
8. Admin releases escrow to farmer.

## Development

```bash
npm install
npm run dev
npm start
```

Required environment values include MongoDB connection, JWT secret, admin demo credentials, Paystack secret, Cloudinary credentials, and email sender settings.
