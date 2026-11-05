// Usage: node scripts/import_json_to_mysql.js [--apply]
// Copies the accounts (data/users.json), proposals (data/proposals.json) and demo requests
// (data/demo_requests.json) into the database. Safe to run again and again:
//   - a record whose id is already in the database is left alone (never overwritten); accounts are also matched by email
//   - nothing is ever deleted, and the JSON files are only read
// Without --apply it is a dry run: it creates nothing and prints counts only (no names, emails or passwords).
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initCollections, defineCollection, flushWrites, failedWriteCount } from '../services/doc_collections.js';

const apply = process.argv.includes('--apply');
const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

const SOURCES = [
    { label: 'accounts', name: 'users', table: 'app_users', file: 'users.json', matchKey: (r) => r.email },
    { label: 'proposals', name: 'proposals', table: 'app_proposals', file: 'proposals.json', matchKey: null },
    { label: 'demo requests', name: 'demo_requests', table: 'app_demo_requests', file: 'demo_requests.json', matchKey: null }
];

try {
    const collections = SOURCES.map((s) => defineCollection(s.name, s.table));
    await initCollections({ createTables: apply });

    for (const [i, s] of SOURCES.entries()) {
        const file = path.join(dataDir, s.file);
        if (!fs.existsSync(file)) {
            console.log(`${s.label}: ${s.file} not found, nothing to import`);
            continue;
        }
        const docs = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const r = await collections[i].importMissing(docs, { matchKey: s.matchKey, apply });
        console.log(`${s.label}: in file ${r.total}, already in database ${r.alreadyThere}, ` +
            `${apply ? 'added' : 'would add'} ${r.toAdd}, skipped (no id) ${r.skippedNoId}`);
    }
    await flushWrites();
    if (failedWriteCount() > 0) {
        console.error(`${failedWriteCount()} write(s) failed, see the errors above. Fix the cause and run again; records already added are skipped.`);
        process.exit(1);
    }
    if (!apply) console.log('Dry run only. Nothing was created or changed. Run again with --apply to import.');
    process.exit(0);
} catch (err) {
    console.error(err.message);
    process.exit(1);
}
