# KWO Secure Backend

Enterprise-grade Express backend with JWT validation, rate limiting, and audit logging.

## Quick Start

### 1. Install Dependencies
```bash
cd backend
bun install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and fill in your Supabase credentials:
```bash
cp .env.example .env
```

Edit `.env`:
```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
PORT=3001
CORS_ORIGIN=http://localhost:8081
```

### 3. Start the Server
```bash
bun run dev
```

Server will run on `http://localhost:3001`

## Security Features

✅ **JWT Token Validation** - Verifies tokens with Supabase Auth
✅ **Rate Limiting** - 100 requests/minute per user, 1000/15min global
✅ **Audit Logging** - All actions logged to `audit_logs` table
✅ **CORS Protection** - Only allows your app domain
✅ **Helmet Security** - HTTP headers hardened
✅ **Input Validation** - Type-safe request handling
✅ **Token Refresh** - Automatic JWT refresh on expiration

## API Endpoints

All endpoints require `Authorization: Bearer <JWT_TOKEN>` header.

### User Profile
- `POST /api/profile/get` - Get user profile
- `POST /api/profile/update` - Update user profile

### Check-ins
- `POST /api/check-ins/list` - List check-ins (with pagination)
- `POST /api/check-ins/create` - Create new check-in

### Devices (Push Notifications)
- `POST /api/devices/register` - Register device with push token
- `POST /api/devices/get` - Get device info
- `POST /api/devices/update-active` - Update last active timestamp

### Chat
- `POST /api/chat/messages` - Get chat messages (with pagination)
- `POST /api/chat/send` - Send chat message

### Health
- `GET /health` - Health check endpoint

## Example Request

```bash
curl -X POST http://localhost:3001/api/profile/get \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Deployment

### To Production (Vercel, Railway, etc.)

1. Set environment variables in your hosting provider
2. Deploy the backend
3. Update `EXPO_PUBLIC_BACKEND_URL` in the app's `.env`
4. Redeploy the app

## Database Requirements

Make sure these tables exist in Supabase:
- `user_profiles` - User account info
- `user_devices` - Device/push token registry
- `user_check_ins` - Check-in history
- `chat_messages` - Chat history
- `audit_logs` - Action audit trail

## Architecture

```
React Native App
    ↓ (JWT in Authorization header)
Express Backend (http://localhost:3001)
    ↓ (validates JWT with Supabase Auth)
Supabase Database
    ↓ (all operations logged)
Audit Logs
```
