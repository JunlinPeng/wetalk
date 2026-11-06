#Requires -Version 5.1
<#
.SYNOPSIS
  Connect the Wetalk web app to a Supabase project.

.DESCRIPTION
  Writes the public Supabase URL + anon key (and optional AI proxy URL) into
  js/config.js, then optionally commits and pushes so GitHub Pages redeploys.
  The anon key is a PUBLIC key: it is safe to commit. Never pass a
  service-role key here.

.EXAMPLE
  powershell -File scripts/configure_supabase.ps1 -SupabaseUrl https://abcd.supabase.co -AnonKey eyJhbGci... -AiProxyUrl https://abcd.supabase.co/functions/v1/ai-feedback -Push
#>
param(
    [Parameter(Mandatory = $true)][string]$SupabaseUrl,
    [Parameter(Mandatory = $true)][string]$AnonKey,
    [string]$AiProxyUrl = "",
    [switch]$Push
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root "js/config.js"

if (-not (Test-Path $configPath)) { throw "Cannot find js/config.js at $configPath" }

# Accept the copy-pasted "Project URL" even when it includes /rest/v1/ or a
# trailing slash - the app needs the bare project origin.
$SupabaseUrl = $SupabaseUrl.Trim().TrimEnd("/")
$SupabaseUrl = $SupabaseUrl -replace "/rest/v1$", ""
$SupabaseUrl = $SupabaseUrl.TrimEnd("/")
if ($SupabaseUrl -notmatch "^https://[a-z0-9-]+\.supabase\.co$") { throw "SupabaseUrl must look like https://abcdefgh.supabase.co (got: $SupabaseUrl)" }
if ($AnonKey.Length -lt 40) { throw "That anon key looks too short - copy the full anon public key from Supabase Project Settings > API." }
if ($AnonKey.StartsWith("sbp_")) { throw "That is a Supabase personal access token, not the anon key. Use the public anon/publishable key." }
if ($AnonKey -notmatch "^sb_publishable_[A-Za-z0-9_\-]+$" -and $AnonKey.Length -lt 60) { throw "That does not look like a Supabase anon or publishable key. Copy the public key from Project Settings > API." }

$text = Get-Content -Raw -Encoding UTF8 $configPath
$text = $text -replace '(?m)^(\s*supabaseUrl:\s*")[^"]*(")', ('${1}' + $SupabaseUrl + '${2}')
$text = $text -replace '(?m)^(\s*supabaseAnonKey:\s*")[^"]*(")', ('${1}' + $AnonKey + '${2}')
if ($AiProxyUrl) {
    $text = $text -replace '(?m)^(\s*aiProxyUrl:\s*")[^"]*(")', ('${1}' + $AiProxyUrl + '${2}')
}

[System.IO.File]::WriteAllText($configPath, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Updated js/config.js" -ForegroundColor Green
Write-Host ("  supabaseUrl     = " + $SupabaseUrl)
Write-Host ("  supabaseAnonKey = " + $AnonKey.Substring(0, [Math]::Min(12, $AnonKey.Length)) + "...")
if ($AiProxyUrl) { Write-Host ("  aiProxyUrl      = " + $AiProxyUrl) }

if ($Push) {
    Push-Location $root
    try {
        git add js/config.js
        git commit -m "feat: connect Supabase backend"
        git push
        Write-Host "Pushed - GitHub Pages will redeploy in about a minute." -ForegroundColor Green
    } finally { Pop-Location }
} else {
    Write-Host "Next: commit and push js/config.js to redeploy the site." -ForegroundColor Yellow
}
