# KIZ FARM Backend

This is the Express and MongoDB API for KIZ FARM.

## Tech Stack

- Node.js with Express
- MongoDB through Mongoose models
- JWT authentication
- Bcrypt password hashing and OTP verification
- Paystack verification for payments
- Cloudinary uploads for media
- Centralized Email Mailer (Resend API)
- Socket.IO setup in `index.mjs`

## Entry Points

- `index.mjs`: starts the HTTP and Socket.IO server.
- `src/app.mjs`: configures Express middleware and route mounts.
- `src/middleware/auth.mjs`: JWT parsing, user auth, and admin auth.
- `src/lib/mailer.mjs`: Centralized email templates and non-blocking sending utility (`notifyEmail`).
- `src/lib/inventory.mjs`: Deduct/restore stock handlers.
- `src/lib/escrowLedger.mjs`: Ledger ledger release/refund handlers.

## Main Models

- `User`: buyer/admin identity, auth, balance, refund ledger.
- `Farmer`: seller/farmer profile, bank details, released funds ledger.
- `Product`: marketplace products.
- `BlogPost`: dynamic blog articles (title, slug, summary, content JSON blocks, category, readTime, status).
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
- `GET /dashboard`: buyer dashboard with product catalogs, filtering out any products with `quantity: 0`.
- `POST /orders`: creates unpaid order(s), one per farmer, with status `awaiting_transport_quote`. Sends admin a summary email and the buyer receipt confirmations.
- `POST /orders/:id/pay`: verifies Paystack payment after admin adds transport fare, creates escrow, and moves order to `pending`.
- `GET /orders`, `GET /orders/:id`: buyer order list/detail.
- `POST /orders/:id/confirm-receipt`: buyer confirms delivery (triggers escrow release alert to admin).
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
- `PATCH /orders/:id/transport-fare`: adds or updates transport fare and changes order to `awaiting_payment` (emails buyer to pay).
- `PATCH /orders/:id/status`: admin lifecycle update.
- `POST /orders/:id/assign-driver`: assigns driver and changes order to `assigned` (notifies driver, buyer, and farmer).
- `GET /stats`: driver/order summary.

Escrow:

- Mounted at `/admin/escrow`.
- List escrow records, view detail, release funds, refund funds.

## Farmer Routes

Mounted at `/farmer` and `/farmer-orders`.

- Farmer status, registration, verification upload, product CRUD, bank details, profile, payment history, payout history.
- Farmer order actions:
  - Accept pending order (notifies buyer/admin).
  - Reject pending order.
  - Pack confirmed order.

## Learning Routes

Mounted at `/learning`.

- Public tutors and courses.
- Admin tutor/course creation.
- Buyer-created courses and admin review.
- Course purchases and subscriptions.
- Course creator payout release through `POST /learning/admin/course-purchases/:id/release-payout`.

## Blog Routes

Mounted at `/blog`.

- `GET /`: Lists all published blog posts. Supports categories and search keywords.
- `GET /admin`: Lists all blog posts (including drafts) for admin management (requires Admin).
- `GET /:slugOrId`: Resolves a single blog post details by slug or Mongoose ID.
- `POST /`: Creates a new blog post (requires Admin).
- `PATCH /:id`: Updates an existing blog post (requires Admin).
- `DELETE /:id`: Deletes a blog post (requires Admin).
- `POST /upload`: Uploads images directly to Cloudinary (requires Admin).

## Email Notification System

All transactional emails are sent asynchronously and non-blockingly using `notifyEmail(message, promise)`. If the email provider (Resend) experiences downtime or slow response times, API responses remain fast and uninterrupted.

Centralized templates in `src/lib/mailer.mjs` include:
- OTP Signups & Logins
- Buyer Checkout Summaries (to Admin) & Sub-order Receipts (to Buyer)
- Transport Fare Quoted Notification (to Buyer)
- Successful Payment Alerts (to Buyer, Farmer, Admin)
- Courier Driver Assignments
- Order Transit Progress Updates (`confirmed`, `in_transit`, `delivered`, `cancelled`)
- Escrow Release & Refund Confirmations
- Farmer KYC Submission & Admin Review Outcomes
- Course Submission & Review Outcomes
- Course Purchase & Balance Payout Alerts

## Paystack Webhook Concurrency & Duplicate Protection

During Checkout payments, customers are directed to Paystack checkout pages. Upon payment, both the client redirect (`/orders/:id/pay`) and Paystack server-to-server webhook (`/paystack-webhook`) attempt to process order success.

To prevent double-processing (which causes double stock deductions and duplicate customer emails), the server executes an **atomic update lock** using MongoDB `findOneAndUpdate`:
```javascript
const order = await Order.findOneAndUpdate(
  { _id: orderId, paymentStatus: { $ne: "paid" } },
  { paymentStatus: "paid", paymentRef: reference, status: "pending" },
  { new: true }
);
```
Only the thread that successfully mutates the `paymentStatus` from "unpaid" to "paid" is allowed to deduct inventory, create escrow ledgers, and trigger email notifications.

## Inventory Stock Constraints
- **Zero Quantity Filter**: The marketplace listing `GET /marketplace/products` and dashboard catalog queries now filter out any products whose available inventory reaches zero (`quantity: { $ne: 0 }`).

## Development

```bash
npm install
npm run dev
npm start
```

Required environment values include MongoDB connection, JWT secret, admin demo credentials, Paystack secret, Cloudinary credentials, and Resend API keys.
