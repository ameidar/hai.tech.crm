/**
 * Google Drive Service
 * Lists files and folders from the HaiTech Drive using a Service Account
 */

import { google } from 'googleapis';
import path from 'path';

// In Docker container, process.cwd() = /app (the working directory)
// credentials/ is at /app/credentials/google-drive-sa.json
const SA_PATH = path.join(process.cwd(), 'credentials/google-drive-sa.json');

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  iconLink?: string;
  size?: string;
  modifiedTime?: string;
  isFolder: boolean;
}

let driveClient: ReturnType<typeof google.drive> | null = null;

function getDriveClient() {
  if (driveClient) return driveClient;
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: SA_PATH,
      // Full drive access needed for creating/uploading files
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    driveClient = google.drive({ version: 'v3', auth });
    return driveClient;
  } catch (err) {
    console.error('[GoogleDrive] Failed to initialize:', err);
    throw new Error('Google Drive service not configured');
  }
}

/**
 * List files/folders inside a Google Drive folder
 */
export async function listDriveFolder(folderId: string): Promise<DriveFile[]> {
  const drive = getDriveClient();

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    pageSize: 100,
    fields: 'files(id, name, mimeType, webViewLink, iconLink, size, modifiedTime)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    orderBy: 'folder,name',
  });

  return (res.data.files || []).map(f => ({
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    webViewLink: f.webViewLink || undefined,
    iconLink: f.iconLink || undefined,
    size: f.size || undefined,
    modifiedTime: f.modifiedTime || undefined,
    isFolder: f.mimeType === 'application/vnd.google-apps.folder',
  }));
}

/**
 * Get a direct view link for a Drive file/folder
 */
export function getDriveViewUrl(fileId: string): string {
  return `https://drive.google.com/open?id=${fileId}`;
}

const AI_FOLDER_NAME = '📚 מערכי שיעור AI';
const SHARED_DRIVE_ID = '0AOtxV5IPmcnqUk9PVA';

/**
 * Find or create a subfolder by name inside a parent folder
 */
async function findOrCreateFolder(parentId: string, name: string): Promise<string> {
  const drive = getDriveClient();

  // Try to find existing folder
  const existing = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (existing.data.files && existing.data.files.length > 0) {
    return existing.data.files[0].id!;
  }

  // Create new folder
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    supportsAllDrives: true,
    fields: 'id',
  });

  return created.data.id!;
}

/**
 * Upload a lesson plan as a Google Doc to Drive
 * Places it in: [courseFolderId]/📚 מערכי שיעור AI/[filename]
 * or in root Shared Drive AI folder if no course folder
 */
export async function uploadLessonPlan(params: {
  title: string;
  content: string;
  courseFolderId?: string | null;
}): Promise<{ fileId: string; webViewLink: string }> {
  const drive = getDriveClient();

  // Determine parent folder
  const parentId = params.courseFolderId || SHARED_DRIVE_ID;
  const aiFolderId = await findOrCreateFolder(parentId, AI_FOLDER_NAME);

  // Create Google Doc from plain text
  const file = await drive.files.create({
    requestBody: {
      name: params.title,
      mimeType: 'application/vnd.google-apps.document',
      parents: [aiFolderId],
    },
    media: {
      mimeType: 'text/plain',
      body: params.content,
    },
    supportsAllDrives: true,
    fields: 'id, webViewLink',
  });

  return {
    fileId: file.data.id!,
    webViewLink: file.data.webViewLink || `https://drive.google.com/open?id=${file.data.id}`,
  };
}

/**
 * Map Google Drive MIME types to human-readable labels
 */
export function getMimeTypeLabel(mimeType: string): string {
  const map: Record<string, string> = {
    'application/vnd.google-apps.folder': 'תיקייה',
    'application/vnd.google-apps.document': 'מסמך Google',
    'application/vnd.google-apps.spreadsheet': 'גיליון Google',
    'application/vnd.google-apps.presentation': 'מצגת Google',
    'application/pdf': 'PDF',
    'video/mp4': 'וידאו',
    'audio/mpeg': 'אודיו',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  };
  return map[mimeType] || 'קובץ';
}
