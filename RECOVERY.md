# Tideway recovery

The public website source is safe to copy. The `data/` folder is private because it may contain customer, cleaner and business identity information.

## Source recovery

Keep a source archive outside the working folder after each stable milestone. Never include live `data/*.ndjson`, `data/business-config.json`, `.env`, admin keys or other secrets in a source archive.

## Private data backup

Run the following from the Tideway project folder. It creates a timestamped device-protected zip only when private data exists and prints a SHA-256 checksum.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\backup-data.ps1
```

The archive itself is sensitive. It includes customer and cleaner records plus any private property photos saved in job briefs. Store it only in an access-controlled location. Do not email it or upload it to a public drive.

## Recovery order

1. Restore the Tideway source folder.
2. Restore the private data files into `data/`.
3. Recreate environment variables such as `ADMIN_KEY`; never store them in source control.
4. Start the server and check `/api/health`.
5. Open `/admin` and confirm lead counts, lead statuses, cleaner-screening records, photo-brief review decisions, notes, proposals, confirmed bookings, completed-job outcomes, append-only later adjustments, current profitability and launch configuration.
6. Submit one test customer request and one test cleaner application, then remove the test records.

## Production requirement

Local files are appropriate only for development and a tightly controlled manual pilot. Before public launch, move personal data to an encrypted production database with access controls, automated backups, retention rules and an audit trail.

Automated smoke tests use a separate temporary `DATA_DIR` and must never read, overwrite or delete the live local `data/` folder.
