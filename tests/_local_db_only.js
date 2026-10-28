/**
 * tests/_local_db_only.js
 *
 * Import this FIRST in every test that loads the database code:
 *
 *     import './_local_db_only.js';
 *
 * Tests create and delete rows, so they must never run on the live MySQL database. A test that only sets
 * USE_LOCAL_DB / DB_ENGINE in its own body is too late: ES module imports run before the body, and the
 * database connects while they load. This file runs before any of them, so the local SQLite database is
 * chosen (services/db.js) and the live database is never contacted.
 *
 * If SQLite is not installed (npm install better-sqlite3), tests that need the database fail with
 * "Database connection failed" instead of touching live data. That is the safe way to fail.
 */
process.env.DB_ENGINE = 'sqlite';
process.env.USE_LOCAL_DB = 'true';
