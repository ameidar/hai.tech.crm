import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    leadAppointment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../services/google-calendar.js', () => ({
  deleteCalendarEvent: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/notifications.js', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/email/sender.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

import { publicAppointmentRouter } from '../public-appointment.js';
import { generateAppointmentToken } from '../../services/appointment-manage.js';
import { errorHandler } from '../../middleware/errorHandler.js';
import { prisma } from '../../utils/prisma.js';
import { deleteCalendarEvent } from '../../services/google-calendar.js';

const app = express();
app.use(express.json());
app.use('/public/appointment', publicAppointmentRouter);
app.use(errorHandler);

const APPT_ID = '11111111-1111-1111-1111-111111111111';
const TOKEN = generateAppointmentToken(APPT_ID);

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

const baseAppointment = {
  id: APPT_ID,
  customerName: 'ישראל ישראלי',
  customerPhone: '0501234567',
  childName: 'דני',
  interest: 'תכנות',
  appointmentDate: futureDate,
  appointmentTime: '10:00',
  appointmentStatus: 'scheduled',
  calendarEventId: 'evt-123',
  cancelledAt: null,
};

describe('GET /public/appointment/:id/:token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an invalid token', async () => {
    const res = await request(app).get(`/public/appointment/${APPT_ID}/wrong-token`);
    expect(res.status).toBe(403);
    expect(vi.mocked(prisma.leadAppointment.findUnique)).not.toHaveBeenCalled();
  });

  it('returns appointment details with a valid token', async () => {
    vi.mocked(prisma.leadAppointment.findUnique).mockResolvedValue(baseAppointment as any);

    const res = await request(app).get(`/public/appointment/${APPT_ID}/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.customerName).toBe('ישראל ישראלי');
    expect(res.body.status).toBe('scheduled');
    expect(res.body.canCancel).toBe(true);
  });

  it('returns 404 for a missing appointment', async () => {
    vi.mocked(prisma.leadAppointment.findUnique).mockResolvedValue(null);

    const res = await request(app).get(`/public/appointment/${APPT_ID}/${TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('reports canCancel=false for a past appointment', async () => {
    vi.mocked(prisma.leadAppointment.findUnique).mockResolvedValue({
      ...baseAppointment,
      appointmentDate: new Date('2026-01-01'),
    } as any);

    const res = await request(app).get(`/public/appointment/${APPT_ID}/${TOKEN}`);
    expect(res.body.canCancel).toBe(false);
  });

  it('reports canCancel=false for a cancelled appointment', async () => {
    vi.mocked(prisma.leadAppointment.findUnique).mockResolvedValue({
      ...baseAppointment,
      appointmentStatus: 'cancelled',
    } as any);

    const res = await request(app).get(`/public/appointment/${APPT_ID}/${TOKEN}`);
    expect(res.body.canCancel).toBe(false);
  });
});

describe('POST /public/appointment/:id/:token/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an invalid token', async () => {
    const res = await request(app).post(`/public/appointment/${APPT_ID}/bad/cancel`);
    expect(res.status).toBe(403);
  });

  it('cancels a future appointment and deletes the calendar event', async () => {
    vi.mocked(prisma.leadAppointment.findUnique).mockResolvedValue(baseAppointment as any);
    vi.mocked(prisma.leadAppointment.update).mockResolvedValue({} as any);

    const res = await request(app)
      .post(`/public/appointment/${APPT_ID}/${TOKEN}/cancel`)
      .send({ reason: 'לא מתאים לי המועד' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(vi.mocked(prisma.leadAppointment.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: APPT_ID },
        data: expect.objectContaining({
          appointmentStatus: 'cancelled',
          cancelReason: 'לא מתאים לי המועד',
        }),
      })
    );
    expect(vi.mocked(deleteCalendarEvent)).toHaveBeenCalledWith('evt-123');
  });

  it('is idempotent for an already-cancelled appointment', async () => {
    vi.mocked(prisma.leadAppointment.findUnique).mockResolvedValue({
      ...baseAppointment,
      appointmentStatus: 'cancelled',
    } as any);

    const res = await request(app).post(`/public/appointment/${APPT_ID}/${TOKEN}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.alreadyCancelled).toBe(true);
    expect(vi.mocked(prisma.leadAppointment.update)).not.toHaveBeenCalled();
  });

  it('refuses to cancel a past appointment', async () => {
    vi.mocked(prisma.leadAppointment.findUnique).mockResolvedValue({
      ...baseAppointment,
      appointmentDate: new Date('2026-01-01'),
    } as any);

    const res = await request(app).post(`/public/appointment/${APPT_ID}/${TOKEN}/cancel`);
    expect(res.status).toBe(400);
    expect(vi.mocked(prisma.leadAppointment.update)).not.toHaveBeenCalled();
  });
});
