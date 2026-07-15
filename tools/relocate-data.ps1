param(
  [string]$DataDirectory = "",
  [string]$DestinationDirectory = "",
  [switch]$ExecuteCopy,
  [switch]$ServerStoppedConfirmed,
  [string]$Confirmation = ""
)

$ErrorActionPreference = "Stop"
$siteRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$confirmationPhrase = "COPY TIDEWAY PRIVATE DATA"
$cloudDirectoryPattern = '(?i)(^|[\\/])(OneDrive|Dropbox|Google Drive|GoogleDrive|iCloud Drive|iCloudDrive)([\\/]|$)'

function Resolve-FullPath([string]$PathValue) {
  return [System.IO.Path]::GetFullPath($PathValue).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
}

function Test-SameOrChildPath([string]$Candidate, [string]$Parent) {
  if ($Candidate.Equals($Parent, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  $prefix = "$Parent$([System.IO.Path]::DirectorySeparatorChar)"
  return $Candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

if (-not $DataDirectory) {
  $DataDirectory = if ($env:DATA_DIR) { $env:DATA_DIR } else { Join-Path $siteRoot "data" }
}

$destinationWasExplicit = -not [string]::IsNullOrWhiteSpace($DestinationDirectory)
if (-not $destinationWasExplicit) {
  $localData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  if (-not $localData) { throw "A default non-synchronised data location could not be determined. Pass -DestinationDirectory explicitly." }
  $DestinationDirectory = Join-Path $localData "Tideway\data"
}

$resolvedSource = Resolve-FullPath $DataDirectory
$resolvedDestination = Resolve-FullPath $DestinationDirectory
$destinationRoot = [System.IO.Path]::GetPathRoot($resolvedDestination).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)

if (-not (Test-Path -LiteralPath $resolvedSource -PathType Container)) {
  throw "The Tideway private data directory does not exist: $resolvedSource"
}
if (Test-SameOrChildPath $resolvedDestination $resolvedSource) {
  throw "The destination must not be the source directory or a child of it."
}
if (Test-SameOrChildPath $resolvedSource $resolvedDestination) {
  throw "The destination must not contain the current source directory."
}
if (Test-SameOrChildPath $resolvedDestination $siteRoot) {
  throw "The destination must be outside the Tideway source project."
}
if ($resolvedDestination -eq $destinationRoot) {
  throw "A drive root cannot be used as the Tideway private data directory."
}
if ($resolvedDestination -match $cloudDirectoryPattern) {
  throw "The destination appears to be cloud-synchronised. Choose an access-restricted location outside OneDrive, Dropbox, Google Drive and iCloud."
}

$sourceFiles = @(Get-ChildItem -LiteralPath $resolvedSource -Recurse -Force -File | Where-Object { $_.Name -ne ".gitkeep" } | Sort-Object FullName)
$totalBytes = ($sourceFiles | Measure-Object -Property Length -Sum).Sum
if ($null -eq $totalBytes) { $totalBytes = 0 }

Write-Output "Tideway private-data relocation rehearsal"
Write-Output "Source: $resolvedSource"
Write-Output "Destination: $resolvedDestination"
Write-Output "Private files found: $($sourceFiles.Count)"
Write-Output "Total bytes: $totalBytes"

if (-not $ExecuteCopy) {
  Write-Output "DRY RUN ONLY: no directory or file was created, copied, moved or deleted."
  Write-Output "Before an approved live copy: stop Tideway, create and verify a private backup, verify destination access permissions, then rerun with -ExecuteCopy -ServerStoppedConfirmed -Confirmation '$confirmationPhrase'."
  exit 0
}

if (-not $destinationWasExplicit) {
  throw "An executed copy requires an explicit -DestinationDirectory so the approved location is unambiguous."
}
if (-not $ServerStoppedConfirmed) {
  throw "Stop every Tideway server process and pass -ServerStoppedConfirmed before copying private records."
}
if ($Confirmation -cne $confirmationPhrase) {
  throw "The executed copy requires the exact case-sensitive confirmation phrase: $confirmationPhrase"
}
if ($sourceFiles.Count -eq 0) {
  throw "No private Tideway files were found. Nothing was copied."
}

if (Test-Path -LiteralPath $resolvedDestination) {
  if (-not (Test-Path -LiteralPath $resolvedDestination -PathType Container)) {
    throw "The destination exists but is not a directory."
  }
  $existingItems = @(Get-ChildItem -LiteralPath $resolvedDestination -Force)
  if ($existingItems.Count -gt 0) {
    throw "The destination must be absent or empty. The tool will not merge with or overwrite existing data."
  }
} else {
  New-Item -ItemType Directory -Path $resolvedDestination | Out-Null
}

$sourceSnapshot = @{}
foreach ($sourceFile in $sourceFiles) {
  $relativePath = $sourceFile.FullName.Substring($resolvedSource.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  $sourceSnapshot[$relativePath] = [PSCustomObject]@{
    Length = $sourceFile.Length
    Hash = (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash
  }
}

foreach ($relativePath in $sourceSnapshot.Keys) {
  $sourcePath = Join-Path $resolvedSource $relativePath
  $destinationPath = Join-Path $resolvedDestination $relativePath
  $destinationParent = Split-Path -Parent $destinationPath
  if (-not (Test-Path -LiteralPath $destinationParent -PathType Container)) {
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
  }
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath
}

$destinationFiles = @(Get-ChildItem -LiteralPath $resolvedDestination -Recurse -Force -File | Sort-Object FullName)
if ($destinationFiles.Count -ne $sourceSnapshot.Count) {
  throw "Relocation verification failed: expected $($sourceSnapshot.Count) destination files but found $($destinationFiles.Count). The source was not deleted; do not use this destination."
}

foreach ($relativePath in $sourceSnapshot.Keys) {
  $sourcePath = Join-Path $resolvedSource $relativePath
  $destinationPath = Join-Path $resolvedDestination $relativePath
  if (-not (Test-Path -LiteralPath $destinationPath -PathType Leaf)) {
    throw "Relocation verification failed: a copied file is missing. The source was not deleted; do not use this destination."
  }

  $expected = $sourceSnapshot[$relativePath]
  $currentSource = Get-Item -LiteralPath $sourcePath
  $currentSourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
  $destinationHash = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash
  if ($currentSource.Length -ne $expected.Length -or $currentSourceHash -ne $expected.Hash) {
    throw "Relocation verification failed: a source file changed during the copy. The source was not deleted; do not use this destination."
  }
  if ((Get-Item -LiteralPath $destinationPath).Length -ne $expected.Length -or $destinationHash -ne $expected.Hash) {
    throw "Relocation verification failed: a destination file does not match its source. The source was not deleted; do not use this destination."
  }
}

Write-Output "COPY VERIFIED: $($sourceSnapshot.Count) private files match by byte length and SHA-256."
Write-Output "The source remains untouched. Do not delete it."
Write-Output "Next: set DATA_DIR to the destination, start Tideway, require /api/health to be healthy, and verify the authenticated control-desk integrity check and expected record counts before intake."
Write-Output "Only after separate retention approval and a verified backup should the old source be considered for controlled removal. This tool never removes it."
