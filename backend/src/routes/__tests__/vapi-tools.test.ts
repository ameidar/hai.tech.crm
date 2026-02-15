import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock google-calendar service
vi.mock('../../services/google-calendar.js', () => ({
  getAvailableSlots: vi.fn(),
  bookAppointment: vi.fn(),
}));

// Mock PrismaClient as a class
vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      leadAppointment = {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      };
    },
  };
});

import { vapiToolsRouter } from '../vapi-tools.js';
import { getAvailableSlots, bookAppointment } from '../../services/google-calendar.js';

const app = express();
app.use(express.json());
app.use('/vapi-tools', vapiToolsRouter);

describe('POST /vapi-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles checkAvailability with available slots', async () => {
    vi.mocked(getAvailableSlots).mockResolvedValue(['09:00', '09:30', '10:00']);

    const res = await request(app).post('/vapi-tools').send({
      message: {
        toolCallList: [{
          id: 'tc-1',
          function: { name: 'checkAvailability', arguments: { date: '2026-02-16' } },
        }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.results[0].toolCallId).toBe('tc-1');
    expect(res.body.results[0].result).toContain('09:00');
    expect(res.body.results[0].result).toContain('16/02');
  });

  it('handles checkAvailability with no slots', async () => {
    vi.mocked(getAvailableSlots).mockResolvedValue([]);

    const res = await request(app).post('/vapi-tools').send({
      message: {
        toolCallList: [{
          id: 'tc-2',
          function: { name: 'checkAvailability', arguments: { date: '2026-02-16' } },
        }],
      },
    });

    expect(res.body.results[0].result).toContain('אין שעות פנויות');
  });

  it('handles checkAvailability without date', async () => {
    const res = await request(app).post('/vapi-tools').send({
      message: {
        toolCallList: [{
          id: 'tc-3',
          function: { name: 'checkAvailability', arguments: {} },
        }],
      },
    });

    expect(res.body.results[0].result).toContain('שגיאה');
  });

  it('handles bookAppointment successfully', async () => {
    vi.mocked(bookAppointment).mockResolvedValue({ success: true, eventId: 'evt-1' });

    const res = await request(app).post('/vapi-tools').send({
      message: {
        call: { id: 'call-123' },
        toolCallList: [{
          id: 'tc-4',
          function: {
            name: 'bookAppointment',
            arguments: { date: '2026-02-16', time: '10:00', customerName: 'דוד כהן', phone: '0501234567' },
          },
        }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.results[0].result).toContain('נקבעה בהצלחה');
    expect(res.body.results[0].result).toContain('דוד כהן');
  });

  it('handles bookAppointment with missing fields', async () => {
    const res = await request(app).post('/vapi-tools').send({
      message: {
        toolCallList: [{
          id: 'tc-5',
          function: { name: 'bookAppointment', arguments: { date: '2026-02-16' } },
        }],
      },
    });

    expect(res.body.results[0].result).toContain('שגיאה');
    expect(res.body.results[0].result).toContain('חסרים');
  });

  it('handles bookAppointment failure', async () => {
    vi.mocked(bookAppointment).mockResolvedValue({ success: false, error: 'conflict' });

    const res = await request(app).post('/vapi-tools').send({
      message: {
        toolCallList: [{
          id: 'tc-6',
          function: {
            name: 'bookAppointment',
            arguments: { date: '2026-02-16', time: '10:00', customerName: 'Test' },
          },
        }],
      },
    });

    expect(res.body.results[0].result).toContain('שגיאה');
    expect(res.body.results[0].result).toContain('conflict');
  });

  it('handles unknown function', async () => {
    const res = await request(app).post('/vapi-tools').send({
      message: {
        toolCallList: [{
          id: 'tc-7',
          function: { name: 'unknownTool', arguments: {} },
        }],
      },
    });

    expect(res.body.results[0].result).toContain('Unknown function');
  });

  it('handles string arguments (JSON string)', async () => {
    vi.mocked(getAvailableSlots).mockResolvedValue(['11:00']);

    const res = await request(app).post('/vapi-tools').send({
      message: {
        toolCallList: [{
          id: 'tc-8',
          function: { name: 'checkAvailability', arguments: '{"date":"2026-02-16"}' },
        }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.results[0].result).toContain('11:00');
  });

  it('handles multiple tool calls in one request', async () => {
    vi.mocked(getAvailableSlots).mockResolvedValue(['09:00', '10:00']);
    vi.mocked(bookAppointment).mockResolvedValue({ success: true, eventId: 'e1' });

    const res = await request(app).post('/vapi-tools').send({
      message: {
        toolCallList: [
          { id: 'tc-a', function: { name: 'checkAvailability', arguments: { date: '2026-02-16' } } },
          { id: 'tc-b', function: { name: 'bookAppointment', arguments: { date: '2026-02-16', time: '09:00', customerName: 'Test' } } },
        ],
      },
    });

    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].toolCallId).toBe('tc-a');
    expect(res.body.results[1].toolCallId).toBe('tc-b');
  });
});
