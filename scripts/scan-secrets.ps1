[CmdletBinding()]
param(
    [switch]$AllHistory,
    [string]$GitleaksPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$gitleaks = if ($GitleaksPath) {
    Get-Command $GitleaksPath -ErrorAction SilentlyContinue
}
else {
    Get-Command gitleaks -ErrorAction SilentlyContinue
}
if (-not $gitleaks) {
    Write-Error 'Gitleaks is not installed or -GitleaksPath is invalid. Install a current release from https://github.com/gitleaks/gitleaks/releases and retry.'
    exit 2
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$commonArguments = @(
    '--redact=100'
    '--no-banner'
    '--config'
    '.gitleaks.toml'
)

Push-Location $repoRoot
try {
    if ($AllHistory) {
        Write-Host 'Scanning every reachable Git ref. Findings are fully redacted.'
        & $gitleaks.Source 'git' @commonArguments '--log-opts=--all' '.'
    }
    else {
        Write-Host 'Scanning staged changes. Findings are fully redacted.'
        & $gitleaks.Source 'git' '--pre-commit' '--staged' @commonArguments
    }

    $scanExitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

if ($scanExitCode -ne 0) {
    Write-Error "Gitleaks failed or found a possible secret (exit code $scanExitCode)."
}

Write-Host 'Secret scan passed.'
