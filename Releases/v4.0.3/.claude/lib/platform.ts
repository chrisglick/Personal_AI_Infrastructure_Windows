/**
 * Cross-Platform Abstraction Layer
 *
 * All platform-specific logic flows through this module.
 * No other file should contain inline `process.platform` checks
 * for path resolution, command mapping, or OS detection.
 *
 * Adopted from p4gs/Personal_AI_Infrastructure (feature/windows-11-support-v4)
 * with adjustments for our VoiceServer's existing Windows audio support.
 *
 * Follows conventions from hooks/lib/paths.ts:
 *   - Uses os.homedir(), os.tmpdir() for path resolution
 *   - Environment variable fallback chains
 *   - Pure functions, no side effects on import
 */

import { homedir, tmpdir, platform as osPlatform } from 'os';
import { join, sep } from 'path';

// ─── Section 1: OS Detection ───────────────────────────────────────────────

/** Current platform identifier */
export const platform: NodeJS.Platform = process.platform;

/** True when running on Windows (including WSL host detection) */
export const isWindows: boolean = process.platform === 'win32';

/** True when running on macOS */
export const isMacOS: boolean = process.platform === 'darwin';

/** True when running on Linux (includes WSL) */
export const isLinux: boolean = process.platform === 'linux';

/** True when running inside WSL (Linux but on a Windows host) */
export const isWSL: boolean =
  isLinux && (
    !!process.env.WSL_DISTRO_NAME ||
    !!process.env.WSLENV ||
    (process.env.PATH || '').includes('/mnt/c/')
  );

/** Human-readable platform name */
export function getPlatformName(): string {
  if (isMacOS) return 'macOS';
  if (isWSL) return 'WSL';
  if (isWindows) return 'Windows';
  if (isLinux) return 'Linux';
  return process.platform;
}

// ─── Section 2: Path Resolution ────────────────────────────────────────────

/**
 * Get the user's home directory.
 * Uses os.homedir() which handles HOME (Unix) and USERPROFILE (Windows).
 */
export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

/**
 * Get the system temp directory.
 * Uses os.tmpdir() — returns /tmp on Unix, %TEMP% on Windows.
 */
export function getTempDir(): string {
  return tmpdir();
}

/**
 * Get a temp file path with the given prefix and extension.
 * Cross-platform: uses os.tmpdir() instead of hardcoded /tmp/.
 */
export function getTempFilePath(prefix: string, extension: string): string {
  return join(tmpdir(), `${prefix}-${Date.now()}${extension}`);
}

/**
 * Get the PAI directory (where .claude lives).
 * Priority: PAI_DIR env var → ~/.claude
 */
export function getPaiDir(): string {
  if (process.env.PAI_DIR) {
    return process.env.PAI_DIR;
  }
  return join(getHomeDir(), '.claude');
}

/**
 * Get a path relative to the PAI directory.
 */
export function paiPath(...segments: string[]): string {
  return join(getPaiDir(), ...segments);
}

/**
 * Get the PAI config directory.
 *   macOS/Linux: ~/.config/PAI
 *   Windows: %APPDATA%/PAI or ~/.config/PAI
 */
export function getConfigDir(): string {
  if (process.env.PAI_CONFIG_DIR) {
    return process.env.PAI_CONFIG_DIR;
  }
  if (isWindows && process.env.APPDATA) {
    return join(process.env.APPDATA, 'PAI');
  }
  return join(getHomeDir(), '.config', 'PAI');
}

/**
 * Get the PAI log directory.
 *   macOS: ~/Library/Logs
 *   Linux: ~/.local/share/PAI/logs
 *   Windows: %APPDATA%/PAI/logs
 */
export function getLogDir(): string {
  if (isMacOS) {
    return join(getHomeDir(), 'Library', 'Logs');
  }
  if (isWindows && process.env.APPDATA) {
    return join(process.env.APPDATA, 'PAI', 'logs');
  }
  return join(getHomeDir(), '.local', 'share', 'PAI', 'logs');
}

/** Path separator for the current platform. */
export const pathSeparator: string = sep;

// ─── Section 3: Command Mapping ────────────────────────────────────────────

/**
 * Get the command to find a process listening on a given port.
 */
export function getPortCheckCommand(port: number): { command: string; args: string[] } {
  if (isWindows) {
    return { command: 'netstat', args: ['-ano'] };
  }
  return { command: 'lsof', args: ['-ti', `:${port}`, '-sTCP:LISTEN'] };
}

/**
 * Get the command string to find a process on a port (for shell execution).
 */
export function getPortCheckCommandString(port: number): string {
  if (isWindows) {
    return `netstat -ano | findstr :${port} | findstr LISTENING`;
  }
  return `lsof -ti:${port} -sTCP:LISTEN`;
}

/**
 * Get the command to kill a process by PID.
 */
export function getKillCommand(pid: number | string, force: boolean = false): string {
  if (isWindows) {
    return force ? `taskkill /F /PID ${pid}` : `taskkill /PID ${pid}`;
  }
  return force ? `kill -9 ${pid}` : `kill ${pid}`;
}

/**
 * Get the command to kill processes matching a pattern.
 */
export function getKillByPatternCommand(pattern: string): string {
  if (isWindows) {
    return `taskkill /F /FI "IMAGENAME eq ${pattern}"`;
  }
  return `pkill -f "${pattern}"`;
}

/**
 * Get the appropriate shell for spawning commands.
 */
export function getDefaultShell(): string {
  if (isWindows) {
    return 'powershell.exe';
  }
  return process.env.SHELL || '/bin/sh';
}

// ─── Section 4: Terminal Detection ─────────────────────────────────────────

/** Supported terminal types */
export type TerminalType = 'kitty' | 'windows-terminal' | 'iterm2' | 'generic';

/**
 * Detect the current terminal emulator.
 */
export function detectTerminal(): TerminalType {
  if (process.env.TERM === 'xterm-kitty' || process.env.KITTY_WINDOW_ID) {
    return 'kitty';
  }
  if (process.env.WT_SESSION || process.env.WT_PROFILE_ID) {
    return 'windows-terminal';
  }
  if (process.env.TERM_PROGRAM === 'iTerm.app') {
    return 'iterm2';
  }
  return 'generic';
}

/**
 * Check if Kitty remote control is available.
 */
export function isKittyAvailable(): boolean {
  if (isWindows) return false;
  return detectTerminal() === 'kitty' &&
    !!(process.env.KITTY_LISTEN_ON || process.env.KITTY_WINDOW_ID);
}

/**
 * Get the Kitty socket path (Unix only). Returns null on Windows.
 */
export function getKittySocketPath(): string | null {
  if (isWindows) return null;
  if (process.env.KITTY_LISTEN_ON) {
    return process.env.KITTY_LISTEN_ON;
  }
  const user = process.env.USER || process.env.LOGNAME || 'user';
  return `unix:/tmp/kitty-${user}`;
}

/**
 * Check if the terminal supports ANSI escape sequences.
 */
export function supportsAnsiEscapes(): boolean {
  if (!isWindows) return true;
  if (process.env.WT_SESSION) return true;
  if (process.env.ConEmuPID) return true;
  return !!process.stdout.isTTY;
}

/**
 * Get the terminal size cross-platform.
 */
export function getTerminalSize(): { columns: number; rows: number } {
  return {
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

// ─── Section 5: Audio & Notifications ──────────────────────────────────────

/**
 * Get the command to play an audio file.
 */
export function getAudioPlayCommand(filePath: string, volume?: number): { command: string; args: string[] } | null {
  if (isMacOS) {
    const args = volume !== undefined
      ? ['-v', volume.toString(), filePath]
      : [filePath];
    return { command: '/usr/bin/afplay', args };
  }

  if (isLinux) {
    return { command: 'paplay', args: [filePath] };
  }

  if (isWindows) {
    // PowerShell WPF MediaPlayer — handles MP3 (SoundPlayer is WAV-only)
    const vol = volume !== undefined ? volume : 1.0;
    const ps = [
      `Add-Type -AssemblyName PresentationCore`,
      `$p = New-Object System.Windows.Media.MediaPlayer`,
      `$p.Open([Uri]::new('${filePath.replace(/'/g, "''")}'))`,
      `$p.Volume = ${vol}`,
      `Start-Sleep -Milliseconds 300`,
      `$p.Play()`,
      `while(-not $p.NaturalDuration.HasTimeSpan){Start-Sleep -Milliseconds 100}`,
      `Start-Sleep -Milliseconds ([math]::Ceiling($p.NaturalDuration.TimeSpan.TotalMilliseconds))`,
      `$p.Close()`,
    ].join('; ');
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-WindowStyle', 'Hidden', '-sta', '-Command', ps],
    };
  }

  return null;
}

/**
 * Get the command to send a system notification.
 */
export function getNotificationCommand(
  title: string,
  message: string,
): { command: string; args: string[] } | null {
  if (isMacOS) {
    const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
    return { command: '/usr/bin/osascript', args: ['-e', script] };
  }

  if (isLinux) {
    return { command: 'notify-send', args: [title, message] };
  }

  if (isWindows) {
    const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $text = $xml.GetElementsByTagName('text'); $text[0].AppendChild($xml.CreateTextNode('${title.replace(/'/g, "''")}')) | Out-Null; $text[1].AppendChild($xml.CreateTextNode('${message.replace(/'/g, "''")}')) | Out-Null; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('PAI').Show([Windows.UI.Notifications.ToastNotification]::new($xml))`;
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps],
    };
  }

  return null;
}

// ─── Section 6: Environment Variable Expansion ─────────────────────────────

/**
 * Expand environment variables in a string.
 * Supports ${VAR} on all platforms, %VAR% on Windows only.
 */
export function expandEnvVars(str: string): string {
  let result = str.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    if (!varName) return _match;
    return process.env[varName] ?? '';
  });

  if (isWindows) {
    result = result.replace(/%([^%]+)%/g, (_match, varName: string) => {
      if (!varName) return _match;
      return process.env[varName] ?? '';
    });
  }

  return result;
}

// ─── Section 7: Service Management ─────────────────────────────────────────

export type ServiceManagerType = 'launchctl' | 'systemd' | 'task-scheduler' | 'none';

export function getServiceManager(): ServiceManagerType {
  if (isMacOS) return 'launchctl';
  if (isWindows) return 'task-scheduler';
  if (isLinux) return 'systemd';
  return 'none';
}
