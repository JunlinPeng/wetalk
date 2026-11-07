#Requires -Version 5.1
<#
.SYNOPSIS
  Smoke-test the deployed Wetalk site on GitHub Pages.

.EXAMPLE
  powershell -File scripts/verify_live.ps1
  powershell -File scripts/verify_live.ps1 -BaseUrl https://junlinpeng.github.io/wetalk/
#>
param([string]$BaseUrl = "https://junlinpeng.github.io/wetalk/")

$ErrorActionPreference = "Stop"
if (-not $BaseUrl.EndsWith("/")) { $BaseUrl += "/" }

$pages = @(
    "", "index.html", "signin.html", "signup.html", "app.html", "works.html",
    "topic.html", "script.html", "schedule.html", "practice.html",
    "checkin.html", "impromptu.html", "reset.html", "reset-password.html", "404.html",
    "v2/js/app.js", "v2/js/v2-ai.js", "v2/js/v2-cloud.js", "v2/css/styles.css", "images/p1.svg",
    "js/config.js", "js/auth.js", "js/store.js", "js/llm.js", "js/ui.js", "css/styles.css"
)

$failed = @()
foreach ($page in $pages) {
    $url = $BaseUrl + $page
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
        if ($r.StatusCode -ne 200) { $failed += "$page -> HTTP $($r.StatusCode)" }
        else { Write-Host ("OK   " + $page) -ForegroundColor Green }
    } catch {
        $failed += "$page -> $($_.Exception.Message)"
        Write-Host ("FAIL " + $page) -ForegroundColor Red
    }
}

if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "Failures:" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host ("  " + $_) -ForegroundColor Red }
    exit 1
}
Write-Host ""
Write-Host "All $($pages.Count) checks passed: $BaseUrl" -ForegroundColor Green