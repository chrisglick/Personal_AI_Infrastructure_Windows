# LifeOS on native Windows — fork notes

This fork (`windows-v7.1.1`) adapts LifeOS v7.1.1 to run on native Windows (Win10+, Bun, Git Bash present but not required at runtime). Everything a third party must do differently from the macOS/Linux install is listed here. If it isn't listed here, stock upstream behavior applies.

## Requirements

### 1. `HOME` environment variable (required)
Upstream code reads `$HOME` / `process.env.HOME` in ~145 runtime files; 21 sites crash at module load when it is unset, and most others silently fall back to wrong (cwd-relative) paths. Windows does not set `HOME` by default — only `USERPROFILE`.

**Set a user-level `HOME` before installing:**
```powershell
[Environment]::SetEnvironmentVariable('HOME', $env:USERPROFILE, 'User')
```
Then restart your terminal. (Planned: a `Doctor.ts` check that verifies/sets this; mechanical `HOME || USERPROFILE` fallbacks for the crash sites are candidates for an upstream PR.)

### 2. Bun ≥ 1.3.x
`hooks/lib/hook-io.ts` `readHookInput()` (Bun.stdin stream reader) is verified working on Windows under Bun 1.3.8 (7–10 ms reads via PowerShell and Git Bash pipes). Older Bun versions had a Windows/MSYS stdin hang — do not run this fork on Bun versions earlier than 1.3.

## Deliberate differences from upstream

### Tab titles: not supported on Windows (hooks not registered)
Upstream's tab-title system (TabState.hook.ts, lib/tab-setter.ts) drives the **Kitty terminal**, which does not run on native Windows. On Windows these hooks would silently no-op on every prompt. This fork **does not register the tab hooks** on Windows installs. If you use Kitty via WSL, register them manually. (A Windows Terminal backend via ANSI title escapes is a possible future contribution.)

### USER directory link: junction instead of symlink
Windows symlinks require admin rights or Developer Mode; this fork uses an NTFS junction for the USER directory link (commit `cd6b333`). No user action needed.

### Temp paths
Hardcoded `/tmp` paths are routed through `os.tmpdir()` (commit `9450520`). No user action needed.

### Pulse daemon: Scheduled Task instead of launchd/systemd
Upstream manages the Pulse daemon (:31337) with `manage.sh` (launchd plist on macOS, systemd user unit on Linux) — neither exists on Windows. This fork adds **`LIFEOS/PULSE/manage.ps1`** with the same commands:
```powershell
powershell -File "$env:USERPROFILE\.claude\LIFEOS\PULSE\manage.ps1" install   # logon Scheduled Task 'LifeOS-Pulse' + start + :31337 bind verification
powershell -File "$env:USERPROFILE\.claude\LIFEOS\PULSE\manage.ps1" status   # PID + uptime + last job runs
```
`start|stop|restart|uninstall` also supported. Logs land in `LIFEOS/PULSE/logs/`.

### Voice
Voice notifications use ElevenLabs cloud upstream. Running without voice is a supported state: decline it via `bun Doctor.ts` (`decline` path). Nothing else in the system depends on it.

## Scheduled jobs
If you add Task Scheduler entries that reference `~/.claude` paths, re-verify their action paths after any reinstall — scheduled jobs fire silently at dead paths (see upstream discussion #1616).

## Known-good environment
- Windows 10 Home 10.0.19045, Bun 1.3.8, PowerShell 5.1 + Git Bash
- `HOME` set per above; install at `%USERPROFILE%\.claude`
