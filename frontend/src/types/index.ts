// Enums
export type CourseCategory = 'programming' | 'ai' | 'robotics' | 'printing_3d';
export type BranchType = 'school' | 'community_center' | 'frontal' | 'online';
export type OrderStatus = 'draft' | 'active' | 'completed' | 'cancelled';
export type CycleType = 'private' | 'institutional_per_child' | 'institutional_fixed';
export type CycleStatus = 'active' | 'completed' | 'cancelled';
export type DayOfWeek = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
export type MeetingStatus = 'scheduled' | 'completed' | 'cancelled' | 'postponed';
export type RegistrationStatus = 'registered' | 'active' | 'completed' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type PaymentMethod = 'credit' | 'transfer' | 'cash';
export type AttendanceStatus = 'present' | 'absent' | 'late';
export type UserRole = 'admin' | 'manager' | 'instructor';
export type ActivityType = 'online' | 'frontal' | 'private_lesson';

// Entities
export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  notes?: string;
  createdAt: string;
  students?: Student[];
  _count?: {
    students: number;
  };
}

export interface Student {
  id: string;
  customerId: string;
  name: string;
  birthDate?: string;
  grade?: string;
  notes?: string;
  customer?: Customer;
  registrations?: Registration[];
}

export interface Course {
  id: string;
  name: string;
  description?: string;
  targetAudience?: string;
  category: CourseCategory;
  isActive: boolean;
  createdAt: string;
  _count?: {
    cycles: number;
  };
}

export interface Branch {
  id: string;
  name: string;
  type: BranchType;
  address?: string;
  city?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  isActive: boolean;
  createdAt: string;
  _count?: {
    cycles: number;
    institutionalOrders: number;
  };
}

export interface InstitutionalOrder {
  id: string;
  branchId: string;
  orderNumber?: string;
  orderDate: string;
  startDate: string;
  endDate: string;
  pricePerMeeting: number;
  estimatedMeetings: number;
  estimatedTotal: number;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  contractFile?: string;
  status: OrderStatus;
  notes?: string;
  createdAt: string;
  branch?: Branch;
}

export type EmploymentType = 'freelancer' | 'employee';

export interface Instructor {
  id: string;
  name: string;
  phone: string;
  email: string;
  rateFrontal: number;
  rateOnline: number;
  ratePrivate: number;
  ratePreparation: number;
  employmentType: EmploymentType;
  userId?: string;
  isActive: boolean;
  notes?: string;
  createdAt: string;
  _count?: {
    cycles: number;
    meetings: number;
  };
}

export interface Cycle {
  id: string;
  name: string;
  courseId: string;
  branchId: string;
  instructorId: string;
  institutionalOrderId?: string;
  type: CycleType;
  startDate: string;
  endDate: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  totalMeetings: number;
  pricePerStudent?: number;
  meetingRevenue?: number;
  revenueIncludesVat?: boolean | null;
  studentCount?: number;
  maxStudents?: number;
  sendParentReminders: boolean;
  isOnline: boolean;
  activityType: ActivityType;
  completedMeetings: number;
  remainingMeetings: number;
  status: CycleStatus;
  createdAt: string;
  course?: Course;
  branch?: Branch;
  instructor?: Instructor;
  meetings?: Meeting[];
  registrations?: Registration[];
  _count?: {
    meetings: number;
    registrations: number;
  };
}

export interface Meeting {
  id: string;
  cycleId: string;
  instructorId: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  status: MeetingStatus;
  statusUpdatedAt?: string;
  statusUpdatedById?: string;
  revenue: number;
  instructorPayment: number;
  profit: number;
  activityType?: ActivityType;
  topic?: string;
  notes?: string;
  zoomMeetingId?: string;
  zoomJoinUrl?: string;
  zoomStartUrl?: string;
  zoomPassword?: string;
  zoomHostKey?: string;
  zoomHostEmail?: string;
  zoomRecordingUrl?: string;
  zoomRecordingPassword?: string;
  lessonTranscript?: string;
  lessonSummary?: string;
  rescheduledToId?: string;
  createdAt: string;
  cycle?: Cycle;
  instructor?: Instructor;
  attendance?: Attendance[];
  _count?: {
    attendance: number;
  };
}

export interface Registration {
  id: string;
  studentId: string;
  cycleId: string;
  registrationDate: string;
  status: RegistrationStatus;
  amount?: number;
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  invoiceLink?: string;
  cancellationDate?: string;
  cancellationReason?: string;
  notes?: string;
  createdAt: string;
  student?: Student;
  cycle?: Cycle;
}

export interface Attendance {
  id: string;
  meetingId: string;
  registrationId: string;
  status: AttendanceStatus;
  notes?: string;
  recordedAt: string;
  recordedById: string;
  meeting?: Meeting;
  registration?: Registration;
}

// API Response types
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// Dashboard types
export interface DailySummary {
  date: string;
  totalMeetings: number;
  completedMeetings: number;
  cancelledMeetings: number;
  pendingMeetings: number;
  totalRevenue: number;
  totalCosts: number;
  profit: number;
  meetings: Meeting[];
}

// Hebrew translations
export const dayOfWeekHebrew: Record<DayOfWeek, string> = {
  sunday: 'ראשון',
  monday: 'שני',
  tuesday: 'שלישי',
  wednesday: 'רביעי',
  thursday: 'חמישי',
  friday: 'שישי',
  saturday: 'שבת',
};

export const meetingStatusHebrew: Record<MeetingStatus, string> = {
  scheduled: 'מתוכנן',
  completed: 'הושלם',
  cancelled: 'בוטל',
  postponed: 'נדחה',
};

export const cycleStatusHebrew: Record<CycleStatus, string> = {
  active: 'פעיל',
  completed: 'הושלם',
  cancelled: 'בוטל',
};

export const cycleTypeHebrew: Record<CycleType, string> = {
  private: 'פרטי',
  institutional_per_child: 'מוסדי (פר ילד)',
  institutional_fixed: 'מוסדי (סכום קבוע)',
};

export const branchTypeHebrew: Record<BranchType, string> = {
  school: 'בית ספר',
  community_center: 'מתנ"ס',
  frontal: 'פרונטלי',
  online: 'אונליין',
};

export const categoryHebrew: Record<CourseCategory, string> = {
  programming: 'תכנות',
  ai: 'בינה מלאכותית',
  robotics: 'רובוטיקה',
  printing_3d: 'הדפסה תלת-מימדית',
};

export const paymentStatusHebrew: Record<PaymentStatus, string> = {
  unpaid: 'לא שולם',
  partial: 'חלקי',
  paid: 'שולם',
};

export const attendanceStatusHebrew: Record<AttendanceStatus, string> = {
  present: 'נוכח',
  absent: 'נעדר',
  late: 'מאחר',
};

export const activityTypeHebrew: Record<ActivityType, string> = {
  online: 'אונליין',
  frontal: 'פרונטלי',
  private_lesson: 'פרטי',
};
