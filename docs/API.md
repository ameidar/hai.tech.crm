# HaiTech CRM API Documentation

**Version:** 1.0.0  
**Base URL:** `https://your-domain.com/api/v1`

---

## Table of Contents

1. [Authentication](#authentication)
   - [JWT Authentication](#jwt-authentication)
   - [API Key Authentication](#api-key-authentication)
2. [Common Patterns](#common-patterns)
3. [Endpoints](#endpoints)
   - [Health](#health)
   - [Auth](#auth)
   - [Customers](#customers)
   - [Students](#students)
   - [Instructors](#instructors)
   - [Branches](#branches)
   - [Courses](#courses)
   - [Cycles](#cycles)
   - [Meetings](#meetings)
   - [Registrations](#registrations)
   - [Attendance](#attendance)
   - [Reports](#reports)
   - [API Keys](#api-keys)
   - [Webhooks](#webhooks)
4. [Error Handling](#error-handling)
5. [Rate Limiting](#rate-limiting)

---

## Authentication

The API supports two authentication methods:

### JWT Authentication

For interactive users (dashboard, mobile apps):

1. Call `POST /auth/login` with email and password
2. Receive `accessToken` and `refreshToken`
3. Include the access token in subsequent requests:
   ```
   Authorization: Bearer <accessToken>
   ```
4. When the access token expires, call `POST /auth/refresh` with the refresh token

### API Key Authentication

For external system integrations:

1. Generate an API key from the admin dashboard or API
2. Include the key in requests using one of these methods:
   ```
   X-API-Key: haitech_xxxx...
   ```
   or
   ```
   Authorization: Bearer haitech_xxxx...
   ```

API keys have configurable scopes that limit access to specific resources. See [API Keys](#api-keys) section.

---

## Common Patterns

### Pagination

All list endpoints support pagination:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 20 | Number of items per page (1-100) |
| `offset` | integer | 0 | Number of items to skip |

Response includes pagination metadata:
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "total": 150,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

### Sorting

| Parameter | Type | Description |
|-----------|------|-------------|
| `sortBy` | string | Field name to sort by |
| `sortOrder` | string | `asc` or `desc` (default: `asc`) |

### Searching

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search term (searches relevant text fields) |
| `q` | string | Alias for `search` |

### Date Filtering

Many endpoints support date range filtering:

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | ISO 8601 date | Start date (inclusive) |
| `to` | ISO 8601 date | End date (inclusive) |

### UUID Format

All resource IDs are UUIDv4 format:
```
550e8400-e29b-41d4-a716-446655440000
```

---

## Endpoints

### Health

#### GET /health
Basic health check - returns 200 if server is running.

**Access:** Public (no authentication required)

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "version": "1.0.0",
    "uptime": 12345.678
  }
}
```

#### GET /health/ready
Readiness check - verifies database connectivity.

**Access:** Public

**Response (healthy):**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "version": "1.0.0",
    "uptime": 12345.678,
    "checks": {
      "database": "connected"
    }
  }
}
```

#### GET /health/live
Liveness check - basic process health.

**Access:** Public

---

### Auth

#### POST /auth/login
Authenticate with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "your-password"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbG...",
    "refreshToken": "eyJhbG...",
    "expiresIn": 3600,
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "User Name",
      "role": "admin"
    }
  }
}
```

#### POST /auth/refresh
Refresh an expired access token.

**Request Body:**
```json
{
  "refreshToken": "eyJhbG..."
}
```

#### GET /auth/me
Get current authenticated user info.

**Access:** Authenticated

#### POST /auth/logout
Logout (invalidates refresh token).

**Access:** Authenticated

#### PUT /auth/password
Change password.

**Access:** Authenticated

**Request Body:**
```json
{
  "currentPassword": "old-password",
  "newPassword": "new-password-min-6-chars"
}
```

---

### Customers

Customers are parents/guardians who pay for student registrations.

#### GET /customers
List all customers.

**Access:** Authenticated

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search by name, email, phone |
| `city` | string | Filter by city |
| `hasActiveRegistration` | boolean | Filter customers with active registrations |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "ישראל ישראלי",
      "email": "israel@example.com",
      "phone": "0501234567",
      "address": "רחוב הרצל 1",
      "city": "תל אביב",
      "notes": null,
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {...}
}
```

#### GET /customers/:id
Get single customer by ID.

#### POST /customers
Create new customer.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "name": "ישראל ישראלי",
  "phone": "0501234567",
  "email": "israel@example.com",
  "address": "רחוב הרצל 1",
  "city": "תל אביב",
  "notes": "הערות נוספות"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✓ | Customer name |
| `phone` | string | ✓ | Phone (min 9 digits) |
| `email` | string | | Email address |
| `address` | string | | Street address |
| `city` | string | | City |
| `notes` | string | | Internal notes |

#### PUT /customers/:id
Update customer.

**Access:** Manager or Admin

#### DELETE /customers/:id
Soft delete customer.

**Access:** Manager or Admin

#### GET /customers/:id/students
Get all students belonging to a customer.

#### POST /customers/:id/students
Add a new student to customer.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "name": "דני ישראלי",
  "birthDate": "2015-03-20",
  "grade": "ד",
  "notes": "אלרגיה לאגוזים"
}
```

---

### Students

Students are children who participate in courses.

#### GET /students
List all students.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search by name |
| `customerId` | UUID | Filter by parent/customer |
| `grade` | string | Filter by grade |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "customerId": "uuid",
      "name": "דני ישראלי",
      "birthDate": "2015-03-20",
      "grade": "ד",
      "notes": null,
      "customer": {
        "id": "uuid",
        "name": "ישראל ישראלי",
        "phone": "0501234567"
      }
    }
  ]
}
```

#### GET /students/:id
Get single student.

#### POST /students
Create new student.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "customerId": "uuid-of-parent",
  "name": "דני ישראלי",
  "birthDate": "2015-03-20",
  "grade": "ד",
  "notes": "הערות"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `customerId` | UUID | ✓ | Parent customer ID |
| `name` | string | ✓ | Student name |
| `birthDate` | date | | Birth date (YYYY-MM-DD) |
| `grade` | string | | School grade (א-יב) |
| `notes` | string | | Notes |

#### PUT /students/:id
Update student.

**Access:** Manager or Admin

#### DELETE /students/:id
Soft delete student.

**Access:** Manager or Admin

#### GET /students/:id/registrations
Get all registrations for a student.

---

### Instructors

Teachers/instructors who lead courses and meetings.

#### GET /instructors
List all instructors.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search by name, email, phone |
| `isActive` | boolean | Filter by active status |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "מורה ישראלי",
      "phone": "0521234567",
      "email": "teacher@example.com",
      "rateFrontal": 150.00,
      "rateOnline": 120.00,
      "ratePrivate": 200.00,
      "ratePreparation": 50.00,
      "isActive": true,
      "notes": null
    }
  ]
}
```

#### GET /instructors/:id
Get single instructor.

#### POST /instructors
Create new instructor.

**Access:** Admin only

**Request Body:**
```json
{
  "name": "מורה ישראלי",
  "phone": "0521234567",
  "email": "teacher@example.com",
  "rateFrontal": 150.00,
  "rateOnline": 120.00,
  "ratePrivate": 200.00,
  "ratePreparation": 50.00,
  "isActive": true,
  "notes": "מתמחה ברובוטיקה",
  "createUser": true,
  "userPassword": "initial-password"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✓ | Instructor name |
| `phone` | string | ✓ | Phone number (min 9 digits) |
| `email` | string | | Email address |
| `rateFrontal` | number | | Hourly rate for frontal lessons |
| `rateOnline` | number | | Hourly rate for online lessons |
| `ratePrivate` | number | | Hourly rate for private lessons |
| `ratePreparation` | number | | Preparation time rate |
| `isActive` | boolean | | Active status (default: true) |
| `createUser` | boolean | | Create login user account |
| `userPassword` | string | | Initial password (if createUser=true) |

#### PUT /instructors/:id
Update instructor.

**Access:** Manager or Admin

#### DELETE /instructors/:id
Delete instructor.

**Access:** Admin only

#### GET /instructors/:id/cycles
Get all cycles taught by instructor.

#### GET /instructors/:id/meetings
Get meetings for instructor.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | enum | scheduled, completed, cancelled, postponed |
| `from` | date | Start date |
| `to` | date | End date |

---

### Branches

Locations where courses are held (schools, community centers, etc.).

#### GET /branches
List all branches.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search by name |
| `type` | enum | school, community_center, frontal, online |
| `city` | string | Filter by city |
| `isActive` | boolean | Filter by active status |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "בית ספר יסודי אלון",
      "type": "school",
      "address": "רחוב האלון 5",
      "city": "רמת גן",
      "contactName": "מנהל בית הספר",
      "contactPhone": "031234567",
      "contactEmail": "school@example.com",
      "isActive": true
    }
  ]
}
```

#### GET /branches/:id
Get single branch.

#### POST /branches
Create new branch.

**Access:** Admin only

**Request Body:**
```json
{
  "name": "בית ספר יסודי אלון",
  "type": "school",
  "address": "רחוב האלון 5",
  "city": "רמת גן",
  "contactName": "מנהל בית הספר",
  "contactPhone": "031234567",
  "contactEmail": "school@example.com",
  "isActive": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✓ | Branch name |
| `type` | enum | ✓ | school, community_center, frontal, online |
| `address` | string | | Street address |
| `city` | string | | City |
| `contactName` | string | | Contact person name |
| `contactPhone` | string | | Contact phone |
| `contactEmail` | string | | Contact email |
| `isActive` | boolean | | Active status |

#### PUT /branches/:id
Update branch.

**Access:** Manager or Admin

#### DELETE /branches/:id
Delete branch.

**Access:** Admin only

#### GET /branches/:id/cycles
Get all cycles at this branch.

---

### Courses

Course types/templates (e.g., "Python Programming", "Robotics").

#### GET /courses
List all courses.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search by name |
| `category` | enum | programming, ai, robotics, printing_3d |
| `isActive` | boolean | Filter by active status |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "תכנות Python למתחילים",
      "description": "קורס מבוא לתכנות בשפת Python",
      "targetAudience": "כיתות ד-ו",
      "category": "programming",
      "isActive": true
    }
  ]
}
```

#### GET /courses/:id
Get single course.

#### POST /courses
Create new course.

**Access:** Admin only

**Request Body:**
```json
{
  "name": "תכנות Python למתחילים",
  "description": "קורס מבוא לתכנות בשפת Python",
  "targetAudience": "כיתות ד-ו",
  "category": "programming",
  "isActive": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✓ | Course name |
| `category` | enum | ✓ | programming, ai, robotics, printing_3d |
| `description` | string | | Detailed description |
| `targetAudience` | string | | Target audience |
| `isActive` | boolean | | Active status |

#### PUT /courses/:id
Update course.

**Access:** Admin only

#### DELETE /courses/:id
Delete course.

**Access:** Admin only

#### GET /courses/:id/cycles
Get all cycles of this course.

---

### Cycles

A cycle is a specific instance of a course with scheduled meetings.

#### GET /cycles
List all cycles.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search by name |
| `from` | date | Start date range |
| `to` | date | End date range |
| `courseId` | UUID | Filter by course |
| `branchId` | UUID | Filter by branch |
| `instructorId` | UUID | Filter by instructor |
| `type` | enum | private, institutional_per_child, institutional_fixed |
| `status` | enum | active, completed, cancelled |
| `dayOfWeek` | enum | sunday-saturday |
| `activityType` | enum | online, frontal, private_lesson |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Python - בית ספר אלון - א2024",
      "courseId": "uuid",
      "branchId": "uuid",
      "instructorId": "uuid",
      "type": "institutional_per_child",
      "status": "active",
      "startDate": "2024-01-15",
      "endDate": "2024-06-15",
      "dayOfWeek": "tuesday",
      "startTime": "14:00",
      "endTime": "15:30",
      "durationMinutes": 90,
      "totalMeetings": 20,
      "completedMeetings": 5,
      "pricePerStudent": 150.00,
      "meetingRevenue": 3000.00,
      "studentCount": 15,
      "maxStudents": 20,
      "activityType": "frontal",
      "sendParentReminders": true,
      "zoomMeetingId": null,
      "zoomJoinUrl": null,
      "course": {...},
      "branch": {...},
      "instructor": {...}
    }
  ]
}
```

#### GET /cycles/:id
Get single cycle with full details.

#### POST /cycles
Create new cycle.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "name": "Python - בית ספר אלון - א2024",
  "courseId": "uuid",
  "branchId": "uuid",
  "instructorId": "uuid",
  "type": "institutional_per_child",
  "startDate": "2024-01-15",
  "endDate": "2024-06-15",
  "dayOfWeek": "tuesday",
  "startTime": "14:00",
  "endTime": "15:30",
  "durationMinutes": 90,
  "totalMeetings": 20,
  "pricePerStudent": 150.00,
  "meetingRevenue": 3000.00,
  "maxStudents": 20,
  "activityType": "frontal",
  "sendParentReminders": true,
  "zoomHostEmail": "zoom@example.com"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✓ | Cycle name |
| `courseId` | UUID | ✓ | Course ID |
| `branchId` | UUID | ✓ | Branch ID |
| `instructorId` | UUID | ✓ | Instructor ID |
| `type` | enum | ✓ | private, institutional_per_child, institutional_fixed |
| `startDate` | date | ✓ | First meeting date |
| `dayOfWeek` | enum | ✓ | sunday-saturday |
| `startTime` | string | ✓ | Start time (HH:MM) |
| `endTime` | string | ✓ | End time (HH:MM) |
| `durationMinutes` | integer | ✓ | Meeting duration |
| `totalMeetings` | integer | ✓ | Total planned meetings |
| `endDate` | date | | Last meeting date |
| `pricePerStudent` | number | | Per-student fee |
| `meetingRevenue` | number | | Revenue per meeting |
| `studentCount` | integer | | Current student count |
| `maxStudents` | integer | | Maximum capacity |
| `activityType` | enum | | online, frontal, private_lesson |
| `sendParentReminders` | boolean | | Send WhatsApp reminders |
| `zoomHostEmail` | string | | Zoom host account email |

#### PUT /cycles/:id
Update cycle.

**Access:** Manager or Admin

#### DELETE /cycles/:id
Soft delete cycle.

**Access:** Manager or Admin

#### GET /cycles/:id/meetings
Get all meetings of a cycle.

#### GET /cycles/:id/registrations
Get all registrations for a cycle.

#### POST /cycles/:id/registrations
Add a student registration to cycle.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "studentId": "uuid",
  "registrationDate": "2024-01-10",
  "status": "registered",
  "amount": 3000.00,
  "paymentStatus": "unpaid",
  "paymentMethod": "credit",
  "notes": "תשלום דחוי"
}
```

#### POST /cycles/:id/generate-meetings
Auto-generate meeting records based on cycle schedule.

**Access:** Manager or Admin

#### POST /cycles/:id/sync-progress
Recalculate completedMeetings count from actual meeting data.

**Access:** Manager or Admin

#### POST /cycles/:id/duplicate
Duplicate cycle with new dates.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "newStartDate": "2024-09-01",
  "newName": "Python - בית ספר אלון - ב2024",
  "copyRegistrations": false,
  "generateMeetings": true
}
```

#### POST /cycles/bulk-update
Update multiple cycles at once.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "ids": ["uuid1", "uuid2", "uuid3"],
  "data": {
    "status": "completed",
    "instructorId": "new-instructor-uuid"
  }
}
```

---

### Meetings

Individual class sessions within a cycle.

#### GET /meetings
List all meetings.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `cycleId` | UUID | Filter by cycle |
| `instructorId` | UUID | Filter by instructor |
| `branchId` | UUID | Filter by branch |
| `status` | enum | scheduled, completed, cancelled, postponed |
| `activityType` | enum | online, frontal, private_lesson |
| `date` | date | Specific date |
| `from` | date | Start date range |
| `to` | date | End date range |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "cycleId": "uuid",
      "instructorId": "uuid",
      "meetingNumber": 5,
      "scheduledDate": "2024-02-15",
      "startTime": "14:00",
      "endTime": "15:30",
      "status": "scheduled",
      "activityType": "frontal",
      "topic": "לולאות ותנאים",
      "notes": null,
      "revenue": 3000.00,
      "instructorPayment": 150.00,
      "profit": 2850.00,
      "zoomMeetingId": null,
      "zoomJoinUrl": null,
      "cycle": {...},
      "instructor": {...}
    }
  ]
}
```

#### GET /meetings/:id
Get single meeting with full details.

#### POST /meetings
Create new meeting.

**Access:** Manager or Admin (requires scope: write:meetings)

**Request Body:**
```json
{
  "cycleId": "uuid",
  "instructorId": "uuid",
  "scheduledDate": "2024-02-15",
  "startTime": "14:00",
  "endTime": "15:30",
  "activityType": "frontal",
  "topic": "לולאות ותנאים",
  "notes": "להכין מחשבים מראש",
  "withZoom": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cycleId` | UUID | ✓ | Parent cycle ID |
| `instructorId` | UUID | ✓ | Instructor ID |
| `scheduledDate` | date | ✓ | Meeting date |
| `startTime` | string | ✓ | Start time (HH:MM) |
| `endTime` | string | ✓ | End time (HH:MM) |
| `activityType` | enum | | online, frontal, private_lesson |
| `topic` | string | | Meeting topic |
| `notes` | string | | Internal notes |
| `withZoom` | boolean | | Create Zoom meeting |

#### PUT /meetings/:id
Update meeting.

**Access:** Manager/Admin, or Instructor (same day only)

#### DELETE /meetings/:id
Soft delete meeting.

**Access:** Manager or Admin

#### GET /meetings/:id/attendance
Get attendance records for meeting.

#### POST /meetings/:id/attendance/bulk
Record attendance for multiple students.

**Request Body:**
```json
{
  "meetingId": "uuid",
  "records": [
    {
      "registrationId": "uuid",
      "status": "present",
      "notes": null
    },
    {
      "studentId": "uuid",
      "status": "absent",
      "notes": "חולה"
    },
    {
      "guestName": "אורח חד פעמי",
      "status": "present",
      "isTrial": true
    }
  ]
}
```

#### POST /meetings/:id/complete
Mark meeting as completed.

**Request Body:**
```json
{
  "notes": "השיעור עבר בהצלחה"
}
```

#### POST /meetings/:id/cancel
Cancel a meeting.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "reason": "מורה חולה"
}
```

#### POST /meetings/:id/postpone
Postpone meeting to new date.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "newDate": "2024-02-22",
  "newStartTime": "14:00",
  "newEndTime": "15:30",
  "notes": "נדחה בגלל חג"
}
```

#### POST /meetings/:id/recalculate
Recalculate meeting financials.

**Access:** Manager or Admin

#### POST /meetings/bulk-recalculate
Recalculate multiple meetings.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "ids": ["uuid1", "uuid2"]
}
```

#### POST /meetings/bulk-update-status
Update status for multiple meetings.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "ids": ["uuid1", "uuid2"],
  "status": "completed"
}
```

#### POST /meetings/bulk-delete
Delete multiple meetings.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "ids": ["uuid1", "uuid2"]
}
```

---

### Registrations

Student enrollments in cycles.

#### GET /registrations
List all registrations.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `studentId` | UUID | Filter by student |
| `cycleId` | UUID | Filter by cycle |
| `customerId` | UUID | Filter by customer (parent) |
| `status` | enum | registered, active, completed, cancelled, trial |
| `paymentStatus` | enum | unpaid, partial, paid |
| `from` | date | Registration date from |
| `to` | date | Registration date to |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "studentId": "uuid",
      "cycleId": "uuid",
      "registrationDate": "2024-01-10",
      "status": "active",
      "amount": 3000.00,
      "paymentStatus": "paid",
      "paymentMethod": "credit",
      "invoiceLink": "https://...",
      "cancellationReason": null,
      "notes": null,
      "student": {...},
      "cycle": {...}
    }
  ]
}
```

#### GET /registrations/:id
Get single registration.

#### POST /registrations
Create new registration.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "studentId": "uuid",
  "cycleId": "uuid",
  "registrationDate": "2024-01-10",
  "status": "registered",
  "amount": 3000.00,
  "paymentStatus": "unpaid",
  "paymentMethod": "credit",
  "notes": "הערות"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `studentId` | UUID | ✓ | Student ID |
| `cycleId` | UUID | ✓ | Cycle ID |
| `registrationDate` | date | | Date of registration |
| `status` | enum | | registered, active, completed, cancelled, trial |
| `amount` | number | | Payment amount |
| `paymentStatus` | enum | | unpaid, partial, paid |
| `paymentMethod` | enum | | credit, transfer, cash |
| `invoiceLink` | URL | | Link to invoice |
| `notes` | string | | Notes |

#### PUT /registrations/:id
Update registration.

**Access:** Manager or Admin

#### DELETE /registrations/:id
Soft delete registration.

**Access:** Manager or Admin

#### GET /registrations/:id/attendance
Get attendance records for registration.

#### POST /registrations/:id/cancel
Cancel registration.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "reason": "ביטול על ידי ההורה"
}
```

#### POST /registrations/:id/payment
Update payment status.

**Access:** Manager or Admin

**Request Body:**
```json
{
  "paymentStatus": "paid",
  "paymentMethod": "credit",
  "amount": 3000.00,
  "invoiceLink": "https://invoice.example.com/123"
}
```

---

### Attendance

Individual attendance records.

#### GET /attendance
List attendance records.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `meetingId` | UUID | Filter by meeting |
| `studentId` | UUID | Filter by student |
| `registrationId` | UUID | Filter by registration |
| `status` | enum | present, absent, late |
| `isTrial` | boolean | Filter trial attendees |
| `from` | date | Date from |
| `to` | date | Date to |

#### GET /attendance/:id
Get single attendance record.

#### POST /attendance
Create attendance record.

**Request Body:**
```json
{
  "meetingId": "uuid",
  "registrationId": "uuid",
  "status": "present",
  "isTrial": false,
  "notes": null
}
```

One of `registrationId`, `studentId`, or `guestName` must be provided.

#### PUT /attendance/:id
Update attendance record.

#### DELETE /attendance/:id
Delete attendance record.

**Access:** Manager or Admin

#### POST /attendance/bulk
Bulk create/update attendance records.

**Request Body:**
```json
{
  "meetingId": "uuid",
  "records": [
    {"registrationId": "uuid", "status": "present"},
    {"studentId": "uuid", "status": "absent"},
    {"guestName": "אורח", "status": "present", "isTrial": true}
  ]
}
```

---

### Reports

Analytics and reporting endpoints.

#### GET /reports/revenue
Revenue report with breakdown.

**Access:** Manager or Admin

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `startDate` | date | Required - Report start date |
| `endDate` | date | Required - Report end date |
| `groupBy` | enum | day, week, month, branch, course, instructor |
| `branchId` | UUID | Filter by branch |
| `courseId` | UUID | Filter by course |
| `instructorId` | UUID | Filter by instructor |

#### GET /reports/revenue/export
Export revenue report to CSV.

**Access:** Manager or Admin

#### GET /reports/instructor-payments
Instructor payment report.

**Access:** Manager or Admin

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `startDate` | date | Required |
| `endDate` | date | Required |
| `instructorId` | UUID | Filter by instructor |
| `status` | enum | Payment status |

#### GET /reports/instructor-payments/export
Export instructor payments to CSV.

**Access:** Manager or Admin

#### GET /reports/attendance
Attendance summary report.

**Access:** Manager or Admin

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `startDate` | date | Required |
| `endDate` | date | Required |
| `cycleId` | UUID | Filter by cycle |
| `branchId` | UUID | Filter by branch |
| `groupBy` | enum | Grouping option |

#### GET /reports/cycle-progress
Cycle progress report.

**Access:** Manager or Admin

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | enum | Cycle status filter |
| `branchId` | UUID | Filter by branch |
| `instructorId` | UUID | Filter by instructor |

#### GET /reports/cycle-progress/export
Export cycle progress to CSV.

**Access:** Manager or Admin

---

### API Keys

Manage API keys for external integrations.

#### GET /api-keys
List all API keys.

**Access:** Admin only

#### GET /api-keys/scopes
Get available scopes list.

**Access:** Admin only

**Response:**
```json
{
  "success": true,
  "data": [
    "*",
    "read:*",
    "write:*",
    "read:customers",
    "write:customers",
    "read:students",
    "write:students",
    "read:courses",
    "write:courses",
    "read:branches",
    "write:branches",
    "read:instructors",
    "write:instructors",
    "read:cycles",
    "write:cycles",
    "read:meetings",
    "write:meetings",
    "read:registrations",
    "write:registrations",
    "read:attendance",
    "write:attendance",
    "read:reports"
  ]
}
```

#### GET /api-keys/:id
Get single API key (includes secret).

**Access:** Admin only

#### POST /api-keys
Create new API key.

**Access:** Admin only

**Request Body:**
```json
{
  "name": "External CRM Integration",
  "scopes": ["read:customers", "read:students", "read:registrations"],
  "rateLimit": 1000,
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✓ | Key name |
| `scopes` | array | | Allowed scopes (default: read:*) |
| `rateLimit` | integer | | Requests per hour (10-100000, default: 1000) |
| `expiresAt` | datetime | | Expiration date (null = never) |

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "External CRM Integration",
    "key": "haitech_xxxx...",
    "scopes": ["read:customers", "read:students", "read:registrations"],
    "rateLimit": 1000,
    "expiresAt": "2025-12-31T23:59:59Z",
    "isActive": true,
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

> ⚠️ **Important:** The full API key is only shown once upon creation. Store it securely!

#### PUT /api-keys/:id
Update API key.

**Access:** Admin only

#### DELETE /api-keys/:id
Delete API key.

**Access:** Admin only

---

### Webhooks

Configure webhooks for event notifications.

#### GET /webhooks
List all webhooks.

**Access:** Admin only

#### GET /webhooks/events
Get available webhook events.

**Access:** Admin only

#### GET /webhooks/deliveries
Get webhook delivery history.

**Access:** Admin only

#### GET /webhooks/:id
Get single webhook (includes secret).

**Access:** Admin only

#### POST /webhooks
Create new webhook.

**Access:** Admin only

**Request Body:**
```json
{
  "url": "https://your-server.com/webhook",
  "events": ["meeting.completed", "registration.created"],
  "isActive": true
}
```

#### POST /webhooks/:id/test
Test webhook with sample payload.

**Access:** Admin only

#### PUT /webhooks/:id
Update webhook.

**Access:** Admin only

#### DELETE /webhooks/:id
Delete webhook.

**Access:** Admin only

---

## Error Handling

All errors follow a consistent format:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  }
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (missing/invalid auth) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 409 | Conflict (duplicate entry) |
| 422 | Unprocessable Entity |
| 429 | Too Many Requests (rate limited) |
| 500 | Internal Server Error |
| 503 | Service Unavailable |

### Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Request validation failed |
| `UNAUTHORIZED` | Authentication required |
| `FORBIDDEN` | Insufficient permissions |
| `NOT_FOUND` | Resource not found |
| `CONFLICT` | Resource already exists |
| `RATE_LIMITED` | Too many requests |
| `INTERNAL_ERROR` | Server error |

---

## Rate Limiting

API requests are rate limited to prevent abuse.

### JWT Authentication
- **1000 requests per hour** per user

### API Key Authentication
- Configurable per key (10-100,000 requests/hour)
- Default: 1000 requests/hour

### Rate Limit Headers

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 1704067200
```

When rate limited, you'll receive HTTP 429:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Try again in 300 seconds.",
    "retryAfter": 300
  }
}
```

---

## Examples

### cURL Examples

**Login:**
```bash
curl -X POST https://api.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'
```

**List Cycles with API Key:**
```bash
curl https://api.example.com/api/v1/cycles \
  -H "X-API-Key: haitech_xxxxx"
```

**Create Meeting:**
```bash
curl -X POST https://api.example.com/api/v1/meetings \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{
    "cycleId": "550e8400-e29b-41d4-a716-446655440000",
    "instructorId": "550e8400-e29b-41d4-a716-446655440001",
    "scheduledDate": "2024-02-15",
    "startTime": "14:00",
    "endTime": "15:30"
  }'
```

### JavaScript/TypeScript

```typescript
const API_BASE = 'https://api.example.com/api/v1';
const API_KEY = 'haitech_xxxxx';

async function listCycles(filters?: { status?: string; branchId?: string }) {
  const params = new URLSearchParams(filters as Record<string, string>);
  
  const response = await fetch(`${API_BASE}/cycles?${params}`, {
    headers: {
      'X-API-Key': API_KEY
    }
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  
  return response.json();
}

async function createRegistration(data: {
  studentId: string;
  cycleId: string;
  amount?: number;
}) {
  const response = await fetch(`${API_BASE}/registrations`, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  
  return response.json();
}
```

### Python

```python
import requests

API_BASE = 'https://api.example.com/api/v1'
API_KEY = 'haitech_xxxxx'

headers = {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json'
}

# List active cycles
response = requests.get(
    f'{API_BASE}/cycles',
    headers=headers,
    params={'status': 'active', 'limit': 50}
)
cycles = response.json()['data']

# Create a registration
registration_data = {
    'studentId': 'uuid-here',
    'cycleId': 'uuid-here',
    'amount': 3000.00,
    'paymentStatus': 'unpaid'
}
response = requests.post(
    f'{API_BASE}/registrations',
    headers=headers,
    json=registration_data
)
new_registration = response.json()['data']
```

---

## Changelog

### v1.0.0 (2024-02)
- Initial release
- Full CRUD for all entities
- JWT and API Key authentication
- Webhook support
- Report endpoints
- Bulk operations

---

*Last updated: February 2024*
