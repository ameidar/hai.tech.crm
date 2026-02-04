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

// Local host key mapping (Zoom API requires admin scope to read host keys)
const HOST_KEYS: Record<string, string> = {
  'hila@hai.tech': '576706',
  'alonad78@gmail.com': '161988',
  'shaul@hai.tech': '152303',
  'inna_grois@yahoo.com': '983810',
  'innagrois@gmail.com': '184874',
  'inna@hai.tech': '740578',
  'info@hai.tech': '296693',
  'hai.tech.teacher@gmail.com': '982294',
};

/**
 * Get user's host key - uses local lookup since Zoom API requires admin scope
 */
export async function getUserHostKey(userId: string): Promise<string | null> {
  console.log(`[Zoom] getUserHostKey called for userId: ${userId}`);
  try {
    // First get the user's email
    const user = await zoomRequest<{ email: string; host_key?: string }>('GET', `/users/${userId}`);
    console.log(`[Zoom] User email for ${userId}: ${user.email}`);
    
    // Check local mapping first (Zoom API often doesn't return host_key without admin scope)
    const localHostKey = HOST_KEYS[user.email.toLowerCase()];
    if (localHostKey) {
      console.log(`[Zoom] Found host key in local mapping for ${user.email}: ${localHostKey}`);
      return localHostKey;
    }
    
    // Fall back to API response if available
    if (user.host_key) {
      console.log(`[Zoom] Got host key from API for ${userId}: ${user.host_key}`);
      return user.host_key;
    }
    
    console.log(`[Zoom] No host key found for ${user.email}`);
    return null;
  } catch (error: any) {
    console.error(`[Zoom] Failed to get host key for user ${userId}:`, error.message);
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
  const requestedDayOfWeek = startTime.getUTCDay(); // Use UTC day of week
  
  // Get all meetings for this user (not just for the specific day)
  // We need to check recurring meetings that might occur on the same day of week
  const meetings = await getUserMeetings(userId);
  
  console.log(`[Zoom] Checking availability for user ${userId} at ${startTime.toISOString()} (${durationMinutes} min)`);
  console.log(`[Zoom] Requested day of week (UTC): ${requestedDayOfWeek}`);
  console.log(`[Zoom] Found ${meetings.length} meetings to check`);
  
  for (const meeting of meetings) {
    const meetingStart = new Date(meeting.start_time);
    const meetingDuration = meeting.duration;
    
    console.log(`[Zoom] Checking meeting: "${meeting.topic}" type=${meeting.type} start=${meeting.start_time} duration=${meetingDuration}`);
    
    // For recurring meetings (type 8), check if this day of week would conflict
    if (meeting.type === 8) {
      const meetingDayOfWeek = meetingStart.getUTCDay(); // Use UTC day of week
      
      console.log(`[Zoom]   Meeting day of week (UTC): ${meetingDayOfWeek}, requested: ${requestedDayOfWeek}`);
      
      // If meeting is on a different day of week, no conflict
      if (meetingDayOfWeek !== requestedDayOfWeek) {
        console.log(`[Zoom]   Different day of week, skipping`);
        continue;
      }
      
      // Same day of week - check time overlap using UTC consistently
      const meetingTimeMinutes = meetingStart.getUTCHours() * 60 + meetingStart.getUTCMinutes();
      const meetingEndTimeMinutes = meetingTimeMinutes + meetingDuration;
      
      const requestedTimeMinutes = startTime.getUTCHours() * 60 + startTime.getUTCMinutes();
      const requestedEndTimeMinutes = requestedTimeMinutes + durationMinutes;
      
      console.log(`[Zoom]   Existing time (UTC min): ${meetingTimeMinutes} - ${meetingEndTimeMinutes}`);
      console.log(`[Zoom]   Requested time (UTC min): ${requestedTimeMinutes} - ${requestedEndTimeMinutes}`);
      
      // Check for time overlap
      if (requestedTimeMinutes < meetingEndTimeMinutes && requestedEndTimeMinutes > meetingTimeMinutes) {
        console.log(`[Zoom] CONFLICT: Recurring meeting "${meeting.topic}" on same day of week with overlapping time`);
        return false;
      }
      console.log(`[Zoom]   No overlap`);
    } else {
      // For non-recurring meetings, check exact date/time overlap
      const meetingEnd = new Date(meetingStart.getTime() + meetingDuration * 60000);
      
      if (startTime < meetingEnd && endTime > meetingStart) {
        console.log(`[Zoom] CONFLICT: Non-recurring meeting "${meeting.topic}" overlaps`);
        return false;
      }
    }
  }
  
  console.log(`[Zoom] User ${userId} is AVAILABLE`);
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
  
  console.log(`[Zoom] Finding available user for ${startTime.toISOString()} (${durationMinutes} min)`);
  console.log(`[Zoom] Checking ${users.length} users...`);
  
  for (const user of users) {
    if (user.status !== 'active') {
      console.log(`[Zoom] Skipping inactive user: ${user.email}`);
      continue;
    }
    
    console.log(`[Zoom] Checking user: ${user.email}`);
    const available = await isUserAvailable(user.id, startTime, durationMinutes);
    if (available) {
      console.log(`[Zoom] FOUND available user: ${user.email}`);
      // Get host key for this user
      const hostKey = await getUserHostKey(user.id);
      return { ...user, host_key: hostKey || undefined };
    }
    console.log(`[Zoom] User ${user.email} is NOT available`);
  }
  
  console.log(`[Zoom] NO available users found!`);
  return null;
}

/**
 * Create a Zoom meeting
 */
export async function createMeeting(
  hostId: string, 
  params: CreateMeetingParams
): Promise<ZoomMeeting & { host_key?: string }> {
  // Format start_time for Zoom - send in Israel local time since timezone is Asia/Jerusalem
  // Convert UTC date to Israel local time (UTC+2) for display
  const pad = (n: number) => n.toString().padStart(2, '0');
  const d = params.startTime;
  
  // Add 2 hours to UTC to get Israel time (simplified - doesn't handle DST)
  const israelTime = new Date(d.getTime() + 2 * 60 * 60 * 1000);
  const localTimeStr = `${israelTime.getUTCFullYear()}-${pad(israelTime.getUTCMonth() + 1)}-${pad(israelTime.getUTCDate())}T${pad(israelTime.getUTCHours())}:${pad(israelTime.getUTCMinutes())}:00`;
  
  console.log('[Zoom] Creating meeting with startTime:', {
    inputDateUTC: d.toISOString(),
    israelTimeConverted: israelTime.toISOString(),
    formattedLocalTime: localTimeStr,
    timezone: params.timezone || 'Asia/Jerusalem',
    duration: params.duration,
  });
  
  const meetingData: any = {
    topic: params.topic,
    type: params.recurrence ? 8 : 2, // 8 = recurring with fixed time, 2 = scheduled
    start_time: localTimeStr,
    duration: params.duration,
    timezone: params.timezone || 'Asia/Jerusalem',
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: true,
      waiting_room: false,
      mute_upon_entry: true,
      auto_recording: 'none',
      meeting_authentication: false,
      alternative_hosts: 'hai.tech.teacher@gmail.com',
      alternative_hosts_email_notification: false,
      use_pmi: false
    }
  };

  if (params.recurrence) {
    meetingData.recurrence = params.recurrence;
  }
  
  console.log('[Zoom] Full meeting data being sent:', JSON.stringify(meetingData, null, 2));

  const meeting = await zoomRequest<ZoomMeeting>('POST', `/users/${hostId}/meetings`, meetingData);
  
  console.log('[Zoom] Meeting created response:', JSON.stringify(meeting, null, 2));
  
  // Get host key
  console.log('[Zoom] About to fetch host key for hostId:', hostId);
  const hostKey = await getUserHostKey(hostId);
  console.log('[Zoom] Fetched host key:', hostKey);
  
  return { ...meeting, host_key: hostKey || undefined };
}

/**
 * Delete a Zoom meeting
 */
export async function deleteMeeting(meetingId: string | number): Promise<void> {
  await zoomRequest('DELETE', `/meetings/${meetingId}`);
}

/**
 * Delete all cloud recordings for a meeting
 */
export async function deleteRecordings(meetingId: string | number): Promise<void> {
  try {
    // Delete all recordings for this meeting
    await zoomRequest('DELETE', `/meetings/${meetingId}/recordings`);
    console.log(`[Zoom] Deleted cloud recordings for meeting ${meetingId}`);
  } catch (error: any) {
    // Ignore 404 (no recordings) or other errors - recordings might not exist
    if (error.response?.status === 404) {
      console.log(`[Zoom] No recordings found for meeting ${meetingId}`);
    } else {
      console.error(`[Zoom] Failed to delete recordings for meeting ${meetingId}:`, error.message);
    }
  }
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
  startTime: string; // HH:MM format (Israel local time)
  durationMinutes: number;
  totalOccurrences?: number; // Override calculated occurrences
}): Promise<{ meeting: ZoomMeeting; hostUser: ZoomUser } | null> {
  // Build the first meeting datetime
  // startTime is in Israel local time (HH:MM), we need to create a proper datetime
  // Start Zoom meeting 10 minutes early to allow participants to join before the lesson
  let [hours, minutes] = params.startTime.split(':').map(Number);
  minutes -= 10;
  if (minutes < 0) {
    minutes += 60;
    hours -= 1;
    if (hours < 0) hours = 23;
  }
  
  // Create date string in ISO format for Israel timezone
  const startDateStr = params.startDate.toISOString().split('T')[0];
  const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
  
  // Find the next occurrence of the weekday from today (or startDate if in the future)
  const now = new Date();
  let baseDate = params.startDate > now ? params.startDate : now;
  
  // Convert Zoom day of week (1=Sun, 2=Mon, ..., 7=Sat) to JS day of week (0=Sun, 1=Mon, ..., 6=Sat)
  const targetDowJs = params.dayOfWeek === 1 ? 0 : params.dayOfWeek - 1;
  const currentDow = baseDate.getDay();
  
  // Calculate days until next occurrence
  let daysUntilNext = (targetDowJs - currentDow + 7) % 7;
  // If it's today and time hasn't passed, use today; otherwise next week
  if (daysUntilNext === 0) {
    const todayMeeting = new Date(baseDate);
    todayMeeting.setHours(hours, minutes, 0, 0);
    if (todayMeeting <= now) {
      daysUntilNext = 7; // Next week
    }
  }
  
  // Calculate the first meeting date
  const firstMeetingDate = new Date(baseDate);
  firstMeetingDate.setDate(firstMeetingDate.getDate() + daysUntilNext);
  const firstMeetingDateStr = `${firstMeetingDate.getFullYear()}-${(firstMeetingDate.getMonth() + 1).toString().padStart(2, '0')}-${firstMeetingDate.getDate().toString().padStart(2, '0')}`;
  
  // Create the firstMeeting datetime in UTC
  // The timeStr is in Israel local time, we need to convert to UTC
  // Israel is UTC+2 (or UTC+3 during DST, but Zoom handles DST)
  // Create date in Israel timezone by appending the timezone offset
  const israelDateStr = `${firstMeetingDateStr}T${timeStr}+02:00`;
  const firstMeeting = new Date(israelDateStr);
  
  console.log('[Zoom] createCycleMeeting:', {
    startTime: params.startTime,
    originalStartDate: startDateStr,
    calculatedFirstMeetingDate: firstMeetingDateStr,
    timeStr,
    israelDateStr,
    zoomDayOfWeek: params.dayOfWeek,
    targetDowJs: targetDowJs,
    currentDow,
    daysUntilNext,
    firstMeetingISO: firstMeeting.toISOString(),
    firstMeetingUTCHours: firstMeeting.getUTCHours(),
  });
  
  // Find available user
  const availableUser = await findAvailableUser(firstMeeting, params.durationMinutes);
  if (!availableUser) {
    return null;
  }

  // Calculate number of occurrences
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const totalWeeks = Math.ceil((params.endDate.getTime() - params.startDate.getTime()) / msPerWeek);
  const occurrences = params.totalOccurrences || totalWeeks + 1;
  
  // Create recurring meeting
  // Add 10 minutes to duration to cover the early start
  const meeting = await createMeeting(availableUser.id, {
    topic: params.cycleName,
    startTime: firstMeeting,
    duration: params.durationMinutes + 10,
    timezone: 'Asia/Jerusalem',
    recurrence: {
      type: 2, // Weekly
      repeat_interval: 1,
      weekly_days: String(params.dayOfWeek),
      end_times: Math.min(occurrences, 50) // Max 50 occurrences
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
  deleteRecordings,
  getMeeting,
  createCycleMeeting
};
