import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'user_uploads');
const FILE = path.join(DATA_DIR, 'proposals.json');

export function readProposals() {
    try {
        if (!fs.existsSync(FILE)) return [];
        return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    } catch (e) {
        console.error('[PROPOSALS_STORE] read failed:', e.message);
        return [];
    }
}

export function writeProposals(list) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf-8');
}
