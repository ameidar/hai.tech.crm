import { prisma } from '../utils/prisma.js';
import { recalcMeetingRevenue } from '../utils/recalcMeetingRevenue.js';
import { defaultRegistrationAmountForCycle } from '../utils/registration-amount.js';
import { Prisma } from '@prisma/client';

const AUTO_REGISTRATION_SOURCES = new Set([
  'omer-dafna-registration-form',
]);

type AutoRegistrationStatus =
  | 'skipped'
  | 'registered'
  | 'already_registered'
  | 'invalid_cycle'
  | 'ambiguous_cycle'
  | 'inactive_cycle'
  | 'missing_child';

export interface AutoRegisterLeadInput {
  source: string;
  customerId: string;
  childName?: string | null;
  childAge?: string | null;
  grade?: string | null;
  cycleId?: string | null;
  cycleLabel?: string | null;
  interest?: string | null;
}

export interface AutoRegisterLeadResult {
  status: AutoRegistrationStatus;
  reason?: string;
  cycleId?: string;
  studentId?: string;
  registrationId?: string;
}

function cleanText(value?: string | null): string {
  return String(value ?? '').trim();
}

function shouldAutoRegister(source: string): boolean {
  return AUTO_REGISTRATION_SOURCES.has(source) || source.startsWith('campaign:');
}

function parseChildAge(value?: string | null): number | undefined {
  const cleaned = cleanText(value);
  if (!cleaned) return undefined;
  const match = cleaned.match(/\d+/);
  if (!match) return undefined;
  const age = Number(match[0]);
  return Number.isInteger(age) && age > 0 && age < 25 ? age : undefined;
}

function normalizeText(value?: string | null): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[״"׳']/g, '')
    .replace(/[־–—|·,.;:()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTime(value: string): string | null {
  const match = value.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!match) return null;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function timeValue(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function dayFromLabel(value: string) {
  const normalized = normalizeText(value);
  if (/ראשון|יום א\b/.test(normalized)) return 'sunday';
  if (/שני|יום ב\b/.test(normalized)) return 'monday';
  if (/שלישי|יום ג\b/.test(normalized)) return 'tuesday';
  if (/רביעי|יום ד\b/.test(normalized)) return 'wednesday';
  if (/חמישי|יום ה\b/.test(normalized)) return 'thursday';
  if (/שישי|יום ו\b/.test(normalized)) return 'friday';
  if (/שבת/.test(normalized)) return 'saturday';
  return null;
}

function meaningfulTokens(value: string): string[] {
  const stopWords = new Set([
    'עומר',
    'יום',
    'כיתה',
    'כיתות',
    'מתחיל',
    'מתחילה',
    'חוג',
    'קורס',
    'עם',
    'ו',
  ]);

  return normalizeText(value)
    .split(' ')
    .filter(token => token.length >= 2 && !stopWords.has(token) && !/^\d+$/.test(token));
}

function tokenVariants(token: string): string[] {
  if (token === 'סטארטאפ' || token === 'startup') return [token, 'יזמות'];
  if (token === 'יזמות') return [token, 'סטארטאפ', 'startup'];
  return [token];
}

async function resolveCycle(input: AutoRegisterLeadInput) {
  const requestedCycleId = cleanText(input.cycleId);
  const label = [input.cycleLabel, input.interest].map(cleanText).filter(Boolean).join(' ');

  if (requestedCycleId) {
    const byId = await prisma.cycle.findFirst({
      where: { id: requestedCycleId, deletedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        defaultRegistrationAmount: true,
      },
    });

    if (byId) return { cycle: byId, requestedCycleId };
  }

  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel) return { cycle: null, requestedCycleId };

  const requestedDay = dayFromLabel(normalizedLabel);
  const requestedTime = extractTime(label);
  const tokens = meaningfulTokens(normalizedLabel);

  const candidates = await prisma.cycle.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      OR: [
        { name: { contains: 'עומר', mode: 'insensitive' } },
        { branch: { name: { contains: 'עומר', mode: 'insensitive' } } },
      ],
    },
    select: {
      id: true,
      name: true,
      status: true,
      defaultRegistrationAmount: true,
      dayOfWeek: true,
      startTime: true,
      course: { select: { name: true } },
      branch: { select: { name: true } },
    },
  });

  const ranked = candidates
    .map(cycle => {
      const haystack = normalizeText(`${cycle.name} ${cycle.course?.name ?? ''} ${cycle.branch?.name ?? ''}`);
      const tokenMatches = tokens.filter(token => tokenVariants(token).some(variant => haystack.includes(variant))).length;
      const dayMatches = requestedDay && cycle.dayOfWeek === requestedDay;
      const timeMatches = requestedTime && timeValue(cycle.startTime) === requestedTime;
      const score = tokenMatches + (dayMatches ? 5 : 0) + (timeMatches ? 5 : 0);
      return { cycle, score, tokenMatches, dayMatches, timeMatches };
    })
    .filter(item =>
      item.score >= 6 &&
      item.tokenMatches > 0 &&
      (!requestedDay || item.dayMatches) &&
      (!requestedTime || item.timeMatches)
    )
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return { cycle: null, requestedCycleId };
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
    return { cycle: null, requestedCycleId, ambiguous: true };
  }

  return { cycle: ranked[0].cycle, requestedCycleId };
}

export async function autoRegisterLeadToCycle(input: AutoRegisterLeadInput): Promise<AutoRegisterLeadResult> {
  if (!shouldAutoRegister(input.source)) {
    return { status: 'skipped', reason: 'source_not_enabled' };
  }

  const { cycle, requestedCycleId, ambiguous } = await resolveCycle(input);
  if (!cycle && ambiguous) {
    return { status: 'ambiguous_cycle', reason: 'cycle_label_ambiguous', cycleId: requestedCycleId };
  }

  const cycleId = cycle?.id ?? requestedCycleId;
  const childName = cleanText(input.childName);
  if (!childName) {
    return { status: 'missing_child', reason: 'missing_child_name', cycleId };
  }

  if (!cycle) {
    return { status: 'invalid_cycle', reason: 'cycle_not_found', cycleId };
  }

  if (cycle.status !== 'active') {
    return { status: 'inactive_cycle', reason: `cycle_status_${cycle.status}`, cycleId };
  }

  const studentNotes = [
    input.childAge ? `גיל: ${cleanText(input.childAge)}` : null,
    input.grade ? `כיתה: ${cleanText(input.grade)}` : null,
    input.interest ? `תחום עניין: ${cleanText(input.interest)}` : null,
    `מקור: ${input.source}`,
  ].filter(Boolean).join(' | ');

  let student = await prisma.student.findFirst({
    where: {
      customerId: input.customerId,
      deletedAt: null,
      name: childName,
    },
    select: { id: true },
  });

  if (!student) {
    student = await prisma.student.create({
      data: {
        customerId: input.customerId,
        name: childName,
        age: parseChildAge(input.childAge),
        grade: cleanText(input.grade) || undefined,
        notes: studentNotes || undefined,
      },
      select: { id: true },
    });
  }

  const existingRegistration = await prisma.registration.findFirst({
    where: {
      studentId: student.id,
      cycleId: cycle.id,
      deletedAt: null,
      status: { notIn: ['cancelled', 'pending_cancellation'] },
    },
    select: { id: true },
  });

  if (existingRegistration) {
    return {
      status: 'already_registered',
      cycleId: cycle.id,
      studentId: student.id,
      registrationId: existingRegistration.id,
    };
  }

  let registration: { id: string };
  try {
    registration = await prisma.registration.create({
      data: {
        studentId: student.id,
        cycleId: cycle.id,
        status: 'registered',
        paymentStatus: 'unpaid',
        amount: defaultRegistrationAmountForCycle(cycle),
        notes: `נוצר אוטומטית מטופס ${input.source}`,
      },
      select: { id: true },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }

    const conflictingRegistration = await prisma.registration.findFirst({
      where: {
        studentId: student.id,
        cycleId: cycle.id,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!conflictingRegistration) {
      throw error;
    }

    return {
      status: 'already_registered',
      cycleId: cycle.id,
      studentId: student.id,
      registrationId: conflictingRegistration.id,
    };
  }

  recalcMeetingRevenue(cycle.id)
    .catch(err => console.error('[lead-cycle-registration] failed to recalculate cycle revenue:', err));

  return {
    status: 'registered',
    cycleId: cycle.id,
    studentId: student.id,
    registrationId: registration.id,
  };
}
