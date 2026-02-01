-- HaiTech CRM Database Schema
-- PostgreSQL 15+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===================
-- ENUMS
-- ===================

CREATE TYPE user_role AS ENUM ('admin', 'manager', 'instructor');
CREATE TYPE course_category AS ENUM ('programming', 'ai', 'robotics', '3d_printing');
CREATE TYPE branch_type AS ENUM ('school', 'community_center', 'frontal', 'online');
CREATE TYPE order_status AS ENUM ('draft', 'active', 'completed', 'cancelled');
CREATE TYPE cycle_type AS ENUM ('institutional', 'private');
CREATE TYPE cycle_status AS ENUM ('active', 'completed', 'cancelled');
CREATE TYPE day_of_week AS ENUM ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday');
CREATE TYPE registration_status AS ENUM ('registered', 'active', 'completed', 'cancelled');
CREATE TYPE payment_status AS ENUM ('unpaid', 'partial', 'paid');
CREATE TYPE payment_method AS ENUM ('credit', 'transfer', 'cash');
CREATE TYPE meeting_status AS ENUM ('scheduled', 'completed', 'cancelled', 'postponed');
CREATE TYPE attendance_status AS ENUM ('present', 'absent', 'late');

-- ===================
-- TABLES
-- ===================

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    role user_role NOT NULL DEFAULT 'instructor',
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Customers table
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50) UNIQUE NOT NULL,
    address TEXT,
    city VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Students table
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    birth_date DATE,
    grade VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Courses table
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    target_audience VARCHAR(255),
    category course_category NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Branches table
CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    type branch_type NOT NULL,
    address TEXT,
    city VARCHAR(100),
    contact_name VARCHAR(255),
    contact_phone VARCHAR(50),
    contact_email VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Instructors table
CREATE TABLE instructors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255),
    rate_frontal DECIMAL(10, 2),
    rate_online DECIMAL(10, 2),
    rate_preparation DECIMAL(10, 2),
    is_active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Institutional Orders table
CREATE TABLE institutional_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    order_number VARCHAR(100),
    order_date DATE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    price_per_meeting DECIMAL(10, 2) NOT NULL,
    estimated_meetings INTEGER,
    estimated_total DECIMAL(10, 2),
    contact_name VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(50) NOT NULL,
    contact_email VARCHAR(255),
    contract_file VARCHAR(500),
    status order_status NOT NULL DEFAULT 'draft',
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Cycles table
CREATE TABLE cycles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
    institutional_order_id UUID REFERENCES institutional_orders(id) ON DELETE SET NULL,
    type cycle_type NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    day_of_week day_of_week NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration_minutes INTEGER NOT NULL,
    total_meetings INTEGER NOT NULL,
    price_per_student DECIMAL(10, 2),
    max_students INTEGER,
    send_parent_reminders BOOLEAN NOT NULL DEFAULT false,
    is_online BOOLEAN NOT NULL DEFAULT false,
    zoom_host_id VARCHAR(100),
    completed_meetings INTEGER NOT NULL DEFAULT 0,
    remaining_meetings INTEGER NOT NULL DEFAULT 0,
    status cycle_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Registrations table
CREATE TABLE registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    cycle_id UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    registration_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status registration_status NOT NULL DEFAULT 'registered',
    amount DECIMAL(10, 2),
    payment_status payment_status,
    payment_method payment_method,
    invoice_link VARCHAR(500),
    cancellation_date DATE,
    cancellation_reason TEXT,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, cycle_id)
);

-- Meetings table
CREATE TABLE meetings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cycle_id UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
    scheduled_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status meeting_status NOT NULL DEFAULT 'scheduled',
    status_updated_at TIMESTAMP,
    status_updated_by UUID REFERENCES users(id),
    revenue DECIMAL(10, 2) NOT NULL DEFAULT 0,
    instructor_payment DECIMAL(10, 2) NOT NULL DEFAULT 0,
    profit DECIMAL(10, 2) NOT NULL DEFAULT 0,
    topic VARCHAR(500),
    notes TEXT,
    zoom_meeting_id VARCHAR(100),
    zoom_join_url VARCHAR(500),
    zoom_start_url VARCHAR(500),
    rescheduled_to_id UUID REFERENCES meetings(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Attendance table
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    status attendance_status NOT NULL,
    notes TEXT,
    recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
    recorded_by UUID NOT NULL REFERENCES users(id),
    UNIQUE(meeting_id, registration_id)
);

-- ===================
-- INDEXES
-- ===================

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- Customers
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_city ON customers(city);

-- Students
CREATE INDEX idx_students_customer_id ON students(customer_id);
CREATE INDEX idx_students_name ON students(name);

-- Courses
CREATE INDEX idx_courses_category ON courses(category);
CREATE INDEX idx_courses_is_active ON courses(is_active);

-- Branches
CREATE INDEX idx_branches_type ON branches(type);
CREATE INDEX idx_branches_city ON branches(city);
CREATE INDEX idx_branches_is_active ON branches(is_active);

-- Instructors
CREATE INDEX idx_instructors_phone ON instructors(phone);
CREATE INDEX idx_instructors_user_id ON instructors(user_id);
CREATE INDEX idx_instructors_is_active ON instructors(is_active);

-- Institutional Orders
CREATE INDEX idx_institutional_orders_branch_id ON institutional_orders(branch_id);
CREATE INDEX idx_institutional_orders_status ON institutional_orders(status);
CREATE INDEX idx_institutional_orders_start_date ON institutional_orders(start_date);

-- Cycles
CREATE INDEX idx_cycles_course_id ON cycles(course_id);
CREATE INDEX idx_cycles_branch_id ON cycles(branch_id);
CREATE INDEX idx_cycles_instructor_id ON cycles(instructor_id);
CREATE INDEX idx_cycles_institutional_order_id ON cycles(institutional_order_id);
CREATE INDEX idx_cycles_status ON cycles(status);
CREATE INDEX idx_cycles_start_date ON cycles(start_date);
CREATE INDEX idx_cycles_day_of_week ON cycles(day_of_week);

-- Registrations
CREATE INDEX idx_registrations_student_id ON registrations(student_id);
CREATE INDEX idx_registrations_cycle_id ON registrations(cycle_id);
CREATE INDEX idx_registrations_status ON registrations(status);
CREATE INDEX idx_registrations_payment_status ON registrations(payment_status);

-- Meetings
CREATE INDEX idx_meetings_cycle_id ON meetings(cycle_id);
CREATE INDEX idx_meetings_instructor_id ON meetings(instructor_id);
CREATE INDEX idx_meetings_scheduled_date ON meetings(scheduled_date);
CREATE INDEX idx_meetings_status ON meetings(status);
CREATE INDEX idx_meetings_date_status ON meetings(scheduled_date, status);

-- Attendance
CREATE INDEX idx_attendance_meeting_id ON attendance(meeting_id);
CREATE INDEX idx_attendance_registration_id ON attendance(registration_id);

-- ===================
-- TRIGGERS
-- ===================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_instructors_updated_at BEFORE UPDATE ON instructors FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_institutional_orders_updated_at BEFORE UPDATE ON institutional_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_cycles_updated_at BEFORE UPDATE ON cycles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_registrations_updated_at BEFORE UPDATE ON registrations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_meetings_updated_at BEFORE UPDATE ON meetings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
