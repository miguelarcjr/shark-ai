import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3) {
    console.error("usage: node review-package.js BASE HEAD [OUTFILE]");
    process.exit(2);
}

const [base, head, outFileArg] = args;

try {
    execSync(`git rev-parse --verify --quiet "${base}"`);
} catch {
    console.error(`bad BASE: ${base}`);
    process.exit(2);
}

try {
    execSync(`git rev-parse --verify --quiet "${head}"`);
} catch {
    console.error(`bad HEAD: ${head}`);
    process.exit(2);
}

let outFile = outFileArg;
if (!outFile) {
    const sddDir = path.resolve('.shark', 'sdd');
    fs.mkdirSync(sddDir, { recursive: true });
    
    const baseShort = execSync(`git rev-parse --short "${base}"`, { encoding: 'utf8' }).trim();
    const headShort = execSync(`git rev-parse --short "${head}"`, { encoding: 'utf8' }).trim();
    outFile = path.join(sddDir, `review-${baseShort}..${headShort}.diff`);
}

const commits = execSync(`git log --oneline "${base}..${head}"`, { encoding: 'utf8' });
const stat = execSync(`git diff --stat "${base}..${head}"`, { encoding: 'utf8' });
const diff = execSync(`git diff -U10 "${base}..${head}"`, { encoding: 'utf8' });

const report = [
    `# Review package: ${base}..${head}`,
    '',
    '## Commits',
    commits,
    '',
    '## Files changed',
    stat,
    '',
    '## Diff',
    diff
].join('\n');

fs.writeFileSync(outFile, report, 'utf8');
const count = execSync(`git rev-list --count "${base}..${head}"`, { encoding: 'utf8' }).trim();
console.log(`wrote ${outFile}: ${count} commit(s)`);
console.log(`[INSTRUCTION] Review package written successfully to ${outFile}. Now, you MUST prepare the reviewer briefing by running: 'node .agents/skills/subagent-driven-development-lite/scripts/prepare-brief.js reviewer BASE HEAD PLAN_FILE N' (replacing BASE/HEAD with commit hashes, PLAN_FILE with the plan path, and N with the task number).`);
