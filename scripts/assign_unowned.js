// Usage: node scripts/assign_unowned.js <admin-email> [--apply]
// Without --apply it only shows how many rows would change.
import 'dotenv/config';
import { assignUnownedToAdmin } from '../services/unowned_assign.js';

const email = process.argv[2];
const apply = process.argv.includes('--apply');

if (!email || email.startsWith('--')) {
    console.error('Usage: node scripts/assign_unowned.js <admin-email> [--apply]');
    process.exit(1);
}

try {
    const result = await assignUnownedToAdmin(email, { apply });
    console.log(`${apply ? 'Assigned' : 'Would assign'} to ${email} (${result.adminId}):`);
    console.table(result.counts);
    if (!apply) console.log('Dry run only. Run again with --apply to make the change.');
    process.exit(0);
} catch (err) {
    console.error(err.message);
    process.exit(1);
}
