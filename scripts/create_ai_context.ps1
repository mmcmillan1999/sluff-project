# SCRIPT NAME: create_ai_context.ps1
# PURPOSE: Combines all relevant frontend and backend source code into a single
#          context file for AI assistant onboarding.

# --- CONFIGURATION ---

# --- NEW: Define the external save directory ---
$outputDir = "C:\Users\matth\OneDrive\Desktop\AI_context_History"

# --- NEW: Dynamically generate the new filename format ---
$timestamp = (Get-Date -Format "yyyy-MM-dd-HH-mm")
$branchName = $(git branch --show-current)
$outputFile = "AI-Context-Sluff-Files-Exported-$timestamp-Branch-$branchName.txt"

# --- Ensure the output directory exists ---
if (-not (Test-Path -Path $outputDir)) {
    New-Item -ItemType Directory -Force -Path $outputDir
}

$sourcePaths = @("backend", "frontend")
$excludeDirs = @("node_modules", ".git", ".vscode", "dist", "build", "public")
$excludeFiles = @("package-lock.json", "logo.svg")
$includeAtTop = @("README.md")

# --- SCRIPT LOGIC ---
$projectRootPath = (Get-Location).Path
$allContents = @()

# 1. Add the high-level overview files first
foreach ($fileName in $includeAtTop) {
    $filePath = Join-Path -Path $projectRootPath -ChildPath $fileName
    if (Test-Path $filePath) {
        $relativePath = $filePath.Substring($projectRootPath.Length + 1).Replace("\", "/")
        $allContents += "--- START FILE: $relativePath ---"
        $allContents += (Get-Content $filePath -Raw)
        $allContents += "--- END FILE: $relativePath ---`n"
    }
}

# 2. Add the source code files from specified directories
foreach ($path in $sourcePaths) {
    $files = Get-ChildItem -Path $path -Recurse -File | Where-Object {
        $shouldExclude = $false
        foreach ($dir in $excludeDirs) {
            if ($_.FullName.Contains("\$dir\") -or $_.FullName.Contains("/$dir/")) {
                $shouldExclude = $true; break
            }
        }
        if (-not $shouldExclude -and $excludeFiles -contains $_.Name) {
            $shouldExclude = $true
        }
        -not $shouldExclude
    }

    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($projectRootPath.Length + 1).Replace("\", "/")
        $allContents += "--- START FILE: $relativePath ---"
        $allContents += (Get-Content -Raw -Path $file.FullName)
        $allContents += "--- END FILE: $relativePath ---`n"
    }
}

# 3. Write everything to the new output path
$outputPath = Join-Path -Path $outputDir -ChildPath $outputFile
$allContents | Set-Content -Path $outputPath -Encoding UTF8

Write-Host "✅ Complete AI context created at: $outputPath"