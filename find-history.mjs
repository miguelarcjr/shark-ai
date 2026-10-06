import fs from 'fs';
import path from 'path';

const dir = 'test-sandbox/_sharkrc/history';
const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.raw.json'))
    .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

for (const { name } of files) {
    const content = fs.readFileSync(path.join(dir, name), 'utf-8');
    if (content.includes('Red Team / Adversarial Reviewer') && content.includes('discount.test.ts')) {
        console.log('Found matching history in:', name, 'size:', content.length);
        fs.writeFileSync('test-sandbox/matching-history.json', content);
        break;
    }
}
