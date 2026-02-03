import axios from 'axios';

// Zoom API configuration
const ZOOM_ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;

interface ZoomToken {
  access_token: string;
  expires_at: number;
}

interface ZoomUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  type: number;
  status: string;
  host_key?: string;
}

interface ZoomMeeting {
  id: number;
  uuid: string;
  host_id: string;
  topic: string;
  type: number;
  start_time: string;
  duration: number;
  timezone: string;
  join_url: string;
  start_url: string;
  password: string;
  host_key?: string;
}

interface CreateMeetingParams {
  topic: string;
  startTime: Date;
  duration: number; // in minutes
  timezone?: string;
  recurrence?: {
    type: number; // 1=daily, 2=weekly, 3=monthly
    repeat_interval: number;
    weekly_days?: string; // "1,2,3,4,5,6,7" (Sun=1)
    end_date_time?: string;
    end_times?: number;
  };
}

let cachedToken: ZoomToken | null = null;

/**
 * Get Zoom access token using Server-to-Server OAuth
 */
async function getAccessToken(): Promise<string> {
  // Check if we have a valid cached token
  if (cachedToken && cachedToken.expires_at > Date.now() + 60000) {
    return cachedToken.access_token;
  }

  const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
  
  const response = await axios.post(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
    null,
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  cachedToken = {
    access_token: response.data.access_token,
    expires_at: Date.now() + (response.data.expires_in * 1000)
  };

  return cachedToken.access_token;
}

/**
 * Make authenticated request to Zoom API
 */
async function zoomRequest<T>(method: string, endpoint: string, data?: any): Promise<T> {
  const token = await getAccessToken();
  
  const response = await axios({
    method,
    url: `https://api.zoom.us/v2${endpoint}`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    data
  });

  return response.data;
}

/**
 * Get all Zoom users
 */
export async function getUsers(): Promise<ZoomUser[]> {
  const response = await zoomRequest<{ users: ZoomUser[] }>('GET', '/users?page_size=100');
  return response.users;
}

/**
 * Get user's host key
 */
export async function getUserHostKey(userId: string): Promise<string | null> {
  try {
    const response = await zoomRequest<{ host_key: string }>('GET', `/users/${userId}?login_type=100`);
    return response.host_key || null;
  } catch (error) {
    console.error(`Failed to get host key for user ${userId}:`, error);
    return null;
  }
}

/**
 * Get scheduled meetings for a user
 */
export async function getUserMeetings(userId: string, from?: Date, to?: Date): Promise<ZoomMeeting[]> {
  const params = new URLSearchParams({ page_size: '300' });
  if (from) params.append('from', from.toISOString().split('T')[0]);
  if (to) params.append('to', to.toISOString().split('T')[0]);
  
  const response = await zoomRequest<{ meetings: ZoomMeeting[] }>(
    'GET', 
    `/users/${userId}/meetings?${params.toString()}`
  );
  return response.meetings || [];
}

/**
 * Check if a user is available at a given time
 */
export async function isUserAvailable(
  userId: string, 
  startTime: Date, 
  durationMinutes: number
): Promise<boolean> {
  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
  
  // Get meetings for that day
  const from = new Date(startTime);
  from.setHours(0, 0, 0, 0);
  const to = new Date(startTime);
  to.setHours(23, 59, 59, 999);
  
  const meetings = await getUserMeetings(userId, from, to);
  
  for (const meeting of meetings) {
    const meetingStart = new Date(meeting.start_time);
    const meetingEnd = new Date(meetingStart.getTime() + meeting.duration * 60000);
    
    // Check for overlap
    if (startTime < meetingEnd && endTime > meetingStart) {
      return false;
    }
  }
  
  return true;
}

/**
 * Find an available Zoom user for a given time slot
 */
export async function findAvailableUser(
  startTime: Date, 
  durationMinutes: number
): Promise<ZoomUser | null> {
  const users = await getUsers();
  
  for (const user of users) {
    if (user.status !== 'active') continue;
    
    const available = await isUserAvailable(user.id, startTime, durationMinutes);
    if (available) {
      // Get host key for this user
      const hostKey = await getUserHostKey(user.id);
      return { ...user, host_key: hostKey || undefined };
    }
  }
  
  return null;
}

/**
 * Create a Zoom meeting
 */
export async function createMeeting(
  hostId: string, 
  params: CreateMeetingParams
): Promise<ZoomMeeting & { host_key?: string }> {
  const meetingData: any = {
    topic: params.topic,
    type: params.recurrence ? 8 : 2, // 8 = recurring with fixed time, 2 = scheduled
    start_time: params.startTime.toISOString(),
    duration: params.duration,
    timezone: params.timezone || 'Asia/Jerusalem',
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: true,
      waiting_room: false,
      mute_upon_entry: true,
      auto_recording: 'none'
    }
  };

  if (params.recurrence) {
    meetingData.recurrence = params.recurrence;
  }

  const meeting = await zoomRequest<ZoomMeeting>('POST', `/users/${hostId}/meetings`, meetingData);
  
  // Get host key
  const hostKey = await getUserHostKey(hostId);
  
  return { ...meeting, host_key: hostKey || undefined };
}

/**
 * Delete a Zoom meeting
 */
export async function deleteMeeting(meetingId: string | number): Promise<void> {
  await zoomRequest('DELETE', `/meetings/${meetingId}`);
}

/**
 * Get meeting details
 */
export async function getMeeting(meetingId: string | number): Promise<ZoomMeeting | null> {
  try {
    return await zoomRequest<ZoomMeeting>('GET', `/meetings/${meetingId}`);
  } catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Create a recurring meeting for a cycle
 */
export async function createCycleMeeting(params: {
  cycleName: string;
  startDate: Date;
  endDate: Date;
  dayOfWeek: number; // 1=Sunday, 7=Saturday
  startTime: string; // HH:MM format
  durationMinutes: number;
}): Promise<{ meeting: ZoomMeeting; hostUser: ZoomUser } | null> {
  // Build the first meeting datetime
  const [hours, minutes] = params.startTime.split(':').map(Number);
  const firstMeeting = new Date(params.startDate);
  firstMeeting.setHours(hours, minutes, 0, 0);
  
  // Find available user
  const availableUser = await findAvailableUser(firstMeeting, params.durationMinutes);
  if (!availableUser) {
    return null;
  }

  // Calculate number of occurrences
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const totalWeeks = Math.ceil((params.endDate.getTime() - params.startDate.getTime()) / msPerWeek);
  
  // Create recurring meeting
  const meeting = await createMeeting(availableUser.id, {
    topic: params.cycleName,
    startTime: firstMeeting,
    duration: params.durationMinutes,
    timezone: 'Asia/Jerusalem',
    recurrence: {
      type: 2, // Weekly
      repeat_interval: 1,
      weekly_days: String(params.dayOfWeek),
      end_times: Math.min(totalWeeks + 1, 50) // Max 50 occurrences
    }
  });

  return { meeting, hostUser: availableUser };
}

export const zoomService = {
  getUsers,
  getUserHostKey,
  getUserMeetings,
  isUserAvailable,
  findAvailableUser,
  createMeeting,
  deleteMeeting,
  getMeeting,
  createCycleMeeting
};
