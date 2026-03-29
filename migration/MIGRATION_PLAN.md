# Fireberry → HaiTech CRM Migration Plan

## Status: ✅ MOSTLY COMPLETED

### Summary
- **Source**: Fireberry CRM (127 active cycles)
- **Target**: HaiTech CRM
- **Imported**: ~127 cycles
- **Status**: All active cycles migrated, system in production use

---

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
| - | - | fireberryId | Original Fireberry ID stored for reference |

### Day Mapping
| Hebrew | English |
|--------|---------|
| ראשון | sunday |
| שני | monday |
| שלישי | tuesday |
| רביעי | wednesday |
| חמישי | thursday |
| שישי | friday |

### Type Mapping
| Fireberry Type | HaiTech Type | isOnline |
|----------------|--------------|----------|
| אונליין קבוצתי + מוסדי | institutional_fixed | true |
| פרונטלי שנתי + מוסדי | institutional_fixed | false |
| פרטי | private | varies |

---

## Migration Checklist

### Entity Migration Status

| Entity | Status | Count | Notes |
|--------|--------|-------|-------|
| Courses | ✅ Done | ~15 | Created as needed |
| Instructors | ✅ Done | ~12 | All active imported |
| Branches | ✅ Done | ~40 | Schools & community centers |
| Cycles | ✅ Done | ~127 | All active cycles |
| Meetings | ✅ Done | Auto-generated | Based on cycle dates |
| Customers | ⚠️ Partial | For private only | Not all imported |
| Students | ⚠️ Partial | For private only | Linked to customers |
| Registrations | ⚠️ Partial | For private only | Payment tracking |

### Validation Checklist (Per Cycle)
- [x] Name matches
- [x] Instructor matches
- [x] Course matches
- [x] Branch/Customer matches
- [x] Day of week matches
- [x] Start time matches
- [x] Start/End date matches
- [x] Total meetings count correct
- [x] Completed meetings count correct
- [x] Revenue per meeting matches
- [x] IsOnline flag correct
- [x] Meetings generated with correct dates

---

## Import Scripts

### Location
```
/home/opc/clawd/projects/haitech-crm/scripts/
```

### Available Scripts
- Import meetings from CSV
- Bulk cycle creation
- Meeting generation utilities

---

## Post-Migration Tasks

### Completed ✅
- [x] All cycles imported and verified
- [x] Meetings auto-generated for each cycle
- [x] Instructor assignments correct
- [x] Branch/course relationships established
- [x] Zoom integration for online cycles
- [x] System in production use

### Remaining (Optional)
- [ ] Import historical attendance records (if needed)
- [ ] Import payment history for private cycles
- [ ] Archive old Fireberry data

---

## Data Validation

### Post-Import Checks
```sql
-- Count cycles by status
SELECT status, COUNT(*) FROM cycles GROUP BY status;

-- Count meetings by status
SELECT status, COUNT(*) FROM meetings GROUP BY status;

-- Verify all cycles have instructor
SELECT COUNT(*) FROM cycles WHERE instructor_id IS NULL;

-- Check for orphan meetings
SELECT COUNT(*) FROM meetings m
WHERE NOT EXISTS (SELECT 1 FROM cycles c WHERE c.id = m.cycle_id);
```

### Known Issues Resolved
1. **Duplicate instructors** - Merged during import
2. **Missing branches** - Created on-the-fly
3. **Date format issues** - Normalized to ISO format
4. **Hebrew encoding** - Proper UTF-8 handling

---

## Rollback Plan (No Longer Needed)

Since the system is in production and working well, rollback is not expected. However, the original Fireberry system remains accessible as read-only if needed for reference.

---

## Support Contacts

- **Technical**: Clawd (AI assistant)
- **Business**: Ami (HaiTech)
- **Fireberry Access**: Read-only for historical data

---

*Last updated: 2025-02-13*
*Migration status: Production*
