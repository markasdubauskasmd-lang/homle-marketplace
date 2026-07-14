param(
  [string]$DestinationDirectory = ""
)

$ErrorActionPreference = "Stop"
$siteRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = Join-Path $siteRoot "data"

if (-not $DestinationDirectory) {
  $DestinationDirectory = Join-Path $siteRoot "backups"
}

$resolvedSiteRoot = [System.IO.Path]::GetFullPath($siteRoot)
$resolvedDataDirectory = [System.IO.Path]::GetFullPath($dataDirectory)
$resolvedDestination = [System.IO.Path]::GetFullPath($DestinationDirectory)

if (-not $resolvedDataDirectory.StartsWith($resolvedSiteRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "The data directory is outside the Tideway site root."
}

New-Item -ItemType Directory -Path $resolvedDestination -Force | Out-Null
$items = Get-ChildItem -LiteralPath $resolvedDataDirectory -Force | Where-Object { $_.Name -ne ".gitkeep" }

if (-not $items) {
  Write-Output "No Tideway lead or configuration data exists yet; no backup was created."
  exit 0
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$archivePath = Join-Path $resolvedDestination "tideway-private-data_$timestamp.zip"
Compress-Archive -LiteralPath $items.FullName -DestinationPath $archivePath -CompressionLevel Optimal
$hash = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256

Write-Output "Backup created: $archivePath"
Write-Output "SHA-256: $($hash.Hash)"
