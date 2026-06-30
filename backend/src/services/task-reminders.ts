import cron, { ScheduledTask } from 'node-cron';
import { ReminderChannel, TaskPriority } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { sendWhatsApp } from './messaging.js';
import { sendEmail } from './email/sender.js';
import { config } from '../config.js';

const TZ = 'Asia/Jerusalem';
const CHANNELS: ReminderChannel[] = ['email', 'whatsapp'];

let scheduledTask: ScheduledTask | null = null;

const priorityLabels: Record<TaskPriority, string> = {
  low: 'נמוכה',
  normal: 'רגילה',
  high: 'גבוהה',
  urgent: 'דחופה',
};

function taskUrl(id: string) {
  const base = config.frontendUrl && config.frontendUrl !== '*' ? config.frontendUrl : 'https://crm.orma-ai.com';
  return `${base}/tasks?task=${id}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string
  ));
}

function israelDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function israelOffset(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    timeZoneName: 'shortOffset',
  });
  const value = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || 'GMT+2';
  const match = value.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  if (!match) return '+02:00';
  const hours = Number(match[1]);
  const minutes = match[2] || '00';
  return `${hours >= 0 ? '+' : '-'}${String(Math.abs(hours)).padStart(2, '0')}:${minutes}`;
}

function israelLocalDateTimeToUtc(year: number, month: number, day: number, hour: number, minute = 0) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = israelOffset(guess);
  return new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offset}`);
}

export async function rebuildTaskReminders(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      dueDate: true,
      assigneeId: true,
      status: true,
      deletedAt: true,
    },
  });

  await prisma.taskReminder.deleteMany({
    where: { taskId, status: 'pending' },
  });

  if (!task || task.deletedAt || task.status === 'completed' || !task.dueDate || !task.assigneeId) return;

  const now = new Date();
  const { year, month, day } = israelDateParts(task.dueDate);
  const dueMorning = israelLocalDateTimeToUtc(year, month, day, 9, 0);
  const twentyFourHoursBefore = new Date(task.dueDate.getTime() - 24 * 60 * 60 * 1000);
  const remindAtValues = [twentyFourHoursBefore, dueMorning]
    .filter((value) => value > now)
    .filter((value, index, array) => array.findIndex((other) => Math.abs(other.getTime() - value.getTime()) < 60_000) === index);

  if (remindAtValues.length === 0) return;

  await prisma.taskReminder.createMany({
    data: remindAtValues.flatMap((remindAt) => CHANNELS.map((channel) => ({
      taskId,
      channel,
      remindAt,
    }))),
  });
}

async function sendReminder(reminderId: string) {
  const reminder = await prisma.taskReminder.findUnique({
    where: { id: reminderId },
    include: {
      task: {
        include: {
          assignee: { select: { id: true, name: true, email: true, phone: true } },
        },
      },
    },
  });

  if (!reminder || reminder.status !== 'pending') return;

  const task = reminder.task;
  if (task.deletedAt || task.status === 'completed' || !task.assignee) {
    await prisma.taskReminder.update({
      where: { id: reminder.id },
      data: { status: 'failed', failureReason: 'Task is no longer active or has no assignee' },
    });
    return;
  }

  const due = task.dueDate ? new Date(task.dueDate).toLocaleDateString('he-IL', { timeZone: TZ }) : 'לא נקבע';
  const text = [
    `תזכורת למשימה ב-HaiTech CRM: ${task.title}`,
    `עדיפות: ${priorityLabels[task.priority]}`,
    `יעד: ${due}`,
    taskUrl(task.id),
  ].join('\n');

  try {
    if (reminder.channel === 'whatsapp') {
      if (!task.assignee.phone) throw new Error('Assignee has no phone');
      const result = await sendWhatsApp({ phone: task.assignee.phone, message: text });
      if (!result.success) throw new Error(result.error || 'WhatsApp send failed');
    } else {
      if (!task.assignee.email) throw new Error('Assignee has no email');
      await sendEmail({
        to: task.assignee.email,
        subject: `תזכורת למשימה: ${task.title}`,
        text,
        html: `<div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.6;">
          <h2>תזכורת למשימה</h2>
          <p><strong>${escapeHtml(task.title)}</strong></p>
          ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ''}
          <p>עדיפות: ${priorityLabels[task.priority]}</p>
          <p>יעד: ${due}</p>
          <p><a href="${taskUrl(task.id)}">פתיחת המשימה ב-CRM</a></p>
        </div>`,
      });
    }

    await prisma.taskReminder.update({
      where: { id: reminder.id },
      data: { status: 'sent', sentAt: new Date(), failureReason: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await prisma.taskReminder.update({
      where: { id: reminder.id },
      data: { status: 'failed', failureReason: message },
    });
    console.error('[TaskReminders] failed to send reminder:', reminder.id, message);
  }
}

export async function processDueTaskReminders() {
  const reminders = await prisma.taskReminder.findMany({
    where: {
      status: 'pending',
      remindAt: { lte: new Date() },
    },
    select: { id: true },
    orderBy: { remindAt: 'asc' },
    take: 50,
  });

  for (const reminder of reminders) {
    await sendReminder(reminder.id);
  }
}

export function initTaskReminderScheduler() {
  if (scheduledTask) scheduledTask.stop();
  scheduledTask = cron.schedule('*/5 * * * *', () => {
    processDueTaskReminders().catch((error) => {
      console.error('[TaskReminders] scheduler failed:', error);
    });
  }, { timezone: TZ });
  console.log('   ✓ Task reminders: every 5 min → email + WhatsApp');
}

export function stopTaskReminderScheduler() {
  scheduledTask?.stop();
  scheduledTask = null;
}
