import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchData, mutateData } from './useApi';

// Types
export interface CycleExpense {
  id: string;
  cycleId: string;
  type: 'materials' | 'wraparound_hours' | 'equipment' | 'travel_fixed' | 'additional_instructor' | 'other';
  description?: string;
  amount?: number | null;
  isPercentage?: boolean;
  percentage?: number | null;
  hours?: number | null;
  rateType?: 'preparation' | 'online' | 'frontal' | null;
  instructorId?: string;
  instructor?: { 
    id: string; 
    name: string;
    ratePreparation?: number;
    rateOnline?: number;
    rateFrontal?: number;
    employmentType?: 'freelancer' | 'employee';
  };
  createdAt: string;
  updatedAt: string;
}

export interface MeetingExpense {
  id: string;
  meetingId: string;
  type: 'travel' | 'taxi' | 'extra_instructor' | 'materials' | 'other';
  description?: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  submittedBy?: string;
  approvedBy?: string;
  instructorId?: string;
  instructor?: {
    id: string;
    name: string;
    ratePreparation?: number;
    rateOnline?: number;
    rateFrontal?: number;
    employmentType?: 'freelancer' | 'employee';
  };
  rateType?: 'preparation' | 'online' | 'frontal';
  hours?: number;
  createdAt: string;
  updatedAt: string;
}

// Cycle Expenses Hooks
export function useCycleExpenses(cycleId: string) {
  return useQuery({
    queryKey: ['cycle-expenses', cycleId],
    queryFn: () => fetchData<CycleExpense[]>(`/expenses/cycle/${cycleId}`),
    enabled: !!cycleId,
  });
}

export function useCreateCycleExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { 
      cycleId: string; 
      type: string; 
      description?: string; 
      amount?: number; 
      instructorId?: string;
      isPercentage?: boolean;
      percentage?: number;
      hours?: number;
      rateType?: string;
    }) =>
      mutateData<CycleExpense, typeof data>('/expenses/cycle', 'post', data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cycle-expenses', variables.cycleId] });
    },
  });
}

export function useDeleteCycleExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cycleId }: { id: string; cycleId: string }) =>
      mutateData<void, never>(`/expenses/cycle/${id}`, 'delete'),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['cycle-expenses', variables.cycleId] });
    },
  });
}

// Calculate additional instructor cost for a cycle
export interface InstructorCostCalculation {
  hourlyRate: number;
  costPerMeeting: number;
  totalCost: number;
  durationMinutes: number;
  totalMeetings: number;
  activityType: string;
}

export function useCalculateInstructorCost(cycleId: string, instructorId: string | null) {
  return useQuery({
    queryKey: ['instructor-cost', cycleId, instructorId],
    queryFn: () => fetchData<InstructorCostCalculation>(`/expenses/cycle/${cycleId}/calculate-instructor-cost/${instructorId}`),
    enabled: !!cycleId && !!instructorId,
  });
}

// Meeting Expenses Hooks
export function useMeetingExpenses(meetingId: string) {
  return useQuery({
    queryKey: ['meeting-expenses', meetingId],
    queryFn: () => fetchData<MeetingExpense[]>(`/expenses/meeting/${meetingId}`),
    enabled: !!meetingId,
  });
}

export function useCreateMeetingExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { 
      meetingId: string; 
      type: string; 
      description?: string; 
      amount?: number;
      instructorId?: string;
      rateType?: string;
    }) =>
      mutateData<MeetingExpense, typeof data>('/expenses/meeting', 'post', data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['meeting-expenses', variables.meetingId] });
      // Also invalidate meeting data to reflect updated profit
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
    },
  });
}

export function useDeleteMeetingExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, meetingId }: { id: string; meetingId: string }) =>
      mutateData<void, never>(`/expenses/meeting/${id}`, 'delete'),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['meeting-expenses', variables.meetingId] });
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
    },
  });
}
