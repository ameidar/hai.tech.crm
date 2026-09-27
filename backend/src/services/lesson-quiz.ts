import { randomBytes } from 'node:crypto';
import OpenAI from 'openai';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { queueEmail, EmailPriority } from './email/queue.js';
import { sendGreenApiMessage } from './green-api-client.js';
import { broadcastWaSSE } from './wa-events.js';

const PUBLIC_BASE_URL = () => process.env.FRONTEND_URL || 'https://crm.orma-ai.com';

const quizQuestionSchema = z.object({
  id: z.preprocess((value) => {
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'string') return value.trim();
    return value;
  }, z.string().min(1)),
  question: z.string().min(8),
  options: z.array(z.string().min(1)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(4),
});

const quizQuestionsSchema = z.array(quizQuestionSchema).min(3).max(8);

type QuizQuestion = z.infer<typeof quizQuestionSchema>;

export interface PublicQuizQuestion {
  id: string;
  question: string;
  options: string[];
}

function openaiClient() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('OPENAI_API_KEY is not configured');
  return new OpenAI({ apiKey: key });
}

function createToken() {
  return randomBytes(24).toString('base64url');
}

function extractJsonArray(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || content;
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('OpenAI did not return a JSON array');
  }
  return raw.slice(start, end + 1);
}

export function normalizeQuestions(value: unknown): QuizQuestion[] {
  const questions = quizQuestionsSchema.parse(value);
  return questions.map((question, index) => ({
    ...question,
    id: question.id || `q${index + 1}`,
    options: question.options.map((option) => option.trim()),
  }));
}

function publicQuestions(questions: QuizQuestion[]): PublicQuizQuestion[] {
  return questions.map(({ id, question, options }) => ({ id, question, options }));
}

function formatDate(date: Date) {
  return date.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
}

function formatTime(time: Date) {
  return time.toISOString().slice(11, 16);
}

function quizUrl(token: string) {
  return `${PUBLIC_BASE_URL()}/lesson-quiz/${token}`;
}

function normalizeWhatsAppPhone(phone: string | null | undefined): string | null {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  return `972${digits}`;
}

function formatPhoneForGreenApi(phone: string) {
  return `${phone}@c.us`;
}

function questionsFromJson(value: Prisma.JsonValue): QuizQuestion[] {
  return normalizeQuestions(value);
}

export function buildParentQuizMessage(params: {
  parentName?: string | null;
  studentName?: string | null;
  instructorName?: string | null;
  cycleName?: string | null;
  url: string;
}) {
  const parentName = params.parentName?.trim();
  const studentName = params.studentName?.trim() || 'הילד/ה';
  const greeting = parentName ? `שלום ${parentName},` : 'שלום,';
  const instructorLine = params.instructorName ? ` עם ${params.instructorName}` : '';
  const cycleLine = params.cycleName ? ` (${params.cycleName})` : '';

  return [
    greeting,
    `הכנו ל${studentName} חידון קצר אחרי השיעור${instructorLine}${cycleLine}, כדי לבדוק שהחומר הובן בצורה טובה.`,
    'החידון אמריקאי וקצר, וייקח כמה דקות לענות עליו:',
    params.url,
    '',
    'אחרי השליחה המדריך יקבל את התשובות והציון ויוכל לדעת אם צריך לחזק משהו בשיעור הבא.',
    'דרך ההייטק',
  ].join('\n');
}

async function generateQuestions(params: {
  summary: string;
  transcript?: string | null;
  cycleName?: string | null;
  courseName?: string | null;
  instructorName?: string | null;
}) {
  const openai = openaiClient();
  const response = await openai.chat.completions.create({
    model: process.env.LESSON_QUIZ_MODEL || process.env.LESSON_REPORT_MODEL || 'gpt-4o',
    temperature: 0.25,
    max_tokens: 1400,
    messages: [
      {
        role: 'system',
        content: `אתה יוצר חידוני הבנה לילדים אחרי שיעורי תכנות של דרך ההייטק.
כתוב בעברית פשוטה, חיובית וברורה לילדים.
החידון חייב לבדוק הבנה של מה שבאמת נלמד בשיעור, לא ידע כללי.
החזר JSON בלבד: מערך של 5 שאלות. לכל שאלה:
id, question, options עם בדיוק 4 תשובות, correctIndex בין 0 ל-3, explanation קצר.`,
      },
      {
        role: 'user',
        content: [
          `מחזור: ${params.cycleName || '-'}`,
          `קורס: ${params.courseName || '-'}`,
          `מדריך: ${params.instructorName || '-'}`,
          '',
          'סיכום שיעור:',
          params.summary,
          '',
          'תמלול שיעור, אם צריך לדייק:',
          params.transcript?.slice(0, 12000) || '-',
        ].join('\n'),
      },
    ],
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) throw new Error('OpenAI returned an empty quiz');
  return normalizeQuestions(JSON.parse(extractJsonArray(content)));
}

export async function generateLessonQuizForMeeting(meetingId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      cycle: { include: { course: true } },
      instructor: true,
      registration: { include: { student: { include: { customer: true } } } },
    },
  });

  if (!meeting) throw new Error('Meeting not found');
  if (!meeting.lessonSummary && !meeting.lessonTranscript) {
    throw new Error('Cannot generate quiz without lesson summary or transcript');
  }

  try {
    const questions = await generateQuestions({
      summary: meeting.lessonSummary || meeting.lessonTranscript || '',
      transcript: meeting.lessonTranscript,
      cycleName: meeting.cycle?.name,
      courseName: meeting.cycle?.course?.name,
      instructorName: meeting.instructor?.name,
    });

    const existing = await prisma.lessonQuiz.findUnique({
      where: { meetingId },
      select: { token: true },
    });

    return prisma.lessonQuiz.upsert({
      where: { meetingId },
      create: {
        meetingId,
        token: createToken(),
        status: 'ready',
        questions: questions as unknown as Prisma.InputJsonValue,
        totalQuestions: questions.length,
        instructorEmailSnapshot: meeting.instructor?.email || null,
        studentNameSnapshot: meeting.registration?.student?.name || null,
        parentSentAt: null,
        parentSentToPhone: null,
        parentMessageId: null,
        parentSendError: null,
        generationError: null,
      },
      update: {
        token: existing?.token || createToken(),
        status: 'ready',
        questions: questions as unknown as Prisma.InputJsonValue,
        answers: Prisma.JsonNull,
        score: null,
        totalQuestions: questions.length,
        submittedAt: null,
        instructorEmailSnapshot: meeting.instructor?.email || null,
        studentNameSnapshot: meeting.registration?.student?.name || null,
        emailSentAt: null,
        emailError: null,
        parentSentAt: null,
        parentSentToPhone: null,
        parentMessageId: null,
        parentSendError: null,
        generationError: null,
      },
    });
  } catch (error: any) {
    await prisma.lessonQuiz.upsert({
      where: { meetingId },
      create: {
        meetingId,
        token: createToken(),
        status: 'failed',
        questions: [],
        totalQuestions: 0,
        instructorEmailSnapshot: meeting.instructor?.email || null,
        studentNameSnapshot: meeting.registration?.student?.name || null,
        parentSentAt: null,
        parentSentToPhone: null,
        parentMessageId: null,
        parentSendError: null,
        generationError: error.message || 'Quiz generation failed',
      },
      update: {
        status: 'failed',
        generationError: error.message || 'Quiz generation failed',
      },
    });
    throw error;
  }
}

export async function getMeetingQuiz(meetingId: string) {
  const quiz = await prisma.lessonQuiz.findUnique({
    where: { meetingId },
    include: {
      meeting: {
        include: {
          cycle: true,
          instructor: true,
          registration: { include: { student: { include: { customer: true } } } },
        },
      },
    },
  });
  if (!quiz) return null;
  const parentPhone = normalizeWhatsAppPhone(quiz.meeting.registration?.student?.customer?.phone);
  const url = quizUrl(quiz.token);
  return {
    ...quiz,
    url,
    questions: questionsFromJson(quiz.questions),
    parentName: quiz.meeting.registration?.student?.customer?.name || null,
    parentPhone,
    parentMessagePreview: parentPhone
      ? buildParentQuizMessage({
          parentName: quiz.meeting.registration?.student?.customer?.name,
          studentName: quiz.studentNameSnapshot || quiz.meeting.registration?.student?.name,
          instructorName: quiz.meeting.instructor?.name,
          cycleName: quiz.meeting.cycle?.name,
          url,
        })
      : null,
  };
}

export async function getPublicLessonQuiz(token: string) {
  const quiz = await prisma.lessonQuiz.findUnique({
    where: { token },
    include: {
      meeting: {
        include: {
          cycle: { include: { course: true } },
          instructor: true,
          registration: { include: { student: true } },
        },
      },
    },
  });

  if (!quiz || quiz.status === 'failed') return null;
  const questions = questionsFromJson(quiz.questions);
  return {
    token: quiz.token,
    status: quiz.status,
    submittedAt: quiz.submittedAt,
    score: quiz.score,
    totalQuestions: quiz.totalQuestions,
    studentName: quiz.studentNameSnapshot || quiz.meeting.registration?.student?.name || null,
    instructorName: quiz.meeting.instructor?.name || null,
    cycleName: quiz.meeting.cycle?.name || null,
    courseName: quiz.meeting.cycle?.course?.name || null,
    scheduledDate: quiz.meeting.scheduledDate,
    answers: quiz.submittedAt ? quiz.answers : null,
    questions: quiz.submittedAt ? questions : publicQuestions(questions),
  };
}

export async function submitLessonQuiz(token: string, answers: Record<string, number>) {
  const quiz = await prisma.lessonQuiz.findUnique({
    where: { token },
    include: {
      meeting: {
        include: {
          cycle: { include: { course: true } },
          instructor: true,
          registration: { include: { student: { include: { customer: true } } } },
        },
      },
    },
  });

  if (!quiz || quiz.status === 'failed') throw new Error('Quiz not found');
  if (quiz.submittedAt) throw new Error('Quiz already submitted');

  const questions = questionsFromJson(quiz.questions);
  const missingAnswer = questions.find((question) => typeof answers[question.id] !== 'number');
  if (missingAnswer) throw new Error('Quiz is missing answers');
  const score = questions.reduce((total, question) => (
    answers[question.id] === question.correctIndex ? total + 1 : total
  ), 0);
  const submittedAt = new Date();

  const updated = await prisma.lessonQuiz.update({
    where: { id: quiz.id },
    data: {
      answers: answers as Prisma.InputJsonValue,
      score,
      submittedAt,
      status: 'submitted',
    },
  });

  const instructorEmail = quiz.meeting.instructor?.email || quiz.instructorEmailSnapshot;
  if (instructorEmail) {
    try {
      await queueEmail({
        to: instructorEmail,
        subject: `חידון שיעור הוגש - ${quiz.studentNameSnapshot || 'תלמיד/ה'}`,
        html: buildInstructorEmail({
          questions,
          answers,
          score,
          totalQuestions: questions.length,
          studentName: quiz.studentNameSnapshot || quiz.meeting.registration?.student?.name || 'תלמיד/ה',
          customerName: quiz.meeting.registration?.student?.customer?.name || null,
          cycleName: quiz.meeting.cycle?.name || null,
          courseName: quiz.meeting.cycle?.course?.name || null,
          instructorName: quiz.meeting.instructor?.name || null,
          meetingDate: formatDate(quiz.meeting.scheduledDate),
          meetingTime: `${formatTime(quiz.meeting.startTime)}-${formatTime(quiz.meeting.endTime)}`,
          submittedAt: submittedAt.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }),
        }),
        text: buildInstructorEmailText({
          questions,
          answers,
          score,
          totalQuestions: questions.length,
          studentName: quiz.studentNameSnapshot || quiz.meeting.registration?.student?.name || 'תלמיד/ה',
          cycleName: quiz.meeting.cycle?.name || null,
          courseName: quiz.meeting.cycle?.course?.name || null,
        }),
        priority: EmailPriority.NORMAL,
        metadata: { type: 'lesson_quiz_submission', quizId: quiz.id, meetingId: quiz.meetingId },
      });
      await prisma.lessonQuiz.update({
        where: { id: quiz.id },
        data: { emailSentAt: new Date(), emailError: null },
      });
    } catch (error: any) {
      await prisma.lessonQuiz.update({
        where: { id: quiz.id },
        data: { emailError: error.message || 'Failed to queue instructor email' },
      });
    }
  } else {
    await prisma.lessonQuiz.update({
      where: { id: quiz.id },
      data: { emailError: 'Instructor email is missing' },
    });
  }

  return {
    ...updated,
    score,
    totalQuestions: questions.length,
    questions,
  };
}

export async function sendLessonQuizToParent(meetingId: string) {
  const quiz = await prisma.lessonQuiz.findUnique({
    where: { meetingId },
    include: {
      meeting: {
        include: {
          cycle: true,
          instructor: true,
          registration: { include: { student: { include: { customer: true } } } },
        },
      },
    },
  });

  if (!quiz || quiz.status === 'failed') throw new Error('Quiz not found');

  const parent = quiz.meeting.registration?.student?.customer;
  const phone = normalizeWhatsAppPhone(parent?.phone);
  if (!phone) throw new Error('Parent phone is missing');

  const url = quizUrl(quiz.token);
  const message = buildParentQuizMessage({
    parentName: parent?.name,
    studentName: quiz.studentNameSnapshot || quiz.meeting.registration?.student?.name,
    instructorName: quiz.meeting.instructor?.name,
    cycleName: quiz.meeting.cycle?.name,
    url,
  });

  const result = await sendGreenApiMessage(formatPhoneForGreenApi(phone), message);
  if (!result.success) {
    await prisma.lessonQuiz.update({
      where: { id: quiz.id },
      data: {
        parentSentToPhone: phone,
        parentSendError: result.error || 'Failed to send quiz to parent',
      },
    });
    throw new Error(result.error || 'Failed to send quiz to parent');
  }

  const now = new Date();
  await saveParentQuizWhatsAppMessage({
    phone,
    parentName: parent?.name,
    message,
    greenMessageId: result.messageId,
  });

  const updated = await prisma.lessonQuiz.update({
    where: { id: quiz.id },
    data: {
      parentSentAt: now,
      parentSentToPhone: phone,
      parentMessageId: result.messageId || null,
      parentSendError: null,
    },
  });

  return {
    quiz: updated,
    phone,
    message,
    messageId: result.messageId,
  };
}

async function saveParentQuizWhatsAppMessage(params: {
  phone: string;
  parentName?: string | null;
  message: string;
  greenMessageId?: string | null;
}) {
  const now = new Date();
  const waMessageId = params.greenMessageId ? `green:${params.greenMessageId}` : undefined;

  if (waMessageId) {
    const existing = await prisma.waMessage.findUnique({
      where: { waMessageId },
      select: { id: true },
    });
    if (existing) return existing;
  }

  let conversation = await prisma.waConversation.findFirst({
    where: { phone: params.phone },
    orderBy: { lastMessageAt: 'desc' },
  });

  if (!conversation) {
    conversation = await prisma.waConversation.create({
      data: {
        phone: params.phone,
        contactName: params.parentName || params.phone,
        status: 'open',
        unreadCount: 0,
        lastMessageAt: now,
        lastMessagePreview: params.message.slice(0, 100),
        businessPhone: 'Green API',
        phoneNumberId: null,
        aiEnabled: false,
      },
    });
  }

  const waMessage = await prisma.waMessage.create({
    data: {
      conversationId: conversation.id,
      direction: 'outbound',
      content: params.message,
      waMessageId,
      status: 'sent',
      isAiGenerated: false,
    },
  });

  await prisma.waConversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: now,
      lastMessagePreview: params.message.slice(0, 100),
      contactName: params.parentName || conversation.contactName || params.phone,
      businessPhone: conversation.businessPhone || 'Green API',
      aiEnabled: false,
      updatedAt: now,
    },
  });

  broadcastWaSSE('new_message', {
    conversationId: conversation.id,
    message: waMessage,
    phone: params.phone,
    contactName: params.parentName || conversation.contactName || params.phone,
    provider: 'green',
  });

  return waMessage;
}

function buildInstructorEmail(params: {
  questions: QuizQuestion[];
  answers: Record<string, number>;
  score: number;
  totalQuestions: number;
  studentName: string;
  customerName: string | null;
  cycleName: string | null;
  courseName: string | null;
  instructorName: string | null;
  meetingDate: string;
  meetingTime: string;
  submittedAt: string;
}) {
  const rows = params.questions.map((question, index) => {
    const chosen = params.answers[question.id];
    const chosenText = typeof chosen === 'number' ? question.options[chosen] || 'לא תקין' : 'לא נענה';
    const isCorrect = chosen === question.correctIndex;
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(question.question)}</td>
        <td style="color:${isCorrect ? '#166534' : '#991b1b'}">${escapeHtml(chosenText)}</td>
        <td>${escapeHtml(question.options[question.correctIndex])}</td>
        <td>${escapeHtml(question.explanation)}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6; }
    .container { max-width: 760px; margin: 0 auto; padding: 20px; }
    .header { background: #0f766e; color: #fff; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { border: 1px solid #d1d5db; border-top: 0; padding: 20px; }
    .score { background: #ecfdf5; border-right: 4px solid #10b981; padding: 14px; margin: 16px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 10px; text-align: right; vertical-align: top; }
    th { background: #f9fafb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin:0">חידון שיעור הוגש</h1>
    </div>
    <div class="content">
      <p>שלום ${escapeHtml(params.instructorName || 'מדריך/ה')},</p>
      <p>${escapeHtml(params.studentName)} הגיש/ה חידון הבנה אחרי השיעור.</p>
      <div class="score">
        <strong>ציון:</strong> ${params.score}/${params.totalQuestions}<br>
        <strong>קורס:</strong> ${escapeHtml(params.courseName || '-')}<br>
        <strong>מחזור:</strong> ${escapeHtml(params.cycleName || '-')}<br>
        <strong>תאריך ושעה:</strong> ${escapeHtml(params.meetingDate)} ${escapeHtml(params.meetingTime)}<br>
        ${params.customerName ? `<strong>לקוח:</strong> ${escapeHtml(params.customerName)}<br>` : ''}
        <strong>הוגש:</strong> ${escapeHtml(params.submittedAt)}
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>שאלה</th>
            <th>תשובת הילד/ה</th>
            <th>תשובה נכונה</th>
            <th>הסבר</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

function buildInstructorEmailText(params: {
  questions: QuizQuestion[];
  answers: Record<string, number>;
  score: number;
  totalQuestions: number;
  studentName: string;
  cycleName: string | null;
  courseName: string | null;
}) {
  const lines = params.questions.map((question, index) => {
    const chosen = params.answers[question.id];
    const chosenText = typeof chosen === 'number' ? question.options[chosen] || 'לא תקין' : 'לא נענה';
    return `${index + 1}. ${question.question}
תשובת הילד/ה: ${chosenText}
תשובה נכונה: ${question.options[question.correctIndex]}
הסבר: ${question.explanation}`;
  });

  return [
    `חידון שיעור הוגש על ידי ${params.studentName}`,
    `ציון: ${params.score}/${params.totalQuestions}`,
    `קורס: ${params.courseName || '-'}`,
    `מחזור: ${params.cycleName || '-'}`,
    '',
    ...lines,
  ].join('\n\n');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
