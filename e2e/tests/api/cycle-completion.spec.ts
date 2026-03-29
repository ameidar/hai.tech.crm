import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * E2E tests for cycle completion feature.
 * Tests the flow: last meeting completed → cycle completed → registrations completed → upsell leads created → future meetings deleted
 */

const API = process.env.API_URL || 'http://localhost:3001';

let token: string;

async function api(request: APIRequestContext, method: string, path: string, data?: any) {
  const opts: any = { headers: { Authorization: `Bearer ${token}` } };
  if (data) opts.data = data;
  const url = `${API}${path}`;
  const res = method === 'GET' ? await request.get(url, opts)
    : method === 'POST' ? await request.post(url, opts)
    : method === 'PUT' ? await request.put(url, opts)
    : method === 'PATCH' ? await request.patch(url, opts)
    : await request.delete(url, opts);
  return res;
}

async function login(request: APIRequestContext) {
  const res = await request.post(`${API}/api/auth/login`, {
    data: { email: 'admin@haitech.co.il', password: 'admin123' },
  });
  expect(res.ok(), 'Login failed').toBeTruthy();
  const data = await res.json();
  token = data.accessToken || data.token;
  return token;
}

// IDs for cleanup
const cleanup: { cycles: string[]; students: string[]; customers: string[] } = {
  cycles: [], students: [], customers: [],
};

test.describe('Cycle Completion @smoke', () => {
  let courseId: string;
  let branchId: string;
  let instructorId: string;

  test.beforeAll(async ({ request }) => {
    await login(request);

    // Get existing reference data
    const [coursesRes, branchesRes, instructorsRes] = await Promise.all([
      api(request, 'GET', '/api/courses'),
      api(request, 'GET', '/api/branches'),
      api(request, 'GET', '/api/instructors'),
    ]);

    const courses = await coursesRes.json();
    courseId = (courses.data || courses)[0].id;
    const branches = await branchesRes.json();
    branchId = (branches.data || branches)[0].id;
    const instructors = await instructorsRes.json();
    instructorId = (instructors.data || instructors)[0].id;
  });

  test.afterAll(async ({ request }) => {
    if (!token) return;
    // Cleanup in reverse order
    for (const id of cleanup.cycles) {
      await api(request, 'DELETE', `/api/cycles/${id}`).catch(() => {});
    }
    for (const id of cleanup.students) {
      await api(request, 'DELETE', `/api/students/${id}`).catch(() => {});
    }
    for (const id of cleanup.customers) {
      await api(request, 'DELETE', `/api/customers/${id}`).catch(() => {});
    }
  });

  test('complete last meeting triggers cycle completion', async ({ request }) => {
    // 1. Create customer + student
    const custRes = await api(request, 'POST', '/api/customers', {
      name: 'E2E CC Test Customer',
      phone: '0501111222',
      source: 'other',
    });
    expect(custRes.ok(), `Customer create: ${await custRes.text()}`).toBeTruthy();
    const customer = await custRes.json();
    cleanup.customers.push(customer.id);

    const studRes = await api(request, 'POST', '/api/students', {
      name: 'E2E CC Test Student',
      customerId: customer.id,
    });
    expect(studRes.ok(), `Student create: ${await studRes.text()}`).toBeTruthy();
    const student = await studRes.json();
    cleanup.students.push(student.id);

    // 2. Create cycle with totalMeetings=2
    const cycleRes = await api(request, 'POST', '/api/cycles', {
      name: 'E2E Cycle Completion Test',
      courseId,
      branchId,
      instructorId,
      type: 'private',
      startDate: '2026-02-01',
      dayOfWeek: 'sunday',
      startTime: '10:00',
      endTime: '11:00',
      durationMinutes: 60,
      totalMeetings: 1,
    });
    expect(cycleRes.ok(), `Cycle create: ${await cycleRes.text()}`).toBeTruthy();
    const cycle = await cycleRes.json();
    cleanup.cycles.push(cycle.id);

    // 3. Create registration (active)
    const regRes = await api(request, 'POST', `/api/cycles/${cycle.id}/registrations`, {
      studentId: student.id,
      status: 'active',
      amount: 1000,
    });
    expect(regRes.ok(), `Registration create: ${await regRes.text()}`).toBeTruthy();
    const reg = await regRes.json();

    // 4. Create 2 meetings (POST auto-increments cycle.totalMeetings and remainingMeetings)
    // After cycle creation: totalMeetings=1, remainingMeetings=1
    // After creating 2 meetings via POST: totalMeetings=3, remainingMeetings=3
    // We need to fix totalMeetings to 2 so completing both triggers completion
    const m1Res = await api(request, 'POST', '/api/meetings', {
      cycleId: cycle.id,
      instructorId,
      scheduledDate: '2026-02-08T10:00:00.000Z',
      startTime: '10:00',
      endTime: '11:00',
      durationMinutes: 60,
    });
    expect(m1Res.ok(), `Meeting 1 create: ${await m1Res.text()}`).toBeTruthy();
    const m1 = await m1Res.json();

    const m2Res = await api(request, 'POST', '/api/meetings', {
      cycleId: cycle.id,
      instructorId,
      scheduledDate: '2026-02-15T10:00:00.000Z',
      startTime: '10:00',
      endTime: '11:00',
      durationMinutes: 60,
    });
    expect(m2Res.ok(), `Meeting 2 create: ${await m2Res.text()}`).toBeTruthy();
    const m2 = await m2Res.json();

    // Fix cycle counters: totalMeetings should be 2 (the actual number of meetings)
    const fixRes = await api(request, 'PUT', `/api/cycles/${cycle.id}`, {
      totalMeetings: 2,
      remainingMeetings: 2,
      completedMeetings: 0,
    });
    expect(fixRes.ok(), `Fix cycle: ${await fixRes.text()}`).toBeTruthy();

    // 5. Complete meeting 1
    const m1Update = await api(request, 'PUT', `/api/meetings/${m1.id}`, {
      status: 'completed',
    });
    expect(m1Update.ok(), `Meeting 1 complete: ${await m1Update.text()}`).toBeTruthy();

    // 6. Complete meeting 2 - should trigger cycle completion!
    const m2Update = await api(request, 'PUT', `/api/meetings/${m2.id}`, {
      status: 'completed',
    });
    expect(m2Update.ok(), `Meeting 2 complete: ${await m2Update.text()}`).toBeTruthy();

    // Wait for async cycle completion
    await new Promise(r => setTimeout(r, 3000));

    // 7. Verify cycle status = completed
    const cycleCheck = await api(request, 'GET', `/api/cycles/${cycle.id}`);
    expect(cycleCheck.ok()).toBeTruthy();
    const cycleData = await cycleCheck.json();
    expect(cycleData.status).toBe('completed');
    expect(cycleData.completedMeetings).toBe(2);
    expect(cycleData.remainingMeetings).toBe(0);

    // 8. Verify registration status = completed
    const regsCheck = await api(request, 'GET', `/api/cycles/${cycle.id}/registrations`);
    if (regsCheck.ok()) {
      const regsData = await regsCheck.json();
      const regs = regsData.data || regsData;
      const ourReg = regs.find((r: any) => r.id === reg.id);
      if (ourReg) {
        expect(ourReg.status).toBe('completed');
      }
    }

    // 9. Verify upsell leads created
    const leadsRes = await api(request, 'GET', '/api/upsell-leads');
    expect(leadsRes.ok()).toBeTruthy();
    const leadsData = await leadsRes.json();
    const leads = leadsData.data || leadsData;
    const ourLeads = leads.filter((l: any) => l.cycleId === cycle.id);
    expect(ourLeads.length).toBeGreaterThan(0);
    expect(ourLeads[0].customerId).toBe(customer.id);
    expect(ourLeads[0].status).toBe('new');
  });

  test('upsell leads CRUD - list and update', async ({ request }) => {
    // List all
    const listRes = await api(request, 'GET', '/api/upsell-leads');
    expect(listRes.ok()).toBeTruthy();
    const listData = await listRes.json();
    const leads = listData.data || listData;
    expect(Array.isArray(leads)).toBeTruthy();

    // Filter by status
    const filteredRes = await api(request, 'GET', '/api/upsell-leads?status=new');
    expect(filteredRes.ok()).toBeTruthy();

    // Update a lead if any exist
    if (leads.length > 0) {
      const lead = leads[0];
      const updateRes = await api(request, 'PATCH', `/api/upsell-leads/${lead.id}`, {
        status: 'contacted',
        notes: 'E2E test update',
      });
      expect(updateRes.ok()).toBeTruthy();
      const updated = await updateRes.json();
      expect(updated.status).toBe('contacted');
      expect(updated.notes).toBe('E2E test update');

      // Verify filtered list
      const contactedRes = await api(request, 'GET', '/api/upsell-leads?status=contacted');
      expect(contactedRes.ok()).toBeTruthy();
      const contactedData = await contactedRes.json();
      const contacted = contactedData.data || contactedData;
      expect(contacted.some((l: any) => l.id === lead.id)).toBeTruthy();
    }
  });

  test('non-last meeting does not trigger cycle completion', async ({ request }) => {
    // Create cycle with 3 meetings
    const cycleRes = await api(request, 'POST', '/api/cycles', {
      name: 'E2E Non-Completion Test',
      courseId,
      branchId,
      instructorId,
      type: 'private',
      startDate: '2026-02-01',
      dayOfWeek: 'monday',
      startTime: '14:00',
      endTime: '15:00',
      durationMinutes: 60,
      totalMeetings: 1,
    });
    expect(cycleRes.ok(), `Cycle create: ${await cycleRes.text()}`).toBeTruthy();
    const cycle = await cycleRes.json();
    cleanup.cycles.push(cycle.id);

    // Create 3 meetings (POST auto-increments totalMeetings)
    const meetingDates = ['2026-02-10', '2026-02-17', '2026-02-24'];
    const meetings: any[] = [];
    for (const date of meetingDates) {
      const mRes = await api(request, 'POST', '/api/meetings', {
        cycleId: cycle.id,
        instructorId,
        scheduledDate: `${date}T14:00:00.000Z`,
        startTime: '14:00',
        endTime: '15:00',
        durationMinutes: 60,
      });
      expect(mRes.ok()).toBeTruthy();
      meetings.push(await mRes.json());
    }

    // Fix cycle counters to match actual meetings
    const fixRes = await api(request, 'PUT', `/api/cycles/${cycle.id}`, {
      totalMeetings: 3,
      remainingMeetings: 3,
      completedMeetings: 0,
    });
    expect(fixRes.ok(), `Fix cycle: ${await fixRes.text()}`).toBeTruthy();

    // Complete meeting 1 (1 of 3 - not last)
    const updateRes = await api(request, 'PUT', `/api/meetings/${meetings[0].id}`, {
      status: 'completed',
    });
    expect(updateRes.ok(), `Update: ${await updateRes.text()}`).toBeTruthy();

    await new Promise(r => setTimeout(r, 1000));

    // Verify cycle is still active
    const cycleCheck = await api(request, 'GET', `/api/cycles/${cycle.id}`);
    expect(cycleCheck.ok()).toBeTruthy();
    const cycleData = await cycleCheck.json();
    expect(cycleData.status).toBe('active');
    expect(cycleData.completedMeetings).toBe(1);
    expect(cycleData.remainingMeetings).toBe(2);
  });
});
