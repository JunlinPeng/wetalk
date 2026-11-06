#Requires -Version 5.1
<#
.SYNOPSIS
  Serve the Wetalk site locally for development.
.DESCRIPTION
  Serves this folder on http://localhost:8080.
#>
param([int]$Port = 8080)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    python -m http.server $Port
} finally { Pop-Location }
