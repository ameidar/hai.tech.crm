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
  | 'inactive_cycle'
  | 'missing_child';

export interface AutoRegisterLeadInput {
  source: string;
  customerId: string;
  childName?: string | null;
  childAge?: string | null;
  grade?: string | null;
  cycleId?: string | null;
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

export async function autoRegisterLeadToCycle(input: AutoRegisterLeadInput): Promise<AutoRegisterLeadResult> {
  if (!shouldAutoRegister(input.source)) {
    return { status: 'skipped', reason: 'source_not_enabled' };
  }

  const cycleId = cleanText(input.cycleId);
  if (!cycleId) {
    return { status: 'skipped', reason: 'missing_cycle_id' };
  }

  const childName = cleanText(input.childName);
  if (!childName) {
    return { status: 'missing_child', reason: 'missing_child_name', cycleId };
  }

  const cycle = await prisma.cycle.findFirst({
    where: { id: cycleId, deletedAt: null },
    select: {
      id: true,
      name: true,
      status: true,
      defaultRegistrationAmount: true,
    },
  });

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
