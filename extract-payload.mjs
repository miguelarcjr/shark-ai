import fs from 'fs';

const log = fs.readFileSync('test-sandbox/shark-debug.log', 'utf-8');
const regex = /"payload":\s*({[\s\S]*?})\s*}\s*----------------------------------------/g;
let lastMatch = null;
let m;
while ((m = regex.exec(log)) !== null) {
    lastMatch = m[1];
}

if (!lastMatch) {
    console.error('No payload found');
    process.exit(1);
}

fs.writeFileSync('test-sandbox/last-payload.json', lastMatch);
console.log('Saved last-payload.json successfully, size:', lastMatch.length);
