# Local Testing Setup for Mercy Token Fixes

## Quick Start Guide

### 1. Database Setup
Edit `/workspace/backend/.env` and replace the placeholder with your actual PostgreSQL connection string:

```bash
# Example connection strings:
# Local PostgreSQL: postgresql://username:password@localhost:5432/database_name
# Remote PostgreSQL: postgresql://username:password@hostname:5432/database_name

POSTGRES_CONNECT_STRING=postgresql://your_username:your_password@localhost:5432/your_database
```

### 2. Install Dependencies

**Backend:**
```bash
cd /workspace/backend
npm install
```

**Frontend:**
```bash
cd /workspace/frontend
npm install
```

### 3. Start the Applications

**Terminal 1 - Backend Server:**
```bash
cd /workspace/backend
npm start
# Server will run on http://localhost:3000
```

**Terminal 2 - Frontend Client:**
```bash
cd /workspace/frontend
npm start
# Client will run on http://localhost:3001
```

### 4. Test the Mercy Token Fixes

1. **Register/Login** to create a user account
2. **Join a game** and lose all your tokens (or use admin tools to set tokens to 0)
3. **Click the mercy token button** - you should see:
   - 15-second contemplation timer (enforced server-side)
   - Rate limiting message (1 token per hour)
   - Success notification when granted
4. **Try rapid requests** - you should be blocked by rate limiting
5. **Check admin endpoints** (if you're an admin):
   - `GET /api/admin/mercy-token-report` - Security report
   - `GET /api/admin/user-suspicious-activity/:userId` - User activity check

## Key Features to Test

### ✅ **Race Condition Fix**
- Try opening multiple browser tabs and requesting mercy tokens simultaneously
- Only one should succeed, others should be blocked

### ✅ **Rate Limiting**
- Request a mercy token successfully
- Try to request another immediately - should be blocked for 1 hour

### ✅ **Server-Side Timer**
- Try to bypass the 15-second timer using browser dev tools
- Server will reject requests with insufficient contemplation time

### ✅ **Input Validation**
- All user inputs are validated server-side
- Invalid requests are rejected with proper error messages

### ✅ **Security Monitoring**
- All mercy token attempts are logged to console
- Suspicious activity is flagged automatically
- Admin endpoints provide security reports

## Console Output Examples

When testing, you'll see logs like:
```
✅ [MERCY_TOKEN] username (123): Mercy token granted
❌ [MERCY_TOKEN] username (123): Rate limit exceeded
⚠️ Mercy token denied for username (ID: 123): Token limit exceeded
🚨 [SECURITY] Suspicious mercy token activity for user 123: Multiple mercy tokens in 24h: 4
```

## Database Verification

You can verify the fixes work by checking the `transactions` table:
```sql
SELECT * FROM transactions 
WHERE transaction_type = 'free_token_mercy' 
ORDER BY transaction_time DESC;
```

## Troubleshooting

**Database Connection Issues:**
- Make sure PostgreSQL is running
- Verify connection string format
- Check firewall/network settings

**Port Conflicts:**
- Backend uses port 3000
- Frontend uses port 3001
- Make sure these ports are available

**Environment Variables:**
- All required variables are in `/workspace/backend/.env`
- Restart the server after changing .env files