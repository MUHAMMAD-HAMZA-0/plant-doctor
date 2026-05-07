import OpenAI from 'openai';
import * as FileSystem from 'expo-file-system/legacy';

// ---------------------------------------------------------------------------
// Config — 100% driven by .env
// Provider, model, key — sab .env se. Code mein kuch nahi badalna.
// ---------------------------------------------------------------------------
const AI_API_KEY  = process.env.EXPO_PUBLIC_AI_API_KEY  ?? '';
const AI_BASE_URL = process.env.EXPO_PUBLIC_AI_BASE_URL ?? 'https://api.openai.com/v1';
const AI_MODEL    = process.env.EXPO_PUBLIC_AI_MODEL    ?? 'gpt-4.1';
const MAX_TOKENS  = parseInt(process.env.EXPO_PUBLIC_AI_MAX_TOKENS  ?? '1024', 10);
const TIMEOUT_MS  = parseInt(process.env.EXPO_PUBLIC_AI_TIMEOUT_MS  ?? '30000', 10);
const MAX_RETRIES = parseInt(process.env.EXPO_PUBLIC_AI_MAX_RETRIES ?? '3', 10);

if (!AI_API_KEY || AI_API_KEY === 'sk-39043ac688454be7a348b01adb4c01cf') {
  console.warn('[AI Service] EXPO_PUBLIC_AI_API_KEY is not set in .env');
}

// ---------------------------------------------------------------------------
// Client — baseURL se koi bhi OpenAI-compatible provider plug ho jata hai
// ---------------------------------------------------------------------------
const client = new OpenAI({
  apiKey: AI_API_KEY,
  baseURL: AI_BASE_URL,
  maxRetries: MAX_RETRIES,
  timeout: TIMEOUT_MS,
  dangerouslyAllowBrowser: true,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type PlantStatus = 'Healthy' | 'Infected' | 'Unknown';

export type PlantAnalysisResult = {
  status: PlantStatus;
  diseaseName: string;
  details: string;
  remedy: string;
};

export type AIServiceError =
  | { code: 'MISSING_KEY' }
  | { code: 'INVALID_IMAGE' }
  | { code: 'PARSE_ERROR'; raw: string }
  | { code: 'RATE_LIMITED'; retryAfter?: number }
  | { code: 'QUOTA_EXCEEDED' }
  | { code: 'TIMEOUT' }
  | { code: 'API_ERROR'; status: number; message: string }
  | { code: 'NETWORK_ERROR'; message: string };

export class PlantAnalysisError extends Error {
  constructor(
    public readonly serviceError: AIServiceError,
    message: string,
  ) {
    super(message);
    this.name = 'PlantAnalysisError';
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are an expert plant pathologist AI with decades of experience identifying plant diseases from visual imagery.

Your task: analyze the provided plant image and return ONLY a valid JSON object — no markdown, no code fences, no extra text.

JSON schema (strict):
{
  "status": "Healthy" | "Infected" | "Unknown",
  "diseaseName": "string — disease name if Infected, empty string otherwise",
  "details": "string — concise clinical description of visual findings (max 150 words)",
  "remedy": "string — actionable treatment steps if Infected, empty string otherwise"
}

Rules:
- status "Unknown" only when image quality makes diagnosis impossible
- diseaseName and remedy must be empty strings when status is "Healthy" or "Unknown"
- details must always describe what you visually observed
- Output ONLY the JSON object, nothing else`;

// ---------------------------------------------------------------------------
// Image utils
// ---------------------------------------------------------------------------
async function uriToBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

function parseMimeType(type: string): string {
  return type.startsWith('image/') ? type : 'image/jpeg';
}

// ---------------------------------------------------------------------------
// Response parser with strict validation
// ---------------------------------------------------------------------------
function parseAnalysisResponse(content: string): PlantAnalysisResult {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new PlantAnalysisError(
      { code: 'PARSE_ERROR', raw: content },
      'AI response mein valid JSON nahi mila.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new PlantAnalysisError(
      { code: 'PARSE_ERROR', raw: jsonMatch[0] },
      'AI JSON parse nahi ho saka.',
    );
  }

  const obj = parsed as Record<string, unknown>;
  const validStatuses: PlantStatus[] = ['Healthy', 'Infected', 'Unknown'];

  if (!validStatuses.includes(obj.status as PlantStatus)) {
    throw new PlantAnalysisError(
      { code: 'PARSE_ERROR', raw: jsonMatch[0] },
      `Invalid status value: ${obj.status}`,
    );
  }

  return {
    status: obj.status as PlantStatus,
    diseaseName: typeof obj.diseaseName === 'string' ? obj.diseaseName : '',
    details:     typeof obj.details     === 'string' ? obj.details     : '',
    remedy:      typeof obj.remedy      === 'string' ? obj.remedy      : '',
  };
}

// ---------------------------------------------------------------------------
// Error classifier
// ---------------------------------------------------------------------------
function classifyError(error: unknown): PlantAnalysisError {
  if (error instanceof PlantAnalysisError) return error;

  if (error instanceof OpenAI.APIError) {
    if (error.status === 429) {
      const retryAfter = Number(error.headers?.['retry-after']) || undefined;
      return new PlantAnalysisError(
        { code: 'RATE_LIMITED', retryAfter },
        'Rate limit hit. Thodi der baad dobara koshish karein.',
      );
    }
    if (error.status === 402 || error.status === 403) {
      return new PlantAnalysisError({ code: 'QUOTA_EXCEEDED' }, 'API quota khatam ho gayi.');
    }
    if (error.status === 408 || error.message?.toLowerCase().includes('timeout')) {
      return new PlantAnalysisError(
        { code: 'TIMEOUT' },
        `Request timeout after ${TIMEOUT_MS / 1000}s.`,
      );
    }
    return new PlantAnalysisError(
      { code: 'API_ERROR', status: error.status ?? 0, message: error.message },
      `API error ${error.status}: ${error.message}`,
    );
  }

  const msg = error instanceof Error ? error.message : String(error);
  return new PlantAnalysisError({ code: 'NETWORK_ERROR', message: msg }, `Network error: ${msg}`);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function analyzePlantImage(
  uri: string,
  mimeType: string = 'image/jpeg',
): Promise<PlantAnalysisResult> {
  if (!AI_API_KEY || AI_API_KEY === 'sk-your-key-here') {
    throw new PlantAnalysisError(
      { code: 'MISSING_KEY' },
      'EXPO_PUBLIC_AI_API_KEY .env mein set nahi hai.',
    );
  }

  let base64: string;
  try {
    base64 = await uriToBase64(uri);
  } catch {
    throw new PlantAnalysisError({ code: 'INVALID_IMAGE' }, 'Image file read nahi ho saka.');
  }

  try {
    const response = await client.chat.completions.create({
      model: AI_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${parseMimeType(mimeType)};base64,${base64}`,
                detail: 'high',
              },
            },
            { type: 'text', text: 'Analyze this plant image and return the JSON.' },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content ?? '';
    return parseAnalysisResponse(content);
  } catch (error) {
    throw classifyError(error);
  }
}
