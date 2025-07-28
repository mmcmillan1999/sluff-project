# Sluff Card Game - Beta Testing Guide

## 🎯 Testing Overview

This guide provides step-by-step instructions for thoroughly testing the Sluff card game before Beta launch.

## 🧪 Testing Environments

### Local Testing
```bash
# Backend
cd backend
npm install
npm run dev

# Frontend (in another terminal)
cd frontend
npm install
npm start
```

### Staging Environment
- Frontend: https://sluff-pilot.netlify.app
- Backend: https://sluff-backend-pilot.onrender.com

## 📋 Test Scenarios

### 1. User Registration & Authentication

#### New User Registration
- [ ] Register with valid email
- [ ] Verify email validation works
- [ ] Check password strength requirements
- [ ] Confirm email verification sent
- [ ] Test duplicate email rejection

#### Login Flow
- [ ] Login with correct credentials
- [ ] Test "Remember Me" functionality
- [ ] Verify incorrect password handling
- [ ] Test account lockout (if implemented)

#### Password Reset
- [ ] Request password reset
- [ ] Receive reset email
- [ ] Successfully reset password
- [ ] Login with new password

### 2. Game Lobby

#### Creating Games
- [ ] Create public game
- [ ] Create private game
- [ ] Set game parameters
- [ ] Verify game appears in lobby

#### Joining Games
- [ ] Join public game
- [ ] Join private game with code
- [ ] Handle full game scenario
- [ ] Test reconnection to game

### 3. Gameplay Testing

#### Game Setup
- [ ] 4 players join successfully
- [ ] Cards dealt correctly
- [ ] Starting player determined

#### Bidding Phase
- [ ] Pass bid
- [ ] Frog bid
- [ ] Solo bid
- [ ] Heart Solo bid
- [ ] Bid hierarchy enforced
- [ ] Partner selection (Frog)

#### Playing Phase
- [ ] Legal move validation
- [ ] Must follow suit rule
- [ ] Trump card rules
- [ ] Trick winner calculation
- [ ] Score tracking

#### Special Rules
- [ ] Mercy token usage
- [ ] Sluff detection
- [ ] Game ending conditions

### 4. UI/UX Testing

#### Desktop Experience
- [ ] Chrome
- [ ] Firefox
- [ ] Safari
- [ ] Edge

#### Mobile Experience
- [ ] iOS Safari
- [ ] Android Chrome
- [ ] Touch interactions
- [ ] Landscape/Portrait modes

#### Responsive Design
- [ ] Small screens (< 768px)
- [ ] Medium screens (768px - 1024px)
- [ ] Large screens (> 1024px)

### 5. Performance Testing

#### Load Times
- [ ] Initial page load < 3s
- [ ] Game join < 2s
- [ ] Card play response < 500ms

#### Concurrent Users
- [ ] 10 concurrent games
- [ ] 40 concurrent players
- [ ] Chat functionality under load

#### Network Conditions
- [ ] 3G connection
- [ ] Intermittent connectivity
- [ ] Reconnection handling

### 6. Error Scenarios

#### Network Errors
- [ ] Server unavailable
- [ ] Lost connection mid-game
- [ ] Timeout handling

#### Game Errors
- [ ] Player leaves mid-game
- [ ] Invalid game state recovery
- [ ] Concurrent action conflicts

### 7. Security Testing

#### Authentication
- [ ] JWT token validation
- [ ] Session timeout
- [ ] Cross-site request protection

#### Input Validation
- [ ] SQL injection attempts
- [ ] XSS attempts
- [ ] Invalid data handling

### 8. Accessibility Testing

#### Keyboard Navigation
- [ ] Tab through all elements
- [ ] Enter/Space activation
- [ ] Escape key handling

#### Screen Reader
- [ ] ARIA labels present
- [ ] Game state announced
- [ ] Error messages readable

## 🐛 Bug Reporting Template

```markdown
### Bug Title
[Brief description]

### Environment
- Device: [e.g., iPhone 12, Desktop Chrome]
- OS: [e.g., iOS 15, Windows 11]
- Browser: [e.g., Safari 15, Chrome 120]

### Steps to Reproduce
1. 
2. 
3. 

### Expected Behavior
[What should happen]

### Actual Behavior
[What actually happens]

### Screenshots
[If applicable]

### Additional Context
[Any other relevant information]
```

## 📊 Performance Benchmarks

### Target Metrics
- **First Contentful Paint**: < 1.5s
- **Time to Interactive**: < 3s
- **Memory Usage**: < 100MB
- **WebSocket Latency**: < 100ms
- **API Response Time**: < 500ms

### Testing Tools
- Chrome DevTools
- Lighthouse
- WebPageTest
- Network throttling

## 🔄 Regression Testing

Before each release, verify:

1. **Core Features**
   - User can register and login
   - Games can be created and joined
   - Full game can be played
   - Scores calculated correctly

2. **Previous Bug Fixes**
   - Maintain list of fixed bugs
   - Verify fixes still work
   - Check for regression

3. **Cross-Browser**
   - Test on all supported browsers
   - Verify consistent behavior
   - Check console for errors

## 📱 Mobile App Testing (Future)

### Pre-Wrapper Testing
- [ ] PWA functionality
- [ ] Add to Home Screen
- [ ] Offline capabilities
- [ ] Push notification setup

### Post-Wrapper Testing
- [ ] Native app installation
- [ ] Deep linking
- [ ] Background behavior
- [ ] Platform-specific features

## ✅ Beta Launch Checklist

### Technical Readiness
- [ ] All critical bugs fixed
- [ ] Performance targets met
- [ ] Security audit passed
- [ ] Error tracking enabled

### User Experience
- [ ] Tutorial/help available
- [ ] Intuitive navigation
- [ ] Clear error messages
- [ ] Smooth animations

### Infrastructure
- [ ] Staging tested thoroughly
- [ ] Production deployment ready
- [ ] Monitoring configured
- [ ] Backup strategy in place

### Documentation
- [ ] User guide complete
- [ ] FAQ updated
- [ ] Terms of Service ready
- [ ] Privacy Policy published

## 🚀 Beta Testing Phases

### Phase 1: Internal Testing (1 week)
- Development team
- Close friends/family
- Focus on critical bugs

### Phase 2: Closed Beta (2 weeks)
- 50-100 invited users
- Feedback collection
- Performance monitoring

### Phase 3: Open Beta (2-4 weeks)
- Public access
- Marketing push
- Final polish

### Phase 4: Production Launch
- App store submission
- Full release
- Ongoing monitoring