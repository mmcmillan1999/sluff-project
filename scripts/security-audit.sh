#!/bin/bash

# Security Audit Script for Sluff Card Game
echo "🔒 Sluff Card Game - Security Audit"
echo "===================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
ISSUES=0
WARNINGS=0

echo "🔍 Checking for common security issues..."
echo ""

# Check for hardcoded secrets
echo "1. Checking for hardcoded secrets..."
if grep -r "password\s*=\s*[\"'][^\"']*[\"']" ../backend/src --exclude-dir=node_modules 2>/dev/null | grep -v test; then
    echo -e "${RED}❌ Found hardcoded passwords${NC}"
    ((ISSUES++))
else
    echo -e "${GREEN}✅ No hardcoded passwords found${NC}"
fi

if grep -r "secret\s*=\s*[\"'][^\"']*[\"']" ../backend/src --exclude-dir=node_modules 2>/dev/null | grep -v test; then
    echo -e "${RED}❌ Found hardcoded secrets${NC}"
    ((ISSUES++))
else
    echo -e "${GREEN}✅ No hardcoded secrets found${NC}"
fi

echo ""

# Check for console.log in production code
echo "2. Checking for console.log statements..."
CONSOLE_LOGS=$(grep -r "console\.log" ../frontend/src ../backend/src --exclude-dir=node_modules --exclude="*.test.js" 2>/dev/null | wc -l)
if [ $CONSOLE_LOGS -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Found $CONSOLE_LOGS console.log statements${NC}"
    ((WARNINGS++))
else
    echo -e "${GREEN}✅ No console.log statements found${NC}"
fi

echo ""

# Check for rate limiting
echo "3. Checking for rate limiting..."
if grep -r "rate.*limit\|express-rate-limit\|limiter" ../backend/src --exclude-dir=node_modules 2>/dev/null | grep -q .; then
    echo -e "${GREEN}✅ Rate limiting appears to be implemented${NC}"
else
    echo -e "${RED}❌ No rate limiting found${NC}"
    ((ISSUES++))
fi

echo ""

# Check for input validation
echo "4. Checking for input validation..."
if grep -r "validate\|validator\|joi\|express-validator" ../backend/src --exclude-dir=node_modules 2>/dev/null | grep -q .; then
    echo -e "${GREEN}✅ Input validation appears to be implemented${NC}"
else
    echo -e "${YELLOW}⚠️  Limited input validation found${NC}"
    ((WARNINGS++))
fi

echo ""

# Check for SQL injection protection
echo "5. Checking for SQL injection protection..."
if grep -r "\$[0-9]\|parameterized\|prepared" ../backend/src --exclude-dir=node_modules 2>/dev/null | grep -q .; then
    echo -e "${GREEN}✅ Parameterized queries appear to be used${NC}"
else
    echo -e "${YELLOW}⚠️  Verify parameterized queries are used${NC}"
    ((WARNINGS++))
fi

echo ""

# Check for HTTPS enforcement
echo "6. Checking for HTTPS usage..."
if grep -r "https://" ../frontend/src ../backend/src --exclude-dir=node_modules 2>/dev/null | grep -q .; then
    echo -e "${GREEN}✅ HTTPS URLs found${NC}"
else
    echo -e "${YELLOW}⚠️  Ensure HTTPS is enforced in production${NC}"
    ((WARNINGS++))
fi

echo ""

# Check for security headers
echo "7. Checking for security headers..."
if grep -r "helmet\|security.*header\|X-Frame-Options\|Content-Security-Policy" ../backend/src --exclude-dir=node_modules 2>/dev/null | grep -q .; then
    echo -e "${GREEN}✅ Security headers appear to be configured${NC}"
else
    echo -e "${RED}❌ No security headers configuration found${NC}"
    ((ISSUES++))
fi

echo ""

# Check for environment variables
echo "8. Checking for environment variable usage..."
if grep -r "process\.env\." ../backend/src --exclude-dir=node_modules 2>/dev/null | grep -q .; then
    echo -e "${GREEN}✅ Environment variables are used${NC}"
else
    echo -e "${YELLOW}⚠️  Limited use of environment variables${NC}"
    ((WARNINGS++))
fi

echo ""

# Check for JWT configuration
echo "9. Checking JWT configuration..."
if grep -r "expiresIn\|exp\|token.*expir" ../backend/src --exclude-dir=node_modules 2>/dev/null | grep -q .; then
    echo -e "${GREEN}✅ JWT expiration appears to be configured${NC}"
else
    echo -e "${YELLOW}⚠️  Verify JWT expiration is properly set${NC}"
    ((WARNINGS++))
fi

echo ""

# Check for error handling
echo "10. Checking error handling..."
ERROR_HANDLERS=$(grep -r "catch\|error.*handler\|try.*catch" ../backend/src --exclude-dir=node_modules 2>/dev/null | wc -l)
if [ $ERROR_HANDLERS -gt 10 ]; then
    echo -e "${GREEN}✅ Error handling appears adequate ($ERROR_HANDLERS instances)${NC}"
else
    echo -e "${YELLOW}⚠️  Limited error handling found ($ERROR_HANDLERS instances)${NC}"
    ((WARNINGS++))
fi

echo ""
echo "===================================="
echo "📊 Security Audit Summary:"
echo -e "   Critical Issues: ${RED}$ISSUES${NC}"
echo -e "   Warnings: ${YELLOW}$WARNINGS${NC}"
echo ""

if [ $ISSUES -gt 0 ]; then
    echo -e "${RED}⚠️  Critical security issues found! Please address these before Beta launch.${NC}"
elif [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Some security improvements recommended.${NC}"
else
    echo -e "${GREEN}✅ No major security issues found!${NC}"
fi

echo ""
echo "📝 Recommendations:"
echo "   1. Implement rate limiting on all API endpoints"
echo "   2. Add helmet.js for security headers"
echo "   3. Ensure all user inputs are validated"
echo "   4. Set up proper JWT expiration (e.g., 24 hours)"
echo "   5. Use environment variables for all sensitive data"
echo "   6. Implement proper error logging (not console.log)"
echo "   7. Add CAPTCHA for authentication endpoints"
echo "   8. Regular security dependency updates"