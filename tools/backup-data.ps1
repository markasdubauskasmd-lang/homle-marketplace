param(
  [string]$DataDirectory = "",
  [string]$DestinationDirectory = "",
  [switch]$AllowCloudDestination
)

$ErrorActionPreference = "Stop"
$siteRoot = Split-Path -Parent $PSScriptRoot

if (-not $DataDirectory) {
  $DataDirectory = if ($env:DATA_DIR) { $env:DATA_DIR } else { Join-Path $siteRoot "data" }
}
if (-not $DestinationDirectory) {
  $localData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  if (-not $localData) { throw "A default non-synchronised backup location could not be determined. Pass -DestinationDirectory explicitly." }
  $DestinationDirectory = Join-Path $localData "Tideway\backups"
}

$resolvedDataDirectory = [System.IO.Path]::GetFullPath($DataDirectory).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$resolvedDestination = [System.IO.Path]::GetFullPath($DestinationDirectory).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$cloudDirectoryPattern = '(?i)(^|[\\/])(OneDrive|Dropbox|Google Drive|GoogleDrive|iCloud Drive|iCloudDrive)([\\/]|$)'

if (-not (Test-Path -LiteralPath $resolvedDataDirectory -PathType Container)) {
  throw "The Tideway private data directory does not exist: $resolvedDataDirectory"
}
if ($resolvedDestination.StartsWith("$resolvedDataDirectory$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase) -or $resolvedDestination -eq $resolvedDataDirectory) {
  throw "The backup destination must be outside the private data directory."
}
if (-not $AllowCloudDestination -and $resolvedDestination -match $cloudDirectoryPattern) {
  throw "The backup destination appears to be cloud-synchronised. Choose an access-controlled off-sync destination, or pass -AllowCloudDestination only after accepting that risk."
}

$sourceFiles = @(Get-ChildItem -LiteralPath $resolvedDataDirectory -Recurse -Force -File | Where-Object { $_.Name -ne ".gitkeep" })
if (-not $sourceFiles) {
  Write-Output "No Tideway lead or configuration data exists yet; no backup was created."
  exit 0
}

New-Item -ItemType Directory -Path $resolvedDestination -Force | Out-Null
$timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$archivePath = Join-Path $resolvedDestination "tideway-private-data_$timestamp.zip"
if (Test-Path -LiteralPath $archivePath) { throw "A backup with this timestamp already exists; wait one second and retry." }

$topLevelItems = @(Get-ChildItem -LiteralPath $resolvedDataDirectory -Force | Where-Object { $_.Name -ne ".gitkeep" })
Compress-Archive -LiteralPath $topLevelItems.FullName -DestinationPath $archivePath -CompressionLevel Optimal

$verificationDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "tideway-backup-verify-$([Guid]::NewGuid().ToString('N'))"
try {
  Expand-Archive -LiteralPath $archivePath -DestinationPath $verificationDirectory
  $expandedFiles = @(Get-ChildItem -LiteralPath $verificationDirectory -Recurse -Force -File)
  if ($expandedFiles.Count -ne $sourceFiles.Count) {
    throw "Backup verification failed: expected $($sourceFiles.Count) files but extracted $($expandedFiles.Count)."
  }

  foreach ($sourceFile in $sourceFiles) {
    $relativePath = $sourceFile.FullName.Substring($resolvedDataDirectory.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $expandedPath = Join-Path $verificationDirectory $relativePath
    if (-not (Test-Path -LiteralPath $expandedPath -PathType Leaf)) { throw "Backup verification failed: a source file was missing after extraction." }
    $sourceHash = (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash
    $expandedHash = (Get-FileHash -LiteralPath $expandedPath -Algorithm SHA256).Hash
    if ($sourceHash -ne $expandedHash) { throw "Backup verification failed: an extracted file did not match its source." }
  }
} catch {
  Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
  throw
} finally {
  Remove-Item -LiteralPath $verificationDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

$hash = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
Write-Output "Backup created and extraction-verified: $archivePath"
Write-Output "Files verified: $($sourceFiles.Count)"
Write-Output "SHA-256: $($hash.Hash)"
Write-Output "Archive encryption: none. Keep this private archive in an access-controlled encrypted device or encrypted vault."
