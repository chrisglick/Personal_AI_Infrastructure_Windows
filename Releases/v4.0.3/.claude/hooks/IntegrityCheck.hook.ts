#!/usr/bin/env bun
/**
 * IntegrityCheck.hook.ts - PAI Integrity Check (SessionEnd)
 *
 * Runs system integrity check — detects PAI system file changes, spawns background maintenance.
 * Doc cross-ref integrity is handled by DocIntegrity.hook.ts (Stop event) to avoid double execution.
 *
 * TRIGGER: SessionEnd
 * PERFORMANCE: ~50ms (single transcript parse, one handler call). Non-blocking.
 */

import { parseTranscript } from '../PAI/Tools/TranscriptParser';
import { handleSystemIntegrity } from './handlers/SystemIntegrity';

interface HookInput {
  session_id: string;
  transcript_path: string;
  hook_event_name: string;
}

async function readStdin(): Promise<HookInput | null> {
  try {
    // Cross-platform: use process.stdin instead of Bun.stdin (fails on Windows/MSYS)
    const input = await new Promise<string>((resolve) => {
      let data = '';
      const timer = setTimeout(() => { process.stdin.destroy(); resolve(data); }, 500);
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk: string) => { data += chunk; });
      process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
      process.stdin.on('error', () => { clearTimeout(timer); resolve(''); });
    });
    if (input.trim()) return JSON.parse(input) as HookInput;
  } catch {}
  return null;
}

async function main() {
  const hookInput = await readStdin();
  if (!hookInput?.transcript_path) { process.exit(0); }

  const parsed = parseTranscript(hookInput.transcript_path);

  // Run system integrity check (doc cross-ref is handled by DocIntegrity.hook.ts)
  await handleSystemIntegrity(parsed, hookInput);

  process.exit(0);
}

main().catch(() => process.exit(0));
