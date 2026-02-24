import nodemailer from 'nodemailer';

// Email options interface
export interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

// Email result interface
export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// Create transporter with Gmail SMTP
const createTransporter = () => {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_PASS;

  if (!user || !pass) {
    console.warn('⚠️ GMAIL_USER or GMAIL_PASS not configured - emails will fail');
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass, // Use App Password for Gmail
    },
  });
};

// Singleton transporter
let transporter: nodemailer.Transporter | null = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
};

// Send a single email
export const sendEmail = async (options: EmailOptions): Promise<EmailResult> => {
  const { to, subject, html, text, replyTo, attachments } = options;

  // Validate required fields
  if (!to || !subject) {
    return {
      success: false,
      error: 'Missing required fields: to, subject',
    };
  }

  if (!html && !text) {
    return {
      success: false,
      error: 'Email must have either html or text content',
    };
  }

  const fromName = process.env.EMAIL_FROM_NAME || 'HaiTech';
  const fromEmail = process.env.GMAIL_USER || 'noreply@haitech.co.il';

  try {
    const transport = getTransporter();

    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      html,
      text,
      replyTo: replyTo || fromEmail,
      attachments,
    };

    const info = await transport.sendMail(mailOptions);

    console.log(`📧 Email sent to ${to}: ${info.messageId}`);

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Failed to send email to ${to}:`, errorMessage);

    // Throw so BullMQ marks the job as failed (not completed)
    throw new Error(errorMessage);
  }
};

// Send test email to verify configuration
export const sendTestEmail = async (to: string): Promise<EmailResult> => {
  return sendEmail({
    to,
    subject: '🧪 בדיקת מערכת המייל - HaiTech CRM',
    html: `
      <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
        <h1 style="color: #2563eb;">✅ מערכת המייל פועלת!</h1>
        <p>זוהי הודעת בדיקה מ-HaiTech CRM.</p>
        <p>אם קיבלת הודעה זו, הגדרות השליחה תקינות.</p>
        <hr style="border: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="color: #6b7280; font-size: 12px;">
          נשלח בתאריך: ${new Date().toLocaleString('he-IL')}
        </p>
      </div>
    `,
    text: 'מערכת המייל פועלת! זוהי הודעת בדיקה מ-HaiTech CRM.',
  });
};

// Verify email configuration
export const verifyEmailConfig = async (): Promise<boolean> => {
  try {
    const transport = getTransporter();
    await transport.verify();
    console.log('✅ Email configuration verified');
    return true;
  } catch (error) {
    console.error('❌ Email configuration error:', error);
    return false;
  }
};
