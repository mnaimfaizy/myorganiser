# Backend REST API

This is the backend REST API for MyOrganiser application, built with Express.js, TypeScript, and Prisma ORM.

## Table of Contents

- [Overview](#overview)
- [Technologies](#technologies)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Development](#development)
- [Project Structure](#project-structure)
- [Available Scripts](#available-scripts)
- [API Documentation](#api-documentation)
- [Testing](#testing)
- [Building for Production](#building-for-production)

## Overview

The backend API provides a RESTful interface for the MyOrganiser application. It handles user authentication, vault ciphertext, and other core functionalities. The API is built with TypeScript for type safety and uses Prisma as the ORM for database operations.

## Technologies

This backend application is built with the following technologies:

### Core Framework & Runtime

- **Node.js** - JavaScript runtime
- **Express.js** - Web application framework
- **TypeScript** - Typed JavaScript

### Database & ORM

- **PostgreSQL** - Relational database
- **Prisma** - Next-generation ORM for Node.js
  - Type-safe database client
  - Automated migrations
  - Schema management

### API Documentation

- **TSOA** - TypeScript OpenAPI (Swagger) generator
  - Automatic route generation
  - API documentation from TypeScript types
- **Swagger UI Express** - Interactive API documentation

### Authentication & Security

- **Passport.js** - Authentication middleware
  - Local strategy for username/password
  - JWT strategy for token-based auth
- **passport-jwt** - JWT authentication strategy
- **passport-local** - Local authentication strategy
- **bcrypt** - Password hashing

### Utilities

- **dotenv** - Environment variable management
- **cors** - Cross-Origin Resource Sharing
- **body-parser** - Request body parsing
- **cookie-parser** - Cookie parsing
- **winston** - Logging library
- **nodemailer** - Email sending
- **zod** - TypeScript-first schema validation

### Development Tools

- **Nx** - Monorepo build system
- **Webpack** - Module bundler
- **Jest** - Testing framework
- **ESLint** - Code linting
- **Prettier** - Code formatting

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (see [TECH_STACK.md](../../TECH_STACK.md) for required version)
- **Yarn** (package manager)
- **PostgreSQL** (v12 or higher)
- **Docker & Docker Compose** (optional, for containerized database)

Note: The repo sets `package.json.engines.node` to `>=22.18.0`.

## Installation

1. **Clone the repository** (if not already done):

   ```bash
   git clone <repository-url>
   cd myorganiser
   ```

2. **Install dependencies**:

   ```bash
   yarn install
   ```

3. **Set up the database**:
   - You can use Docker Compose to run PostgreSQL locally:
     ```bash
     docker-compose up -d
     ```
   - Or install PostgreSQL manually on your system

## Environment Configuration

1. **Copy the example environment file**:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

2. **Configure the environment variables** in the `.env` file:

   ```env
   # Application
   # Used to build email verification/reset links
   APP_FRONTEND_URL=http://localhost:4200
   PORT=3000
   NODE_ENV=development
   ROUTER_PREFIX=/api/v1

   # Reverse proxy (recommended in production)
   # If behind a reverse proxy/load balancer (cPanel Passenger, Nginx, Cloudflare), set this.
   # Common values:
   # - 1 (recommended) trust first proxy hop
   # - true trust all proxies
   TRUST_PROXY=1

   # Optional: global API rate limiting (recommended in production)
   # Uses in-memory counters by default; for multi-instance deployments you should use a shared store (e.g. Redis).
   # See express-rate-limit store docs: https://express-rate-limit.mintlify.app/reference/stores
   ENABLE_GLOBAL_RATE_LIMIT=false
   RATE_LIMIT_WINDOW_MS=60000
   RATE_LIMIT_MAX=300

   # Comma-separated list of allowed origins (no trailing slashes)
   CORS_ORIGINS=http://localhost:3000,http://localhost:4200

   # JWT Secrets (generate secure random strings)
   ACCESS_JWT_SECRET=your-access-secret-here
   REFRESH_JWT_SECRET=your-refresh-secret-here
   VERIFY_JWT_SECRET=your-verify-secret-here
   RESET_JWT_SECRET=your-reset-secret-here

   # PostgreSQL Database
   DATABASE_USER=postgres
   DATABASE_PASSWORD=Admin@123
   DATABASE_NAME=myorganiser
   # Prisma reads DATABASE_URL directly; dotenv does not expand ${VARS} by default.
   DATABASE_URL=postgresql://postgres:Admin%40123@localhost:5453/myorganiser

   # PgAdmin (if using Docker)
   PGADMIN_DEFAULT_EMAIL=admin@myorganiser.com
   PGADMIN_DEFAULT_PASSWORD=Admin@123

   # Mail - SMTP Configuration
   MAIL_SERVICE=smtp
   DEFAULT_EMAIL_PROVIDER=smtp
   # Dev (MailHog): docker-compose provides SMTP on localhost:1453 and UI on http://localhost:8453
   MAIL_HOST=localhost
   MAIL_PORT=1453
   MAIL_SECURE=false
   MAIL_USERNAME=
   MAIL_PASSWORD=
   EMAIL_SENDER=no-reply@myorganiser.local
   ```

   **Important Notes:**
   - `yarn start:backend:prod` runs with `NODE_ENV=production` (and will fail fast if required env vars are missing)
   - If you are behind a reverse proxy (common in production), set `TRUST_PROXY` so secure cookies and request IP/proto are detected correctly
   - If you enable `ENABLE_GLOBAL_RATE_LIMIT=true`, the backend will apply a global rate limiter to API routes
   - Generate strong, random secrets for JWT tokens in production
   - Update database credentials if not using default values
   - Configure SMTP settings for email functionality (MailHog is recommended for local dev)
   - Adjust `DATABASE_URL` if using a different database host/port

### Local production run (recommended)

Minimum env vars to start the backend in production mode:

- `ACCESS_JWT_SECRET`, `REFRESH_JWT_SECRET`, `VERIFY_JWT_SECRET`, `RESET_JWT_SECRET`
- `DATABASE_URL`

Generate secure random secrets (example):

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

Run it once per secret and paste the output into your `.env`.

Then run:

```bash
yarn start:backend:prod
```

If you want to test registration/password-reset flows locally, also configure email-related variables (`DEFAULT_EMAIL_PROVIDER`, `MAIL_HOST`/`MAIL_PORT` or Gmail/SMTP creds, and `EMAIL_SENDER`) plus `APP_FRONTEND_URL`.

## Database Setup

The application uses Prisma ORM for database management. Follow these steps to set up your database:

### 1. Ensure Database is Running

If using Docker Compose:

```bash
docker-compose up -d myorganiser_db
```

Verify the database is running:

```bash
docker ps | grep myorganiser_db
```

### 2. Generate Prisma Client

Generate the Prisma client based on your schema:

```bash
# Using Nx
nx run backend:generate-types

# Or using Prisma directly (schema lives in a folder)
npx prisma generate --schema apps/backend/src/prisma/schema
```

### 3. Run Database Migrations

Apply database migrations to create tables:

```bash
# Using Nx
nx run backend:migrate

# Or using Prisma directly
npx prisma migrate dev --schema apps/backend/src/prisma/schema
```

If you are deploying to an existing database (non-dev), apply migrations with:

```bash
npx prisma migrate deploy --schema apps/backend/src/prisma/schema
```

This will:

- Create the database if it doesn't exist
- Run all pending migrations
- Generate Prisma Client

### 4. (Optional) Seed the Database

If seed scripts are available, run:

```bash
cd apps/backend/src
npx prisma db seed
```

### Prisma Schema Location

The Prisma schema files are located in:

```
apps/backend/src/prisma/schema/
├── schema.prisma    # Main schema configuration
├── user.prisma      # User model
└── vault.prisma     # Vault ciphertext model
```

### Useful Prisma Commands

```bash
# Navigate to the backend src directory first
cd apps/backend/src

# View current database
npx prisma db pull

# Reset database (careful: deletes all data)
npx prisma migrate reset

# Open Prisma Studio (database GUI)
npx prisma studio

# Create a new migration
npx prisma migrate dev --name migration_name

# Format Prisma schema files
npx prisma format
```

## Development

### Starting the Development Server

To start the backend development server with hot reload:

```bash
# From the root directory
yarn start:backend

# Or using Nx directly
nx serve backend

# The server will start at http://localhost:3000
```

The development server features:

- **Hot reload** - Automatically restarts when you save changes
- **TypeScript compilation** - Compiles TypeScript on the fly
- **Watch mode** - Monitors file changes

### API Endpoints

Once the server is running, you can access:

- **API Base URL**: `http://localhost:3000/api/v1`
- **API Documentation**: `http://localhost:3000/docs` (Swagger UI)
- **Health Check**: `http://localhost:3000/api/v1/health` (if implemented)

### Generating API Documentation

The API documentation is automatically generated using TSOA from TypeScript controllers:

```bash
# Generate JSON Swagger spec
yarn json-api:generate

# Generate YAML Swagger spec
yarn yaml-api:generate

# Generate both JSON and YAML
yarn api-docs:generate
```

Generated files:

- JSON: `apps/backend/src/swagger/swagger.json`
- YAML: `apps/backend/src/swagger/swagger.yaml`

### Sync OpenAPI + regenerate the TypeScript client

`apps/backend/src/swagger/swagger.yaml` is the **source of truth** for the repo’s OpenAPI.

From the repo root, run:

```bash
yarn openapi:sync
```

This will:

1. Generate the TSOA JSON and YAML specs (`swagger.json` is what `/docs` serves)
2. Copy it into `libs/api-specs/src/api-specs.openapi.yaml`
3. Regenerate `libs/app-api-client`

To verify in CI (no drift between backend spec, copied spec, and generated client):

```bash
yarn openapi:check
```

### Development Workflow

1. **Make code changes** in `apps/backend/src/`
2. **Server auto-reloads** with your changes
3. **Update Prisma schema** if changing database models:
   ```bash
   cd apps/backend/src
   npx prisma migrate dev --name describe_your_changes
   npx prisma generate
   ```
4. **Regenerate API docs** if changing API endpoints:
   ```bash
   yarn openapi:sync
   ```
   Use `openapi:sync`, not `api-docs:generate`: the latter refreshes `swagger.json` /
   `swagger.yaml` only, leaving `libs/api-specs` and the generated client stale.
5. **Run tests** to verify changes:
   ```bash
   yarn test:backend
   ```

## Project Structure

```
apps/backend/
├── src/
│   ├── assets/              # Static assets
│   ├── controllers/         # API controllers (TSOA)
│   │   ├── AuthController.ts
│   │   └── UserController.ts
│   ├── decorators/          # Custom TypeScript decorators
│   ├── helpers/             # Utility helper functions
│   │   ├── filterUser.ts
│   │   ├── jwtHelper.ts
│   │   └── ApiTokens.ts
│   ├── interfaces/          # TypeScript interfaces
│   ├── middleware/          # Express middleware
│   │   ├── authentication.ts
│   │   └── isOwner.ts
│   ├── models/              # Data models
│   │   ├── User.ts
│   │   └── (no Task model; tasks are vault-backed)
│   ├── prisma/              # Prisma ORM files
│   │   ├── schema/          # Prisma schema files
│   │   │   ├── schema.prisma
│   │   │   ├── user.prisma
│   │   │   └── vault.prisma
│   │   ├── migrations/      # Database migrations
│   │   └── prisma-client/   # Generated Prisma client
│   ├── routes/              # Express routes
│   │   ├── auth.ts
│   │   ├── user.ts
│   │   └── routes.ts        # Auto-generated TSOA routes
│   ├── schemas/             # Validation schemas (Zod)
│   │   ├── auth.schema.ts
│   │   └── user.schema.ts
│   ├── services/            # Business logic services
│   │   ├── UserService.ts
│   │   └── EmailService.ts
│   ├── swagger/             # Generated API documentation
│   │   ├── swagger.json
│   │   └── swagger.yaml
│   ├── types/               # TypeScript type definitions
│   ├── utils/               # Utility functions
│   │   └── passport.ts      # Passport configuration
│   └── main.ts              # Application entry point
├── .gitignore
├── eslint.config.js         # ESLint configuration
├── jest.config.ts           # Jest configuration
├── project.json             # Nx project configuration
├── tsconfig.json            # TypeScript configuration
├── tsconfig.app.json        # TypeScript app configuration
├── tsconfig.spec.json       # TypeScript test configuration
├── tsoa.json                # TSOA configuration
└── webpack.config.js        # Webpack configuration
```

### Key Files

- **`main.ts`** - Application entry point, Express server setup
- **`tsoa.json`** - TSOA configuration for API documentation
- **`project.json`** - Nx project configuration with custom commands
- **`prisma/schema/`** - Database schema definitions

## Available Scripts

### From Root Directory

```bash
# Start development server
yarn start:backend
# or
nx serve backend

# Build for production
yarn build:backend
# or
nx build backend

# Run tests
yarn test:backend
# or
nx test backend

# Lint code
nx lint backend

# Generate API documentation
yarn api-docs:generate
```

### Nx-Specific Backend Commands

```bash
# Run Prisma commands
nx run backend:prisma [prisma-command]

# Run database migrations
nx run backend:migrate

# Generate Prisma types
nx run backend:generate-types
```

### Direct Prisma Commands

```bash
# Navigate to backend src first
cd apps/backend/src

# Generate Prisma Client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Create migration
npx prisma migrate dev --name your_migration_name

# Reset database
npx prisma migrate reset

# Open Prisma Studio
npx prisma studio

# Push schema changes without migration
npx prisma db push
```

## API Documentation

### Swagger UI

Once the server is running, visit:

```
http://localhost:3000/docs
```

This provides an interactive API documentation where you can:

- Explore all available endpoints
- View request/response schemas
- Test API endpoints directly from the browser
- See authentication requirements

### API Structure

The API follows RESTful conventions:

#### Authentication Endpoints (`/auth`)

- `POST /auth/login` - User login
- `POST /auth/register` - User registration
- `POST /auth/refresh` - Refresh access token
- `POST /auth/verify-email` - Verify email address
- `POST /auth/forgot-password` - Request password reset
- `PATCH /auth/reset-password` - Reset password

#### User Endpoints (`/user`)

- `GET /user/:id` - Get user by ID
- `PATCH /user/:id` - Update user
- `DELETE /user/:id` - Delete user

#### Task data

Tasks are stored as encrypted vault blobs (`tasks`) and are not available as plain REST resources.

### Authentication

The API uses JWT (JSON Web Tokens) for authentication:

1. **Login** - Obtain access and refresh tokens
2. **Include Token** - Add `Authorization: Bearer <token>` header to authenticated requests
3. **Refresh Token** - Use refresh token to get new access token when expired

## Testing

### Running Tests

```bash
# Run all backend tests
yarn test:backend

# Run tests in watch mode
nx test backend --watch

# Run tests with coverage
nx test backend --coverage
```

### Test Structure

Tests are located alongside the source files with `.test.ts` or `.spec.ts` extensions:

- `main.test.ts` - Main application tests
- `controllers/*.test.ts` - Controller tests
- `routes/*.test.ts` - Route tests

### Writing Tests

The project uses Jest as the testing framework. Example:

```typescript
import { UserService } from '../services/UserService';

describe('UserService', () => {
  it('should create a user', async () => {
    const userService = new UserService();
    const user = await userService.createUser({
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      password: 'password123',
    });
    expect(user).toBeDefined();
  });
});
```

## Building for Production

### Build the Application

```bash
# Build using Nx
yarn build:backend

# Or directly
nx build backend
```

This will:

- Compile TypeScript to JavaScript
- Bundle the application using Webpack
- Output to `dist/apps/backend/`
- Generate `package.json` for deployment

### Output Directory

```
dist/apps/backend/
├── main.js              # Bundled application
├── assets/              # Static assets
└── package.json         # Production dependencies
```

### Running Production Build

```bash
cd dist/apps/backend
npm install --production
node main.js
```

### Production Environment Variables

Ensure all required environment variables are set:

- `NODE_ENV=production`
- `DATABASE_URL` pointing to production database
- All JWT secrets configured
- SMTP settings for email

### Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure production database
- [ ] Set secure JWT secrets
- [ ] Configure SMTP for emails
- [ ] Run database migrations: `npx prisma migrate deploy`
- [ ] Set up CORS for production domains
- [ ] Configure session secret
- [ ] Enable HTTPS
- [ ] Set up logging/monitoring
- [ ] Configure rate limiting (if applicable)

## Additional Resources

### Prisma Documentation

- [Prisma Docs](https://www.prisma.io/docs)
- [Prisma Schema Reference](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference)
- [Prisma Client API](https://www.prisma.io/docs/reference/api-reference/prisma-client-reference)

### TSOA Documentation

- [TSOA GitHub](https://github.com/lukeautry/tsoa)
- [TSOA Documentation](https://tsoa-community.github.io/docs/)

### Express.js

- [Express.js Guide](https://expressjs.com/en/guide/routing.html)

### Nx Monorepo

- [Nx Documentation](https://nx.dev)
- [Nx Express Plugin](https://nx.dev/nx-api/express)

## Troubleshooting

### Common Issues

**Issue: Database connection fails**

```
Solution:
1. Ensure PostgreSQL is running: docker-compose ps
2. Check DATABASE_URL in .env file
3. Verify database credentials
```

**Issue: Prisma client not generated**

```
Solution:
cd apps/backend/src
npx prisma generate
```

**Issue: Port already in use**

```
Solution:
1. Change PORT in .env file
2. Or kill the process using port 3000:
   - Linux/Mac: lsof -ti:3000 | xargs kill -9
   - Windows: netstat -ano | findstr :3000, then taskkill /PID <pid> /F
```

**Issue: Migration fails**

```
Solution:
1. Check database connection
2. Review migration file for errors
3. Reset database: npx prisma migrate reset (warning: deletes data)
```

## Support

For issues and questions:

- Check the main repository [README](../../README.md)
- Review existing issues on GitHub
- Create a new issue with detailed information

## License

This app is part of MyOrganiser and is licensed under the
[Elastic License 2.0](../../LICENSE). Third-party notices for vendored files
are in the repository [NOTICE](../../NOTICE).
