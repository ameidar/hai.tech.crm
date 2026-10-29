import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({ prisma: {} }));

import { buildInstructorPreLessonTemplatePayload } from '../whatsapp-reminder.service.js';

const base = {
  id: 'm1',
  startTime: new Date('1970-01-01T16:30:00.000Z'),
  instructor: { id: 'i1', name: 'ניר', phone: '0500000000' },
  cycle: { name: 'פייתון', branch: { name: 'אונליין B2C' } },
};

describe('instructor_pre_lesson_60m payload', () => {
  it('sends the 6 body params the approved Meta template expects', () => {
    const p = buildInstructorPreLessonTemplatePayload(
      { ...base, zoomJoinUrl: 'https://meet.google.com/abc-defg-hij' }, 'https://crm/link');
    expect(p.bodyParameters).toHaveLength(6);
    expect(p.bodyParameters[4]).toBe('https://meet.google.com/abc-defg-hij');
    expect(p.bodyParameters[5]).toBe('https://crm/link');
  });

  it('fills the video-link slot with a placeholder for frontal lessons', () => {
    const p = buildInstructorPreLessonTemplatePayload(base, 'https://crm/link');
    expect(p.bodyParameters).toHaveLength(6);
    expect(p.bodyParameters[4]).toBe('אין – שיעור פרונטלי');
  });
});
