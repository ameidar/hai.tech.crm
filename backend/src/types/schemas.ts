import { z } from 'zod';

// Common schemas - allow any string ID (not just UUID)
export const uuidSchema = z.string().min(1);

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

// Auth schemas
export const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const registerSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional(),
  role: z.enum(['admin', 'manager', 'instructor']).default('instructor'),
});

// Customer schemas
export const createCustomerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email().optional().nullable(),
  phone: z.string().min(9, 'Phone must be at least 9 characters'),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

// Student schemas
export const createStudentSchema = z.object({
  customerId: z.string().min(1, 'Customer ID is required'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  birthDate: z.string().optional().nullable(),
  grade: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updateStudentSchema = createStudentSchema.partial().omit({ customerId: true });

// Course schemas
export const createCourseSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  description: z.string().optional().nullable(),
  targetAudience: z.string().optional().nullable(),
  category: z.enum(['programming', 'ai', 'robotics', 'printing_3d']),
  isActive: z.boolean().default(true),
});

export const updateCourseSchema = createCourseSchema.partial();

// Branch schemas
export const createBranchSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  type: z.enum(['school', 'community_center', 'frontal', 'online']),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  contactName: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  contactEmail: z.string().email().optional().nullable(),
  isActive: z.boolean().default(true),
});

export const updateBranchSchema = createBranchSchema.partial();

// Instructor schemas
export const createInstructorSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().min(9, 'Phone must be at least 9 characters'),
  email: z.string().email().optional().nullable(),
  rateFrontal: z.number().nonnegative().optional().nullable(),
  rateOnline: z.number().nonnegative().optional().nullable(),
  ratePrivate: z.number().nonnegative().optional().nullable(),
  ratePreparation: z.number().nonnegative().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().default(true),
  notes: z.string().optional().nullable(),
});

export const updateInstructorSchema = createInstructorSchema.partial();

// Institutional Order schemas
export const createInstitutionalOrderSchema = z.object({
  branchId: z.string().uuid('Invalid branch ID'),
  orderNumber: z.string().optional().nullable(),
  orderDate: z.string().optional().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  pricePerMeeting: z.number().positive('Price must be positive'),
  estimatedMeetings: z.number().int().positive().optional().nullable(),
  estimatedTotal: z.number().positive().optional().nullable(),
  contactName: z.string().min(2, 'Contact name must be at least 2 characters'),
  contactPhone: z.string().min(9, 'Phone must be at least 9 characters'),
  contactEmail: z.string().email().optional().nullable(),
  contractFile: z.string().optional().nullable(),
  status: z.enum(['draft', 'active', 'completed', 'cancelled']).default('draft'),
  notes: z.string().optional().nullable(),
});

export const updateInstitutionalOrderSchema = createInstitutionalOrderSchema.partial().omit({ branchId: true });

// Cycle schemas
export const createCycleSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  courseId: z.string().min(1, 'Course ID is required'),
  branchId: z.string().min(1, 'Branch ID is required'),
  instructorId: z.string().min(1, 'Instructor ID is required'),
  institutionalOrderId: z.string().optional().nullable(),
  type: z.enum(['private', 'institutional_per_child', 'institutional_fixed']),
  startDate: z.string(),
  endDate: z.string().optional(), // Will be calculated automatically if not provided
  dayOfWeek: z.enum(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  durationMinutes: z.number().int().positive(),
  totalMeetings: z.number().int().positive(),
  pricePerStudent: z.number().nonnegative().optional().nullable(),
  meetingRevenue: z.number().nonnegative().optional().nullable(),
  studentCount: z.number().int().nonnegative().optional().nullable(),
  maxStudents: z.number().int().nonnegative().optional().nullable(),
  sendParentReminders: z.boolean().default(false),
  isOnline: z.boolean().default(false),
  activityType: z.enum(['online', 'frontal', 'private_lesson']).default('frontal'),
  zoomHostId: z.string().optional().nullable(),
});

export const updateCycleSchema = createCycleSchema.partial().extend({
  completedMeetings: z.number().int().nonnegative().optional(),
  remainingMeetings: z.number().int().nonnegative().optional(),
});

// Registration schemas
export const createRegistrationSchema = z.object({
  studentId: z.string().uuid('Invalid student ID'),
  cycleId: z.string().uuid('Invalid cycle ID'),
  registrationDate: z.string().optional(),
  status: z.enum(['registered', 'active', 'completed', 'cancelled']).default('registered'),
  amount: z.number().positive().optional().nullable(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional().nullable(),
  paymentMethod: z.enum(['credit', 'transfer', 'cash']).optional().nullable(),
  invoiceLink: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const updateRegistrationSchema = createRegistrationSchema.partial().omit({ studentId: true, cycleId: true });

// Meeting schemas
export const createMeetingSchema = z.object({
  cycleId: z.string().uuid('Invalid cycle ID'),
  instructorId: z.string().uuid('Invalid instructor ID'),
  scheduledDate: z.string(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  status: z.enum(['scheduled', 'completed', 'cancelled', 'postponed']).default('scheduled'),
  activityType: z.enum(['online', 'frontal', 'private_lesson']).optional().nullable(),
  topic: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  zoomMeetingId: z.string().optional().nullable(),
  zoomJoinUrl: z.string().optional().nullable(),
  zoomStartUrl: z.string().optional().nullable(),
});

export const updateMeetingSchema = z.object({
  status: z.enum(['scheduled', 'completed', 'cancelled', 'postponed']).optional(),
  topic: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  instructorId: z.string().uuid().optional(),
  activityType: z.enum(['online', 'frontal', 'private_lesson']).optional().nullable(),
  revenue: z.number().optional(),
  instructorPayment: z.number().optional(),
  profit: z.number().optional(),
  scheduledDate: z.string().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format').optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format').optional(),
  // Zoom fields
  zoomMeetingId: z.string().optional().nullable(),
  zoomJoinUrl: z.string().url().optional().nullable(),
  zoomStartUrl: z.string().url().optional().nullable(),
  zoomPassword: z.string().optional().nullable(),
  zoomHostKey: z.string().optional().nullable(),
  zoomHostEmail: z.string().email().optional().nullable(),
});

export const postponeMeetingSchema = z.object({
  newDate: z.string(),
  newStartTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format').optional(),
  newEndTime: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format').optional(),
});

// Attendance schemas
export const createAttendanceSchema = z.object({
  meetingId: z.string().uuid('Invalid meeting ID'),
  registrationId: z.string().uuid('Invalid registration ID'),
  status: z.enum(['present', 'absent', 'late']),
  notes: z.string().optional().nullable(),
});

export const updateAttendanceSchema = z.object({
  status: z.enum(['present', 'absent', 'late']).optional(),
  notes: z.string().optional().nullable(),
});

export const bulkAttendanceSchema = z.object({
  meetingId: z.string().uuid('Invalid meeting ID'),
  attendance: z.array(z.object({
    registrationId: z.string().uuid('Invalid registration ID'),
    status: z.enum(['present', 'absent', 'late']),
    notes: z.string().optional().nullable(),
  })),
});

// Bulk update cycles schema
export const bulkUpdateCyclesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'At least one cycle ID is required'),
  data: z.object({
    status: z.enum(['active', 'completed', 'cancelled']).optional(),
    instructorId: z.string().min(1).optional(),
    courseId: z.string().min(1).optional(),
    branchId: z.string().min(1).optional(),
    meetingRevenue: z.number().positive().optional().nullable(),
    pricePerStudent: z.number().positive().optional().nullable(),
    studentCount: z.number().int().positive().optional().nullable(),
    sendParentReminders: z.boolean().optional(),
    activityType: z.enum(['online', 'frontal', 'private_lesson']).optional(),
  }).refine(
    (data) => Object.keys(data).some(k => data[k as keyof typeof data] !== undefined),
    { message: 'At least one field to update is required' }
  ),
});

// Export types
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type CreateInstructorInput = z.infer<typeof createInstructorSchema>;
export type UpdateInstructorInput = z.infer<typeof updateInstructorSchema>;
export type CreateCycleInput = z.infer<typeof createCycleSchema>;
export type UpdateCycleInput = z.infer<typeof updateCycleSchema>;
export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;
export type UpdateRegistrationInput = z.infer<typeof updateRegistrationSchema>;
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;
export type CreateAttendanceInput = z.infer<typeof createAttendanceSchema>;
export type BulkAttendanceInput = z.infer<typeof bulkAttendanceSchema>;
export type BulkUpdateCyclesInput = z.infer<typeof bulkUpdateCyclesSchema>;
