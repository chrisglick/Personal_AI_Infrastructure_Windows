# PAI v4.0.3 — Non-Interactive Install Guide (For Claude Code)

> **This guide is for AI agents (Claude Code) installing PAI on behalf of a user.**
> It replaces the interactive installer with step-by-step commands that work in a non-interactive shell.

## Prerequisites

Before starting, verify these are installed:

```bash
git --version    # Git for Windows
bun --version    # Bun runtime
claude --version # Claude Code (you're already running this)
```

If `bun` is missing, tell the user to open PowerShell and run: `irm bun.sh/install.ps1 | iex`, then restart their terminal.

## Step 1: Clone and Copy

```bash
git clone https://github.com/chrisglick/Personal_AI_Infrastructure_Windows.git /tmp/pai-install
cp -r /tmp/pai-install/Releases/v4.0.3/.claude ~/
```

If `~/.claude` already exists (it will if Claude Code is running), the `cp -r` merges the new files in. Existing `settings.json` and user files are preserved.

## Step 2: Create Directory Structure

```bash
mkdir -p ~/.claude/MEMORY/STATE
mkdir -p ~/.claude/MEMORY/LEARNING/REFLECTIONS
mkdir -p ~/.claude/MEMORY/WORK
mkdir -p ~/.claude/MEMORY/RELATIONSHIP
mkdir -p ~/.claude/MEMORY/VOICE
mkdir -p ~/.claude/Plans
mkdir -p ~/.config/PAI
```

## Step 3: Collect User Info

Ask the user for:
1. **Their name** (e.g., "Krishna")
2. **AI assistant name** (e.g., "Gyges") — or use "PAI" as default
3. **Timezone** — auto-detect with: `date +%Z` or ask

## Step 4: Update settings.json

Read the existing `~/.claude/settings.json` (the release ships a complete one with hooks, statusline, etc.). Only update the identity fields — do NOT overwrite the whole file.

Use this approach — read the file, update ONLY these fields, write it back:

```json
{
  "env": {
    "PAI_DIR": "THE_USERS_HOME_DIR/.claude"
  },
  "principal": {
    "name": "THE_USERS_NAME",
    "timezone": "DETECTED_OR_PROVIDED_TIMEZONE"
  },
  "daidentity": {
    "name": "THE_AI_NAME",
    "fullName": "THE_AI_NAME — Personal AI",
    "displayName": "THE_AI_NAME_UPPERCASE",
    "color": "#3B82F6"
  },
  "pai": {
    "version": "4.0.3",
    "algorithmVersion": "3.7.0"
  }
}
```

**IMPORTANT:** Merge these fields into the existing settings.json. Do NOT replace the file — it contains hooks, permissions, statusline config, and other settings that must be preserved.

To get the user's home directory in bash: `echo $HOME` (or `echo $USERPROFILE` on Windows if HOME is unset).

## Step 5: Set Up Shell Alias

Add the PAI alias to `~/.bashrc`:

```bash
# Check if alias already exists
if ! grep -q "# PAI alias" ~/.bashrc 2>/dev/null; then
  echo '' >> ~/.bashrc
  echo '# PAI alias' >> ~/.bashrc
  echo "alias pai='bun \"\$HOME/.claude/PAI/Tools/pai.ts\"'" >> ~/.bashrc
fi
```

## Step 6: Set PAI_DIR Environment Variable

```bash
if ! grep -q "PAI_DIR" ~/.bashrc 2>/dev/null; then
  echo 'export PAI_DIR="$HOME/.claude"' >> ~/.bashrc
fi
```

## Step 7: Build CLAUDE.md

```bash
bun ~/.claude/PAI/Tools/BuildCLAUDE.ts
```

If this fails (tool may not exist in all versions), that's okay — CLAUDE.md will be generated on first PAI session.

## Step 8: Verify

Check these files exist:
- `~/.claude/settings.json` — has the user's name and AI name
- `~/.claude/PAI/` — PAI system directory exists
- `~/.claude/hooks/` — hooks directory exists
- `~/.claude/skills/` — skills directory exists
- `~/.claude/MEMORY/` — memory directories exist

## Step 9: Tell the User

Tell the user to:
1. Close and reopen their terminal (or run `source ~/.bashrc`)
2. Run `pai` to start PAI

## Voice Setup (Optional)

Voice features require an ElevenLabs API key. If the user wants voice:

1. Ask for their ElevenLabs API key
2. Write it to `~/.config/PAI/.env`:
   ```bash
   echo "ELEVENLABS_API_KEY=their_key_here" > ~/.config/PAI/.env
   ```
3. Copy to other locations hooks expect:
   ```bash
   cp ~/.config/PAI/.env ~/.claude/.env
   cp ~/.config/PAI/.env ~/.env
   ```

## Notes

- This guide is for the **Windows fork** (`chrisglick/Personal_AI_Infrastructure_Windows`). The upstream `danielmiessler/PAI` repo does not have Windows compatibility fixes.
- The interactive installer (`bash install.sh`) does not work when driven by Claude Code because it requires interactive terminal input.
- All paths use forward slashes — Git Bash on Windows handles this correctly.
