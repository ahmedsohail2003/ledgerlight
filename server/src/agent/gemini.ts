import { GoogleGenAI } from '@google/genai';
import { BRIEF_JSON_SCHEMA } from './brief-schema.js';

/**
 * Thin, injectable LLM boundary. The investigator depends on this interface,
 * so tests can swap in a fake and the whole retry/fallback path runs offline —
 * and a missing API key can never cause an accidental network call.
 */
export interface BriefGenerator {
  modelId: string;
  generate(prompt: string): Promise<string>;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function createGeminiGenerator(): BriefGenerator {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const modelId = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  const client = new GoogleGenAI({ apiKey });

  return {
    modelId,
    async generate(prompt: string): Promise<string> {
      const res = await client.models.generateContent({
        model: modelId,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: BRIEF_JSON_SCHEMA as any,
          temperature: 0.2,
        },
      });
      return res.text ?? '';
    },
  };
}
