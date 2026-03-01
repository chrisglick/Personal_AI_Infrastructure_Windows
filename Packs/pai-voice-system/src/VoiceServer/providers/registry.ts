/**
 * Provider Registry — loads the configured TTS provider.
 *
 * Priority: TTS_PROVIDER env var > settings.json daidentity.ttsProvider > default (qwen3)
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { TTSProvider } from "./types";
import { ElevenLabsProvider } from "./elevenlabs/index";
import { Qwen3Provider } from "./qwen3/index";

export function loadProvider(): TTSProvider {
  let providerName = process.env.TTS_PROVIDER || '';

  if (!providerName) {
    // Read from settings.json
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    try {
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        providerName = settings.daidentity?.ttsProvider || '';
      }
    } catch {
      // ignore parse errors
    }
  }

  // Default to qwen3
  if (!providerName) {
    providerName = 'qwen3';
  }

  providerName = providerName.toLowerCase();

  switch (providerName) {
    case 'elevenlabs':
      console.log('🔊 TTS Provider: ElevenLabs');
      return new ElevenLabsProvider();
    case 'qwen3':
    default:
      console.log('🔊 TTS Provider: Qwen3');
      return new Qwen3Provider();
  }
}

export type { TTSProvider };
