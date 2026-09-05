import type { ParentReminderData } from './email/templates.js';
import {
  sendWhatsAppCloudTemplate,
  templateText,
} from './whatsapp-cloud-templates.js';

export function buildParentReminderTemplateVariables(data: ParentReminderData): string[] {
  const zoomText = data.zoomLink
    ? `קישור לזום: ${data.zoomLink}`
    : 'לשיעור פרונטלי, אין צורך בקישור זום';
  return [
    templateText(data.parentName, 'שלום'),
    templateText(data.studentName, 'התלמיד/ה'),
    templateText(data.className, 'השיעור'),
    templateText(data.date, 'מחר'),
    templateText(data.time, 'השעה תעודכן בהמשך'),
    templateText(data.location, 'אונליין'),
    templateText(data.instructorName, 'צוות HaiTech'),
    templateText(zoomText, 'פרטי השיעור יישלחו בהמשך'),
  ];
}

export function buildParentOnlineReminderTemplateVariables(data: ParentReminderData): string[] {
  return [
    templateText(data.parentName, 'שלום'),
    templateText(data.studentName, 'התלמיד/ה'),
    templateText(data.className, 'השיעור'),
    templateText(data.time, 'השעה תעודכן בהמשך'),
    templateText(data.zoomLink, 'קישור הזום יישלח בהמשך'),
  ];
}

export function buildParentReminderPreview(data: ParentReminderData, templateName: string): string {
  const location = data.zoomLink ? `קישור: ${data.zoomLink}` : `מיקום: ${data.location}`;
  return `[תבנית: ${templateName}] תזכורת ל-${data.studentName}: ${data.className}, ${data.date} בשעה ${data.time}. ${location}`;
}

export async function sendParentWhatsAppReminder(params: {
  phone?: string | null;
  contactName?: string | null;
  data: ParentReminderData;
}): Promise<{ sent: boolean; skipped?: string; messageId?: string }> {
  if (process.env.PARENT_REMINDER_WA_ENABLED !== 'true') {
    return { sent: false, skipped: 'disabled' };
  }

  if (!params.phone) return { sent: false, skipped: 'missing_phone' };

  const onlineTemplateName = process.env.PARENT_ONLINE_REMINDER_WA_TEMPLATE_NAME;
  const isOnlineSpecificTemplate = Boolean((params.data.isOnline || params.data.zoomLink) && onlineTemplateName);
  const templateName = isOnlineSpecificTemplate
    ? onlineTemplateName!
    : process.env.PARENT_REMINDER_WA_TEMPLATE_NAME || 'parent_lesson_reminder';
  const variables = isOnlineSpecificTemplate
    ? buildParentOnlineReminderTemplateVariables(params.data)
    : buildParentReminderTemplateVariables(params.data);
  const preview = buildParentReminderPreview(params.data, templateName);

  const result = await sendWhatsAppCloudTemplate({
    phone: params.phone,
    contactName: params.contactName || params.data.parentName,
    templateName,
    bodyParameters: variables,
    preview,
    phoneNumberId: process.env.PARENT_REMINDER_WA_PHONE_NUMBER_ID || process.env.WA_REMINDER_PHONE_NUMBER_ID || process.env.WA_PHONE_NUMBER_ID,
    businessPhone: process.env.PARENT_REMINDER_WA_BUSINESS_PHONE,
  });

  if (!result.success) return { sent: false, skipped: result.error || 'send_failed' };
  return { sent: true, messageId: result.messageId };
}
