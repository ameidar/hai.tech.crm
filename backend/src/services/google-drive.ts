/**
 * Google Drive Service
 * Lists files and folders from the HaiTech Drive using a Service Account
 */

import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SA_PATH = path.join(__dirname, '../../credentials/google-drive-sa.json');

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
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
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
