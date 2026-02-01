# HaiTech CRM Backend

Backend API for HaiTech CRM - a system for managing coding education business (דרך ההייטק).

## Tech Stack

- **Runtime:** Node.js 22
- **Framework:** Express.js
- **Language:** TypeScript
- **Database:** PostgreSQL 16
- **ORM:** Prisma
- **Auth:** JWT with refresh tokens
- **Validation:** Zod

## Quick Start

### With Docker (Recommended)

```bash
cd /home/opc/clawd/projects/haitech-crm
docker-compose up -d
```

This starts:
- PostgreSQL database on port 5432
- API server on port 3001
- Redis on port 6379

### Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your database credentials

# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Seed initial data
npm run db:seed

# Start development server
npm run dev
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register new user
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout

### Customers
- `GET /api/customers` - List customers
- `POST /api/customers` - Create customer
- `GET /api/customers/:id` - Get customer
- `PUT /api/customers/:id` - Update customer
- `DELETE /api/customers/:id` - Delete customer
- `GET /api/customers/:id/students` - Get customer's students

### Students
- `GET /api/students` - List students
- `POST /api/students` - Create student
- `GET /api/students/:id` - Get student
- `PUT /api/students/:id` - Update student
- `DELETE /api/students/:id` - Delete student

### Courses
- `GET /api/courses` - List courses
- `POST /api/courses` - Create course
- `GET /api/courses/:id` - Get course
- `PUT /api/courses/:id` - Update course
- `DELETE /api/courses/:id` - Delete course

### Branches
- `GET /api/branches` - List branches
- `POST /api/branches` - Create branch
- `GET /api/branches/:id` - Get branch
- `PUT /api/branches/:id` - Update branch
- `DELETE /api/branches/:id` - Delete branch
- `GET /api/branches/:id/orders` - Get institutional orders
- `POST /api/branches/:id/orders` - Create institutional order
- `GET /api/branches/:id/cycles` - Get cycles

### Instructors
- `GET /api/instructors` - List instructors
- `POST /api/instructors` - Create instructor
- `GET /api/instructors/:id` - Get instructor
- `PUT /api/instructors/:id` - Update instructor
- `DELETE /api/instructors/:id` - Delete instructor
- `GET /api/instructors/:id/meetings` - Get instructor's meetings
- `GET /api/instructors/:id/schedule` - Get weekly schedule

### Cycles
- `GET /api/cycles` - List cycles
- `POST /api/cycles` - Create cycle (auto-generates meetings)
- `GET /api/cycles/:id` - Get cycle
- `PUT /api/cycles/:id` - Update cycle
- `DELETE /api/cycles/:id` - Delete cycle
- `GET /api/cycles/:id/meetings` - Get cycle meetings
- `GET /api/cycles/:id/registrations` - Get registrations
- `POST /api/cycles/:id/registrations` - Add registration

### Meetings
- `GET /api/meetings` - List meetings (filter by date, status, instructor)
- `GET /api/meetings/:id` - Get meeting
- `PUT /api/meetings/:id` - Update meeting (status, notes)
- `POST /api/meetings/:id/postpone` - Postpone meeting
- `GET /api/meetings/:id/attendance` - Get attendance

### Registrations
- `GET /api/registrations` - List registrations
- `GET /api/registrations/:id` - Get registration
- `PUT /api/registrations/:id` - Update registration
- `DELETE /api/registrations/:id` - Delete registration
- `POST /api/registrations/:id/cancel` - Cancel registration
- `POST /api/registrations/:id/payment` - Update payment status

### Attendance
- `POST /api/attendance` - Record attendance
- `POST /api/attendance/bulk` - Bulk record attendance
- `PUT /api/attendance/:id` - Update attendance
- `DELETE /api/attendance/:id` - Delete attendance
- `GET /api/attendance/student/:studentId` - Get student attendance summary

## Database Schema

See `schema.sql` for the full PostgreSQL schema, or `prisma/schema.prisma` for the Prisma schema.

### Main Entities
- **Users** - System users (admin, manager, instructor)
- **Customers** - Parents/contacts
- **Students** - Children enrolled in courses
- **Courses** - Course catalog (programming, AI, robotics)
- **Branches** - Locations (schools, community centers, online)
- **Instructors** - Teachers
- **Institutional Orders** - Contracts with schools/organizations
- **Cycles** - Course instances (specific time, place, instructor)
- **Registrations** - Student enrollments in cycles
- **Meetings** - Individual lessons/sessions
- **Attendance** - Attendance records per meeting

## Environment Variables

```env
DATABASE_URL=postgresql://user:password@localhost:5432/haitech_crm
PORT=3001
NODE_ENV=development
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=1d
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRES_IN=7d
```

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run db:generate` - Generate Prisma client
- `npm run db:push` - Push schema to database
- `npm run db:migrate` - Run migrations
- `npm run db:seed` - Seed initial data
- `npm run db:studio` - Open Prisma Studio
