import path from "node:path";

const cloudDirectoryNames = new Map([
  ["onedrive", "OneDrive"],
  ["dropbox", "Dropbox"],
  ["google drive", "Google Drive"],
  ["googledrive", "Google Drive"],
  ["icloud drive", "iCloud Drive"],
  ["iclouddrive", "iCloud Drive"]
]);

export function cloudSyncProvider(dataDirectory) {
  const segments = path.resolve(String(dataDirectory || ".")).split(/[\\/]+/).map((segment) => segment.trim().toLowerCase());
  for (const segment of segments) if (cloudDirectoryNames.has(segment)) return cloudDirectoryNames.get(segment);
  return "";
}

export function assessPrivateDataDirectory(dataDirectory, { explicitlyConfigured = false } = {}) {
  const provider = cloudSyncProvider(dataDirectory);
  return {
    safeForPrivatePilot: !provider,
    cloudSyncProvider: provider,
    explicitlyConfigured: explicitlyConfigured === true,
    warning: provider
      ? `Private Tideway data is inside ${provider}, where customer details and property media may be synchronised in plaintext. Set DATA_DIR to a private non-synchronised local folder before real intake.`
      : ""
  };
}
