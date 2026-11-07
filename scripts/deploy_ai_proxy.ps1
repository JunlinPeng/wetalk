#Requires -Version 5.1
<#
.SYNOPSIS
  Deploy the Wetalk AI feedback proxy and connect it to the site.

.DESCRIPTION
  Uses the Supabase CLI (installed automatically into .tmp/supabase-cli if
  missing) to:
    1. set the server-side DeepSeek secret (+ per-user and global daily caps)
    2. deploy the supabase/functions/ai-feedback Edge Function
    3. write the function URL into js/config.js
  Optionally commits and pushes js/config.js so GitHub Pages redeploys.

  Needs a Supabase personal access token (Dashboard > Account > Access Tokens).
  The DeepSeek API key is read from -DeepseekKey or, failing that, from the
  desktop app's %APPDATA%/TalkReady/settings.json.

.EXAMPLE
  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
  powershell -File scripts/deploy_ai_proxy.ps1 -Push
#>
param(
    [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN,
    [string]$ProjectRef = "efhprhfonzgmpwzkzjup",
    [string]$DeepseekKey = "",
    [int]$DailyLimit = 20,
    [int]$GlobalDailyLimit = 500,
    [switch]$Push
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Find-Node {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $dsh = Join-Path $env:USERPROFILE ".dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
    if (Test-Path $dsh) { return $dsh }
    throw "Node.js not found. Install Node 20+."
}

$node = Find-Node
if (-not $AccessToken) {
    throw 'No Supabase access token. Create one at https://supabase.com/dashboard/account/tokens then pass -AccessToken or set the SUPABASE_ACCESS_TOKEN environment variable.'
}
if ($AccessToken -notmatch "^sbp_") {
    throw "That does not look like a Supabase access token (expected it to start with sbp_)."
}

if (-not $DeepseekKey) {
    $settings = Join-Path $env:APPDATA "TalkReady\settings.json"
    if (Test-Path $settings) {
        try { $DeepseekKey = (Get-Content -Raw -Encoding UTF8 $settings | ConvertFrom-Json).deepseek_api_key } catch { }
    }
}
if (-not $DeepseekKey) {
    throw "No DeepSeek API key. Pass -DeepseekKey or add one in the Wetalk desktop app settings first."
}

# ---------- ensure the Supabase CLI is available ----------
$cliDir = Join-Path $root ".tmp\supabase-cli"
$cli = Join-Path $cliDir "node_modules\supabase\dist\supabase.js"
if (-not (Test-Path $cli)) {
    Write-Host "Installing Supabase CLI into .tmp/supabase-cli ..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $cliDir | Out-Null
    Set-Content -Path (Join-Path $cliDir "package.json") -Value '{"name":"wetalk-cli-tmp","private":true}' -Encoding UTF8
    $pnpm = $null
    $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($pnpmCmd) { $pnpm = $pnpmCmd.Source }
    if (-not $pnpm) {
        $candidate = Join-Path $env:USERPROFILE ".dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs"
        if (Test-Path $candidate) { $pnpm = $candidate }
    }
    if (-not $pnpm) { throw "pnpm not found; cannot install the Supabase CLI automatically." }
    Push-Location $cliDir
    try {
        if ($pnpm -like "*.mjs") { & $node $pnpm add supabase@latest --config.confirmModulesPurge=false }
        else { & $pnpm add supabase@latest --config.confirmModulesPurge=false }
    } finally { Pop-Location }
}
if (-not (Test-Path $cli)) { throw "Supabase CLI install failed (missing $cli)." }

$env:SUPABASE_ACCESS_TOKEN = $AccessToken

function Invoke-SupabaseCli {
    param([string[]]$CliArgs)
    Push-Location $root
    try { & $node $cli @CliArgs 2>&1 } finally { Pop-Location }
}

Write-Host "Setting Edge Function secrets ..." -ForegroundColor Cyan
$output = Invoke-SupabaseCli @(
    "secrets", "set",
    "DEEPSEEK_API_KEY=$DeepseekKey",
    "DAILY_AI_LIMIT=$DailyLimit",
    "GLOBAL_DAILY_LIMIT=$GlobalDailyLimit",
    "--remote=$ProjectRef", "--yes"
)
$output | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { throw "supabase secrets set failed (see output above)." }

Write-Host "Deploying ai-feedback ..." -ForegroundColor Cyan
$output = Invoke-SupabaseCli @(
    "functions", "deploy", "ai-feedback",
    "--remote=$ProjectRef", "--use-api", "--yes"
)
$output | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { throw "supabase functions deploy failed (see output above)." }

# ---------- wire the URL into js/config.js ----------
$proxyUrl = "https://$ProjectRef.supabase.co/functions/v1/ai-feedback"
$configPath = Join-Path $root "js\config.js"
$text = Get-Content -Raw -Encoding UTF8 $configPath
$text = $text -replace '(?m)^(\s*aiProxyUrl:\s*")[^"]*(")', ('$1' + $proxyUrl + '$2')
[System.IO.File]::WriteAllText($configPath, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Updated js/config.js aiProxyUrl = $proxyUrl" -ForegroundColor Green

if ($Push) {
    Push-Location $root
    try {
        git add js/config.js
        git commit -m "feat: enable included AI via the ai-feedback proxy"
        git push
        Write-Host "Pushed - GitHub Pages will redeploy in about a minute." -ForegroundColor Green
    } finally { Pop-Location }
} else {
    Write-Host "Next: commit and push js/config.js to enable the included AI on the live site." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Per-user daily limit: $DailyLimit | global daily cap: $GlobalDailyLimit" -ForegroundColor Cyan
Write-Host "Change later with: supabase secrets set DAILY_AI_LIMIT=<n> GLOBAL_DAILY_LIMIT=<n> --remote=$ProjectRef" -ForegroundColor DarkGray
