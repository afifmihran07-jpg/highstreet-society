'use strict';

/*
 * One-time db.json -> PostgreSQL importer.
 *
 * Safety rules:
 * - DATABASE_URL is required but never printed.
 * - The adapter imports only when every required HSS table is empty.
 * - The check and import are serialized by the adapter's PostgreSQL advisory lock.
 * - Existing PostgreSQL data is never replaced by db.json.
 * - data/db.json is read only; it is never modified or deleted.
 * - The schema is not created by this script.
 */

const path = require('path');
const { initialize } = require('../db-postgres');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Keep it in your local/server environment; do not commit it.');
  }

  const jsonPath = path.join(__dirname, '..', 'data', 'db.json');
  const result = await initialize({ jsonPath });

  if (result.mode !== 'postgres') {
    throw new Error('PostgreSQL mode was not selected. DATABASE_URL must be configured.');
  }

  if (result.migration && result.migration.imported) {
    console.log('[hss] db.json imported into PostgreSQL:', result.migration.counts);
  } else {
    console.log('[hss] PostgreSQL already contains data; db.json was not imported.');
  }

  await result.pool.end();
}

main().catch(err => {
  console.error('[hss] Migration failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
