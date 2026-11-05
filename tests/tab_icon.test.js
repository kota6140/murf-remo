/**
 * tests/tab_icon.test.js
 *
 * Every page shows the same browser-tab logo as the home page (/assets/tab.jpeg), and /favicon.ico serves
 * that same logo for tabs that only ask for the default icon. Reads files only; opens no database.
 */
import assert from 'assert';
import fs from 'fs';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');
const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
const iconOf = (html) => (html.match(/<link[^>]*rel="icon"[^>]*>/i) || [''])[0].match(/href="([^"]*)"/i)?.[1];

let total = 0;
let failed = 0;
function test(name, fn) {
    total++;
    try { fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const homeIcon = iconOf(read('index.html'));

test('The home page icon is the tab logo and the file exists', () => {
    assert.strictEqual(homeIcon, '/assets/tab.jpeg');
    assert.ok(fs.existsSync(new URL('assets/tab.jpeg', root)));
});

test('Every HTML page uses exactly the home page icon', () => {
    const different = pages.filter((p) => iconOf(read(p)) !== homeIcon).map((p) => `${p} -> ${iconOf(read(p)) || 'no icon'}`);
    assert.deepStrictEqual(different, [], `pages with another or no tab icon: ${different.join('; ')}`);
});

test('The pages that were changed also have the iPhone home-screen icon', () => {
    for (const p of ['admin.html', 'account.html', 'phone-designs-preview.html']) {
        assert.ok(/rel="apple-touch-icon"[^>]*href="\/assets\/tab\.jpeg"/.test(read(p)), p);
    }
});

test('/favicon.ico serves the same logo, ahead of the static folder', () => {
    const server = read('server.js');
    const route = server.indexOf("app.get('/favicon.ico'");
    assert.ok(route > -1 && server.slice(route, route + 160).includes("'assets', 'tab.jpeg'"), 'favicon route sends assets/tab.jpeg');
    assert.ok(route < server.indexOf('app.use(express.static(__dirname))'), 'the route comes before express.static');
});

console.log(`\n${total - failed}/${total} passed (${pages.length} pages checked)`);
process.exit(failed ? 1 : 0);
