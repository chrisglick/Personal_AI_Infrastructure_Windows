/**
 * hook-io.ts — Shared stdin reader for Stop hooks
 *
 * Eliminates duplicated stdin-reading boilerplate across individual hooks.
 * Each hook calls readHookInput() to get the parsed JSON payload, and
 * parseTranscriptFromInput() if it needs the full transcript.
 */

import { parseTranscript, type ParsedTranscript } from '../../PAI/Tools/TranscriptParser';

export interface HookInput {
  session_id: string;
  transcript_path: string;
  hook_event_name: string;
  last_assistant_message?: string;
}

/**
 * Read and parse JSON from stdin with a 500ms timeout.
 * Returns null if stdin is empty or malformed.
 */
export async function readHookInput(): Promise<HookInput | null> {
  try {
    const input = await readStdinWithTimeout(500);
    if (input.trim()) {
      return JSON.parse(input) as HookInput;
    }
  } catch (error) {
    console.error('[hook-io] Error reading stdin:', error);
  }
  return null;
}

/**
 * Cross-platform stdin reader using process.stdin (not Bun.stdin).
 * Bun.stdin.stream().getReader() and Bun.stdin.text() fail silently
 * on Windows/MSYS — returning empty strings or hanging indefinitely.
 * See: https://github.com/danielmiessler/Personal_AI_Infrastructure/issues/385
 */
export function readStdinWithTimeout(timeoutMs = 500): Promise<string> {
  return new Promise<string>((resolve) => {
    let data = '';
    const timer = setTimeout(() => {
      process.stdin.destroy();
      resolve(data);
    }, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

/**
 * Parse transcript from hook input. Waits 150ms for transcript to be
 * fully written to disk before parsing.
 */
export async function parseTranscriptFromInput(input: HookInput): Promise<ParsedTranscript> {
  await new Promise(resolve => setTimeout(resolve, 150));
  return parseTranscript(input.transcript_path);
}
