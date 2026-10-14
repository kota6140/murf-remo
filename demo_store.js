import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './proposals_store.js';

// Everyone who filled the "60-second demo" form on the website.
const FILE = path.join(DATA_DIR, 'demo_requests.json');

export function readDemoRequests() {
    try {
        if (!fs.existsSync(FILE)) return [];
        return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    } catch (e) {
        console.error('[DEMO_STORE] read failed:', e.message);
        return [];
    }
}

export function writeDemoRequests(list) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf-8');
}

export function addDemoRequest(entry) {
    const list = readDemoRequests();
    list.push(entry);
    writeDemoRequests(list);
    return entry;
}
