/**
 * Tap Test - Real API Integration Tests for HaiTech CRM
 * Tests real HTTP endpoints against real database
 */

import { test, expect, describe, beforeAll, afterAll } from 'vitest';

const BASE_URL = process.env.CRM_URL || 'http://localhost:3002';
const TEST_PREFIX = 'TAP_TEST_';
let authToken: string;

// Helper functions
async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@haitech.co.il',
      password: 'admin123'
    })
  });
  const data = await res.json();
  return data.accessToken;
}

async function api(method: string, path: string, body?: any) {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    ...(body && { body: JSON.stringify(body) })
  });
  
  // Handle empty responses (204 No Content)
  const text = await res.text();
  if (!text) return { _status: res.status };
  
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text, _status: res.status };
  }
}

async function cleanupTestData() {
  // Delete test customers (cascade deletes students, registrations)
  const customers = await api('GET', `/customers?search=${TEST_PREFIX}&limit=100`);
  for (const customer of customers.data || []) {
    await api('DELETE', `/customers/${customer.id}`);
  }
  
  // Delete test cycles first (before instructors)
  const cycles = await api('GET', `/cycles?search=${TEST_PREFIX}&limit=100`);
  for (const cycle of cycles.data || []) {
    // Delete meetings first
    const meetings = await api('GET', `/cycles/${cycle.id}/meetings`);
    for (const meeting of meetings || []) {
      await api('DELETE', `/meetings/${meeting.id}`);
    }
    await api('DELETE', `/cycles/${cycle.id}`);
  }
  
  // Delete test instructors last
  const instructors = await api('GET', `/instructors?search=${TEST_PREFIX}&limit=100`);
  for (const instructor of instructors.data || []) {
    await api('DELETE', `/instructors/${instructor.id}`);
  }
}

// Get existing entities for testing
let existingInstructorId: string;
let existingBranchId: string;
let existingCourseId: string;

describe('HaiTech CRM - Tap Tests', () => {
  beforeAll(async () => {
    authToken = await login();
    expect(authToken).toBeTruthy();
    await cleanupTestData();
    
    // Get existing entities for use in tests
    const instructors = await api('GET', '/instructors?limit=1');
    existingInstructorId = instructors.data?.[0]?.id;
    
    const branches = await api('GET', '/branches?limit=1');
    existingBranchId = branches.data?.[0]?.id;
    
    const courses = await api('GET', '/courses?limit=1');
    existingCourseId = courses.data?.[0]?.id;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe('Authentication', () => {
    test('should login with valid credentials', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@haitech.co.il',
          password: 'admin123'
        })
      });
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.accessToken).toBeTruthy();
      expect(data.user.email).toBe('admin@haitech.co.il');
      expect(data.user.role).toBe('admin');
    });

    test('should reject invalid credentials', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@haitech.co.il',
          password: 'wrongpassword'
        })
      });
      
      expect(res.status).toBe(401);
    });

    test('should reject unauthenticated requests', async () => {
      const res = await fetch(`${BASE_URL}/api/cycles`);
      expect(res.status).toBe(401);
    });
  });

  describe('Instructors CRUD', () => {
    let testInstructorId: string;

    test('should create instructor', async () => {
      const data = await api('POST', '/instructors', {
        name: `${TEST_PREFIX}מדריך בדיקה`,
        phone: '0501234567',
        email: 'taptest@test.com',
        rateFrontal: 150,
        rateOnline: 130,
        ratePrivate: 200,
        employmentType: 'freelancer',
        isActive: true
      });

      expect(data.id).toBeTruthy();
      expect(data.name).toBe(`${TEST_PREFIX}מדריך בדיקה`);
      expect(parseFloat(data.rateFrontal)).toBe(150);
      testInstructorId = data.id;
    });

    test('should get instructor by ID', async () => {
      expect(testInstructorId).toBeTruthy();
      const data = await api('GET', `/instructors/${testInstructorId}`);
      
      expect(data.id).toBe(testInstructorId);
      expect(data.name).toBe(`${TEST_PREFIX}מדריך בדיקה`);
    });

    test('should update instructor', async () => {
      expect(testInstructorId).toBeTruthy();
      const data = await api('PUT', `/instructors/${testInstructorId}`, {
        rateFrontal: 200
      });
      
      expect(parseFloat(data.rateFrontal)).toBe(200);
    });

    test('should list instructors', async () => {
      const data = await api('GET', '/instructors?limit=100');
      
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
      const testInstructor = data.data.find((i: any) => i.id === testInstructorId);
      expect(testInstructor).toBeTruthy();
    });

    test('should delete instructor', async () => {
      expect(testInstructorId).toBeTruthy();
      const data = await api('DELETE', `/instructors/${testInstructorId}`);
      expect(data._status).toBe(204);
      
      // Verify deleted
      const check = await api('GET', `/instructors/${testInstructorId}`);
      expect(check.error || check._status === 404).toBeTruthy();
    });
  });

  describe('Customers & Students', () => {
    let testCustomerId: string;
    let testStudentId: string;

    test('should create customer', async () => {
      const data = await api('POST', '/customers', {
        name: `${TEST_PREFIX}לקוח בדיקה`,
        phone: '0509876543',
        email: 'tapcustomer@test.com'
      });

      expect(data.id).toBeTruthy();
      expect(data.name).toBe(`${TEST_PREFIX}לקוח בדיקה`);
      testCustomerId = data.id;
    });

    test('should add student to customer', async () => {
      expect(testCustomerId).toBeTruthy();
      const data = await api('POST', `/customers/${testCustomerId}/students`, {
        name: `${TEST_PREFIX}תלמיד בדיקה`,
        grade: 'ה'
      });

      expect(data.id).toBeTruthy();
      expect(data.name).toBe(`${TEST_PREFIX}תלמיד בדיקה`);
      expect(data.customerId).toBe(testCustomerId);
      testStudentId = data.id;
    });

    test('should get customer with students', async () => {
      expect(testCustomerId).toBeTruthy();
      const data = await api('GET', `/customers/${testCustomerId}`);
      
      expect(data.students).toBeTruthy();
      expect(data.students.length).toBeGreaterThan(0);
      expect(data.students[0].id).toBe(testStudentId);
    });
  });

  describe('Cycles & Meetings', () => {
    let testCycleId: string;
    let testInstructorId: string;

    beforeAll(async () => {
      // Create a test instructor for cycles
      const instructor = await api('POST', '/instructors', {
        name: `${TEST_PREFIX}מדריך למחזורים`,
        phone: '0507654321',
        email: 'tapcycle@test.com',
        rateFrontal: 150,
        rateOnline: 130,
        employmentType: 'freelancer',
        isActive: true
      });
      testInstructorId = instructor.id;
    });

    test('should create cycle', async () => {
      // Skip if missing required entities
      if (!testInstructorId || !existingBranchId || !existingCourseId) {
        console.log('Skipping - missing required entities', { testInstructorId, existingBranchId, existingCourseId });
        return;
      }

      const startDate = new Date();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 3);

      const data = await api('POST', '/cycles', {
        name: `${TEST_PREFIX}מחזור בדיקה`,
        instructorId: testInstructorId,
        branchId: existingBranchId,
        courseId: existingCourseId,
        type: 'private',
        dayOfWeek: 'sunday',
        startTime: '16:00',
        endTime: '17:00',
        durationMinutes: 60,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        totalMeetings: 12,
        pricePerStudent: 2500,
        activityType: 'frontal'
      });

      if (data.error) {
        console.log('Cycle creation error:', data);
      }
      
      expect(data.id).toBeTruthy();
      expect(data.name).toBe(`${TEST_PREFIX}מחזור בדיקה`);
      testCycleId = data.id;
    });

    test('should get cycle details', async () => {
      if (!testCycleId) {
        console.log('Skipping - no test cycle');
        return;
      }
      
      const data = await api('GET', `/cycles/${testCycleId}`);
      
      expect(data.id).toBe(testCycleId);
      expect(data.instructor).toBeTruthy();
      expect(data.branch).toBeTruthy();
    });

    test('should list cycle meetings', async () => {
      if (!testCycleId) {
        console.log('Skipping - no test cycle');
        return;
      }
      
      const data = await api('GET', `/cycles/${testCycleId}/meetings`);
      expect(Array.isArray(data)).toBe(true);
    });

    test('should update meeting status', async () => {
      if (!testCycleId) {
        console.log('Skipping - no test cycle');
        return;
      }
      
      const meetings = await api('GET', `/cycles/${testCycleId}/meetings`);
      if (meetings.length > 0) {
        const meetingId = meetings[0].id;
        const data = await api('PUT', `/meetings/${meetingId}`, {
          status: 'completed'
        });
        
        expect(data.status).toBe('completed');
      }
    });
  });

  describe('Registrations', () => {
    let testCycleId: string;
    let testStudentId: string;
    let testRegistrationId: string;

    beforeAll(async () => {
      // Get test cycle and student created earlier
      const cycles = await api('GET', `/cycles?search=${TEST_PREFIX}&limit=1`);
      testCycleId = cycles.data?.[0]?.id;

      const customers = await api('GET', `/customers?search=${TEST_PREFIX}&limit=1`);
      if (customers.data?.[0]) {
        const customer = await api('GET', `/customers/${customers.data[0].id}`);
        testStudentId = customer.students?.[0]?.id;
      }
    });

    test('should create registration', async () => {
      if (!testCycleId || !testStudentId) {
        console.log('Skipping - no test cycle or student');
        return;
      }

      const data = await api('POST', `/cycles/${testCycleId}/registrations`, {
        studentId: testStudentId,
        amount: 2500,
        paymentStatus: 'paid',
        paymentMethod: 'credit'
      });

      expect(data.id).toBeTruthy();
      expect(data.studentId).toBe(testStudentId);
      expect(data.cycleId).toBe(testCycleId);
      testRegistrationId = data.id;
    });

    test('should list cycle registrations', async () => {
      if (!testCycleId) {
        console.log('Skipping - no test cycle');
        return;
      }

      const data = await api('GET', `/cycles/${testCycleId}/registrations`);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Expenses', () => {
    let testCycleId: string;
    let testExpenseId: string;

    beforeAll(async () => {
      const cycles = await api('GET', `/cycles?search=${TEST_PREFIX}&limit=1`);
      testCycleId = cycles.data?.[0]?.id;
      console.log('Expenses test - found cycle:', testCycleId);
    });

    test('should create cycle expense', async () => {
      if (!testCycleId) {
        console.log('Skipping - no test cycle');
        return;
      }

      const data = await api('POST', '/expenses/cycle', {
        cycleId: testCycleId,
        type: 'materials',
        description: `${TEST_PREFIX}חומרים לבדיקה`,
        amount: 100
      });

      if (data.error) {
        console.log('Expense creation error:', data);
      }
      
      expect(data.id).toBeTruthy();
      expect(data.type).toBe('materials');
      expect(parseFloat(data.amount)).toBe(100);
      testExpenseId = data.id;
    });

    test('should list cycle expenses', async () => {
      if (!testCycleId) {
        console.log('Skipping - no test cycle');
        return;
      }

      const data = await api('GET', `/expenses/cycle/${testCycleId}`);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Health & API Status', () => {
    test('should return healthy status', async () => {
      const res = await fetch(`${BASE_URL}/api/health`);
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.database).toBe('connected');
    });
  });
});
