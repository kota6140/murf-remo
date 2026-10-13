import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(BASE_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'remo.db');

export function utcNow() {
    return new Date().toISOString();
}

let mysqlPool = null;
let sqliteDb = null;
let activeEngine = 'mysql'; // 'mysql' | 'sqlite'
let initPromise = null;

const MYSQL_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS batches (
        id VARCHAR(64) PRIMARY KEY,
        service VARCHAR(32) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        original_path TEXT,
        status VARCHAR(32) NOT NULL DEFAULT 'READY',
        total_rows INT NOT NULL DEFAULT 0,
        valid_rows INT NOT NULL DEFAULT 0,
        invalid_rows INT NOT NULL DEFAULT 0,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

    `CREATE TABLE IF NOT EXISTS contacts (
        id VARCHAR(64) PRIMARY KEY,
        batch_id VARCHAR(64) NOT NULL,
        service VARCHAR(32) NOT NULL,
        row_index INT NOT NULL,
        raw_data LONGTEXT NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(64) NOT NULL,
        preferred_language VARCHAR(32) DEFAULT 'en',
        notes TEXT,
        extra_data LONGTEXT,
        validation_status VARCHAR(32) NOT NULL DEFAULT 'VALID',
        validation_errors TEXT,
        call_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        attempt_count INT NOT NULL DEFAULT 0,
        provider_call_id VARCHAR(128),
        started_at VARCHAR(64),
        ended_at VARCHAR(64),
        duration_seconds INT DEFAULT 0,
        detected_language VARCHAR(32),
        call_outcome VARCHAR(64),
        classification VARCHAR(128),
        extracted_data LONGTEXT,
        summary TEXT,
        error_details TEXT,
        updated_at VARCHAR(64) NOT NULL,
        INDEX idx_contacts_batch (batch_id),
        INDEX idx_contacts_phone (phone),
        INDEX idx_contacts_service (service)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

    `CREATE TABLE IF NOT EXISTS call_queue (
        id VARCHAR(64) PRIMARY KEY,
        batch_id VARCHAR(64) NOT NULL,
        contact_id VARCHAR(64) NOT NULL UNIQUE,
        service VARCHAR(32) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
        priority INT NOT NULL DEFAULT 0,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        INDEX idx_queue_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

    `CREATE TABLE IF NOT EXISTS conversations (
        id VARCHAR(64) PRIMARY KEY,
        contact_id VARCHAR(64) NOT NULL,
        batch_id VARCHAR(64) NOT NULL,
        service VARCHAR(32) NOT NULL,
        phone VARCHAR(64) NOT NULL,
        contact_name VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'in-progress',
        started_at VARCHAR(64) NOT NULL,
        ended_at VARCHAR(64),
        duration_seconds INT DEFAULT 0,
        language VARCHAR(32) DEFAULT 'en',
        summary TEXT,
        classification VARCHAR(128),
        sentiment VARCHAR(32) DEFAULT 'neutral',
        created_at VARCHAR(64) NOT NULL,
        INDEX idx_conv_service (service)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

    `CREATE TABLE IF NOT EXISTS transcript_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id VARCHAR(64) NOT NULL,
        speaker VARCHAR(64) NOT NULL,
        text TEXT NOT NULL,
        time_str VARCHAR(32),
        timestamp VARCHAR(64) NOT NULL,
        language VARCHAR(32),
        INDEX idx_trans_conv (conversation_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

    `CREATE TABLE IF NOT EXISTS audit_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_type VARCHAR(64) NOT NULL,
        details TEXT,
        created_at VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
];

const SQLITE_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        service TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_path TEXT,
        status TEXT NOT NULL DEFAULT 'READY',
        total_rows INTEGER NOT NULL DEFAULT 0,
        valid_rows INTEGER NOT NULL DEFAULT 0,
        invalid_rows INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        service TEXT NOT NULL,
        row_index INTEGER NOT NULL,
        raw_data TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        preferred_language TEXT DEFAULT 'en',
        notes TEXT,
        extra_data TEXT,
        validation_status TEXT NOT NULL DEFAULT 'VALID',
        validation_errors TEXT,
        call_status TEXT NOT NULL DEFAULT 'PENDING',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        provider_call_id TEXT,
        started_at TEXT,
        ended_at TEXT,
        duration_seconds INTEGER DEFAULT 0,
        detected_language TEXT,
        call_outcome TEXT,
        classification TEXT,
        extracted_data TEXT,
        summary TEXT,
        error_details TEXT,
        updated_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS call_queue (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        contact_id TEXT NOT NULL UNIQUE,
        service TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'QUEUED',
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        service TEXT NOT NULL,
        phone TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'in-progress',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_seconds INTEGER DEFAULT 0,
        language TEXT DEFAULT 'en',
        summary TEXT,
        classification TEXT,
        sentiment TEXT DEFAULT 'neutral',
        created_at TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS transcript_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        speaker TEXT NOT NULL,
        text TEXT NOT NULL,
        time_str TEXT,
        timestamp TEXT NOT NULL,
        language TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_batch ON contacts(batch_id);`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_service ON contacts(service);`,
    `CREATE INDEX IF NOT EXISTS idx_queue_status ON call_queue(status);`,
    `CREATE INDEX IF NOT EXISTS idx_conv_service ON conversations(service);`
];

async function initSqlite() {
    try {
        const { default: Database } = await import('better-sqlite3');
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        sqliteDb = new Database(DB_PATH, { timeout: 30000 });
        sqliteDb.pragma('journal_mode = WAL');
        for (const sql of SQLITE_SCHEMA) {
            sqliteDb.exec(sql);
        }
        activeEngine = 'sqlite';
        console.log('[DB] SQLite initialized as active storage engine at', DB_PATH);
    } catch (err) {
        console.error('[DB] SQLite dynamic import failed:', err.message);
        throw new Error('Database connection failed. Please ensure MySQL server is reachable.');
    }
}

export async function initDb() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const rawPw = process.env.DB_PASSWORD || '';
        const password = rawPw.startsWith("'") && rawPw.endsWith("'") ? rawPw.slice(1, -1) : rawPw;
        const host = process.env.DB_HOST || 'localhost';
        const port = parseInt(process.env.DB_PORT || '3306', 10);
        const user = process.env.DB_USER || 'root';
        const database = process.env.DB_NAME || 'u576959300_takeremo';

        try {
            console.log(`[DB] Attempting MySQL connection to ${user}@${host}:${port}/${database}...`);
            mysqlPool = mysql.createPool({
                host,
                port,
                user,
                password,
                database,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0,
                connectTimeout: 4000
            });

            // Verify connection
            const conn = await mysqlPool.getConnection();
            conn.release();

            // Run MySQL schema initialization
            for (const statement of MYSQL_SCHEMA) {
                await mysqlPool.query(statement);
            }

            activeEngine = 'mysql';
            console.log(`[DB] MySQL successfully connected and schema verified on ${host}:${port}/${database}!`);
        } catch (err) {
            console.warn(`[DB] MySQL connection error: ${err.message}.`);
            console.warn('[DB] Falling back to SQLite for local development.');
            await initSqlite();
        }
    })();

    return initPromise;
}

export async function getDbEngine() {
    await initDb();
    return activeEngine;
}

export async function get(sql, params = []) {
    await initDb();
    if (activeEngine === 'mysql') {
        const [rows] = await mysqlPool.query(sql, params);
        return rows && rows[0] ? rows[0] : null;
    }
    const adapted = sql.replace(/INSERT IGNORE INTO/gi, 'INSERT OR IGNORE INTO');
    return sqliteDb.prepare(adapted).get(...params) || null;
}

export async function all(sql, params = []) {
    await initDb();
    if (activeEngine === 'mysql') {
        const [rows] = await mysqlPool.query(sql, params);
        return rows || [];
    }
    const adapted = sql.replace(/INSERT IGNORE INTO/gi, 'INSERT OR IGNORE INTO');
    return sqliteDb.prepare(adapted).all(...params) || [];
}

export async function query(sql, params = []) {
    return all(sql, params);
}

export async function run(sql, params = []) {
    await initDb();
    if (activeEngine === 'mysql') {
        const [res] = await mysqlPool.query(sql, params);
        return { changes: res.affectedRows, insertId: res.insertId };
    }
    const adapted = sql.replace(/INSERT IGNORE INTO/gi, 'INSERT OR IGNORE INTO');
    const res = sqliteDb.prepare(adapted).run(...params);
    return { changes: res.changes, insertId: res.lastInsertRowid };
}

export async function transaction(fn) {
    await initDb();
    if (activeEngine === 'mysql') {
        const conn = await mysqlPool.getConnection();
        try {
            await conn.beginTransaction();
            const trx = {
                query: (sql, params = []) => conn.query(sql, params),
                get: async (sql, params = []) => {
                    const [rows] = await conn.query(sql, params);
                    return rows && rows[0] ? rows[0] : null;
                },
                all: async (sql, params = []) => {
                    const [rows] = await conn.query(sql, params);
                    return rows || [];
                },
                run: async (sql, params = []) => {
                    const [res] = await conn.query(sql, params);
                    return { changes: res.affectedRows, insertId: res.insertId };
                }
            };
            const result = await fn(trx);
            await conn.commit();
            return result;
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    } else {
        sqliteDb.exec('BEGIN IMMEDIATE');
        try {
            const trx = {
                query: (sql, params = []) => {
                    const adapted = sql.replace(/INSERT IGNORE INTO/gi, 'INSERT OR IGNORE INTO');
                    return sqliteDb.prepare(adapted).all(...params);
                },
                get: (sql, params = []) => {
                    const adapted = sql.replace(/INSERT IGNORE INTO/gi, 'INSERT OR IGNORE INTO');
                    return sqliteDb.prepare(adapted).get(...params) || null;
                },
                all: (sql, params = []) => {
                    const adapted = sql.replace(/INSERT IGNORE INTO/gi, 'INSERT OR IGNORE INTO');
                    return sqliteDb.prepare(adapted).all(...params) || [];
                },
                run: (sql, params = []) => {
                    const adapted = sql.replace(/INSERT IGNORE INTO/gi, 'INSERT OR IGNORE INTO');
                    const res = sqliteDb.prepare(adapted).run(...params);
                    return { changes: res.changes, insertId: res.lastInsertRowid };
                }
            };
            const result = await fn(trx);
            sqliteDb.exec('COMMIT');
            return result;
        } catch (err) {
            try { sqliteDb.exec('ROLLBACK'); } catch (e) {}
            throw err;
        }
    }
}

// Links calls to the admin user who uploaded them (batches.owner_user_id) or who was assigned them
// from the owner panel (conversations.owner_user_id). Added lazily so existing databases upgrade in place.
let ownerColumnsReady = null;
export function ensureOwnerColumns() {
    if (!ownerColumnsReady) {
        ownerColumnsReady = (async () => {
            for (const table of ['batches', 'conversations']) {
                try {
                    await get(`SELECT owner_user_id FROM ${table} LIMIT 1`);
                } catch {
                    await run(`ALTER TABLE ${table} ADD COLUMN owner_user_id VARCHAR(64) NULL`);
                }
            }
        })().catch((e) => { ownerColumnsReady = null; throw e; });
    }
    return ownerColumnsReady;
}

export const db = {
    get,
    all,
    run,
    query,
    transaction,
    initDb,
    utcNow
};

export function getDbConnection() {
    return db;
}

// Kick off initialization asynchronously
initDb().catch(e => console.error('[DB] Initialization error:', e));

export default db;
