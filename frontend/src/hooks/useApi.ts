import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import type {
  Customer,
  Student,
  Course,
  Branch,
  Instructor,
  Cycle,
  Meeting,
  Registration,
  DailySummary,
} from '../types';

// Pagination metadata
interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// API response wrapper type
interface PaginatedResponse<T> {
  data: T;
  pagination?: PaginationMeta;
}

// Export pagination types for components that need them
export type { PaginationMeta, PaginatedResponse };

// Generic fetch function - handles both paginated and direct responses
const fetchData = async <T>(url: string): Promise<T> => {
  const response = await api.get<T | PaginatedResponse<T>>(url);
  // If response has data property with pagination, extract the data array
  if (response.data && typeof response.data === 'object' && 'data' in response.data && 'pagination' in response.data) {
    return (response.data as PaginatedResponse<T>).data;
  }
  return response.data as T;
};

// Fetch with pagination info - returns both data and pagination
const fetchDataWithPagination = async <T>(url: string): Promise<{ data: T; pagination?: PaginationMeta }> => {
  const response = await api.get<PaginatedResponse<T>>(url);
  if (response.data && typeof response.data === 'object' && 'data' in response.data) {
    return {
      data: (response.data as PaginatedResponse<T>).data,
      pagination: (response.data as PaginatedResponse<T>).pagination,
    };
  }
  return { data: response.data as T };
};

// Generic mutation function
const mutateData = async <T, D>(url: string, method: 'post' | 'put' | 'delete', data?: D): Promise<T> => {
  const response = await api[method]<T>(url, data);
  return response.data;
};

// ==================== Customers ====================
export const useCustomers = (params?: { search?: string; limit?: number }) => {
  const queryParams = new URLSearchParams();
  if (params?.search) queryParams.append('search', params.search);
  queryParams.append('limit', String(params?.limit || 500));
  const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';
  return useQuery({
    queryKey: ['customers', params?.search, params?.limit],
    queryFn: () => fetchData<Customer[]>(`/customers${queryString}`),
  });
};

export const useCustomer = (id: string) => {
  return useQuery({
    queryKey: ['customer', id],
    queryFn: () => fetchData<Customer>(`/customers/${id}`),
    enabled: !!id,
  });
};

export const useCreateCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Customer>) => mutateData<Customer, Partial<Customer>>('/customers', 'post', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
};

export const useUpdateCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Customer> }) =>
      mutateData<Customer, Partial<Customer>>(`/customers/${id}`, 'put', data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
    },
  });
};

export const useDeleteCustomer = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
};

// ==================== Students ====================
export const useStudents = (customerId?: string, limit: number = 500) => {
  const baseUrl = customerId ? `/customers/${customerId}/students` : '/students';
  const url = `${baseUrl}?limit=${limit}`;
  return useQuery({
    queryKey: ['students', customerId, limit],
    queryFn: () => fetchData<Student[]>(url),
  });
};

export const useCreateStudent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, data }: { customerId: string; data: Partial<Student> }) =>
      mutateData<Student, Partial<Student>>(`/customers/${customerId}/students`, 'post', data),
    onSuccess: (_, { customerId }) => {
      queryClient.invalidateQueries({ queryKey: ['students', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
    },
  });
};

export const useUpdateStudent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, customerId, data }: { studentId: string; customerId: string; data: Partial<Student> }) =>
      mutateData<Student, Partial<Student>>(`/students/${studentId}`, 'put', data),
    onSuccess: (_, { customerId }) => {
      queryClient.invalidateQueries({ queryKey: ['students', customerId] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
    },
  });
};

export const useDeleteStudent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, customerId }: { studentId: string; customerId: string }) =>
      mutateData<void, undefined>(`/students/${studentId}`, 'delete'),
    onSuccess: (_, { customerId }) => {
      queryClient.invalidateQueries({ queryKey: ['students', customerId] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
    },
  });
};

// ==================== Courses ====================
export const useCourses = () => {
  return useQuery({
    queryKey: ['courses'],
    queryFn: () => fetchData<Course[]>('/courses'),
  });
};

export const useCourse = (id: string) => {
  return useQuery({
    queryKey: ['course', id],
    queryFn: () => fetchData<Course>(`/courses/${id}`),
    enabled: !!id,
  });
};

export const useCreateCourse = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Course>) => mutateData<Course, Partial<Course>>('/courses', 'post', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courses'] });
    },
  });
};

export const useUpdateCourse = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Course> }) =>
      mutateData<Course, Partial<Course>>(`/courses/${id}`, 'put', data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['courses'] });
      queryClient.invalidateQueries({ queryKey: ['course', id] });
    },
  });
};

// ==================== Branches ====================
export const useBranches = () => {
  return useQuery({
    queryKey: ['branches'],
    queryFn: () => fetchData<Branch[]>('/branches'),
  });
};

export const useBranch = (id: string) => {
  return useQuery({
    queryKey: ['branch', id],
    queryFn: () => fetchData<Branch>(`/branches/${id}`),
    enabled: !!id,
  });
};

export const useCreateBranch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Branch>) => mutateData<Branch, Partial<Branch>>('/branches', 'post', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
    },
  });
};

export const useUpdateBranch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Branch> }) =>
      mutateData<Branch, Partial<Branch>>(`/branches/${id}`, 'put', data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      queryClient.invalidateQueries({ queryKey: ['branch', id] });
    },
  });
};

// ==================== Instructors ====================
export const useInstructors = () => {
  return useQuery({
    queryKey: ['instructors'],
    queryFn: () => fetchData<Instructor[]>('/instructors?limit=100'),
  });
};

export const useInstructor = (id: string) => {
  return useQuery({
    queryKey: ['instructor', id],
    queryFn: () => fetchData<Instructor>(`/instructors/${id}`),
    enabled: !!id,
  });
};

export const useCreateInstructor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Instructor>) => mutateData<Instructor, Partial<Instructor>>('/instructors', 'post', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instructors'] });
    },
  });
};

export const useUpdateInstructor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Instructor> }) =>
      mutateData<Instructor, Partial<Instructor>>(`/instructors/${id}`, 'put', data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['instructors'] });
      queryClient.invalidateQueries({ queryKey: ['instructor', id] });
    },
  });
};

export const useSendInstructorInvite = () => {
  return useMutation({
    mutationFn: (instructorId: string) =>
      mutateData<{ inviteUrl: string; expiresAt: string }, undefined>(`/instructors/${instructorId}/invite`, 'post'),
  });
};

export const useResetInstructorPassword = () => {
  return useMutation({
    mutationFn: (instructorId: string) =>
      mutateData<{ resetUrl: string; expiresAt: string }, undefined>(`/instructors/${instructorId}/reset-password`, 'post'),
  });
};

export const useDeleteInstructor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (instructorId: string) =>
      mutateData<void, undefined>(`/instructors/${instructorId}`, 'delete'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instructors'] });
    },
  });
};

// ==================== Cycles ====================
export const useCycles = (params?: { branchId?: string; instructorId?: string; courseId?: string; status?: string; dayOfWeek?: string; search?: string; limit?: number }) => {
  const searchParams = new URLSearchParams();
  if (params?.branchId) searchParams.append('branchId', params.branchId);
  if (params?.instructorId) searchParams.append('instructorId', params.instructorId);
  if (params?.courseId) searchParams.append('courseId', params.courseId);
  if (params?.status) searchParams.append('status', params.status);
  if (params?.dayOfWeek) searchParams.append('dayOfWeek', params.dayOfWeek);
  searchParams.append('limit', String(params?.limit || 100));
  if (params?.search) searchParams.append('search', params.search);
  const queryString = searchParams.toString() ? `?${searchParams.toString()}` : '';

  return useQuery({
    queryKey: ['cycles', params],
    queryFn: () => fetchData<Cycle[]>(`/cycles${queryString}`),
  });
};

// Returns just the count of cycles
export const useCyclesCount = (params?: { status?: string; branchId?: string }) => {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.append('status', params.status);
  if (params?.branchId) searchParams.append('branchId', params.branchId);
  const queryString = searchParams.toString() ? `?${searchParams.toString()}` : '';

  return useQuery({
    queryKey: ['cyclesCount', params],
    queryFn: () => fetchData<{ total: number }>(`/cycles/count${queryString}`),
  });
};

// Returns cycles with total count from pagination
export const useCyclesWithTotal = (params?: { branchId?: string; instructorId?: string; courseId?: string; status?: string; dayOfWeek?: string; search?: string; limit?: number }) => {
  const searchParams = new URLSearchParams();
  if (params?.branchId) searchParams.append('branchId', params.branchId);
  if (params?.instructorId) searchParams.append('instructorId', params.instructorId);
  if (params?.courseId) searchParams.append('courseId', params.courseId);
  if (params?.status) searchParams.append('status', params.status);
  if (params?.dayOfWeek) searchParams.append('dayOfWeek', params.dayOfWeek);
  searchParams.append('limit', String(params?.limit || 100));
  if (params?.search) searchParams.append('search', params.search);
  const queryString = searchParams.toString() ? `?${searchParams.toString()}` : '';

  return useQuery({
    queryKey: ['cyclesWithTotal', params],
    queryFn: () => fetchDataWithPagination<Cycle[]>(`/cycles${queryString}`),
  });
};

export const useCycle = (id: string) => {
  return useQuery({
    queryKey: ['cycle', id],
    queryFn: () => fetchData<Cycle>(`/cycles/${id}`),
    enabled: !!id,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
};

export const useCreateCycle = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Cycle>) => mutateData<Cycle, Partial<Cycle>>('/cycles', 'post', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
};

export const useUpdateCycle = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Cycle> }) =>
      mutateData<Cycle, Partial<Cycle>>(`/cycles/${id}`, 'put', data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
      queryClient.invalidateQueries({ queryKey: ['cycle', id] });
    },
  });
};

export const useDeleteCycle = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mutateData<void, undefined>(`/cycles/${id}`, 'delete'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
};

export const useGenerateMeetings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cycleId: string) =>
      mutateData<{ message: string; generated: number; total: number }, undefined>(
        `/cycles/${cycleId}/generate-meetings`,
        'post'
      ),
    onSuccess: (_, cycleId) => {
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
      queryClient.invalidateQueries({ queryKey: ['cycle', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['cycle-meetings', cycleId] });
    },
  });
};

export const useSyncCycleProgress = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cycleId: string) =>
      mutateData<Cycle & { synced: { completedMeetings: number; remainingMeetings: number; totalMeetings: number; meetingsInTable: number } }, undefined>(
        `/cycles/${cycleId}/sync-progress`,
        'post'
      ),
    onSuccess: (_, cycleId) => {
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
      queryClient.invalidateQueries({ queryKey: ['cycle', cycleId] });
    },
  });
};

export const useBulkGenerateMeetings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      mutateData<{ message: string; totalGenerated: number; results: any[] }, { ids: string[] }>(
        '/cycles/bulk-generate-meetings',
        'post',
        { ids }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
};

export const useBulkUpdateCycles = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { ids: string[]; data: Partial<Cycle> }) =>
      mutateData<{ message: string; updated: { id: string; name: string }[] }, { ids: string[]; data: Partial<Cycle> }>(
        '/cycles/bulk-update',
        'post',
        payload
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
};

// ==================== Cycle Meetings ====================
export const useCycleMeetings = (cycleId: string) => {
  return useQuery({
    queryKey: ['cycle-meetings', cycleId],
    queryFn: () => fetchData<Meeting[]>(`/cycles/${cycleId}/meetings`),
    enabled: !!cycleId,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
};

// ==================== Cycle Registrations ====================
export const useCycleRegistrations = (cycleId: string) => {
  return useQuery({
    queryKey: ['cycle-registrations', cycleId],
    queryFn: () => fetchData<Registration[]>(`/cycles/${cycleId}/registrations`),
    enabled: !!cycleId,
  });
};

export const useCreateRegistration = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cycleId, data }: { cycleId: string; data: Partial<Registration> }) =>
      mutateData<Registration, Partial<Registration>>(`/cycles/${cycleId}/registrations`, 'post', data),
    onSuccess: (_, { cycleId }) => {
      queryClient.invalidateQueries({ queryKey: ['cycle-registrations', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['cycle', cycleId] });
    },
  });
};

export const useUpdateRegistration = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ registrationId, cycleId, data }: { registrationId: string; cycleId: string; data: Partial<Registration> }) =>
      mutateData<Registration, Partial<Registration>>(`/registrations/${registrationId}`, 'put', data),
    onSuccess: (_, { cycleId }) => {
      queryClient.invalidateQueries({ queryKey: ['cycle-registrations', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['cycle', cycleId] });
    },
  });
};

export const useDeleteRegistration = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ registrationId, cycleId }: { registrationId: string; cycleId: string }) => 
      api.delete(`/registrations/${registrationId}`),
    onSuccess: (_, { cycleId }) => {
      queryClient.invalidateQueries({ queryKey: ['cycle-registrations', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['cycle', cycleId] });
    },
  });
};

// ==================== Meetings ====================
export const useMeetings = (params?: { date?: string; from?: string; to?: string; instructorId?: string; branchId?: string }) => {
  const searchParams = new URLSearchParams();
  if (params?.date) searchParams.append('date', params.date);
  if (params?.from) searchParams.append('from', params.from);
  if (params?.to) searchParams.append('to', params.to);
  if (params?.instructorId) searchParams.append('instructorId', params.instructorId);
  if (params?.branchId) searchParams.append('branchId', params.branchId);
  const queryString = searchParams.toString() ? `?${searchParams.toString()}` : '';

  return useQuery({
    queryKey: ['meetings', params],
    queryFn: () => fetchData<Meeting[]>(`/meetings${queryString}`),
  });
};

export const useMeeting = (id: string | undefined) => {
  return useQuery({
    queryKey: ['meeting', id],
    queryFn: () => fetchData<Meeting>(`/meetings/${id}`),
    enabled: !!id,
  });
};

export interface CreateMeetingData {
  cycleId: string;
  instructorId: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  withZoom?: boolean;
  activityType?: string;
  topic?: string;
  notes?: string;
}

export const useCreateMeeting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMeetingData) =>
      mutateData<Meeting, CreateMeetingData>('/meetings', 'post', data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['cycle-meetings', data.cycleId] });
      queryClient.invalidateQueries({ queryKey: ['cycle', data.cycleId] });
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
};

export const useUpdateMeeting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Meeting> }) =>
      mutateData<Meeting, Partial<Meeting>>(`/meetings/${id}`, 'put', data),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['meeting', id] });
      if (data.cycleId) {
        queryClient.invalidateQueries({ queryKey: ['cycle-meetings', data.cycleId] });
        queryClient.invalidateQueries({ queryKey: ['cycle', data.cycleId] });
      }
    },
  });
};

export const useDeleteMeeting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      mutateData<{ success: boolean }, null>(`/meetings/${id}`, 'delete', null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['cycle-meetings'] });
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
};

export const useBulkDeleteMeetings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      mutateData<{ success: boolean; deleted: number }, { ids: string[] }>('/meetings/bulk-delete', 'post', { ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['cycle-meetings'] });
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
};

export const useRecalculateMeeting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      mutateData<Meeting, object>(`/meetings/${id}/recalculate`, 'post', {}),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['meeting', id] });
      queryClient.invalidateQueries({ queryKey: ['cycle-meetings'] });
    },
  });
};

export const useBulkRecalculateMeetings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, force = true }: { ids: string[]; force?: boolean }) =>
      mutateData<{ success: boolean; recalculated: number }, { ids: string[]; force: boolean }>('/meetings/bulk-recalculate', 'post', { ids, force }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['cycle-meetings'] });
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
      // Invalidate all cycle queries to refresh progress stats
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'cycle' });
    },
  });
};

export const useBulkUpdateMeetingStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) =>
      mutateData<{ success: boolean; updated: number; errors?: string[] }, { ids: string[]; status: string }>(
        '/meetings/bulk-update-status',
        'post',
        { ids, status }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['cycle-meetings'] });
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
      // Invalidate all cycle queries to refresh progress stats
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'cycle' });
    },
  });
};

export const useBulkUpdateMeetings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, data }: { ids: string[]; data: Record<string, any> }) =>
      mutateData<{ success: boolean; updated: number; errors?: string[] }, { ids: string[]; data: Record<string, any> }>(
        '/meetings/bulk-update',
        'post',
        { ids, data }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['cycle-meetings'] });
      queryClient.invalidateQueries({ queryKey: ['cycles'] });
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'cycle' });
    },
  });
};

// ==================== Reports ====================
export const useDailyReport = (date: string) => {
  return useQuery({
    queryKey: ['daily-report', date],
    queryFn: () => fetchData<DailySummary>(`/reports/daily?date=${date}`),
    enabled: !!date,
  });
};

export const useMonthlyReport = (month: string) => {
  return useQuery({
    queryKey: ['monthly-report', month],
    queryFn: () => fetchData<any>(`/reports/monthly?month=${month}`),
    enabled: !!month,
  });
};

// ==================== Attendance ====================
export interface AttendanceRecord {
  registrationId: string | null;
  studentId: string | null;
  studentName: string;
  customerName: string | null;
  customerPhone: string | null;
  grade: string | null;
  status: 'present' | 'absent' | 'late' | null;
  isTrial: boolean;
  notes: string | null;
  attendanceId: string | null;
}

export interface AttendanceData {
  meetingId: string;
  cycleName: string;
  scheduledDate: string;
  attendance: AttendanceRecord[];
  stats: {
    total: number;
    present: number;
    absent: number;
    late: number;
    notMarked: number;
    trials: number;
  };
}

export interface StudentSearchResult {
  id: string;
  name: string;
  grade: string | null;
  customerName: string;
  customerPhone: string;
}

export const useMeetingAttendance = (meetingId: string | undefined) => {
  return useQuery({
    queryKey: ['attendance', meetingId],
    queryFn: () => fetchData<AttendanceData>(`/attendance/meeting/${meetingId}`),
    enabled: !!meetingId,
  });
};

export const useRecordAttendance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      meetingId,
      data,
    }: {
      meetingId: string;
      data: {
        registrationId?: string;
        studentId?: string;
        guestName?: string;
        status: 'present' | 'absent' | 'late';
        isTrial?: boolean;
        notes?: string;
      };
    }) => mutateData<any, any>(`/attendance/meeting/${meetingId}`, 'post', data),
    onSuccess: (_, { meetingId }) => {
      queryClient.invalidateQueries({ queryKey: ['attendance', meetingId] });
    },
  });
};

export const useBulkRecordAttendance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      meetingId,
      attendance,
    }: {
      meetingId: string;
      attendance: Array<{
        registrationId?: string;
        studentId?: string;
        guestName?: string;
        status: 'present' | 'absent' | 'late';
        isTrial?: boolean;
        notes?: string;
      }>;
    }) => mutateData<any, any>(`/attendance/meeting/${meetingId}/bulk`, 'put', { attendance }),
    onSuccess: (_, { meetingId }) => {
      queryClient.invalidateQueries({ queryKey: ['attendance', meetingId] });
    },
  });
};

export const useSearchStudentsForAttendance = (meetingId: string | undefined, search: string) => {
  return useQuery({
    queryKey: ['attendance-search', meetingId, search],
    queryFn: () =>
      fetchData<StudentSearchResult[]>(
        `/attendance/meeting/${meetingId}/search-students?search=${encodeURIComponent(search)}`
      ),
    enabled: !!meetingId && search.length >= 2,
  });
};

export const useDeleteAttendance = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mutateData<void, void>(`/attendance/${id}`, 'delete'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
};

// ==================== Views ====================

export const useViewData = (
  viewId: string | null, 
  additionalFilters: Array<{ field: string; operator: string; value?: any }> = [],
  page: number = 1, 
  limit: number = 50
) => {
  return useQuery({
    queryKey: ['view-data', viewId, JSON.stringify(additionalFilters), page, limit],
    queryFn: async () => {
      const response = await api.post(`/views/${viewId}/apply?page=${page}&limit=${limit}`, {
        additionalFilters,
      });
      return response.data;
    },
    enabled: !!viewId,
  });
};

// ==================== Communication ====================

export const useSendWhatsApp = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ phone, message, customerId, customerName }: { phone: string; message: string; customerId?: string; customerName?: string }) =>
      mutateData<{ success: boolean }, { phone: string; message: string; customerId?: string; customerName?: string }>(
        '/communication/whatsapp',
        'post',
        { phone, message, customerId, customerName }
      ),
    onSuccess: (_, { customerId }) => {
      if (customerId) {
        queryClient.invalidateQueries({ queryKey: ['communication-history', customerId] });
      }
    },
  });
};

export const useSendEmail = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ to, subject, body, customerId, customerName }: { to: string; subject: string; body: string; customerId?: string; customerName?: string }) =>
      mutateData<{ success: boolean }, { to: string; subject: string; body: string; customerId?: string; customerName?: string }>(
        '/communication/email',
        'post',
        { to, subject, body, customerId, customerName }
      ),
    onSuccess: (_, { customerId }) => {
      if (customerId) {
        queryClient.invalidateQueries({ queryKey: ['communication-history', customerId] });
      }
    },
  });
};

// ==================== Zoom ====================

interface ZoomMeeting {
  hasMeeting: boolean;
  canCreate?: boolean;
  meetingExists?: boolean;
  zoomMeetingId?: string;
  zoomJoinUrl?: string;
  zoomHostKey?: string;
  zoomPassword?: string;
  zoomHostEmail?: string;
}

interface ZoomCreateResponse {
  success: boolean;
  cycle: {
    id: string;
    name: string;
    zoomMeetingId: string;
    zoomJoinUrl: string;
    zoomHostKey: string | null;
    zoomPassword: string;
  };
  hostUser: {
    id: string;
    email: string;
    name: string;
  };
}

export const useZoomMeeting = (cycleId: string) => {
  return useQuery({
    queryKey: ['zoom-meeting', cycleId],
    queryFn: () => fetchData<ZoomMeeting>(`/zoom/cycles/${cycleId}/meeting`),
    enabled: !!cycleId,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
};

export const useCreateZoomMeeting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cycleId: string) =>
      mutateData<ZoomCreateResponse, undefined>(`/zoom/cycles/${cycleId}/meeting`, 'post'),
    onSuccess: (_, cycleId) => {
      queryClient.invalidateQueries({ queryKey: ['zoom-meeting', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['cycle', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['cycle-meetings', cycleId] });
    },
  });
};

export const useDeleteZoomMeeting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cycleId: string) =>
      api.delete(`/zoom/cycles/${cycleId}/meeting`),
    onSuccess: (_, cycleId) => {
      queryClient.invalidateQueries({ queryKey: ['zoom-meeting', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['cycle', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['cycle-meetings', cycleId] });
    },
  });
};

// ==================== Messaging ====================

export const useMessageTemplates = () => {
  return useQuery({
    queryKey: ['message-templates'],
    queryFn: () => fetchData<any[]>('/messaging/templates'),
  });
};

export const useSendMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      instructorId: string;
      channel: 'whatsapp' | 'email';
      templateId?: string;
      customMessage?: string;
      customSubject?: string;
      meetingId?: string;
    }) => mutateData<{ success: boolean; messageId?: string }, typeof data>('/messaging/send', 'post', data),
    onSuccess: (_, { instructorId }) => {
      queryClient.invalidateQueries({ queryKey: ['message-logs', instructorId] });
    },
  });
};

export const useBulkSendMessage = () => {
  return useMutation({
    mutationFn: (data: {
      instructorIds: string[];
      channel: 'whatsapp' | 'email';
      templateId: string;
      customMessage?: string;
    }) => mutateData<{ sent: number; failed: number; errors: string[] }, typeof data>('/messaging/bulk-send', 'post', data),
  });
};

export const useMessageLogs = (instructorId?: string) => {
  return useQuery({
    queryKey: ['message-logs', instructorId],
    queryFn: () => fetchData<any[]>(instructorId ? `/messaging/logs/${instructorId}` : '/messaging/logs'),
    enabled: true,
  });
};

export const useInstructorMeetings = (instructorId: string | undefined, date: string) => {
  return useQuery({
    queryKey: ['instructor-meetings', instructorId, date],
    queryFn: () => fetchData<any[]>(`/meetings?instructorId=${instructorId}&date=${date}`),
    enabled: !!instructorId,
  });
};

// Re-export api for direct use in components
export { api };
