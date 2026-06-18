# KIZ FARM Server

Simple Express + MongoDB backend for user signup (OTP via Resend), login, and admin demo login.

Setup

1. Change directory to Downloads (server will live in C:\\Users\\Abdullah\\Downloads\\kizfarm-server)

```bash
cd C:\\Users\\Abdullah\\Downloads\\kizfarm-server
npm install
cp .env.example .env
# edit .env and fill values (MONGODB_URI, RESEND_API_KEY, etc.)
npm run dev
```

Endpoints

- POST `/auth/signup` { name, email, phone, password }
- POST `/auth/resend-otp` { email }
- POST `/auth/verify-otp` { email, code }
- POST `/auth/login` { email, password }
- POST `/auth/admin/login` { email, password } (demo credentials only)

Notes

- The server expects `RESEND_API_KEY` for sending emails; if omitted, OTPs will be logged to the server console and not emailed.
- Admin demo credentials are provided via `ADMIN_DEMO_EMAIL` and `ADMIN_DEMO_PASSWORD` in the environment.
