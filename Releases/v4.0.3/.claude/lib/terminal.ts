/**
 * Terminal Abstraction Layer
 *
 * Provides a unified interface for terminal operations across:
 * - Kitty (via kitten @ remote control)
 * - Windows Terminal (via ANSI OSC escape sequences)
 * - Generic terminals (graceful no-op)
 *
 * Adopted from p4gs/Personal_AI_Infrastructure (feature/windows-11-support-v4)
 */

import { execSync } from 'child_process';
import { detectTerminal, isKittyAvailable, type TerminalType } from './platform';

// ─── Interface ──────────────────────────────────────────────────────────────

export interface TabColorOptions {
  activeBg: string;
  activeFg: string;
  inactiveBg: string;
  inactiveFg: string;
}

export interface TerminalAdapter {
  readonly type: TerminalType;
  readonly supported: boolean;
  setTitle(title: string): void;
  setTabColor(options: TabColorOptions): void;
  resetTabColor(): void;
}

// ─── Kitty Implementation ───────────────────────────────────────────────────

export class KittyTerminalAdapter implements TerminalAdapter {
  readonly type = 'kitty' as const;
  readonly supported = true;

  constructor(private readonly listenOn: string) {}

  setTitle(title: string): void {
    const escaped = title.replace(/"/g, '\\"');
    const toFlag = `--to="${this.listenOn}"`;
    try {
      execSync(`kitten @ ${toFlag} set-tab-title "${escaped}"`, { stdio: 'ignore', timeout: 2000 });
      execSync(`kitten @ ${toFlag} set-window-title "${escaped}"`, { stdio: 'ignore', timeout: 2000 });
    } catch { /* silent — terminal may not be available */ }
  }

  setTabColor(options: TabColorOptions): void {
    const toFlag = `--to="${this.listenOn}"`;
    try {
      execSync(
        `kitten @ ${toFlag} set-tab-color --self active_bg=${options.activeBg} active_fg=${options.activeFg} inactive_bg=${options.inactiveBg} inactive_fg=${options.inactiveFg}`,
        { stdio: 'ignore', timeout: 2000 }
      );
    } catch { /* silent */ }
  }

  resetTabColor(): void {
    const toFlag = `--to="${this.listenOn}"`;
    try {
      execSync(
        `kitten @ ${toFlag} set-tab-color --self active_bg=none active_fg=none inactive_bg=none inactive_fg=none`,
        { stdio: 'ignore', timeout: 2000 }
      );
    } catch { /* silent */ }
  }
}

// ─── Windows Terminal Implementation ────────────────────────────────────────

export class WindowsTerminalAdapter implements TerminalAdapter {
  readonly type = 'windows-terminal' as const;
  readonly supported = true;

  setTitle(title: string): void {
    try {
      process.stderr.write(`\x1b]0;${title}\x07`);
    } catch { /* silent */ }
  }

  setTabColor(_options: TabColorOptions): void {
    // No-op: WT uses profile-based color schemes, not runtime per-tab colors.
  }

  resetTabColor(): void {}
}

// ─── Generic Fallback ───────────────────────────────────────────────────────

export class GenericTerminalAdapter implements TerminalAdapter {
  readonly type = 'generic' as const;
  readonly supported = false;

  setTitle(_title: string): void {}
  setTabColor(_options: TabColorOptions): void {}
  resetTabColor(): void {}
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createTerminalAdapter(kittyListenOn?: string | null): TerminalAdapter {
  if (isKittyAvailable() && kittyListenOn) {
    return new KittyTerminalAdapter(kittyListenOn);
  }

  if (detectTerminal() === 'windows-terminal') {
    return new WindowsTerminalAdapter();
  }

  return new GenericTerminalAdapter();
}
