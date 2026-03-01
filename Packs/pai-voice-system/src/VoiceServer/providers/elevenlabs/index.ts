/**
 * ElevenLabs TTS Provider
 *
 * Encapsulates all ElevenLabs-specific code: API calls, voice config resolution,
 * emotional presets, and voice settings management.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { TTSProvider, TTSGenerateOptions, TTSResult } from "../types";

// ElevenLabs voice_settings fields (sent to their API)
interface ElevenLabsVoiceSettings {
  stability: number;
  similarity_boost: number;
  style?: number;
  speed?: number;
  use_speaker_boost?: boolean;
}

// A voice entry from settings.json daidentity.voices.*
interface VoiceEntry {
  voiceId: string;
  voiceName?: string;
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  use_speaker_boost: boolean;
  volume: number;
}

// Loaded config from settings.json
interface LoadedVoiceConfig {
  defaultVoiceId: string;
  voices: Record<string, VoiceEntry>;
  voicesByVoiceId: Record<string, VoiceEntry>;
}

// Last-resort defaults if settings.json is entirely missing or unparseable
const FALLBACK_VOICE_SETTINGS: ElevenLabsVoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  speed: 1.0,
  use_speaker_boost: true,
};
const FALLBACK_VOLUME = 1.0;

// Emotional markers for dynamic voice adjustment (overlay-only — modifies stability + similarity_boost)
interface EmotionalOverlay {
  stability: number;
  similarity_boost: number;
}

// 13 Emotional Presets - Expanded Prosody System
// These OVERLAY onto resolved voice settings, not replace them
const EMOTIONAL_PRESETS: Record<string, EmotionalOverlay> = {
  // High Energy / Positive
  'excited': { stability: 0.7, similarity_boost: 0.9 },
  'celebration': { stability: 0.65, similarity_boost: 0.85 },
  'insight': { stability: 0.55, similarity_boost: 0.8 },
  'creative': { stability: 0.5, similarity_boost: 0.75 },

  // Success / Achievement
  'success': { stability: 0.6, similarity_boost: 0.8 },
  'progress': { stability: 0.55, similarity_boost: 0.75 },

  // Analysis / Investigation
  'investigating': { stability: 0.6, similarity_boost: 0.85 },
  'debugging': { stability: 0.55, similarity_boost: 0.8 },
  'learning': { stability: 0.5, similarity_boost: 0.75 },

  // Thoughtful / Careful
  'pondering': { stability: 0.65, similarity_boost: 0.8 },
  'focused': { stability: 0.7, similarity_boost: 0.85 },
  'caution': { stability: 0.4, similarity_boost: 0.6 },

  // Urgent / Critical
  'urgent': { stability: 0.3, similarity_boost: 0.9 },
};

// Load voice configuration from settings.json
function loadVoiceConfig(): LoadedVoiceConfig {
  const settingsPath = join(homedir(), '.claude', 'settings.json');

  try {
    if (!existsSync(settingsPath)) {
      console.warn('⚠️  settings.json not found — using fallback voice defaults');
      return { defaultVoiceId: '', voices: {}, voicesByVoiceId: {} };
    }

    const content = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    const daidentity = settings.daidentity || {};
    const voicesSection = daidentity.voices || {};

    const voices: Record<string, VoiceEntry> = {};
    const voicesByVoiceId: Record<string, VoiceEntry> = {};

    for (const [name, config] of Object.entries(voicesSection)) {
      const entry = config as any;
      if (entry.voiceId) {
        const voiceEntry: VoiceEntry = {
          voiceId: entry.voiceId,
          voiceName: entry.voiceName,
          stability: entry.stability ?? 0.5,
          similarity_boost: entry.similarity_boost ?? 0.75,
          style: entry.style ?? 0.0,
          speed: entry.speed ?? 1.0,
          use_speaker_boost: entry.use_speaker_boost ?? true,
          volume: entry.volume ?? 1.0,
        };
        voices[name] = voiceEntry;
        voicesByVoiceId[entry.voiceId] = voiceEntry;
      }
    }

    const defaultVoiceId = voices.main?.voiceId || daidentity.mainDAVoiceID || '';

    const voiceNames = Object.keys(voices);
    console.log(`✅ [elevenlabs] Loaded ${voiceNames.length} voice config(s): ${voiceNames.join(', ')}`);

    return { defaultVoiceId, voices, voicesByVoiceId };
  } catch (error) {
    console.error('⚠️  Failed to load settings.json voice config:', error);
    return { defaultVoiceId: '', voices: {}, voicesByVoiceId: {} };
  }
}

export class ElevenLabsProvider implements TTSProvider {
  readonly name = "elevenlabs" as const;

  private apiKey: string;
  private voiceConfig: LoadedVoiceConfig;
  private defaultVoiceId: string;

  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY || '';
    this.voiceConfig = loadVoiceConfig();
    this.defaultVoiceId = this.voiceConfig.defaultVoiceId || process.env.ELEVENLABS_VOICE_ID || '';
  }

  async generate(opts: TTSGenerateOptions): Promise<TTSResult> {
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    const voice = opts.voiceId || this.defaultVoiceId;

    // 3-tier voice settings resolution
    let resolvedSettings: ElevenLabsVoiceSettings;

    // Look up by voiceId, fall back to main
    const voiceEntry = this.voiceConfig.voicesByVoiceId[voice] || this.voiceConfig.voices.main;
    if (voiceEntry) {
      resolvedSettings = {
        stability: voiceEntry.stability,
        similarity_boost: voiceEntry.similarity_boost,
        style: voiceEntry.style,
        speed: voiceEntry.speed,
        use_speaker_boost: voiceEntry.use_speaker_boost,
      };
    } else {
      resolvedSettings = { ...FALLBACK_VOICE_SETTINGS };
    }

    // Emotional preset overlay — modifies stability + similarity_boost only
    if (opts.emotion && EMOTIONAL_PRESETS[opts.emotion]) {
      resolvedSettings = {
        ...resolvedSettings,
        stability: EMOTIONAL_PRESETS[opts.emotion].stability,
        similarity_boost: EMOTIONAL_PRESETS[opts.emotion].similarity_boost,
      };
      console.log(`🎭 [elevenlabs] Emotion overlay: ${opts.emotion}`);
    }

    console.log(`🎙️  [elevenlabs] Generating speech (voice: ${voice}, speed: ${resolvedSettings.speed}, stability: ${resolvedSettings.stability})`);

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey,
      },
      body: JSON.stringify({
        text: opts.text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: resolvedSettings,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }

    const arrayBuf = await response.arrayBuffer();
    return {
      audio: Buffer.from(arrayBuf),
      format: "mp3",
    };
  }

  async health(): Promise<{ status: string; detail?: Record<string, any> }> {
    return {
      status: this.apiKey ? "configured" : "missing_api_key",
      detail: {
        default_voice_id: this.defaultVoiceId,
        configured_voices: Object.keys(this.voiceConfig.voices),
      },
    };
  }

  buildCacheKey(opts: TTSGenerateOptions): { voiceId: string; extra: string } {
    const voice = opts.voiceId || this.defaultVoiceId;

    // Resolve settings to build cache-compatible extra string
    const voiceEntry = this.voiceConfig.voicesByVoiceId[voice] || this.voiceConfig.voices.main;
    let stability = FALLBACK_VOICE_SETTINGS.stability;
    let similarity = FALLBACK_VOICE_SETTINGS.similarity_boost;
    let style = FALLBACK_VOICE_SETTINGS.style!;
    let speed = FALLBACK_VOICE_SETTINGS.speed!;

    if (voiceEntry) {
      stability = voiceEntry.stability;
      similarity = voiceEntry.similarity_boost;
      style = voiceEntry.style;
      speed = voiceEntry.speed;
    }

    // Apply emotion overlay to cache key (must match generate() logic)
    if (opts.emotion && EMOTIONAL_PRESETS[opts.emotion]) {
      stability = EMOTIONAL_PRESETS[opts.emotion].stability;
      similarity = EMOTIONAL_PRESETS[opts.emotion].similarity_boost;
    }

    return {
      voiceId: voice,
      extra: `${stability}|${similarity}|${style}|${speed}`,
    };
  }
}
