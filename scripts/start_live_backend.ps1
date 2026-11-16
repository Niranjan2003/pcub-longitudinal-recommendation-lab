<#
.SYNOPSIS
Starts the PCUB backend in LIVE guarded mode for a controlled, operator-attended session.

.DESCRIPTION
Uses the backend's own --live, --journal and --live-call-limit options; no backend file is
changed. The provider endpoint and token are supplied by the operator:

  * from DEMO_PROVIDER_ENDPOINT and DEMO_PROVIDER_TOKEN, if they are set in this PowerShell
    session (they are removed from the session immediately), otherwise
  * by prompting. The token is read with Read-Host -AsSecureString and never echoed.

The values are placed only in the environment of the backend child process. This script never
writes them to disk, never prints them and never passes them on a command line. When the
script ends (Q, Ctrl+C or an error) it stops the backend and drops its copies.

The live-call limit counts every reservation ever made in the journal file, including earlier
runs. Use a new -Journal path for a new rehearsal and keep old journals as evidence.

While it runs, type R and Enter to restart the backend with the same journal and database
(journal durability check), or Q and Enter to stop. Restart only while no request is in
progress: a request interrupted in flight becomes an unknown completion that is never retried.

.EXAMPLE
  .\scripts\start_live_backend.ps1 -LiveCallLimit 2
  Then start the frontend against it, in another terminal, from frontend\:
  $env:PCUB_FRONTEND_PORT = '5175'; $env:PCUB_BACKEND_URL = 'http://127.0.0.1:8785'; npm run dev
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateRange(1, 50)][int]$LiveCallLimit,
  [int]$Port = 8785,
  [string]$FrontendOrigin = 'http://localhost:5175',
  [string]$Journal = 'runtime\live_demo\provider_journal.sqlite3',
  [string]$Database = 'runtime\live_demo\live_demo.sqlite3'
)
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$backendDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'backend'
$python = Join-Path $backendDir '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw "Backend virtual environment not found: $python (see SETUP.md section 3)." }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port is already in use. Choose another -Port." }
foreach ($path in $Journal, $Database) {
  $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent ([IO.Path]::Combine($backendDir, $path)))
}

# ---- operator-supplied provider configuration ------------------------------------------
$endpoint = $env:DEMO_PROVIDER_ENDPOINT
if ([string]::IsNullOrWhiteSpace($endpoint)) {
  $endpoint = Read-Host 'Provider endpoint (full https:// chat-completions URL, without any key in it)'
} else {
  Write-Host 'Using DEMO_PROVIDER_ENDPOINT from this PowerShell session.'
}
$endpoint = $endpoint.Trim()
if (-not [string]::IsNullOrEmpty($env:DEMO_PROVIDER_TOKEN)) {
  $token = ConvertTo-SecureString -String $env:DEMO_PROVIDER_TOKEN -AsPlainText -Force
  Write-Host 'Using DEMO_PROVIDER_TOKEN from this PowerShell session.'
} else {
  $token = Read-Host 'Provider token (input is hidden)' -AsSecureString
}
Remove-Item Env:DEMO_PROVIDER_TOKEN, Env:DEMO_PROVIDER_ENDPOINT -ErrorAction SilentlyContinue
if (-not $endpoint.StartsWith('https://')) { $token.Dispose(); throw 'The endpoint must start with https://' }
if ($token.Length -eq 0) { $token.Dispose(); throw 'No token was entered.' }
$token.MakeReadOnly()

function Start-LiveBackend {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $python
  $psi.Arguments = ('-B -m demo_backend.api.server --assets assets --database "{0}" --journal "{1}" --live --live-call-limit {2} --port {3}' -f $Database, $Journal, $LiveCallLimit, $Port)
  $psi.WorkingDirectory = $backendDir
  $psi.UseShellExecute = $false
  $vars = $psi.EnvironmentVariables
  foreach ($name in 'DEMO_API_TOKEN', 'DEMO_PROVIDER_TOKEN', 'DEMO_PROVIDER_ENDPOINT') { if ($vars.ContainsKey($name)) { $vars.Remove($name) } }
  $vars['PYTHONPATH'] = 'src'
  $vars['PYTHONDONTWRITEBYTECODE'] = '1'
  $vars['DEMO_FRONTEND_ORIGIN'] = $FrontendOrigin
  $vars['DEMO_PROVIDER_ENDPOINT'] = $endpoint
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($token)
  try { $vars['DEMO_PROVIDER_TOKEN'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  try { $proc = [System.Diagnostics.Process]::Start($psi) }
  finally { $vars.Remove('DEMO_PROVIDER_TOKEN') }
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) { throw "The backend exited during start-up (exit code $($proc.ExitCode))." }
    try {
      $caps = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/capabilities" -TimeoutSec 2
      Write-Host ('Backend PID {0} on http://127.0.0.1:{1}: mode={2}, live_guarded={3}, live-call limit {4}, journal {5}' -f $proc.Id, $Port, $caps.mode, $caps.live_guarded, $LiveCallLimit, $Journal)
      return $proc
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  Stop-Process -Id $proc.Id -Force
  throw 'The backend did not answer within 120 seconds.'
}

$proc = $null
try {
  $proc = Start-LiveBackend
  Write-Host 'LIVE MODE IS ON. A guarded-LLM recommendation for a context that is neither recorded nor journaled sends ONE provider request.'
  Write-Host "Frontend origin allowed: $FrontendOrigin"
  :control while ($true) {
    $answer = Read-Host 'Type R and Enter to restart (same journal and database), Q and Enter to stop'
    if ($proc.HasExited) { Write-Host "The backend has exited (exit code $($proc.ExitCode))."; break control }
    switch -Regex ($answer) {
      '^\s*[Rr]' {
        Stop-Process -Id $proc.Id -Force
        $proc.WaitForExit()
        Write-Host 'Backend stopped. Starting it again with the same journal and database...'
        $proc = Start-LiveBackend
      }
      '^\s*[Qq]' { break control }
    }
  }
} finally {
  if ($null -ne $proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force; $proc.WaitForExit() }
  $token.Dispose()
  Remove-Variable -Name endpoint, token -ErrorAction SilentlyContinue
  Remove-Item Env:DEMO_PROVIDER_TOKEN, Env:DEMO_PROVIDER_ENDPOINT -ErrorAction SilentlyContinue
  Write-Host 'Live backend stopped. The provider token and endpoint were dropped from this script and this session.'
}
