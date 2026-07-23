import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3) {
    console.error("usage: node task-brief.js PLAN_FILE TASK_NUMBER [OUTFILE]");
    process.exit(2);
}

const [planFile, taskNum, outFileArg] = args;

if (!fs.existsSync(planFile)) {
    console.error(`no such plan file: ${planFile}`);
    process.exit(2);
}

let outFile = outFileArg;
if (!outFile) {
    const sddDir = path.resolve('.shark', 'sdd');
    fs.mkdirSync(sddDir, { recursive: true });
    outFile = path.join(sddDir, `task-${taskNum}-brief.md`);
}

const content = fs.readFileSync(planFile, 'utf8');
const lines = content.split(/\r?\n/);
let inFence = false;
let inTask = false;
const taskLines = [];

const taskHeaderRegex = new RegExp(`^#+\\s+Task\\s+${taskNum}(?:$|[^0-9])`, 'i');
const generalTaskHeaderRegex = /^#+\s+Task\s+[0-9]+/i;

for (const line of lines) {
    if (line.trim().startsWith('```')) {
        inFence = !inFence;
    }
    
    if (!inFence) {
        if (taskHeaderRegex.test(line)) {
            inTask = true;
            taskLines.push(line);
            continue;
        }
        if (inTask && generalTaskHeaderRegex.test(line)) {
            inTask = false;
        }
    }
    
    if (inTask) {
        taskLines.push(line);
    }
}

if (taskLines.length === 0) {
    console.error(`task ${taskNum} not found in ${planFile}`);
    process.exit(3);
}

fs.writeFileSync(outFile, taskLines.join('\n'), 'utf8');
console.log(`wrote ${outFile}: ${taskLines.length} lines`);
console.log(`[INSTRUCTION] Task brief extracted successfully to ${outFile}. Now, you MUST prepare the implementer briefing by running: 'node .agents/skills/subagent-driven-development-lite/scripts/prepare-brief.mjs implementer PLAN_FILE N' (replacing PLAN_FILE with the plan path and N with the task number).`);
