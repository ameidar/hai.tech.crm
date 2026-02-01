# Fireberry → HaiTech CRM Migration Plan

## Overview
- **Source**: Fireberry CRM (127 active cycles)
- **Target**: HaiTech CRM
- **Already Imported**: ~17 cycles (mostly ORT Monday)
- **Remaining**: ~110 cycles

## Field Mapping

### Cycle Fields
| Fireberry Field | Fireberry ID | HaiTech Field | Notes |
|-----------------|--------------|---------------|-------|
| name | name | name | Direct copy |
| pcfsystemfield85name | instructor name | instructorId | Lookup by name |
| pcfsystemfield28name | course name | courseId | Lookup/create |
| pcfsystemfield451name | customer | branchId | Lookup/create |
| pcfsystemfield268name | day of week | dayOfWeek | Map Hebrew→English |
| pcfsystemfield270 | start time | startTime | Format HH:MM |
| pcfsystemfield33 | start date | startDate | ISO format |
| pcfsystemfield35 | end date | endDate | ISO format |
| pcfsystemfield233 | completed meetings | completedMeetings | Number |
| pcfsystemfield550 | revenue per meeting | meetingRevenue | Decimal |
| pcfsystemfield534 | duration minutes | durationMinutes | Number (75 default) |
| pcfsystemfield536name | type | type | Map to institutional_fixed/private |
| pcfsystemfield549name | pricing type | type | "מוסדי" = institutional |

### Day Mapping
- ראשון → sunday
- שני → monday
- שלישי → tuesday
- רביעי → wednesday
- חמישי → thursday
- שישי → friday

### Type Mapping
- אונליין קבוצתי + מוסדי → institutional_fixed, isOnline: true
- פרונטלי שנתי + מוסדי → institutional_fixed, isOnline: false
- פרטי → private

## Validation Checklist (Per Cycle)
- [ ] Name matches
- [ ] Instructor matches
- [ ] Course matches
- [ ] Branch/Customer matches
- [ ] Day of week matches
- [ ] Start time matches
- [ ] Start/End date matches
- [ ] Total meetings count correct
- [ ] Completed meetings count correct
- [ ] Revenue per meeting matches
- [ ] IsOnline flag correct
- [ ] Meetings generated with correct dates
- [ ] First 4 meetings marked as completed (if completedMeetings >= 4)

## Migration Steps
1. Export all active cycles from Fireberry
2. Identify missing courses → create them
3. Identify missing instructors → create them  
4. Identify missing branches → create them
5. Import cycles one by one
6. Generate meetings for each cycle
7. Mark completed meetings
8. Validate each cycle

## Execution Order
1. Sunday cycles (36)
2. Monday cycles (remaining ~18 after ORT)
3. Tuesday cycles (19)
4. Wednesday cycles (24)
5. Thursday cycles (10)
6. Friday cycles (4)
