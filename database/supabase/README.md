# Supabase-only migrations

These migrations belong to the restricted Forge skill-administration journal.
They are deliberately outside `netlify/database/migrations`: Netlify uploads
and applies every SQL file in that directory to its own application database.

The runtime connects using `FORGE_SKILL_ADMIN_DATABASE_URL`, never the ordinary
Netlify application pool. Do not copy these files into Netlify's migration
directory or run them as part of a site build.

Apply in filename order only to the reviewed Supabase database, inside a
transaction, with a migration administrator. The request role must retain the
exact privileges checked by `verifySkillAdminDatabaseRole`. Never give it the
application owner's credentials or `BYPASSRLS`. Store its generated login only
in encrypted Functions environment settings.

Both files were applied and the restricted login verified on 22 September 2026.
Moving the files did not modify their SQL or rerun them. A previous PR preview
may contain an unused copy of the first journal; it is not authoritative and is
not deleted by this change. Production journal authority remains Supabase.

Local proofs:

```sh
node scripts/test-forge-skill-admin-sql.mjs --disposable-memory-only
node scripts/test-forge-skill-admin-native.mjs --disposable-only --postgres-bin=/absolute/path/to/postgresql/bin
```

The native proof script documents its required explicit local-only arguments in
its initial argument validation. It creates a disposable local PostgreSQL
cluster; never substitute a production connection URL.

See [deployment evidence](../../docs/v2-release-campaign/netlify-resume-20260922.md).
