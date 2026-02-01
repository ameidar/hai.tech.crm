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

// API response wrapper type
interface PaginatedResponse<T> {
  data: T;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Generic fetch function - handles both paginated and direct responses
const fetchData = async <T>(url: string): Promise<T> => {
  const response = await api.get<T | PaginatedResponse<T>>(url);
  // If response has data property with pagination, extract the data array
  if (response.data && typeof response.data === 'object' && 'data' in response.data && 'pagination' in response.data) {
    return (response.data as PaginatedResponse<T>).data;
  }
  return response.data as T;
};

// Generic mutation function
const mutateData = async <T, D>(url: string, method: 'post' | 'put' | 'delete', data?: D): Promise<T> => {
  const response = await api[method]<T>(url, data);
  return response.data;
};

// ==================== Customers ====================
export const useCustomers = (params?: { search?: string }) => {
  const searchParam = params?.search ? `?search=${encodeURIComponent(params.search)}` : '';
  return useQuery({
    queryKey: ['customers', params?.search],
    queryFn: () => fetchData<Customer[]>(`/customers${searchParam}`),
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

// ==================== Students ====================
export const useStudents = (customerId?: string) => {
  const url = customerId ? `/customers/${customerId}/students` : '/students';
  return useQuery({
    queryKey: ['students', customerId],
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

// ==================== Cycles ====================
export const useCycles = (params?: { branchId?: string; instructorId?: string; status?: string; dayOfWeek?: string; search?: string; limit?: number }) => {
  const searchParams = new URLSearchParams();
  if (params?.branchId) searchParams.append('branchId', params.branchId);
  if (params?.instructorId) searchParams.append('instructorId', params.instructorId);
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

export const useCycle = (id: string) => {
  return useQuery({
    queryKey: ['cycle', id],
    queryFn: () => fetchData<Cycle>(`/cycles/${id}`),
    enabled: !!id,
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

// ==================== Cycle Meetings ====================
export const useCycleMeetings = (cycleId: string) => {
  return useQuery({
    queryKey: ['cycle-meetings', cycleId],
    queryFn: () => fetchData<Meeting[]>(`/cycles/${cycleId}/meetings`),
    enabled: !!cycleId,
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

export const useMeeting = (id: string) => {
  return useQuery({
    queryKey: ['meeting', id],
    queryFn: () => fetchData<Meeting>(`/meetings/${id}`),
    enabled: !!id,
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

export const useBulkRecalculateMeetings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      mutateData<{ success: boolean; recalculated: number }, { ids: string[] }>('/meetings/bulk-recalculate', 'post', { ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['cycle-meetings'] });
    },
  });
};

export const useRecalculateMeeting = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      mutateData<Meeting, object>(`/meetings/${id}/recalculate`, 'post', {}),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['meeting', data.id] });
      if (data.cycleId) {
        queryClient.invalidateQueries({ queryKey: ['cycle-meetings', data.cycleId] });
      }
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
