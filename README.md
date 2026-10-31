# Nexachain AI — Investment & Referral Management Platform

A full-stack **MERN** web application built as a technical assessment. The platform demonstrates member and admin workflows for wallet deposits, investment records, referral income, and daily ROI ledger processing.

> **Important demo notice**  
> This repository is a software demonstration, not a real investment service, bank, payment platform, or financial product. The assessment brief does not define ROI percentages, referral commission rates, qualifying events, or a production financial authorization model. The values in this project are configurable demonstration assumptions only. They are not financial advice, guaranteed returns, or official Nexachain AI policies. The wallet is an internal demo ledger; no real payment gateway, KYC, or withdrawal system is integrated.

## Features

### Member dashboard

- User registration, login, and logout.
- Protected member dashboard with wallet and earnings summaries.
- Submit wallet-funding/deposit requests with a payment reference.
- View deposit request status and transaction history.
- Create investments using the available wallet balance.
- View investment status, ROI history, and referral income.
- View direct referrals and a nested referral tree.
- Earnings chart, paginated tables, search, and CSV export.

### Admin dashboard

- Separate role-protected admin console.
- View platform summary statistics.
- Review, approve, or reject member deposit requests.
- View and search users, investments, and ROI records.
- Activate or suspend member accounts.
- Trigger the daily ROI processing job manually.
- Switch between the admin console and the admin's own member dashboard.

### Backend and data integrity

- REST API built with Express.js and MongoDB/Mongoose.
- Password hashing with `bcryptjs`.
- JWT authentication using an HTTP-only session cookie and CSRF protection for browser writes.
- Role-based authorization for admin routes.
- MongoDB transactions for multi-document wallet and ledger operations.
- Integer-paise storage for money values to avoid floating-point currency calculations.
- Idempotent daily ROI ledger processing with a unique investment/day key.
- Scheduled ROI processing with `node-cron`.
- Input validation, centralized error handling, Helmet security headers, CORS configuration, and authentication rate limiting.

## Tech stack

| Layer | Technologies |
|---|---|
| Frontend | React 18, Vite, Axios, Recharts, Lucide React, CSS |
| Backend | Node.js 20+, Express.js, REST APIs, JWT, bcryptjs, node-cron |
| Database | MongoDB, Mongoose |
| Testing | Node.js test runner, frontend utility tests, API integration tests |
| API testing | Postman collection |

## Application architecture

```text
Browser
  │
  ▼
React + Vite frontend (client/)
  │  Axios / REST API / cookie credentials
  ▼
Express API (server/)
  ├── Authentication & authorization
  ├── Member dashboard and investments
  ├── Deposit requests and admin approvals
  ├── Referral income service
  ├── ROI calculation and ledger service
  └── Scheduled daily ROI job (node-cron)
  │
  ▼
MongoDB (Mongoose models and transactions)
```

## Project structure

```text
nexachain-mern-assessment/
├── client/
│   ├── src/
│   │   ├── components/       # Charts, KPI cards, tables and referral tree
│   │   ├── context/          # Authentication context
│   │   ├── pages/            # Login/register, member and admin dashboards
│   │   ├── services/         # Axios API client
│   │   ├── utils/            # Formatting and CSV helpers
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── .env.example
│   └── package.json
├── server/
│   ├── scripts/              # Create admin and migrate currency data
│   ├── src/
│   │   ├── config/           # Database and environment configuration
│   │   ├── controllers/      # Authentication, deposits, admin, etc.
│   │   ├── middleware/       # Authentication and error handling
│   │   ├── models/           # User, Deposit, Investment and ledgers
│   │   ├── routes/           # REST API routes
│   │   ├── services/         # ROI, referrals and scheduler
│   │   ├── utils/            # Money, validation, session and pagination
│   │   ├── app.js
│   │   └── server.js
│   ├── .env.example
│   └── package.json
├── postman/
│   └── Nexachain-Assessment.postman_collection.json
├── BUG_REPORT.md
└── README.md
```

## Requirements

- **Node.js 20 or newer** and npm.
- MongoDB configured as a **replica set**, or a suitable MongoDB Atlas deployment.
- VS Code (recommended).

**Why a replica set?** The application uses MongoDB multi-document transactions to keep wallet balances and transaction ledgers consistent. A standalone local MongoDB server does not support these transactions. For local development, configure a single-node replica set or use MongoDB Atlas.

## Run locally in VS Code

### 1. Clone or extract the project

```bash
git clone <https://github.com/Shubhankar-7029/Nexachain-AI-Investment-Referral-Management-Platform.git>
cd nexachain-mern-assessment
```

Alternatively, extract the ZIP and open the `nexachain-mern-assessment` folder in VS Code.

### 2. Configure MongoDB

Choose one option:

- **MongoDB Atlas:** Create a database user, allow your development IP under Network Access, and copy the connection string. Use a database deployment that supports transactions.
- **Local MongoDB:** Configure MongoDB as a replica set and initialize it once in `mongosh` if it has not already been initialized:

```javascript
rs.initiate()
```

Wait until the local replica-set member becomes `PRIMARY` before starting the API.

### 3. Configure and start the backend

Open a VS Code terminal:

```bash
cd server
```

Create your local environment file:

**Windows PowerShell**

```powershell
Copy-Item .env.example .env
```

**macOS/Linux**

```bash
cp .env.example .env
```

Edit `server/.env` and provide your own MongoDB connection string and a unique JWT secret. Do not commit this file.

Install dependencies and start the API:

```bash
npm install
npm run dev
```

The API normally starts at `http://localhost:5000`. Check the health endpoint:

```text
http://localhost:5000/api/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "nexachain-assessment-api"
}
```

### 4. Configure and start the frontend

Open a **second terminal** in VS Code, from the project root:

```bash
cd client
```

Create the frontend environment file:

**Windows PowerShell**

```powershell
Copy-Item .env.example .env
```

**macOS/Linux**

```bash
cp .env.example .env
```

Install dependencies and start Vite:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Keep both the backend and frontend terminals running.

## Create an admin account

There is intentionally no public API for a user to promote themselves to admin. First register a normal account through the application. Then, in a backend terminal, run:

```bash
cd server
npm run make-admin -- your-email@example.com
```

Sign out and sign in again. The account should now be able to access the admin dashboard.

For a meaningful two-role demo, use two accounts: one admin and one regular member. An admin cannot approve their own deposit request.

## Suggested demo workflow

1. Register a normal member account and open the member dashboard.
2. Submit a deposit request from **Add Funds**. It remains pending and does not immediately change the wallet balance.
3. Sign in with the admin account and approve or reject the pending request in the admin dashboard.
4. Sign back in as the member and confirm the approved amount is reflected in the wallet.
5. Create an investment using the available wallet balance.
6. Review the investment, referral-income, and ROI history sections.
7. As an admin, use **Run Daily ROI Now** to demonstrate the daily processing workflow. Running it more than once for the same day should not create duplicate ROI credits.

To demonstrate referrals, register a second member with the first member's referral code before creating the second member's investment.

## Environment variables

### Backend — `server/.env`

Use `server/.env.example` as the starting point.

| Variable | Description | Example/default |
|---|---|---|
| `PORT` | API server port | `5000` |
| `NODE_ENV` | Runtime environment | `development` |
| `MONGODB_URI` | MongoDB replica-set / Atlas URI | `mongodb://127.0.0.1:27017/nexachain_assessment?replicaSet=rs0` |
| `JWT_SECRET` | JWT signing secret; use a random value of at least 32 characters | Generate your own |
| `JWT_EXPIRES_IN` | JWT expiration | `1d` |
| `CLIENT_URL` | Allowed frontend origin(s), comma-separated | `http://localhost:5173` |
| `CRON_TIMEZONE` | Timezone for the daily scheduler | `Asia/Kolkata` |
| `REFERRAL_LEVEL_RATES` | Demo referral percentages by level | `5,2,1` |
| `DEFAULT_DAILY_ROI_PERCENT` | Demo daily ROI percentage | `0.5` |
| `MAX_INVESTMENT_AMOUNT` | Maximum accepted investment amount | `1000000` |
| `COOKIE_SAMESITE` | Cookie SameSite policy | `lax` |
| `TRUST_PROXY` | Trust proxy setting when deployed behind a proxy | Optional |
| `AUTH_RATE_LIMIT` | Login/register requests per IP per 15 minutes | `30` |
| `MONGODB_TEST_URI` | Optional isolated database used by API tests; database name must end in `_test` | See Testing |

### Frontend — `client/.env`

| Variable | Description | Example |
|---|---|---|
| `VITE_API_URL` | Backend API base URL | `http://localhost:5000/api` |

Restart the relevant development server after changing environment variables.

## API overview

All endpoints are prefixed with `/api`. Except for the health check and public authentication routes, endpoints require authentication. Routes under `/admin` additionally require the `admin` role.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | API health check |
| `POST` | `/auth/register` | Public | Register a member; optional referral code |
| `POST` | `/auth/login` | Public | Log in and create a session |
| `POST` | `/auth/logout` | Public/session | Clear the session cookie |
| `GET` | `/auth/me` | Member | Get current user and CSRF token |
| `POST` | `/deposits` | Member | Submit a deposit request |
| `GET` | `/deposits` | Member | List own deposit requests |
| `POST` | `/investments` | Member | Create an investment from wallet balance |
| `GET` | `/investments` | Member | List own investments |
| `GET` | `/dashboard` | Member | Dashboard KPI data |
| `GET` | `/dashboard/histories` | Member | Recent activity and totals |
| `GET` | `/dashboard/roi` | Member | Own ROI ledger |
| `GET` | `/dashboard/referral-income` | Member | Own referral-income ledger |
| `GET` | `/dashboard/chart` | Member | Daily earnings chart data |
| `GET` | `/referrals/direct` | Member | Direct referrals |
| `GET` | `/referrals/tree` | Member | Nested referral tree |
| `GET` | `/admin/deposits` | Admin | Review deposit requests |
| `POST` | `/admin/deposits/:id/approve` | Admin | Approve and credit a deposit once |
| `POST` | `/admin/deposits/:id/reject` | Admin | Reject a deposit request |
| `POST` | `/admin/run-roi` | Admin | Run daily ROI processing manually |
| `GET` | `/admin/stats` | Admin | Platform totals and statistics |
| `GET` | `/admin/users` | Admin | Search and manage user accounts |
| `PATCH` | `/admin/users/:id/status` | Admin | Activate or suspend a member |
| `GET` | `/admin/investments` | Admin | View all investments |
| `GET` | `/admin/roi` | Admin | View global ROI ledger |

For request examples, import `postman/Nexachain-Assessment.postman_collection.json` into Postman. Register or log in first and use the returned bearer token in the collection's `token` variable when testing with Postman.

The browser application uses an HTTP-only cookie and sends the CSRF token in the `X-CSRF-Token` header for write requests. Postman can use `Authorization: Bearer <token>`. Money values in API requests and responses are expressed in rupees and stored internally as integer paise.

## Business rules and demo assumptions

- Passwords are hashed with `bcryptjs`.
- JWTs are signed using the server-side `JWT_SECRET`.
- Deposit requests remain pending until an admin approves or rejects them.
- Investment creation debits the member's wallet balance within a database transaction. Insufficient balances are rejected.
- ROI is recorded in a ledger, with a unique key preventing duplicate credits for the same investment and UTC day.
- The daily scheduler runs at midnight in `CRON_TIMEZONE`; a missed run can be reconciled on a later run.
- Referral income is calculated using the configured referral-level rates and recorded in a separate ledger.
- When an investment completes, its principal is returned to the member's wallet according to the demo rules.
- Money is stored in integer paise to avoid floating-point currency precision errors.

The default ROI and referral percentages are **assessment/demo assumptions**. Confirm all business rules with the relevant product owner before considering any production implementation.

## Testing

### Frontend utility tests

```bash
cd client
npm test
```

### Frontend production build

```bash
cd client
npm run build
```

### Backend tests

The backend API integration tests require a separate MongoDB replica-set database. Use a disposable database whose name ends in `_test`; the test suite drops that test database.

**Windows PowerShell**

```powershell
cd server
$env:MONGODB_TEST_URI="mongodb://127.0.0.1:27017/nexachain_test?replicaSet=rs0"
npm test
```

**macOS/Linux**

```bash
cd server
MONGODB_TEST_URI="mongodb://127.0.0.1:27017/nexachain_test?replicaSet=rs0" npm test
```

Do not point `MONGODB_TEST_URI` at a database containing data you need. The integration test database is disposable.

## Troubleshooting

| Problem | What to check |
|---|---|
| MongoDB transaction / replica-set error | Confirm MongoDB is running as a replica set or use Atlas. |
| `MONGODB_URI is missing` | Confirm `server/.env` exists and contains a valid connection string. |
| JWT secret validation error | Set a random `JWT_SECRET` with at least 32 characters. |
| Frontend cannot reach the API | Check that the backend is running and `VITE_API_URL` points to the correct API URL. |
| CORS error | Set `CLIENT_URL` to the exact frontend origin, including the port. |
| Rollup platform / Vite dependency error | Remove copied `node_modules` folders and reinstall dependencies with `npm install` (or `npm ci` when using the lockfile). |
| Admin panel is not visible | Promote an account with `npm run make-admin -- email@example.com`, then sign out and sign in again. |

## Security checklist before publishing

- Never commit `.env` files, database connection strings, JWT secrets, private keys, or real user data.
- Keep `.env.example` files limited to placeholder values.
- If a credential has already been pushed to a public or shared repository, rotate it; deleting the file in a later commit does not remove it from Git history.
- Do not commit `node_modules/` or generated build folders.
- Use HTTPS, secure cookie settings, backups, monitoring, and a reviewed authorization model before any real deployment.
- A real-money product would need additional payment, KYC, audit, compliance, reconciliation, and operational controls. These are outside this assessment demo.

## Limitations

- The project name includes “AI”, but this implementation does **not** contain an AI/ML prediction model.
- This project does **not** integrate a blockchain or smart contract.
- No real payment gateway, KYC workflow, or withdrawal system is included.
- ROI and referral calculations are configurable demonstration logic, not promises or recommendations.

## License

No open-source license is currently specified. Add a license file before permitting reuse or redistribution.
