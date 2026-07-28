# LifeOS Pulse — Process Management (Windows)
# Usage: powershell -File manage.ps1 {start|stop|restart|status|install|uninstall}
# Windows counterpart of manage.sh (launchd/systemd are unavailable here);
# `install` registers a Scheduled Task that starts Pulse at logon.

param([Parameter(Position = 0)][string]$Command = "")

$PulseDir  = Join-Path $env:USERPROFILE ".claude\LIFEOS\PULSE"
$TaskName  = "LifeOS-Pulse"
$PidFile   = Join-Path $PulseDir "state\pulse.pid"
$StateFile = Join-Path $PulseDir "state\state.json"
$LogDir    = Join-Path $PulseDir "logs"

# Resolve bun (canonical installer location first, then PATH — same order rationale as manage.sh).
$BunPath = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
if (-not (Test-Path $BunPath)) {
  $cmd = Get-Command bun -ErrorAction SilentlyContinue
  if ($cmd) { $BunPath = $cmd.Source } else { Write-Error "bun not found — install from https://bun.sh"; exit 1 }
}

function Start-Pulse {
  New-Item -ItemType Directory -Force (Join-Path $PulseDir "state") | Out-Null
  New-Item -ItemType Directory -Force $LogDir | Out-Null
  $p = Start-Process -FilePath $BunPath -ArgumentList "`"$PulseDir\pulse.ts`"" `
        -WorkingDirectory $PulseDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $LogDir "pulse-stdout.log") `
        -RedirectStandardError  (Join-Path $LogDir "pulse-stderr.log")
  Set-Content -Path $PidFile -Value $p.Id -Encoding ascii
  Write-Output "LifeOS Pulse started (PID $($p.Id))"
}

function Stop-Pulse {
  if (Test-Path $PidFile) {
    $procId = Get-Content $PidFile
    try { Stop-Process -Id $procId -Force -ErrorAction Stop; Write-Output "LifeOS Pulse stopped (PID $procId)" }
    catch { Write-Output "LifeOS Pulse stopped (PID $procId was not running)" }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  } else {
    # Fall back to matching the daemon by command line (stale/missing PID file).
    $procs = Get-CimInstance Win32_Process -Filter "Name = 'bun.exe'" |
             Where-Object { $_.CommandLine -match 'pulse\.ts' }
    foreach ($pr in $procs) { Stop-Process -Id $pr.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Output "LifeOS Pulse stopped"
  }
}

function Test-PulsePort {
  # Verify pulse actually binds :31337 within 10s — silent success when the
  # daemon never came up is the failure mode manage.sh guards against too.
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      Invoke-RestMethod -Uri "http://localhost:31337/notify" -Method Post -TimeoutSec 1 `
        -ContentType "application/json" -Body '{"message":"","voice_enabled":false}' | Out-Null
      return $true
    } catch { }
  }
  return $false
}

switch ($Command) {
  "start"   { Start-Pulse }
  "stop"    { Stop-Pulse }
  "restart" { Stop-Pulse; Start-Sleep 2; Start-Pulse }

  "status" {
    $running = $false
    if (Test-Path $PidFile) {
      $procId = Get-Content $PidFile
      $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($proc) {
        $uptime = (Get-Date) - $proc.StartTime
        Write-Output ("LifeOS Pulse: RUNNING (PID $procId, uptime {0:d\.hh\:mm\:ss})" -f $uptime)
        $running = $true
      } else { Write-Output "LifeOS Pulse: DEAD (stale PID $procId)" }
    } else { Write-Output "LifeOS Pulse: NOT RUNNING (no PID file)" }

    if ($running -and (Test-Path $StateFile)) {
      Write-Output ""
      Write-Output "Last job runs:"
      $state = Get-Content $StateFile -Raw | ConvertFrom-Json
      foreach ($job in $state.jobs.PSObject.Properties) {
        $ago = [math]::Round(((Get-Date) - [DateTimeOffset]::FromUnixTimeMilliseconds($job.Value.lastRun).LocalDateTime).TotalMinutes)
        $failing = if ($job.Value.consecutiveFailures -gt 0) { " [FAILING x$($job.Value.consecutiveFailures)]" } else { "" }
        Write-Output "  $($job.Name): $ago min ago ($($job.Value.lastResult))$failing"
      }
    }
  }

  "install" {
    # Kill any prior pulse before installing fresh — prevents the stale-PID /
    # unbound-port half-dead state (same guard as manage.sh).
    schtasks /End /TN $TaskName 2>$null | Out-Null
    Get-CimInstance Win32_Process -Filter "Name = 'bun.exe'" |
      Where-Object { $_.CommandLine -match 'pulse\.ts' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep 1

    # Logon-triggered Scheduled Task; runs this script's `start` so PID-file
    # bookkeeping is identical whether started by task or by hand.
    $action  = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PulseDir\manage.ps1`" start"
    schtasks /Create /F /TN $TaskName /SC ONLOGON /RL LIMITED /TR $action | Out-Null
    Start-Pulse

    if (Test-PulsePort) {
      Write-Output "LifeOS Pulse installed and verified on port 31337 (bun: $BunPath)"
    } else {
      Write-Error "LifeOS Pulse installed but port 31337 did not bind within 10s.`n  Check: Get-Content $LogDir\pulse-stderr.log -Tail 50"
      exit 1
    }
  }

  "uninstall" {
    schtasks /Delete /F /TN $TaskName 2>$null | Out-Null
    Stop-Pulse
    Write-Output "LifeOS Pulse uninstalled"
  }

  default { Write-Output "Usage: manage.ps1 {start|stop|restart|status|install|uninstall}"; exit 1 }
}
