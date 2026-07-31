#!/usr/bin/env tsx

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import postgres from 'postgres';
import { readdir, readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://graviton:graviton_dev@localhost:5432/graviton';

const MIGRATIONS_DIR = join(
  __dirname,
  '../apps/graviton-server/src/db/migrations'
);

async function runMigrations() {
  const sql = postgres(DATABASE_URL);

  try {
    // Create migrations table if not exists
    await sql`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    console.log('Migrations table ready');

    // Get all migration files
    const files = await readdir(MIGRATIONS_DIR);
    const migrationFiles = files.filter((f) => f.endsWith('.sql')).sort();

    console.log(`Found ${migrationFiles.length} migration files`);

    // Get executed migrations
    const executed = await sql<
      Array<{ name: string }>
    >`SELECT name FROM migrations ORDER BY id`;
    const executedNames = new Set(executed.map((m) => m.name));

    // Run pending migrations
    for (const file of migrationFiles) {
      if (executedNames.has(file)) {
        console.log(`⏭️  Skipping ${file} (already executed)`);
        continue;
      }

      console.log(`🔄 Running migration: ${file}`);
      const migrationPath = join(MIGRATIONS_DIR, file);
      const migrationSQL = await readFile(migrationPath, 'utf-8');

      await sql.begin(async (tx) => {
        // Execute migration
        await tx.unsafe(migrationSQL);

        // Record migration
        await tx`INSERT INTO migrations (name) VALUES (${file})`;
      });

      console.log(`✅ Completed: ${file}`);
    }

    console.log('\n✨ All migrations completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

const command = process.argv[2];

if (command === 'up' || !command) {
  runMigrations();
} else if (command === 'down') {
  console.log('Migration rollback not implemented yet');
  process.exit(1);
} else {
  console.log('Usage: tsx scripts/migrate.ts [up|down]');
  process.exit(1);
}
