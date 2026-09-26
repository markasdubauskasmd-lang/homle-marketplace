# Database recovery verification

The CI database job now rehearses a PostgreSQL16 logical backup and restore in a disposable local cluster. This verifies the recovery mechanism against the current schema; it does not verify that a production backup exists or establish a production recovery-time commitment.

## What the rehearsal does

After the existing database integration suite, tools/postgres-restore-rehearsal.mjs adds uniquely identified synthetic records, exports a consistent snapshot, writes a temporary custom-format archive and restores it into a new, fixed-name disposable database. It preserves ownership and permissions. Effective ACL entries are compared independently of array order. CHECK comparison only normalizes fully parenthesized, unquoted associative AND groups that PostgreSQL flattens when reparsing a dump; predicate text, operators and other SQL remain strict. Negative tests retain detection of changed predicates, data and expanded permissions. It compares restored data and database structure, then connects as the actual application and worker roles to verify their access boundaries.

The source must be ci_tideway_test on localhost, with the exact disposable owner, application and worker roles; the administrator connection must use the same local cluster. The destination is ci_tideway_restore_test. An existing destination or fixture is refused. The tool requires the explicit disposable-test confirmation, PostgreSQL16 clients/server, and rejects URL query overrides, unexpected roles and mismatched ports before external execution. Credentials and record contents are not printed.

Source fixture records and the temporary archive are removed after the run. The tool never drops or replaces an existing database. The newly restored database remains inside the ephemeral CI service, which GitHub destroys after the job. No object storage, email, Stripe, customer data or production connection is used.

Safety regressions run in the normal application test suite. The actual dump/restore and role checks run in the real database CI job. Run the existing workflow to exercise both; do not adapt its hardcoded guard to point at production.

## Production evidence still required

An authorized operator must record the actual provider recovery window and latest usable restore point, identify the recovery owner and acceptable data-loss/downtime limits, and perform an approved restore into an isolated provider destination. Keep the original database intact. Verify compatible application migration assets, recreated roles/secrets, ownership, grants, customer boundaries and representative booking/payment records before considering any traffic switch.

A database archive alone does not restore bucket objects, Stripe history, environment secrets, email configuration or DNS. Those dependencies need their own recovery evidence. Never send notifications or replay financial actions merely because a restored database contains queued work. Isolate outbound integrations and review payment reconciliation before starting workers on a recovered copy.

The existing tools/backup-data.ps1 archives local files; it is not proof of PostgreSQL recovery. Likewise, a successful CI rehearsal is not a measurement of production-scale restore duration or provider backup availability.

## References

- [PostgreSQL16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html) describes logical archives and ownership considerations.
- [PostgreSQL16 pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html) documents restore behavior and options.
- [Render recovery and backups](https://render.com/docs/postgresql-backups) documents provider recovery facilities. Confirm the actual account and database state rather than treating generic plan documentation as evidence of a usable backup.
