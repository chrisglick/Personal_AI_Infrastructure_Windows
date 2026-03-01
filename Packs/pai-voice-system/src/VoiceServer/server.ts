#!/usr/bin/env bun
/**
 * Voice Server - Personal AI Voice notification server
 *
 * Architecture: Provider-based TTS with shared infrastructure.
 * Provider-specific code lives in providers/{name}/index.ts.
 * This file handles: pronunciation, sanitization, emotion extraction,
 * caching, playback, desktop notifications, and HTTP routing.
 *
 * Config: Set TTS provider via settings.json daidentity.ttsProvider
 * or TTS_PROVIDER env var. Default: qwen3.
 */

import { serve } from "bun";
import { spawn } from "child_process";
import { homedir, tmpdir, platform } from "os";
import { join } from "path";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { TTSCache } from "./tts-cache";
import { loadProvider } from "./providers/registry";

// Load .env from user home directory (before provider init)
const envPath = join(homedir(), '.env');
if (existsSync(envPath)) {
  const envContent = await Bun.file(envPath).text();
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value && !key.startsWith('#')) {
      process.env[key.trim()] = value.trim();
    }
  });
}

// Audio cache — avoids regenerating identical TTS phrases
const audioCache = new TTSCache({
  enabled: process.env.TTS_CACHE_ENABLED !== "false",
  cacheDir: join(homedir(), ".claude", "cache", "tts"),
  ttlSeconds: parseInt(process.env.TTS_CACHE_TTL || "86400"),
  maxFiles: parseInt(process.env.TTS_CACHE_MAX_FILES || "500"),
  maxSizeMB: parseInt(process.env.TTS_CACHE_MAX_SIZE_MB || "500"),
});

const IS_WINDOWS = platform() === "win32";
const PORT = parseInt(process.env.PORT || "8888");
const DEFAULT_VOLUME = 1.0;

// Initialize TTS provider
const provider = loadProvider();

// ==========================================================================
// Pronunciation System
// ==========================================================================

interface PronunciationEntry {
  term: string;
  phonetic: string;
  note?: string;
}

interface PronunciationConfig {
  replacements: PronunciationEntry[];
}

// Compiled pronunciation rules (loaded once at startup)
interface CompiledRule {
  regex: RegExp;
  phonetic: string;
}

let pronunciationRules: CompiledRule[] = [];

// Load and compile pronunciation rules from pronunciations.json
function loadPronunciations(): void {
  const pronPath = join(import.meta.dir, 'pronunciations.json');
  try {
    if (!existsSync(pronPath)) {
      console.warn('⚠️  No pronunciations.json found — TTS will use default pronunciations');
      return;
    }
    const content = readFileSync(pronPath, 'utf-8');
    const config: PronunciationConfig = JSON.parse(content);

    pronunciationRules = config.replacements.map(entry => ({
      // Word-boundary matching: \b ensures "Kai" matches but "Kaiser" doesn't
      regex: new RegExp(`\\b${escapeRegex(entry.term)}\\b`, 'g'),
      phonetic: entry.phonetic,
    }));

    console.log(`📖 Loaded ${pronunciationRules.length} pronunciation rules`);
    for (const entry of config.replacements) {
      console.log(`   ${entry.term} → ${entry.phonetic} (${entry.note || ''})`);
    }
  } catch (error) {
    console.error('⚠️  Failed to load pronunciations.json:', error);
  }
}

// Escape special regex characters in a literal string
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Apply all pronunciation replacements to text before TTS
function applyPronunciations(text: string): string {
  let result = text;
  for (const rule of pronunciationRules) {
    result = result.replace(rule.regex, rule.phonetic);
  }
  return result;
}

// Load pronunciations at startup
loadPronunciations();

// ==========================================================================
// Shared Utilities — emotion, sanitization, audio playback, notifications
// ==========================================================================

// Escape special characters for AppleScript
function escapeForAppleScript(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Extract emotional marker from message
function extractEmotionalMarker(message: string): { cleaned: string; emotion?: string } {
  const emojiToEmotion: Record<string, string> = {
    '\u{1F4A5}': 'excited',
    '\u{1F389}': 'celebration',
    '\u{1F4A1}': 'insight',
    '\u{1F3A8}': 'creative',
    '\u{2728}': 'success',
    '\u{1F4C8}': 'progress',
    '\u{1F50D}': 'investigating',
    '\u{1F41B}': 'debugging',
    '\u{1F4DA}': 'learning',
    '\u{1F914}': 'pondering',
    '\u{1F3AF}': 'focused',
    '\u{26A0}\u{FE0F}': 'caution',
    '\u{1F6A8}': 'urgent'
  };

  const emotionMatch = message.match(/\[(\u{1F4A5}|\u{1F389}|\u{1F4A1}|\u{1F3A8}|\u{2728}|\u{1F4C8}|\u{1F50D}|\u{1F41B}|\u{1F4DA}|\u{1F914}|\u{1F3AF}|\u{26A0}\u{FE0F}|\u{1F6A8})\s+(\w+)\]/u);
  if (emotionMatch) {
    const emoji = emotionMatch[1];
    const emotionName = emotionMatch[2].toLowerCase();

    if (emojiToEmotion[emoji] === emotionName) {
      return {
        cleaned: message.replace(emotionMatch[0], '').trim(),
        emotion: emotionName
      };
    }
  }

  return { cleaned: message };
}

// Sanitize input for TTS and notifications
function sanitizeForSpeech(input: string): string {
  const cleaned = input
    .replace(/<script/gi, '')
    .replace(/\.\.\//g, '')
    .replace(/[;&|><`$\\]/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .trim()
    .substring(0, 500);

  return cleaned;
}

// Validate user input
function validateInput(input: any): { valid: boolean; error?: string; sanitized?: string } {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: 'Invalid input type' };
  }

  if (input.length > 500) {
    return { valid: false, error: 'Message too long (max 500 characters)' };
  }

  const sanitized = sanitizeForSpeech(input);

  if (!sanitized || sanitized.length === 0) {
    return { valid: false, error: 'Message contains no valid content after sanitization' };
  }

  return { valid: true, sanitized };
}

// Play audio — cross-platform (Windows: PowerShell/ffplay, macOS: afplay)
async function playAudio(audioBuffer: ArrayBuffer, volume: number = DEFAULT_VOLUME): Promise<void> {
  const tempFile = join(tmpdir(), `voice-${Date.now()}.mp3`);

  await Bun.write(tempFile, audioBuffer);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      try { unlinkSync(tempFile); } catch {}
    };

    if (IS_WINDOWS) {
      // Try ffplay first (from ffmpeg — handles MP3)
      const proc = spawn('ffplay', ['-nodisp', '-autoexit', '-volume', String(Math.round(volume * 100)), '-loglevel', 'quiet', tempFile], { windowsHide: true });

      proc.on('error', () => {
        // ffplay not found — try PowerShell as fallback
        console.log('ffplay not found, trying PowerShell...');
        const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command',
          `Add-Type -AssemblyName presentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([Uri]'${tempFile.replace(/'/g, "''")}'); $p.Volume = ${volume}; $p.Play(); Start-Sleep -Seconds 10; $p.Close()`
        ], { windowsHide: true });
        ps.on('exit', (code) => { cleanup(); code === 0 ? resolve() : reject(new Error(`PowerShell player exited ${code}`)); });
        ps.on('error', (err) => { cleanup(); reject(err); });
      });

      proc.on('exit', (code) => {
        cleanup();
        if (code === 0) resolve();
        else reject(new Error(`ffplay exited with code ${code}`));
      });
    } else {
      // macOS: afplay
      const proc = spawn('/usr/bin/afplay', ['-v', volume.toString(), tempFile]);

      proc.on('error', (error) => {
        console.error('Error playing audio:', error);
        cleanup();
        reject(error);
      });

      proc.on('exit', (code) => {
        cleanup();
        if (code === 0) resolve();
        else reject(new Error(`afplay exited with code ${code}`));
      });
    }
  });
}

// Spawn a process safely
function spawnSafe(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);

    proc.on('error', (error) => {
      console.error(`Error spawning ${command}:`, error);
      reject(error);
    });

    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

// ==========================================================================
// Core: Send notification with TTS via provider + desktop notification
// ==========================================================================

/**
 * Generate TTS audio via the configured provider and play it.
 * Handles caching at the server level (wraps provider.generate()).
 */
async function generateAndPlayTTS(
  text: string,
  voiceId: string | null,
  emotion: string | undefined,
  volume: number,
): Promise<void> {
  const opts = {
    text,
    voiceId: voiceId || undefined,
    emotion,
    volume,
  };

  // Build cache key from provider
  const cacheKey = provider.buildCacheKey(opts);
  const cached = audioCache.get(text, provider.name, cacheKey.voiceId, cacheKey.extra);

  let audioBuffer: Buffer;

  if (cached) {
    audioBuffer = cached;
  } else {
    const result = await provider.generate(opts);

    // Empty buffer means provider played audio server-side (Qwen3 /notify fallback)
    if (result.audio.length === 0) {
      return;
    }

    audioCache.put(text, provider.name, cacheKey.voiceId, result.audio, result.format, cacheKey.extra);
    audioBuffer = result.audio;
  }

  await playAudio(audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength), volume);
}

/**
 * Send notification: TTS audio + desktop notification.
 */
async function sendNotification(
  title: string,
  message: string,
  voiceEnabled = true,
  voiceId: string | null = null,
  volume: number = DEFAULT_VOLUME,
) {
  const titleValidation = validateInput(title);
  const messageValidation = validateInput(message);

  if (!titleValidation.valid) {
    throw new Error(`Invalid title: ${titleValidation.error}`);
  }

  if (!messageValidation.valid) {
    throw new Error(`Invalid message: ${messageValidation.error}`);
  }

  const safeTitle = titleValidation.sanitized!;
  let safeMessage = messageValidation.sanitized!;

  // Preprocess: pronunciations then emotion extraction
  const preprocessed = applyPronunciations(safeMessage);
  const { cleaned, emotion } = extractEmotionalMarker(preprocessed);
  safeMessage = cleaned;

  // Generate and play voice via provider
  if (voiceEnabled) {
    try {
      await generateAndPlayTTS(safeMessage, voiceId, emotion, volume);
    } catch (error) {
      console.error("Failed to generate/play speech:", error);
    }
  }

  // Display desktop notification (platform-aware)
  try {
    if (IS_WINDOWS) {
      // Windows toast notification via PowerShell
      const escapedTitle = safeTitle.replace(/'/g, "''");
      const escapedMessage = safeMessage.replace(/'/g, "''");
      const psScript = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>'${escapedTitle}'</text><text>'${escapedMessage}'</text></binding></visual></toast>")
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('PAI').Show([Windows.UI.Notifications.ToastNotification]::new($xml))
`;
      spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], { windowsHide: true });
    } else {
      // macOS notification
      const escapedTitle = escapeForAppleScript(safeTitle);
      const escapedMessage = escapeForAppleScript(safeMessage);
      const script = `display notification "${escapedMessage}" with title "${escapedTitle}" sound name ""`;
      await spawnSafe('/usr/bin/osascript', ['-e', script]);
    }
  } catch (error) {
    console.error("Notification display error:", error);
  }
}

// Rate limiting
const requestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = requestCounts.get(ip);

  if (!record || now > record.resetTime) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT) {
    return false;
  }

  record.count++;
  return true;
}

// Start HTTP server
const server = serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    const clientIp = req.headers.get('x-forwarded-for') || 'localhost';

    const corsHeaders = {
      "Access-Control-Allow-Origin": "http://localhost",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    if (!checkRateLimit(clientIp)) {
      return new Response(
        JSON.stringify({ status: "error", message: "Rate limit exceeded" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 429
        }
      );
    }

    if (url.pathname === "/notify" && req.method === "POST") {
      try {
        const data = await req.json();
        const title = data.title || "PAI Notification";
        const message = data.message || "Task completed";
        const voiceEnabled = data.voice_enabled !== false;
        const voiceId = data.voice_id || data.voice_name || null;
        const volume = data.volume ?? DEFAULT_VOLUME;

        if (voiceId && typeof voiceId !== 'string') {
          throw new Error('Invalid voice_id');
        }

        console.log(`📨 Notification: "${title}" - "${message}" (voice: ${voiceEnabled}, provider: ${provider.name}, voiceId: ${voiceId || 'default'})`);

        await sendNotification(title, message, voiceEnabled, voiceId, volume);

        return new Response(
          JSON.stringify({ status: "success", message: "Notification sent" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
          }
        );
      } catch (error: any) {
        console.error("Notification error:", error);
        return new Response(
          JSON.stringify({ status: "error", message: error.message || "Internal server error" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: error.message?.includes('Invalid') ? 400 : 500
          }
        );
      }
    }

    // /notify/personality — compatibility shim
    if (url.pathname === "/notify/personality" && req.method === "POST") {
      try {
        const data = await req.json();
        const message = data.message || "Notification";

        console.log(`🎭 Personality notification: "${message}"`);

        await sendNotification("PAI Notification", message, true, null);

        return new Response(
          JSON.stringify({ status: "success", message: "Personality notification sent" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
          }
        );
      } catch (error: any) {
        console.error("Personality notification error:", error);
        return new Response(
          JSON.stringify({ status: "error", message: error.message || "Internal server error" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: error.message?.includes('Invalid') ? 400 : 500
          }
        );
      }
    }

    if (url.pathname === "/pai" && req.method === "POST") {
      try {
        const data = await req.json();
        const title = data.title || "PAI Assistant";
        const message = data.message || "Task completed";

        console.log(`🤖 PAI notification: "${title}" - "${message}"`);

        await sendNotification(title, message, true, null);

        return new Response(
          JSON.stringify({ status: "success", message: "PAI notification sent" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
          }
        );
      } catch (error: any) {
        console.error("PAI notification error:", error);
        return new Response(
          JSON.stringify({ status: "error", message: error.message || "Internal server error" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: error.message?.includes('Invalid') ? 400 : 500
          }
        );
      }
    }

    // Cache endpoints
    if (url.pathname === "/cache/stats" && req.method === "GET") {
      return new Response(JSON.stringify(audioCache.getStats()), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (url.pathname === "/cache/clear" && req.method === "POST") {
      const count = audioCache.clear();
      return new Response(JSON.stringify({ cleared: count }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (url.pathname === "/cache/pin" && req.method === "POST") {
      try {
        const data = await req.json();
        const text = data.text;
        if (!text || typeof text !== "string") {
          return new Response(JSON.stringify({ status: "error", message: "text field required" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          });
        }
        const success = audioCache.pin(text);
        return new Response(JSON.stringify({ status: success ? "pinned" : "not_found", text: text.slice(0, 80) }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: success ? 200 : 404,
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ status: "error", message: e.message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
    }

    if (url.pathname === "/cache/unpin" && req.method === "POST") {
      try {
        const data = await req.json();
        const text = data.text;
        if (!text || typeof text !== "string") {
          return new Response(JSON.stringify({ status: "error", message: "text field required" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          });
        }
        const success = audioCache.unpin(text);
        return new Response(JSON.stringify({ status: success ? "unpinned" : "not_found", text: text.slice(0, 80) }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: success ? 200 : 404,
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ status: "error", message: e.message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
    }

    if (url.pathname === "/cache/pinned" && req.method === "GET") {
      return new Response(JSON.stringify(audioCache.listPinned()), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (url.pathname === "/health") {
      const providerHealth = await provider.health();

      return new Response(
        JSON.stringify({
          status: "healthy",
          port: PORT,
          platform: IS_WINDOWS ? "windows" : "unix",
          provider: {
            name: provider.name,
            ...providerHealth,
          },
          cache: audioCache.getStats(),
          pronunciation_rules: pronunciationRules.length,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200
        }
      );
    }

    return new Response("Voice Server - POST to /notify, /notify/personality, or /pai", {
      headers: corsHeaders,
      status: 200
    });
  },
});

console.log(`🚀 Voice Server running on port ${PORT}`);
console.log(`🔊 TTS Provider: ${provider.name}`);
console.log(`📡 POST to http://localhost:${PORT}/notify`);
console.log(`🔒 Security: CORS restricted to localhost, rate limiting enabled`);
console.log(`📖 Pronunciations: ${pronunciationRules.length} rules loaded`);
console.log(`💾 Cache: ${audioCache.getStats().enabled ? '✅ Enabled' : '❌ Disabled'} (${audioCache.getStats().entries} entries)`);
