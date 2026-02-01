#!/bin/bash
# Cycle Migration Script: Fireberry CRM → HaiTech CRM

set -e

API_BASE="http://localhost:3001/api"
DATA_FILE="/home/opc/clawd/projects/haitech-crm/migration/data/fireberry_cycles.json"
LOG_FILE="/home/opc/clawd/projects/haitech-crm/migration/migration_log.txt"

# Get auth token
get_token() {
    curl -s -X POST "$API_BASE/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"email":"admin@haitech.co.il","password":"admin123"}' | jq -r '.accessToken'
}

TOKEN=$(get_token)
echo "Token acquired: ${TOKEN:0:20}..."

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Create missing courses
create_courses() {
    log "=== Creating missing courses ==="
    
    # Check if courses exist, create if not
    local courses=(
        '{"name":"קורס כללי","category":"programming","description":"קורס כללי לפעילויות שונות"}'
        '{"name":"חולון - בינה מלאכותית לפיתוח משחק","category":"ai","description":"קורס AI לפיתוח משחקים בסקופ חולון"}'
        '{"name":"חולון - יזמות טכנולוגית ו-AI","category":"ai","description":"קורס יזמות טכנולוגית בסקופ חולון"}'
        '{"name":"חולון סקופ - מיינקראפט  ו AI","category":"programming","description":"קורס מיינקראפט עם AI בסקופ חולון"}'
        '{"name":"חולון - מפתחים אפליקציות עם AI","category":"ai","description":"קורס פיתוח אפליקציות עם AI בסקופ חולון"}'
    )
    
    for course_json in "${courses[@]}"; do
        local name=$(echo "$course_json" | jq -r '.name')
        # Check if exists
        local exists=$(curl -s "$API_BASE/courses" -H "Authorization: Bearer $TOKEN" | jq -r ".data[] | select(.name==\"$name\") | .id")
        if [ -z "$exists" ]; then
            log "Creating course: $name"
            curl -s -X POST "$API_BASE/courses" \
                -H "Authorization: Bearer $TOKEN" \
                -H "Content-Type: application/json" \
                -d "$course_json" | jq -r '.id // .error'
        else
            log "Course exists: $name (id: $exists)"
        fi
    done
}

# Get all courses and create mapping
get_courses_map() {
    curl -s "$API_BASE/courses" -H "Authorization: Bearer $TOKEN" | jq -r '.data[] | "\(.name)|\(.id)"'
}

# Get all instructors and create mapping by name
get_instructors_map() {
    curl -s "$API_BASE/instructors?limit=100" -H "Authorization: Bearer $TOKEN" | jq -r '.data[] | "\(.name)|\(.id)"'
}

create_courses

log "=== Building mappings ==="

# Save mappings
get_courses_map > /tmp/courses_map.txt
get_instructors_map > /tmp/instructors_map.txt

log "Courses: $(wc -l < /tmp/courses_map.txt)"
log "Instructors: $(wc -l < /tmp/instructors_map.txt)"

# Show sample mappings
log "Sample course mappings:"
head -5 /tmp/courses_map.txt | while read line; do log "  $line"; done

log "=== Migration setup complete ==="
