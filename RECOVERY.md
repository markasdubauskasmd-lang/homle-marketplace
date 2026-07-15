# Tideway recovery

The public website source is safe to copy. The active `DATA_DIR` is private because it may contain customer, cleaner and business identity information. Before real intake, point `DATA_DIR` at an access-restricted local folder outside OneDrive, Dropbox, Google Drive and iCloud. On Windows, create a dedicated folder under `$env:LOCALAPPDATA\Tideway\data`, verify its permissions, and configure its absolute path in the Tideway launch environment. A startup privacy warning means the current location is not suitable for real customer records.

## Source recovery

Keep a source archive outside the working folder after each stable milestone. Never include live `data/*.ndjson`, `data/business-config.json`, `.env`, admin keys or other secrets in a source archive.

## Private data backup

Stop the Tideway server first so files cannot change during the snapshot. Run the following from the project folder. The script reads the configured `DATA_DIR`, defaults its destination to the current user's local application-data folder outside the project, extracts the completed archive to a temporary folder, compares every extracted file with its source, and prints a SHA-256 checksum only after verification succeeds.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\backup-data.ps1
```

The zip is **not encrypted by the script**. It includes customer and cleaner records plus private property media. Store it only on an access-controlled encrypted device or in an approved encrypted vault. Do not email it or upload it to a public or consumer-sync drive. The script rejects a detected OneDrive, Dropbox, Google Drive or iCloud destination unless the operator explicitly supplies `-AllowCloudDestination`; that override records no claim that the archive is protected.

To choose an explicit off-sync destination or a separately restored data folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\backup-data.ps1 -DataDirectory "C:\private\TidewayData" -DestinationDirectory "D:\encrypted-backups\Tideway"
```

## Integrity check and degraded mode

Tideway checks every private record file and the launch configuration when it starts, whenever the control-desk integrity check is run, and before every API write. Open `/admin` and review **Private record protection → Data integrity** before operating the pilot.

If the status is **Degraded — writes stopped**:

1. Do not hand-edit, delete, rename or replace the reported file. Tideway has already stopped new writes and will not repair anything automatically.
2. Create a private backup of the current state with `tools/backup-data.ps1` and keep its printed SHA-256 checksum. This preserves the evidence even when the current state is damaged.
3. Record the reported filename, line, reference and issue code. `invalid-financial-config` or `invalid-financial-record` means a parseable configuration, proposal, booking, outcome or adjustment failed its supported-value or frozen-calculation checks; do not retype or recalculate it in place. The integrity response deliberately excludes customer content and financial values.
4. Locate the latest earlier private backup whose checksum and date are known. Restore and inspect it in a separate temporary `DATA_DIR`; do not overwrite the live folder merely because a zip opens.
5. Start the restored copy on a different local port and run `/api/health` plus the authenticated `/api/admin/data-integrity` check. Accept it only when `dataIntegrity` is `healthy`, `writesAllowed` is `true`, the integrity desk shows zero issues and expected record counts are present.
6. Stop Tideway before replacing the live `data/` folder. Preserve the damaged copy separately, restore the verified copy, restart, rerun the integrity check and compare the control-desk funnel and latest real references.

Never paste private record contents into chat, email or a public issue. Escalate recovery if no verified earlier copy exists; guessing at a missing booking link can create false payment or fulfilment history.

## Recovery order

1. Restore the Tideway source folder.
2. Restore the private data files into `data/`.
3. Recreate environment variables such as `ADMIN_KEY`; never store them in source control.
4. Start the server and check `/api/health`; require `dataIntegrity: "healthy"` and `writesAllowed: true`.
5. Open `/admin`, run the data-integrity check and require zero issues before changing anything.
6. Confirm lead counts, lead statuses, cleaner-screening records, photo-brief review decisions, notes, proposals, confirmed bookings, completed-job outcomes, append-only later adjustments, current profitability and launch configuration.
7. Submit one clearly identified test customer request and one test cleaner application, then remove all test records and media through a controlled local-only procedure before any real pilot use.

## Production requirement

Local files are appropriate only for development and a tightly controlled manual pilot. Before public launch, move personal data to an encrypted production database with access controls, automated backups, retention rules and an audit trail.

Automated smoke tests use a separate temporary `DATA_DIR` and must never read, overwrite or delete the live local `data/` folder.
