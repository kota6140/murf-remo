import path from 'path';
import { fileURLToPath } from 'url';
import { defineCollection } from './services/doc_collections.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'user_uploads');

// Proposals live in the database (table app_proposals), not in data/proposals.json.
const proposals = defineCollection('proposals', 'app_proposals');

export function readProposals() {
    return proposals.read();
}

export function writeProposals(list) {
    proposals.write(list);
}
