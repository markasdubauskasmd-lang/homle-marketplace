# Private GitHub publication

The Homle repository must remain private while it contains launch architecture, operational controls and security implementation details. Publishing source to GitHub does not deploy the application, enable accounts, contact users or activate payments.

## Required boundary

Run this command immediately before adding or updating the Git remote:

```text
pnpm run prepush:safety
```

The check refuses publication when:

- the worktree or index contains uncommitted changes;
- a tracked `.env` file, private key, database, NDJSON record, runtime log, backup or archive exists;
- a tracked file contains a high-confidence live provider secret pattern;
- required `.gitignore` coverage for environment files, customer records, media, logs, dependencies or backups is missing;
- an individual file exceeds 25 MiB or the tracked project exceeds 100 MiB.

The check is a final guard, not a secret-management system. Render credentials, OAuth secrets, database URLs, SMTP credentials, storage keys, monitoring URLs and Stripe secrets must be entered only through the approved hosting dashboard or secret manager. They must never be pasted into source, documentation, Git history or a GitHub issue.

## First private remote

1. Create an empty private GitHub repository without a generated README, licence or `.gitignore`.
2. Grant the connected GitHub application access to that repository.
3. Confirm the local branch is clean and `pnpm run prepush:safety` passes.
4. Add the repository as `origin` and push the existing `main` history without force.
5. Compare the remote `main` commit to the local commit before configuring Render.

Do not make the repository public, force-push, delete history or upload local `.env`, `data`, `backups`, logs or release ZIP files.
