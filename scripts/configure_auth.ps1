#Requires -Version 5.1
<#
.SYNOPSIS
  Configure the Supabase Auth URLs (and optionally OAuth providers) for Wetalk.

.DESCRIPTION
  Uses the Supabase Management API with a personal access token to set:
    - Site URL               (default https://junlinpeng.github.io/wetalk/)
    - Redirect URL allow list (GitHub Pages + local development)
    - optionally GitHub sign-in
    - optionally Google sign-in

  Get an access token from https://supabase.com/dashboard/account/tokens

.EXAMPLE
  $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
  powershell -File scripts/configure_auth.ps1

.EXAMPLE
  powershell -File scripts/configure_auth.ps1 -GithubClientId Iv1.xxxx -GithubClientSecret xxxx
#>
param(
    [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN,
    [string]$ProjectRef = "efhprhfonzgmpwzkzjup",
    [string]$SiteUrl = "https://junlinpeng.github.io/wetalk/",
    [string]$RedirectUrls = "https://junlinpeng.github.io/wetalk/**,http://localhost:8080/**",
    [string]$GithubClientId = "",
    [string]$GithubClientSecret = "",
    [string]$GoogleClientId = "",
    [string]$GoogleClientSecret = ""
)

$ErrorActionPreference = "Stop"
if (-not $AccessToken) {
    throw 'No Supabase access token. Create one at https://supabase.com/dashboard/account/tokens then set the SUPABASE_ACCESS_TOKEN environment variable.'
}
if ($AccessToken -notmatch "^sbp_") { throw "That does not look like a Supabase access token (expected sbp_...)." }

$base = "https://api.supabase.com/v1/projects/$ProjectRef/config/auth"
$headers = @{ Authorization = "Bearer $AccessToken"; "Content-Type" = "application/json" }

Write-Host "Reading current auth config ..." -ForegroundColor Cyan
$current = Invoke-RestMethod -Uri $base -Headers $headers -Method GET -TimeoutSec 40

$payload = @{
    site_url       = $SiteUrl
    uri_allow_list = $RedirectUrls
}

if ($GithubClientId -and $GithubClientSecret) {
    $payload.external_github_enabled = $true
    $payload.external_github_client_id = $GithubClientId
    $payload.external_github_secret = $GithubClientSecret
}
if ($GoogleClientId -and $GoogleClientSecret) {
    $payload.external_google_enabled = $true
    $payload.external_google_client_id = $GoogleClientId
    $payload.external_google_secret = $GoogleClientSecret
}

Write-Host "Updating auth config ..." -ForegroundColor Cyan
$body = $payload | ConvertTo-Json -Depth 4
$updated = Invoke-RestMethod -Uri $base -Headers $headers -Method PATCH -Body $body -TimeoutSec 60

Write-Host ""
Write-Host "Site URL:       $($updated.site_url)" -ForegroundColor Green
Write-Host "Redirect URLs:  $($updated.uri_allow_list)" -ForegroundColor Green
Write-Host ("GitHub sign-in: " + $(if ($updated.external_github_enabled) { "enabled" } else { "disabled" })) -ForegroundColor Green
Write-Host ("Google sign-in: " + $(if ($updated.external_google_enabled) { "enabled" } else { "disabled" })) -ForegroundColor Green
Write-Host ""
Write-Host "OAuth callback URL to register with each provider:" -ForegroundColor Cyan
Write-Host "  https://$ProjectRef.supabase.co/auth/v1/callback"
