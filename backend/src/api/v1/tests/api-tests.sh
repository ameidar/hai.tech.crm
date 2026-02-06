#!/bin/bash
#
# HaiTech CRM - API v1 Comprehensive Tests
# 
# This script tests all API endpoints with curl
# Run with the server running: npm run dev
#
# Usage: ./api-tests.sh [base_url]
#

# Configuration
BASE_URL="${1:-http://localhost:4000/api/v1}"
ADMIN_EMAIL="admin@haitech.co.il"
ADMIN_PASSWORD="admin123"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

# Storage for created IDs
TOKEN=""
CUSTOMER_ID=""
STUDENT_ID=""
COURSE_ID=""
BRANCH_ID=""
INSTRUCTOR_ID=""
CYCLE_ID=""
MEETING_ID=""
REGISTRATION_ID=""
ATTENDANCE_ID=""
DUPLICATED_CYCLE_ID=""

# Logging functions
log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASS_COUNT++))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAIL_COUNT++))
}

log_skip() {
    echo -e "${YELLOW}[SKIP]${NC} $1"
    ((SKIP_COUNT++))
}

log_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

# Helper function to test an endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local expected_status=$4
    local description=$5
    local use_auth=${6:-true}
    
    local url="${BASE_URL}${endpoint}"
    local response_file=$(mktemp)
    local status_code
    
    if [ "$use_auth" = "true" ] && [ -n "$TOKEN" ]; then
        if [ -n "$data" ]; then
            status_code=$(curl -s -o "$response_file" -w "%{http_code}" \
                -X "$method" \
                -H "Authorization: Bearer $TOKEN" \
                -H "Content-Type: application/json" \
                -d "$data" \
                "$url")
        else
            status_code=$(curl -s -o "$response_file" -w "%{http_code}" \
                -X "$method" \
                -H "Authorization: Bearer $TOKEN" \
                -H "Content-Type: application/json" \
                "$url")
        fi
    else
        if [ -n "$data" ]; then
            status_code=$(curl -s -o "$response_file" -w "%{http_code}" \
                -X "$method" \
                -H "Content-Type: application/json" \
                -d "$data" \
                "$url")
        else
            status_code=$(curl -s -o "$response_file" -w "%{http_code}" \
                -X "$method" \
                "$url")
        fi
    fi
    
    local response=$(cat "$response_file")
    rm -f "$response_file"
    
    if [ "$status_code" = "$expected_status" ]; then
        log_pass "$method $endpoint - $description (status: $status_code)"
        echo "$response"
        return 0
    else
        log_fail "$method $endpoint - $description (expected $expected_status, got $status_code)"
        echo "Response: $response" >&2
        return 1
    fi
}

# Extract ID from JSON response
extract_id() {
    echo "$1" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

# Extract data.id from nested response
extract_data_id() {
    # Try to get id from data object
    local id=$(echo "$1" | sed 's/.*"data":{[^}]*"id":"\([^"]*\)".*/\1/' | head -1)
    if [ -n "$id" ] && [ "$id" != "$1" ]; then
        echo "$id"
    else
        extract_id "$1"
    fi
}

echo "=========================================="
echo "  HaiTech CRM API v1 Tests"
echo "  Base URL: $BASE_URL"
echo "=========================================="
echo ""

# =============================================================================
# SECTION 1: Health Check
# =============================================================================
echo "--- Health Check ---"
test_endpoint GET /health "" 200 "Health check" false || true
echo ""

# =============================================================================
# SECTION 2: Authentication Tests
# =============================================================================
echo "--- Authentication Tests ---"

# Test 1: Login with valid credentials
response=$(test_endpoint POST /auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 200 "valid credentials" false) || true
if [ $? -eq 0 ]; then
    TOKEN=$(echo "$response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    if [ -z "$TOKEN" ]; then
        TOKEN=$(echo "$response" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
    fi
    if [ -n "$TOKEN" ]; then
        log_info "Token obtained: ${TOKEN:0:30}..."
    fi
fi

# Test 2: Login with invalid credentials
test_endpoint POST /auth/login '{"email":"wrong@email.com","password":"wrongpassword"}' 401 "invalid credentials" false || true

# Test 3: Access protected route without token
old_token=$TOKEN
TOKEN=""
test_endpoint GET /customers "" 401 "protected route without token" true || true
TOKEN=$old_token

# Test 4: Access protected route with token
test_endpoint GET /customers "" 200 "protected route with token" true || true

# Test 5: Get current user
test_endpoint GET /auth/me "" 200 "get current user" true || true

echo ""

# =============================================================================
# SECTION 3: Customers CRUD Tests
# =============================================================================
echo "--- Customers CRUD Tests ---"

# List customers
test_endpoint GET /customers "" 200 "list customers" || true

# Create customer
response=$(test_endpoint POST /customers '{"name":"Test Customer API","phone":"0501234567","email":"test-api@example.com","city":"Tel Aviv"}' 201 "create customer") || true
CUSTOMER_ID=$(extract_data_id "$response")
if [ -n "$CUSTOMER_ID" ]; then
    log_info "Created customer ID: $CUSTOMER_ID"
fi

# Create with invalid data (missing required field)
test_endpoint POST /customers '{"email":"invalid@test.com"}' 400 "create with invalid data (missing name)" || true

# Get single customer
if [ -n "$CUSTOMER_ID" ]; then
    test_endpoint GET "/customers/$CUSTOMER_ID" "" 200 "get single customer" || true
fi

# Get non-existent customer
test_endpoint GET /customers/00000000-0000-0000-0000-000000000000 "" 404 "get non-existent customer" || true

# Update customer
if [ -n "$CUSTOMER_ID" ]; then
    test_endpoint PUT "/customers/$CUSTOMER_ID" '{"name":"Updated Customer API","city":"Jerusalem"}' 200 "update customer" || true
fi

# Test duplicate phone - create another customer with same phone
test_endpoint POST /customers '{"name":"Duplicate Phone Test","phone":"0501234567","email":"dup@example.com"}' 409 "duplicate phone conflict" || log_skip "Duplicate phone not enforced"

echo ""

# =============================================================================
# SECTION 4: Students CRUD Tests
# =============================================================================
echo "--- Students CRUD Tests ---"

# Create student (requires customer)
if [ -n "$CUSTOMER_ID" ]; then
    response=$(test_endpoint POST /students "{\"name\":\"Test Student API\",\"customerId\":\"$CUSTOMER_ID\",\"grade\":\"5\"}" 201 "create student") || true
    STUDENT_ID=$(extract_data_id "$response")
    if [ -n "$STUDENT_ID" ]; then
        log_info "Created student ID: $STUDENT_ID"
    fi
fi

# List students
test_endpoint GET /students "" 200 "list students" || true

# Get single student
if [ -n "$STUDENT_ID" ]; then
    test_endpoint GET "/students/$STUDENT_ID" "" 200 "get single student" || true
fi

# Update student
if [ -n "$STUDENT_ID" ]; then
    test_endpoint PUT "/students/$STUDENT_ID" '{"name":"Updated Student API","grade":"6"}' 200 "update student" || true
fi

echo ""

# =============================================================================
# SECTION 5: Courses CRUD Tests
# =============================================================================
echo "--- Courses CRUD Tests ---"

# List courses
test_endpoint GET /courses "" 200 "list courses" || true

# Create course
response=$(test_endpoint POST /courses '{"name":"Test Course API","category":"programming","description":"API Test Course"}' 201 "create course") || true
COURSE_ID=$(extract_data_id "$response")
if [ -n "$COURSE_ID" ]; then
    log_info "Created course ID: $COURSE_ID"
fi

# Get single course
if [ -n "$COURSE_ID" ]; then
    test_endpoint GET "/courses/$COURSE_ID" "" 200 "get single course" || true
fi

# Update course
if [ -n "$COURSE_ID" ]; then
    test_endpoint PUT "/courses/$COURSE_ID" '{"name":"Updated Course API"}' 200 "update course" || true
fi

echo ""

# =============================================================================
# SECTION 6: Branches CRUD Tests
# =============================================================================
echo "--- Branches CRUD Tests ---"

# List branches
test_endpoint GET /branches "" 200 "list branches" || true

# Create branch
response=$(test_endpoint POST /branches '{"name":"Test Branch API","type":"school","city":"Tel Aviv","address":"Test Address 123"}' 201 "create branch") || true
BRANCH_ID=$(extract_data_id "$response")
if [ -n "$BRANCH_ID" ]; then
    log_info "Created branch ID: $BRANCH_ID"
fi

# Get single branch
if [ -n "$BRANCH_ID" ]; then
    test_endpoint GET "/branches/$BRANCH_ID" "" 200 "get single branch" || true
fi

# Update branch
if [ -n "$BRANCH_ID" ]; then
    test_endpoint PUT "/branches/$BRANCH_ID" '{"name":"Updated Branch API"}' 200 "update branch" || true
fi

echo ""

# =============================================================================
# SECTION 7: Instructors CRUD Tests
# =============================================================================
echo "--- Instructors CRUD Tests ---"

# List instructors
test_endpoint GET /instructors "" 200 "list instructors" || true

# Create instructor
response=$(test_endpoint POST /instructors '{"name":"Test Instructor API","phone":"0521234567","email":"instructor-api@test.com","rateFrontal":150,"rateOnline":120}' 201 "create instructor") || true
INSTRUCTOR_ID=$(extract_data_id "$response")
if [ -n "$INSTRUCTOR_ID" ]; then
    log_info "Created instructor ID: $INSTRUCTOR_ID"
fi

# Get single instructor
if [ -n "$INSTRUCTOR_ID" ]; then
    test_endpoint GET "/instructors/$INSTRUCTOR_ID" "" 200 "get single instructor" || true
fi

# Update instructor
if [ -n "$INSTRUCTOR_ID" ]; then
    test_endpoint PUT "/instructors/$INSTRUCTOR_ID" '{"name":"Updated Instructor API","rateFrontal":160}' 200 "update instructor" || true
fi

echo ""

# =============================================================================
# SECTION 8: Cycles CRUD + Business Logic Tests
# =============================================================================
echo "--- Cycles CRUD + Business Logic Tests ---"

# List cycles
test_endpoint GET /cycles "" 200 "list cycles" || true

# Create cycle (requires course, branch, instructor)
if [ -n "$COURSE_ID" ] && [ -n "$BRANCH_ID" ] && [ -n "$INSTRUCTOR_ID" ]; then
    CYCLE_DATA="{
        \"name\":\"Test Cycle API\",
        \"courseId\":\"$COURSE_ID\",
        \"branchId\":\"$BRANCH_ID\",
        \"instructorId\":\"$INSTRUCTOR_ID\",
        \"type\":\"institutional_fixed\",
        \"startDate\":\"2025-03-01\",
        \"dayOfWeek\":\"sunday\",
        \"startTime\":\"14:00\",
        \"endTime\":\"15:30\",
        \"durationMinutes\":90,
        \"totalMeetings\":10,
        \"meetingRevenue\":500
    }"
    response=$(test_endpoint POST /cycles "$CYCLE_DATA" 201 "create cycle") || true
    CYCLE_ID=$(extract_data_id "$response")
    if [ -n "$CYCLE_ID" ]; then
        log_info "Created cycle ID: $CYCLE_ID"
    fi
else
    log_skip "Create cycle - missing dependencies"
fi

# Get single cycle
if [ -n "$CYCLE_ID" ]; then
    test_endpoint GET "/cycles/$CYCLE_ID" "" 200 "get single cycle" || true
fi

# Update cycle
if [ -n "$CYCLE_ID" ]; then
    test_endpoint PUT "/cycles/$CYCLE_ID" '{"name":"Updated Cycle API"}' 200 "update cycle" || true
fi

# Get cycle meetings
if [ -n "$CYCLE_ID" ]; then
    test_endpoint GET "/cycles/$CYCLE_ID/meetings" "" 200 "get cycle meetings" || true
fi

# Get cycle registrations
if [ -n "$CYCLE_ID" ]; then
    test_endpoint GET "/cycles/$CYCLE_ID/registrations" "" 200 "get cycle registrations" || true
fi

# Generate meetings for cycle
if [ -n "$CYCLE_ID" ]; then
    test_endpoint POST "/cycles/$CYCLE_ID/generate-meetings" "" 200 "generate meetings for cycle" || true
fi

# Sync cycle progress
if [ -n "$CYCLE_ID" ]; then
    test_endpoint POST "/cycles/$CYCLE_ID/sync-progress" "" 200 "sync cycle progress" || true
fi

# Duplicate cycle
if [ -n "$CYCLE_ID" ]; then
    response=$(test_endpoint POST "/cycles/$CYCLE_ID/duplicate" '{"newStartDate":"2025-06-01","newName":"Duplicated Cycle API","copyRegistrations":false,"generateMeetings":true}' 201 "duplicate cycle") || true
    DUPLICATED_CYCLE_ID=$(extract_data_id "$response")
    if [ -n "$DUPLICATED_CYCLE_ID" ]; then
        log_info "Duplicated cycle ID: $DUPLICATED_CYCLE_ID"
    fi
fi

# Bulk update cycles
if [ -n "$CYCLE_ID" ]; then
    test_endpoint POST /cycles/bulk-update "{\"ids\":[\"$CYCLE_ID\"],\"data\":{\"sendParentReminders\":true}}" 200 "bulk update cycles" || true
fi

echo ""

# =============================================================================
# SECTION 9: Registrations Tests
# =============================================================================
echo "--- Registrations Tests ---"

# Add registration to cycle
if [ -n "$CYCLE_ID" ] && [ -n "$STUDENT_ID" ]; then
    response=$(test_endpoint POST "/cycles/$CYCLE_ID/registrations" "{\"studentId\":\"$STUDENT_ID\",\"status\":\"registered\",\"amount\":1500,\"paymentStatus\":\"unpaid\"}" 201 "add registration to cycle") || true
    REGISTRATION_ID=$(extract_data_id "$response")
    if [ -n "$REGISTRATION_ID" ]; then
        log_info "Created registration ID: $REGISTRATION_ID"
    fi
fi

# List registrations
test_endpoint GET /registrations "" 200 "list registrations" || true

# Get single registration
if [ -n "$REGISTRATION_ID" ]; then
    test_endpoint GET "/registrations/$REGISTRATION_ID" "" 200 "get single registration" || true
fi

# Update registration payment
if [ -n "$REGISTRATION_ID" ]; then
    test_endpoint POST "/registrations/$REGISTRATION_ID/payment" '{"paymentStatus":"paid","paymentMethod":"credit","amount":1500}' 200 "update registration payment" || true
fi

# Test duplicate registration (same student + cycle)
if [ -n "$CYCLE_ID" ] && [ -n "$STUDENT_ID" ]; then
    test_endpoint POST "/cycles/$CYCLE_ID/registrations" "{\"studentId\":\"$STUDENT_ID\"}" 409 "duplicate registration conflict" || true
fi

echo ""

# =============================================================================
# SECTION 10: Meetings CRUD + Business Logic Tests
# =============================================================================
echo "--- Meetings CRUD + Business Logic Tests ---"

# List meetings
test_endpoint GET /meetings "" 200 "list meetings" || true

# Get cycle meetings to find a meeting ID
if [ -n "$CYCLE_ID" ]; then
    response=$(test_endpoint GET "/cycles/$CYCLE_ID/meetings" "" 200 "get cycle meetings for ID") || true
    MEETING_ID=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -n "$MEETING_ID" ]; then
        log_info "Found meeting ID: $MEETING_ID"
    fi
fi

# Get single meeting
if [ -n "$MEETING_ID" ]; then
    test_endpoint GET "/meetings/$MEETING_ID" "" 200 "get single meeting" || true
fi

# Update meeting
if [ -n "$MEETING_ID" ]; then
    test_endpoint PUT "/meetings/$MEETING_ID" '{"notes":"Updated via API test"}' 200 "update meeting" || true
fi

# Get meeting attendance
if [ -n "$MEETING_ID" ]; then
    test_endpoint GET "/meetings/$MEETING_ID/attendance" "" 200 "get meeting attendance" || true
fi

# Complete meeting
if [ -n "$MEETING_ID" ]; then
    test_endpoint POST "/meetings/$MEETING_ID/complete" '{"notes":"Completed via API test"}' 200 "complete meeting" || true
fi

# Recalculate meeting
if [ -n "$MEETING_ID" ]; then
    test_endpoint POST "/meetings/$MEETING_ID/recalculate" "" 200 "recalculate meeting" || true
fi

# Find another meeting to cancel
CANCEL_MEETING_ID=""
if [ -n "$CYCLE_ID" ]; then
    response=$(test_endpoint GET "/cycles/$CYCLE_ID/meetings" "" 200 "get meetings for cancel test") || true
    CANCEL_MEETING_ID=$(echo "$response" | grep -o '"id":"[^"]*"' | grep -v "$MEETING_ID" | head -1 | cut -d'"' -f4)
    if [ -n "$CANCEL_MEETING_ID" ]; then
        log_info "Found meeting to cancel: $CANCEL_MEETING_ID"
        test_endpoint POST "/meetings/$CANCEL_MEETING_ID/cancel" '{"reason":"Cancelled via API test"}' 200 "cancel meeting" || true
    fi
fi

# Bulk record attendance
if [ -n "$MEETING_ID" ] && [ -n "$REGISTRATION_ID" ]; then
    test_endpoint POST "/meetings/$MEETING_ID/attendance/bulk" "{\"meetingId\":\"$MEETING_ID\",\"records\":[{\"registrationId\":\"$REGISTRATION_ID\",\"status\":\"present\"}]}" 200 "bulk record attendance" || true
fi

# Bulk recalculate
if [ -n "$MEETING_ID" ]; then
    test_endpoint POST /meetings/bulk-recalculate "{\"ids\":[\"$MEETING_ID\"]}" 200 "bulk recalculate meetings" || true
fi

echo ""

# =============================================================================
# SECTION 11: Attendance Tests
# =============================================================================
echo "--- Attendance Tests ---"

# List attendance
test_endpoint GET /attendance "" 200 "list attendance" || true

# Create attendance record
if [ -n "$MEETING_ID" ] && [ -n "$STUDENT_ID" ]; then
    response=$(test_endpoint POST /attendance "{\"meetingId\":\"$MEETING_ID\",\"studentId\":\"$STUDENT_ID\",\"status\":\"present\"}" 201 "create attendance") || true
    ATTENDANCE_ID=$(extract_data_id "$response")
    if [ -n "$ATTENDANCE_ID" ]; then
        log_info "Created attendance ID: $ATTENDANCE_ID"
    fi
fi

# Get single attendance
if [ -n "$ATTENDANCE_ID" ]; then
    test_endpoint GET "/attendance/$ATTENDANCE_ID" "" 200 "get single attendance" || true
fi

# Update attendance
if [ -n "$ATTENDANCE_ID" ]; then
    test_endpoint PUT "/attendance/$ATTENDANCE_ID" '{"status":"late","notes":"Updated via API test"}' 200 "update attendance" || true
fi

echo ""

# =============================================================================
# SECTION 12: Cleanup - Delete created resources
# =============================================================================
echo "--- Cleanup ---"

# Delete in reverse order of dependencies

# Delete attendance
if [ -n "$ATTENDANCE_ID" ]; then
    test_endpoint DELETE "/attendance/$ATTENDANCE_ID" "" 204 "delete attendance" || true
fi

# Delete registration
if [ -n "$REGISTRATION_ID" ]; then
    test_endpoint DELETE "/registrations/$REGISTRATION_ID" "" 204 "delete registration" || true
fi

# Delete duplicated cycle
if [ -n "$DUPLICATED_CYCLE_ID" ]; then
    test_endpoint DELETE "/cycles/$DUPLICATED_CYCLE_ID" "" 204 "delete duplicated cycle" || true
fi

# Delete cycle
if [ -n "$CYCLE_ID" ]; then
    test_endpoint DELETE "/cycles/$CYCLE_ID" "" 204 "delete cycle" || true
fi

# Delete student
if [ -n "$STUDENT_ID" ]; then
    test_endpoint DELETE "/students/$STUDENT_ID" "" 204 "delete student" || true
fi

# Delete customer
if [ -n "$CUSTOMER_ID" ]; then
    test_endpoint DELETE "/customers/$CUSTOMER_ID" "" 204 "delete customer" || true
fi

# Delete instructor
if [ -n "$INSTRUCTOR_ID" ]; then
    test_endpoint DELETE "/instructors/$INSTRUCTOR_ID" "" 204 "delete instructor" || true
fi

# Delete branch
if [ -n "$BRANCH_ID" ]; then
    test_endpoint DELETE "/branches/$BRANCH_ID" "" 204 "delete branch" || true
fi

# Delete course
if [ -n "$COURSE_ID" ]; then
    test_endpoint DELETE "/courses/$COURSE_ID" "" 204 "delete course" || true
fi

echo ""

# =============================================================================
# Summary
# =============================================================================
echo "=========================================="
echo "  Test Summary"
echo "=========================================="
TOTAL=$((PASS_COUNT + FAIL_COUNT))
echo -e "  ${GREEN}Passed:${NC}  $PASS_COUNT"
echo -e "  ${RED}Failed:${NC}  $FAIL_COUNT"
echo -e "  ${YELLOW}Skipped:${NC} $SKIP_COUNT"
echo "  ─────────────────"
echo "  Total:   $TOTAL tests"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed. Please review the output above.${NC}"
    exit 1
fi
