/**
 * Qwen3 TTS Provider
 *
 * Proxies TTS requests to the local Qwen3 Python server running on QWEN3_PORT.
 * Handles WAV-to-MP3 conversion via ffmpeg for compact caching.
 */

import { execSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import type { TTSProvider, TTSGenerateOptions, TTSResult } from "../types";

const QWEN3_PORT = parseInt(process.env.QWEN3_PORT || "8889");

/**
 * Convert WAV buffer to MP3 via ffmpeg. Returns MP3 buffer or null on failure.
 */
function wavToMp3(wavBuffer: Buffer): Buffer | null {
  const wavPath = join(tmpdir(), `wav2mp3-${Date.now()}.wav`);
  const mp3Path = join(tmpdir(), `wav2mp3-${Date.now()}.mp3`);
  try {
    writeFileSync(wavPath, wavBuffer);
    execSync(`ffmpeg -y -i "${wavPath}" -codec:a libmp3lame -q:a 6 "${mp3Path}" -loglevel quiet`, { timeout: 15000 });
    const mp3 = readFileSync(mp3Path);
    return Buffer.from(mp3);
  } catch (e) {
    console.error('[qwen3] ffmpeg conversion failed:', e);
    return null;
  } finally {
    try { unlinkSync(wavPath); } catch {}
    try { unlinkSync(mp3Path); } catch {}
  }
}

export class Qwen3Provider implements TTSProvider {
  readonly name = "qwen3" as const;

  async generate(opts: TTSGenerateOptions): Promise<TTSResult> {
    const voiceName = opts.voiceId || 'kai';

    // Try /tts/generate first (returns audio bytes for caching)
    const resp = await fetch(`http://127.0.0.1:${QWEN3_PORT}/tts/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: opts.text,
        voice_name: voiceName,
        voice_enabled: true,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) {
      if (resp.status === 404) {
        console.log('[qwen3] /tts/generate not available, trying /notify fallback');
      }
      // Fallback: fire-and-forget to old /notify endpoint (Qwen3 plays locally)
      const fallback = await fetch(`http://127.0.0.1:${QWEN3_PORT}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: opts.text, voice_name: voiceName, voice_enabled: true }),
        signal: AbortSignal.timeout(30000),
      });
      if (!fallback.ok) {
        throw new Error(`Qwen3 TTS failed: /tts/generate ${resp.status}, /notify ${fallback.status}`);
      }
      // /notify plays audio server-side — return empty buffer (server.ts will skip playback)
      console.log('🔊 [qwen3] Played via /notify fallback (not cacheable)');
      return { audio: Buffer.alloc(0), format: "mp3" };
    }

    const wavBuffer = Buffer.from(await resp.arrayBuffer());

    // Convert WAV -> MP3 for compact caching
    const mp3Buffer = wavToMp3(wavBuffer);
    if (mp3Buffer) {
      console.log('🔊 [qwen3] Speech generated (MP3)');
      return { audio: mp3Buffer, format: "mp3" };
    }

    // ffmpeg failed — return WAV directly
    console.warn('[qwen3] ffmpeg unavailable, returning WAV');
    return { audio: wavBuffer, format: "wav" };
  }

  async health(): Promise<{ status: string; detail?: Record<string, any> }> {
    try {
      const resp = await fetch(`http://127.0.0.1:${QWEN3_PORT}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        return {
          status: "running",
          detail: { port: QWEN3_PORT, url: `http://127.0.0.1:${QWEN3_PORT}` },
        };
      }
      return { status: "unhealthy", detail: { port: QWEN3_PORT } };
    } catch {
      return { status: "offline", detail: { port: QWEN3_PORT } };
    }
  }

  buildCacheKey(opts: TTSGenerateOptions): { voiceId: string; extra: string } {
    return {
      voiceId: opts.voiceId || 'default',
      extra: opts.voiceId || 'default',
    };
  }
}
