# PORT_FORWARD_MAP — v4.0.3 Windows fork patches → v5.0.0-windows

Source baseline: `e42469c` (last upstream commit before our v4 fork patches).
Target baseline: `ad5b8f6` (upstream v5.0.0 release).
Generated: 2026-04-30 (ISC-P0-3).

## Decision legend

- **PORT** — bring the patch forward, possibly with edits, to the v5 location
- **DROP** — patch is now redundant per C-10 (claude code v2.1.84+, native Bun stdin, native CRLF, MCP fix)
- **REWRITE** — v5 architecture changed; we need a new file rather than a port
- **MERGE** — v5 already has compatible behavior; we re-apply only the Windows-specific delta
- **SKIP** — historical artifact (v4 release notes etc.); no v5 equivalent needed

## Map

| # | v4.0.3 path | v5 location | Decision | Notes / ISC |
|---|---|---|---|---|
| 1 | `hooks/handlers/UpdateCounts.ts` | `hooks/handlers/UpdateCounts.ts` | MERGE | re-apply `os.tmpdir()` + path normalization · ISC-P1-5, ISC-P4-1 |
| 2 | `hooks/IntegrityCheck.hook.ts` | `hooks/IntegrityCheck.hook.ts` | MERGE | re-apply Windows path normalization · ISC-P1-5 |
| 3 | `hooks/lib/hook-io.ts` | `hooks/lib/hook-io.ts` | MERGE | path normalization · ISC-P1-5 |
| 4 | `hooks/lib/identity.ts` | `hooks/lib/identity.ts` | MERGE | path normalization + os.userInfo() guards · ISC-P1-5 |
| 5 | `hooks/lib/notifications.ts` | `hooks/lib/notifications.ts` | PORT | Windows Toast / notify-send fallback (no osascript) · ISC-P1-5 |
| 6 | `hooks/lib/tab-setter.ts` | `hooks/lib/tab-setter.ts` | PORT | Windows Terminal / Kitty guard · ISC-P1-5 |
| 7 | `hooks/QuestionAnswered.hook.ts` | `hooks/QuestionAnswered.hook.ts` | MERGE | path normalization · ISC-P1-5 |
| 8 | `hooks/RatingCapture.hook.ts` | (gone in v5) | DROP | superseded by v5 mode classifier · ISC-P4-1 |
| 9 | `hooks/SecurityValidator.hook.ts` | `hooks/PromptGuard.hook.ts`+`hooks/ContainmentGuard.hook.ts` | DROP | replaced by v5 ContainmentGuard architecture · ISC-P4-1 |
| 10 | `hooks/SessionAutoName.hook.ts` | (gone in v5) | DROP | feature removed upstream · ISC-P4-1 |
| 11 | `hooks/SessionCleanup.hook.ts` | `hooks/SessionCleanup.hook.ts` | MERGE | path normalization + Windows tmpdir · ISC-P1-5 |
| 12 | `hooks/WorkCompletionLearning.hook.ts` | `hooks/WorkCompletionLearning.hook.ts` | MERGE | path normalization · ISC-P1-5 |
| 13 | `install.sh` | `install.ps1` | REWRITE | new PowerShell installer · ISC-P2-1 |
| 14 | `INSTALL_GUIDE_FOR_CLAUDE.md` | `INSTALL_GUIDE_FOR_CLAUDE.md` | REWRITE | v5 paths, DA identity, supervision flag · ISC-P2-9 |
| 15 | `lib/platform.ts` | `lib/platform.ts` | PORT | expanded for Pulse needs · ISC-P1-1 |
| 16 | `lib/terminal.ts` | `lib/terminal.ts` | PORT | port if v5 hooks reference it · ISC-P1-2 |
| 17 | `PAI/Tools/Banner.ts` | `PAI/Tools/Banner.ts` | MERGE | re-apply stty/tput Windows guard |
| 18 | `PAI/Tools/BannerMatrix.ts` | (gone in v5) | DROP | banner variants pruned upstream |
| 19 | `PAI/Tools/BannerNeofetch.ts` | (gone in v5) | DROP | banner variants pruned upstream |
| 20 | `PAI/Tools/BannerRetro.ts` | (gone in v5) | DROP | banner variants pruned upstream |
| 21 | `PAI/Tools/NeofetchBanner.ts` | (gone in v5) | DROP | banner variants pruned upstream |
| 22 | `PAI/Tools/pai.ts` | `PAI/Tools/pai.ts` | MERGE | re-apply `fs.realpathSync()` (replace `readlink`) · ISC-P1-5 |
| 23 | `PAI/Tools/SplitAndTranscribe.ts` | `PAI/Tools/SplitAndTranscribe.ts` | MERGE | Windows ffmpeg path · ISC-P5-2 |
| 24 | `PAI-Install/.gitignore` | `PAI/PAI-Install/.gitignore` | PORT | trivial |
| 25 | `PAI-Install/cli/display.ts` | `PAI/PAI-Install/cli/display.ts` | MERGE | platform display name (win32 → Windows) |
| 26 | `PAI-Install/cli/index.ts` | `PAI/PAI-Install/cli/index.ts` | MERGE | flag plumbing for `--pulse-supervision` · ISC-P2-7 |
| 27 | `PAI-Install/electron/package-lock.json` | (gone in v5 — no electron) | DROP | electron wizard removed upstream |
| 28 | `PAI-Install/engine/actions.ts` | `PAI/PAI-Install/engine/actions.ts` | REWRITE | NSSM/tasksched/manual actions · ISC-P2-2..P2-8 |
| 29 | `PAI-Install/engine/detect.ts` | `PAI/PAI-Install/engine/detect.ts` | PORT | Windows admin / NSSM detection for default backend · ISC-P2-6 |
| 30 | `PAI-Install/engine/types.ts` | `PAI/PAI-Install/engine/types.ts` | PORT | add `pulseSupervision` enum · ISC-P2-7 |
| 31 | `PAI-Install/engine/validate.ts` | `PAI/PAI-Install/engine/validate.ts` | PORT | Windows preflight checks · ISC-P2-2 |
| 32 | `PAI-Install/install.sh` | `PAI/PAI-Install/install.ps1` | REWRITE | PowerShell entry · ISC-P2-1 |
| 33 | `PAI-Install/main.ts` | `PAI/PAI-Install/main.ts` | MERGE | `--pulse-supervision`, `--check-windows`, `-DryRun` · ISC-P2-2, P2-7 |
| 34 | `PAI-Install/README.md` | `PAI/PAI-Install/README.md` | MERGE | document Windows flags |
| 35 | `Releases/v4.0.3/README.md` | (n/a) | SKIP | v4 release readme; v5 has its own |
| 36 | `settings.json` | `settings.json` | MERGE | drop `bun ` prefix per C-10 · ISC-P4-2 |
| 37 | `skills/Media/Art/Tools/GenerateMidjourneyImage.ts` | (Media skill restructured in v5) | DROP | superseded by v5 `Art` skill · ISC-P5-1 |
| 38 | `statusline-command.sh` | `statusline-command.ps1` | REWRITE | PowerShell statusline · audit during ISC-P4-1 |
| 39 | `VoiceServer/server.ts` | `PAI/PULSE/VoiceServer/voice.ts` | MERGE | Windows audio path (already in v5? confirm) · ISC-P1-5 |

## Summary by decision

- **PORT**: 7 (bring forward as-is or with light edits)
- **MERGE**: 17 (re-apply Windows-only delta on top of v5 file)
- **REWRITE**: 6 (v5 architecture changed enough to warrant new files)
- **DROP**: 8 (redundant per C-10 or removed upstream)
- **SKIP**: 1 (historical)

Total: 39 (matches v4 patch file count).
