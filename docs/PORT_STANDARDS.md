# Sluff Project Port Standards

## Development Ports
- Frontend: 3000
- Backend: 3005

## Port Allocation Strategy
To avoid conflicts when running multiple projects:

1. **Reserve port ranges by project type:**
   - 3000-3099: Project 1 (Sluff)
   - 4000-4099: Project 2
   - 5000-5099: Project 3
   - etc.

2. **Within each range:**
   - xx00-xx04: Frontend services
   - xx05-xx09: Backend APIs
   - xx10-xx19: Databases
   - xx20-xx29: Additional services

## Quick Setup Commands
```bash
# Start frontend
cd frontend && npm start  # Uses PORT from .env (3000)

# Start backend  
cd backend && npm start   # Uses PORT from .env (3005)
```

## Troubleshooting Port Conflicts
If you get "Port already in use" errors:

### Windows:
```cmd
# Find what's using a port
netstat -ano | findstr :3000

# Kill process by PID
taskkill /PID <PID> /F
```

### PowerShell:
```powershell
# Find and kill process on port 3000
Get-NetTCPConnection -LocalPort 3000 | Select-Object -Property OwningProcess | Stop-Process
```