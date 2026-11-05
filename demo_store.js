import { defineCollection } from './services/doc_collections.js';

// Everyone who filled the "60-second demo" form on the website. Kept in the database (table app_demo_requests).
const demoRequests = defineCollection('demo_requests', 'app_demo_requests');

export function readDemoRequests() {
    return demoRequests.read();
}

export function writeDemoRequests(list) {
    demoRequests.write(list);
}

export function addDemoRequest(entry) {
    const list = readDemoRequests();
    list.push(entry);
    writeDemoRequests(list);
    return entry;
}
