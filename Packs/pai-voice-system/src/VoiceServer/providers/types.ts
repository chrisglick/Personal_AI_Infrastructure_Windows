/**
 * TTSProvider interface — all TTS backends implement this contract.
 *
 * server.ts handles: pronunciation, sanitization, emotion extraction, caching, playback.
 * Providers handle: API calls, voice resolution, format conversion.
 */

export interface TTSGenerateOptions {
  text: string;           // already pronunciation-preprocessed and sanitized
  voiceId?: string;       // provider-specific voice name/id
  emotion?: string;       // extracted emotion name (provider decides what to do with it)
  volume?: number;        // caller-requested volume
}

export interface TTSResult {
  audio: Buffer;          // playable audio bytes
  format: "mp3" | "wav";
}

export interface TTSProvider {
  readonly name: string;  // cache engine key: "elevenlabs" | "qwen3"
  generate(opts: TTSGenerateOptions): Promise<TTSResult>;
  health(): Promise<{ status: string; detail?: Record<string, any> }>;
  buildCacheKey(opts: TTSGenerateOptions): { voiceId: string; extra: string };
}
