# HRS Backend — Phase 1

Multi-tenant SaaS backend (PERN) — **Phase 1**.

## What's in Phase 1

1. Project folder structure (strict MVC: routes → controller → service → repository)
2. Database migration system
   - **SuperAdmin migrations**: auto-applied at server startup (tracked in `public.schema_migrations`)
   - **Tenant migrations**: applied per tenant inside its own dynamically-created schema (`tenant_<uuid>`)
3. SuperAdmin seed (CLI only, **not** an API)
4. SuperAdmin login → JWT
5. SuperAdmin can create a tenant (Admin) — guarded by JWT + role
6. On tenant creation, a fresh PG schema is created and tenant migrations run inside it (all in one transaction)

## Stack

- Node.js + Express
- PostgreSQL with raw `pg` (no ORM)
- `bcrypt`, `jsonwebtoken`, `helmet`, `cors`, `express-validator`, `uuid`, `dotenv`

## Folder layout

```
src/
├── config/          # db.js, env.js
├── migrations/
│   ├── superadmin/  # 001, 002... applied at startup
│   └── tenants/     # 001, 002... applied per tenant
├── modules/
│   ├── superadmin/  # routes / controller / service / repository
│   └── tenant/
├── middlewares/     # auth, error, validate
├── utils/           # ApiError, ApiResponse, asyncHandler, logger
├── scripts/         # runMigrations.js, seedSuperAdmin.js
├── app.js
└── server.js
.env / .env.example
```

## Setup

```bash
# 1. Install deps
npm install

# 2. Copy env file and fill in values
copy .env.example .env

# 3. Run SuperAdmin migrations (also runs automatically on `npm run dev`)
npm run migrate

# 4. Seed the first SuperAdmin (uses SEED_SUPERADMIN_* from .env)
npm run seed:superadmin

# 5. Start the server
npm run dev      # nodemon
# or
npm start
```

Server boots on `http://localhost:5000` by default.

## API (Phase 1)

### `POST /api/v1/superadmin/login`

Body:
```json
{ "email": "superadmin@hrs.local", "password": "ChangeMe@12345" }
```

Response:
```json
{
  "success": true,
  "message": "Login successful",
  "data": { "superadmin": { "id": "...", "name": "...", "email": "..." } },
  "token": "<jwt>",
  "superadmin": { "id": "...", "name": "...", "email": "..." }
}
```

### `POST /api/v1/tenants/create`  (Bearer SuperAdmin JWT)

Headers: `Authorization: Bearer <token>`

Body:
```json
{
  "name": "Acme Corp",
  "adminEmail": "admin@acme.com",
  "adminName": "Acme Admin",
  "adminPassword": "Str0ngP@ssw0rd"
}
```

Response (201):
```json
{
  "success": true,
  "message": "Tenant created successfully",
  "data": {
    "tenant": {
      "id": "uuid",
      "name": "Acme Corp",
      "schemaName": "tenant_<uuid>",
      "adminEmail": "admin@acme.com",
      "status": "active"
    }
  },
  "tenant": { ... }
}
```

## Response shape

Success:
```json
{ "success": true, "message": "...", "data": { ... } }
```

Error:
```json
{ "success": false, "message": "...", "errors": [ ] }
```

## What is NOT in Phase 1

- Admin login (Phase 2)
- HR / Member roles, dashboard APIs
- Frontend
- Email sending, file uploads
"# HRIS_API" 
