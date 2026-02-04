import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import os from 'os';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize OpenAI client
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

/**
 * Download a file from URL to a temporary location
 */
async function downloadFile(url: string, filename: string): Promise<string> {
  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, filename);
  
  console.log(`[Transcription] Downloading file to ${filePath}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }
  
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(buffer));
  
  const stats = fs.statSync(filePath);
  console.log(`[Transcription] Downloaded ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  
  return filePath;
}

/**
 * Transcribe audio file using OpenAI Whisper API
 */
export async function transcribeAudio(audioUrl: string): Promise<string> {
  if (!openai) {
    throw new Error('OpenAI API key not configured');
  }
  
  console.log('[Transcription] Starting transcription...');
  
  // Download the audio file
  const filename = `zoom-audio-${Date.now()}.m4a`;
  const filePath = await downloadFile(audioUrl, filename);
  
  try {
    // Check file size - Whisper has 25MB limit
    const stats = fs.statSync(filePath);
    const fileSizeMB = stats.size / 1024 / 1024;
    
    if (fileSizeMB > 25) {
      console.log(`[Transcription] File is ${fileSizeMB.toFixed(2)}MB, exceeds 25MB limit. Will need chunking in future.`);
      // For now, throw error - we can implement chunking later if needed
      throw new Error(`Audio file too large (${fileSizeMB.toFixed(2)}MB). Maximum is 25MB.`);
    }
    
    // Transcribe using Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1',
      language: 'he', // Hebrew
      response_format: 'text'
    });
    
    console.log(`[Transcription] Transcription complete: ${transcription.length} characters`);
    
    return transcription;
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(filePath);
      console.log('[Transcription] Cleaned up temp file');
    } catch (e) {
      console.error('[Transcription] Failed to clean up temp file:', e);
    }
  }
}

/**
 * Generate lesson summary and review questions from transcript
 */
export async function generateLessonSummary(transcript: string, topic?: string): Promise<string> {
  if (!openai) {
    throw new Error('OpenAI API key not configured');
  }
  
  console.log('[Transcription] Generating lesson summary...');
  
  const systemPrompt = `את מורה מנוסה שמסכמת שיעורים. צרי סיכום תמציתי ומועיל לתלמיד.

הפורמט שלך:
## 📚 סיכום השיעור
[3-5 נקודות עיקריות שנלמדו]

## 🎯 נושאים מרכזיים
[רשימה קצרה של הנושאים]

## ❓ שאלות לבדיקה עצמית
[3-5 שאלות שיעזרו לתלמיד לבדוק שהבין את החומר]

כתבי בעברית, בגוף שני (את/ה), בצורה ידידותית ומעודדת.`;

  const userPrompt = topic 
    ? `הנה תמלול של שיעור בנושא "${topic}":\n\n${transcript}`
    : `הנה תמלול של שיעור:\n\n${transcript}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: 1500,
    temperature: 0.7
  });

  const summary = response.choices[0]?.message?.content || '';
  console.log(`[Transcription] Summary generated: ${summary.length} characters`);
  
  return summary;
}

/**
 * Full pipeline: transcribe audio and generate summary
 */
export async function processRecording(audioUrl: string, topic?: string): Promise<{
  transcript: string;
  summary: string;
}> {
  // Step 1: Transcribe
  const transcript = await transcribeAudio(audioUrl);
  
  // Step 2: Generate summary
  const summary = await generateLessonSummary(transcript, topic);
  
  return { transcript, summary };
}

export const transcriptionService = {
  transcribeAudio,
  generateLessonSummary,
  processRecording
};
