/**
 * services/doc_collections.js
 *
 * Keeps small lists of records (accounts, proposals, demo requests) in the database instead of in files under
 * data/, so zipping or re-uploading the project can never replace them.
 *
 * Each list is one table: id (the record's own id) and doc (the record as JSON). The whole list is also held in
 * memory, so the stores keep their synchronous read/write functions. One process serves the app (PM2 runs a
 * single instance), so the memory copy is always current.
 *
 * Writes are queued and sent to the database in order. A write only adds or replaces the records that changed
 * and removes the ones the caller took out of the list; nothing else in the table is ever touched.
 */

const collections = new Map();
let backend = null;
let writeChain = Promise.resolve();

const tableSql = (table, isMysql) => `CREATE TABLE IF NOT EXISTS ${table} (
    id VARCHAR(64) PRIMARY KEY,
    doc LONGTEXT NOT NULL,
    updated_at VARCHAR(64) NOT NULL
)${isMysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : ''};`;

// The real backend: services/db.js (MySQL, or SQLite when it is chosen locally). Loaded only when needed so
// tests that use their own backend never start a database connection.
async function createDbBackend() {
    const { db, getDbEngine } = await import('./db.js');
    const isMysql = (await getDbEngine()) === 'mysql';
    return {
        async ensure(table) {
            await db.run(tableSql(table, isMysql));
        },
        async loadAll(table) {
            return db.all(`SELECT id, doc FROM ${table}`);
        },
        async upsert(table, id, doc) {
            await db.run(`REPLACE INTO ${table} (id, doc, updated_at) VALUES (?, ?, ?)`, [id, doc, new Date().toISOString()]);
        },
        async remove(table, id) {
            await db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
        }
    };
}

let failedWrites = 0;
let pendingWrites = 0;

function enqueue(task, label, onFail) {
    pendingWrites++;
    writeChain = writeChain.then(task).catch((e) => {
        failedWrites++;
        console.error(`[DOC_STORE] ${label} failed: ${e.message}`);
        if (onFail) onFail();
    }).finally(() => { pendingWrites--; });
}

class Collection {
    constructor(name, table) {
        this.name = name;
        this.table = table;
        this.items = null;
        this.version = 0; // goes up on every write(), so a refresh can tell the list changed while it was reading
        this.saved = new Map(); // id -> JSON text as last sent to / read from the database
    }

    ready() {
        return this.items !== null;
    }

    async load({ createTables = true } = {}) {
        let rows;
        if (createTables) {
            await backend.ensure(this.table);
            rows = await backend.loadAll(this.table);
        } else {
            // Read-only look (dry run): a table that does not exist yet is simply empty.
            rows = await backend.loadAll(this.table).catch(() => []);
        }
        this.items = [];
        this.saved = new Map();
        for (const row of rows) {
            try {
                this.items.push(JSON.parse(row.doc));
                this.saved.set(row.id, row.doc);
            } catch (e) {
                console.error(`[DOC_STORE] ${this.name}: skipped unreadable record ${row.id}`);
            }
        }
    }

    /**
     * Pick up changes made by someone else (for example accounts created on the live site while this copy of the
     * app runs on another machine). Skipped when this process has a change that is still being saved, so a
     * refresh can never undo it. A record that failed to save stays in the list and is sent on the next write.
     */
    async refresh() {
        if (!this.ready() || pendingWrites > 0) return false;
        const version = this.version;
        const rows = await backend.loadAll(this.table);
        if (pendingWrites > 0 || version !== this.version) return false; // something changed meanwhile; try next time
        const items = [];
        const saved = new Map();
        for (const row of rows) {
            try {
                items.push(JSON.parse(row.doc));
                saved.set(row.id, row.doc);
            } catch (e) {
                console.error(`[DOC_STORE] ${this.name}: skipped unreadable record ${row.id}`);
            }
        }
        for (const item of this.items) {
            if (item && item.id && !this.saved.has(item.id) && !saved.has(item.id)) items.push(item);
        }
        this.items = items;
        this.saved = saved;
        return true;
    }

    // A copy, like reading a file: callers may change what they get and then call write().
    read() {
        if (!this.ready()) throw new Error(`[DOC_STORE] ${this.name} is not loaded yet (initCollections was not awaited)`);
        return structuredClone(this.items);
    }

    // Replace the list. Sends only the records that are new or changed, and deletes the ones that are gone.
    write(list) {
        if (!this.ready()) throw new Error(`[DOC_STORE] ${this.name} is not loaded yet (initCollections was not awaited)`);
        this.items = structuredClone(list);
        this.version++;
        const seen = new Set();
        for (const item of this.items) {
            if (!item || !item.id) {
                console.error(`[DOC_STORE] ${this.name}: a record without an id was not saved`);
                continue;
            }
            seen.add(item.id);
            const doc = JSON.stringify(item);
            if (this.saved.get(item.id) === doc) continue;
            this.saved.set(item.id, doc);
            // If the database refuses, forget that it was saved so the next write() sends it again.
            enqueue(() => backend.upsert(this.table, item.id, doc), `${this.name} save`, () => this.saved.delete(item.id));
        }
        for (const id of [...this.saved.keys()]) {
            if (seen.has(id)) continue;
            this.saved.delete(id);
            enqueue(() => backend.remove(this.table, id), `${this.name} delete`);
        }
    }

    /**
     * Copy records from an older source (the JSON files) into the database without ever changing a record that
     * is already there. A record counts as already there when its id matches, or when matchKey(record) matches
     * (accounts use the email). Returns counts only.
     */
    async importMissing(docs, { matchKey = null, apply = false } = {}) {
        const keyOf = (r) => (matchKey ? String(matchKey(r) || '').trim().toLowerCase() : '');
        const haveIds = new Set(this.items.map((r) => r.id));
        const haveKeys = new Set(this.items.map(keyOf).filter(Boolean));
        const result = { total: docs.length, alreadyThere: 0, toAdd: 0, skippedNoId: 0 };
        const added = [];
        for (const doc of docs) {
            if (!doc || !doc.id) { result.skippedNoId++; continue; }
            const key = keyOf(doc);
            if (haveIds.has(doc.id) || (key && haveKeys.has(key))) { result.alreadyThere++; continue; }
            haveIds.add(doc.id);
            if (key) haveKeys.add(key);
            result.toAdd++;
            added.push(doc);
        }
        if (apply && added.length) this.write([...this.items, ...added]);
        return result;
    }
}

export function defineCollection(name, table) {
    if (!collections.has(name)) collections.set(name, new Collection(name, table));
    return collections.get(name);
}

// Test hook: use your own backend ({ ensure, loadAll, upsert, remove }) instead of the database.
export function setBackend(b) {
    backend = b;
}

// Load every defined list from the database. Call (and await) it once before the server starts listening.
export async function initCollections(options = {}) {
    if (!backend) backend = await createDbBackend();
    for (const c of collections.values()) await c.load(options);
}

// Reload every list from the database now (see Collection.refresh). Errors are logged, never thrown.
export async function refreshCollections() {
    for (const c of collections.values()) {
        try {
            await c.refresh();
        } catch (e) {
            console.error(`[DOC_STORE] ${c.name} refresh failed: ${e.message}`);
        }
    }
}

// Re-read the lists every intervalMs so accounts made elsewhere (live and localhost share one database) show up
// without a restart. Returns a function that stops it.
export function startRefresh(intervalMs = 30000) {
    const timer = setInterval(refreshCollections, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
}

// Resolves when every queued write has reached the database.
export function flushWrites() {
    return writeChain;
}

// How many writes the database rejected since the process started (each one is also logged).
export function failedWriteCount() {
    return failedWrites;
}
