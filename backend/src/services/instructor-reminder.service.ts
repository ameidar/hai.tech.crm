/**
 * Instructor Daily Reminder Service
 * Sends morning reminders to instructors with their daily meetings
 * 
 * ⚠️ TEST ONLY - Not for production
 */

import { prisma } from '../utils/prisma.js';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

interface DailyMeeting {
  id: string;
  startTime: string;
  endTime: string;
  cycleName: string;
  branchName: string;
  activityType: string;
  studentCount: number;
  zoomJoinUrl?: string;
}

interface InstructorDailySummary {
  instructorId: string;
  instructorName: string;
  instructorPhone?: string;
  instructorEmail?: string;
  meetings: DailyMeeting[];
  magicLinks: { meetingId: string; link: string }[];
}

/**
 * Generate a magic link token for instructor meeting access
 * Valid for 24 hours
 */
export function generateMeetingMagicLink(
  instructorId: string, 
  meetingId: string,
  baseUrl: string
): string {
  const token = jwt.sign(
    { 
      type: 'instructor-meeting-access',
      instructorId, 
      meetingId,
    },
    config.jwt.secret,
    { expiresIn: '24h' }
  );
  
  return `${baseUrl}/i/${meetingId}/${token}`;
}

/**
 * Verify a magic link token
 */
export function verifyMeetingMagicLink(token: string): { 
  valid: boolean; 
  instructorId?: string; 
  meetingId?: string;
  error?: string;
} {
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as {
      type: string;
      instructorId: string;
      meetingId: string;
    };
    
    if (decoded.type !== 'instructor-meeting-access') {
      return { valid: false, error: 'Invalid token type' };
    }
    
    return { 
      valid: true, 
      instructorId: decoded.instructorId,
      meetingId: decoded.meetingId,
    };
  } catch (error) {
    return { valid: false, error: 'Token expired or invalid' };
  }
}

/**
 * Get today's meetings for all active instructors
 */
export async function getDailyMeetingsForInstructors(
  date: Date = new Date()
): Promise<InstructorDailySummary[]> {
  const dateStr = date.toISOString().split('T')[0];
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  
  // Get all meetings for today with instructor info
  const meetings = await prisma.meeting.findMany({
    where: {
      scheduledDate: {
        gte: new Date(dateStr),
        lt: nextDay,
      },
      status: 'scheduled',
      deletedAt: null,
    },
    include: {
      instructor: true,
      cycle: {
        include: {
          branch: true,
          _count: {
            select: { registrations: true }
          }
        }
      }
    },
    orderBy: [
      { instructorId: 'asc' },
      { startTime: 'asc' }
    ]
  });

  // Group by instructor
  const byInstructor = new Map<string, InstructorDailySummary>();
  
  const baseUrl = process.env.FRONTEND_URL || 'https://18f95599f0b7.ngrok-free.app';
  
  for (const meeting of meetings) {
    if (!meeting.instructor) continue;
    
    const instructorId = meeting.instructor.id;
    
    if (!byInstructor.has(instructorId)) {
      byInstructor.set(instructorId, {
        instructorId,
        instructorName: meeting.instructor.name,
        instructorPhone: meeting.instructor.phone || undefined,
        instructorEmail: meeting.instructor.email || undefined,
        meetings: [],
        magicLinks: [],
      });
    }
    
    const summary = byInstructor.get(instructorId)!;
    
    const formatTime = (time: Date | string) => {
      const d = new Date(time);
      return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
    };
    
    summary.meetings.push({
      id: meeting.id,
      startTime: formatTime(meeting.startTime),
      endTime: formatTime(meeting.endTime),
      cycleName: meeting.cycle?.name || 'פגישה',
      branchName: meeting.cycle?.branch?.name || '',
      activityType: meeting.cycle?.activityType || 'frontal',
      studentCount: meeting.cycle?._count?.registrations || 0,
      zoomJoinUrl: meeting.zoomJoinUrl || undefined,
    });
    
    // Generate magic link for this meeting
    const magicLink = generateMeetingMagicLink(instructorId, meeting.id, baseUrl);
    summary.magicLinks.push({ meetingId: meeting.id, link: magicLink });
  }
  
  return Array.from(byInstructor.values());
}

/**
 * Format WhatsApp message for instructor
 */
export function formatWhatsAppReminder(summary: InstructorDailySummary): string {
  const today = new Date().toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  
  let message = `🌅 בוקר טוב ${summary.instructorName}!\n\n`;
  message += `📅 הפגישות שלך להיום (${today}):\n\n`;
  
  for (let i = 0; i < summary.meetings.length; i++) {
    const meeting = summary.meetings[i];
    const link = summary.magicLinks[i]?.link;
    
    message += `⏰ *${meeting.startTime} - ${meeting.endTime}*\n`;
    message += `📚 ${meeting.cycleName}\n`;
    
    if (meeting.branchName) {
      message += `📍 ${meeting.branchName}\n`;
    }
    
    if (meeting.activityType === 'online') {
      message += `💻 שיעור אונליין\n`;
      if (meeting.zoomJoinUrl) {
        message += `🔗 זום: ${meeting.zoomJoinUrl}\n`;
      }
    }
    
    message += `👥 ${meeting.studentCount} תלמידים\n`;
    message += `\n✏️ למילוי נוכחות: ${link}\n`;
    message += `\n---\n\n`;
  }
  
  message += `יום פרודוקטיבי! 💪`;
  
  return message;
}

/**
 * Send reminder to a single instructor (for testing)
 */
export async function sendTestReminder(
  instructorId: string,
  sendMethod: 'console' | 'whatsapp' = 'console'
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const summaries = await getDailyMeetingsForInstructors();
    const summary = summaries.find(s => s.instructorId === instructorId);
    
    if (!summary) {
      return { success: false, error: 'No meetings found for instructor today' };
    }
    
    const message = formatWhatsAppReminder(summary);
    
    if (sendMethod === 'console') {
      console.log('\n========== TEST REMINDER ==========');
      console.log(`To: ${summary.instructorName} (${summary.instructorPhone || summary.instructorEmail})`);
      console.log('Message:');
      console.log(message);
      console.log('====================================\n');
      return { success: true, message };
    }
    
    // WhatsApp sending would go here
    // For now, just return the message
    return { success: true, message };
    
  } catch (error) {
    console.error('Error sending reminder:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Preview all reminders for today (for testing)
 */
export async function previewDailyReminders(): Promise<{
  date: string;
  instructorCount: number;
  totalMeetings: number;
  summaries: InstructorDailySummary[];
}> {
  const summaries = await getDailyMeetingsForInstructors();
  
  return {
    date: new Date().toISOString().split('T')[0],
    instructorCount: summaries.length,
    totalMeetings: summaries.reduce((sum, s) => sum + s.meetings.length, 0),
    summaries,
  };
}
