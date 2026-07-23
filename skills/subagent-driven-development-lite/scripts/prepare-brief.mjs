import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length < 2) {
    console.error("usage:");
    console.error("  node prepare-brief.mjs init PLAN_FILE");
    console.error("  node prepare-brief.mjs implementer PLAN_FILE TASK_NUMBER");
    console.error("  node prepare-brief.mjs reviewer HEAD PLAN_FILE TASK_NUMBER");
    console.error("  node prepare-brief.mjs complete PLAN_FILE TASK_NUMBER");
    console.error("  node prepare-brief.mjs fix PLAN_FILE TASK_NUMBER");
    process.exit(2);
}

const mode = args[0];

if (mode === 'init' && args.length < 2) {
    console.error("usage: node prepare-brief.mjs init PLAN_FILE");
    process.exit(2);
}
if (mode === 'implementer' && args.length < 3) {
    console.error("usage: node prepare-brief.mjs implementer PLAN_FILE TASK_NUMBER");
    process.exit(2);
}
if (mode === 'reviewer' && args.length < 4) {
    console.error("usage: node prepare-brief.mjs reviewer HEAD PLAN_FILE TASK_NUMBER");
    process.exit(2);
}
if (mode === 'complete' && args.length < 3) {
    console.error("usage: node prepare-brief.mjs complete PLAN_FILE TASK_NUMBER");
    process.exit(2);
}
if (mode === 'fix' && args.length < 3) {
    console.error("usage: node prepare-brief.mjs fix PLAN_FILE TASK_NUMBER");
    process.exit(2);
}

function extractTaskBrief(planFile, taskNum) {
    const content = fs.readFileSync(planFile, 'utf8');
    const lines = content.split(/\r?\n/);
    let inFence = false;
    let inTask = false;
    const taskLines = [];
    let taskName = `Task ${taskNum}`;

    const taskHeaderRegex = new RegExp(`^#+\\s+Task\\s+${taskNum}(?:$|[^0-9])(.*)`, 'i');
    const generalTaskHeaderRegex = /^#+\s+Task\s+[0-9]+/i;

    for (const line of lines) {
        if (line.trim().startsWith('```')) {
            inFence = !inFence;
        }
        
        if (!inFence) {
            const match = line.match(taskHeaderRegex);
            if (match) {
                inTask = true;
                taskName = `Task ${taskNum}:` + match[1].trim();
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
    return { taskLines: taskLines.join('\n'), taskName };
}

function extractGlobalConstraints(planFile) {
    if (!fs.existsSync(planFile)) return '';
    const content = fs.readFileSync(planFile, 'utf8');
    const lines = content.split(/\r?\n/);
    let inSection = false;
    const constraints = [];

    const sectionRegex = /^#+\s+Global\s+Constraints/i;

    for (const line of lines) {
        if (sectionRegex.test(line)) {
            inSection = true;
            continue;
        }
        if (inSection) {
            if (line.startsWith('#') || line.trim() === '---') {
                break;
            }
            constraints.push(line);
        }
    }
    return constraints.join('\n').trim();
}

function extractPromptContent(templateText) {
    const lines = templateText.split(/\r?\n/);
    const promptLines = [];
    let inPrompt = false;

    for (const line of lines) {
        if (inPrompt) {
            if (line.trim() === '```') {
                break;
            }
            if (line.startsWith('    ')) {
                promptLines.push(line.substring(4));
            } else if (line.trim() === '') {
                promptLines.push('');
            } else {
                promptLines.push(line);
            }
        } else if (line.trim().startsWith('prompt: |')) {
            inPrompt = true;
        }
    }
    return promptLines.join('\n');
}

function extractAllTasks(planFile) {
    const content = fs.readFileSync(planFile, 'utf8');
    const lines = content.split(/\r?\n/);
    const tasks = [];
    let inFence = false;

    for (const line of lines) {
        if (line.trim().startsWith('```')) {
            inFence = !inFence;
        }
        if (inFence) continue;

        const match = line.match(/^#+\s+(Task\s+[0-9]+.*)/i);
        if (match) {
            tasks.push(match[1].trim());
        }
    }
    return tasks;
}

const sddDir = path.resolve('.shark', 'sdd');
fs.mkdirSync(sddDir, { recursive: true });

function getLatestSubagentReportContent(role) {
    const subagentsFile = path.resolve('.shark', 'subagents.json');
    if (!fs.existsSync(subagentsFile)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(subagentsFile, 'utf8'));
        let latestTime = 0;
        let content = null;
        let subagentId = null;
        for (const id in data.subagents) {
            const sa = data.subagents[id];
            const isMatch = sa.role === role || (role === 'Implementer' && sa.role === 'Fixer');
            if (isMatch && sa.status === 'completed' && sa.endedAt > latestTime) {
                const saContent = sa.lastAction?.params?.content;
                if (saContent) {
                    content = saContent;
                    latestTime = sa.endedAt;
                    subagentId = id;
                }
            }
        }
        return { content, subagentId };
    } catch {
        return null;
    }
}

if (mode === 'init') {
    const [_, planFile] = args;
    if (!fs.existsSync(planFile)) {
        console.error(`no such plan file: ${planFile}`);
        process.exit(2);
    }
    const tasks = extractAllTasks(planFile);
    if (tasks.length === 0) {
        console.error(`No tasks found in plan file: ${planFile}`);
        process.exit(2);
    }
    const ledgerLines = [
        '# Subagent-Driven Development Progress Ledger',
        ''
    ];
    for (const task of tasks) {
        ledgerLines.push(`- [ ] ${task}`);
    }
    const ledgerFile = path.resolve('.shark', 'progress.md');
    fs.writeFileSync(ledgerFile, ledgerLines.join('\n') + '\n', 'utf8');
    console.log(`SUCCESS: Created progress ledger at ${ledgerFile} with ${tasks.length} tasks.`);
    console.log(`[INSTRUCTION] Progress ledger initialized successfully. Now, you MUST call 'read_file' on '.agents/skills/subagent-driven-development-lite/steps/step1_setup.md' to proceed with the next setup actions. Do NOT read the plan file.`);
} else if (mode === 'implementer') {
    const [_, planFile, taskNum] = args;
    if (!fs.existsSync(planFile)) {
        console.error(`no such plan file: ${planFile}`);
        process.exit(2);
    }

    const { taskLines, taskName } = extractTaskBrief(planFile, taskNum);
    const rawBriefFile = path.join(sddDir, `task-${taskNum}-brief.md`);
    fs.writeFileSync(rawBriefFile, taskLines, 'utf8');

    // Read template
    const templatePath = path.resolve('.agents', 'skills', 'subagent-driven-development-lite', 'implementer-prompt.md');
    if (!fs.existsSync(templatePath)) {
        console.error(`template not found at: ${templatePath}`);
        process.exit(2);
    }
    let template = fs.readFileSync(templatePath, 'utf8');
    template = extractPromptContent(template);

    // Replace placeholders
    template = template.replace(/Task N:\s*\[task name\]/gi, taskName);
    template = template.replace(/\[BRIEF_FILE\]/g, `.shark/sdd/task-${taskNum}-brief.md`);
    template = template.replace(/\[REPORT_FILE\]/g, `.shark/sdd/task-${taskNum}-report.md`);
    template = template.replace(/\[MODEL\s*—\s*REQUIRED[^\]]*\]/g, '');
    template = template.replace(/\[directory\]/g, process.cwd().replace(/\\/g, '/'));

    const runBriefFile = path.join(sddDir, `task-${taskNum}-run-brief.md`);
    const briefContent = `---\ntype: self\nrole: Implementer\n---\n\n${template}`;
    fs.writeFileSync(runBriefFile, briefContent, 'utf8');
    
    let currentHead = 'initial';
    try {
        currentHead = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch {}
    fs.writeFileSync(path.join(sddDir, `task-${taskNum}-base.txt`), currentHead, 'utf8');

    const ledgerFile = path.resolve('.shark', 'progress.md');
    if (fs.existsSync(ledgerFile)) {
        let ledgerContent = fs.readFileSync(ledgerFile, 'utf8');
        const lines = ledgerContent.split(/\r?\n/);
        const taskRegex = new RegExp(`^-\\s*\\[[^\\]]*\\]\\s*(Task\\s+${taskNum}(?:$|[^0-9]).*)`, 'i');
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(taskRegex);
            if (match) {
                lines[i] = `- [/] ${match[1]}`;
                break;
            }
        }
        fs.writeFileSync(ledgerFile, lines.join('\n'), 'utf8');
    }

    console.log(`SUCCESS: Wrote implementer brief to: ${runBriefFile}`);
    console.log(`[INSTRUCTION] Implementer briefing prepared successfully. Now, you MUST call 'invoke_subagent' with role="Implementer", type_name="self", and task_file=".shark/sdd/task-${taskNum}-run-brief.md". Then call 'wait' without duration_seconds (or set to null) to wait indefinitely.`);

} else if (mode === 'reviewer') {
    let baseArg = null;
    let head = '';
    let planFile = '';
    let taskNum = '';

    if (args.length >= 5) {
        const [_, b, h, p, t] = args;
        baseArg = b; head = h; planFile = p; taskNum = t;
    } else {
        const [_, h, p, t] = args;
        head = h; planFile = p; taskNum = t;
    }

    const baseFile = path.join(sddDir, `task-${taskNum}-base.txt`);
    let base = baseArg || 'initial';
    if (!baseArg && fs.existsSync(baseFile)) {
        base = fs.readFileSync(baseFile, 'utf8').trim();
    }

    // Verify commits
    if (base !== 'initial') {
        try { execSync(`git rev-parse --verify --quiet "${base}"`); } catch {
            console.warn(`warning: base commit ${base} not found, falling back to HEAD~1`);
            try { base = execSync('git rev-parse --short HEAD~1', { encoding: 'utf8' }).trim(); } catch { base = head; }
        }
    } else {
        try { base = execSync('git rev-parse --short HEAD~1', { encoding: 'utf8' }).trim(); } catch { base = head; }
    }
    try { execSync(`git rev-parse --verify --quiet "${head}"`); } catch {
        console.error(`bad HEAD: ${head}`);
        process.exit(2);
    }

    // Generate diff
    const baseShort = execSync(`git rev-parse --short "${base}"`, { encoding: 'utf8' }).trim();
    const headShort = execSync(`git rev-parse --short "${head}"`, { encoding: 'utf8' }).trim();
    const diffFile = path.join(sddDir, `review-${baseShort}..${headShort}.diff`);

    const excludes = '":(exclude)_sharkrc" ":(exclude).shark" ":(exclude)shark-debug.log" ":(exclude)node_modules"';
    let commits = '';
    try { commits = execSync(`git log --oneline "${base}..HEAD"`, { encoding: 'utf8' }); } catch {}
    const stat = execSync(`git diff --stat "${base}" -- . ${excludes}`, { encoding: 'utf8' });
    const diff = execSync(`git diff -U10 "${base}" -- . ${excludes}`, { encoding: 'utf8' });

    const diffReport = [
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
    fs.writeFileSync(diffFile, diffReport, 'utf8');

    // Read reviewer template
    const templatePath = path.resolve('.agents', 'skills', 'subagent-driven-development-lite', 'task-reviewer-prompt.md');
    if (!fs.existsSync(templatePath)) {
        console.error(`template not found at: ${templatePath}`);
        process.exit(2);
    }
    let template = fs.readFileSync(templatePath, 'utf8');
    template = extractPromptContent(template);

    // Extract constraints
    const globalConstraints = extractGlobalConstraints(planFile);

    // Replace placeholders
    // Archive static Implementer report to unique filename if it exists
    let implementerReportFile = path.join(sddDir, `task-${taskNum}-report.md`);
    const latestImplementer = getLatestSubagentReportContent('Implementer');
    if (latestImplementer && latestImplementer.subagentId) {
        const uniqueReportFile = path.join(sddDir, `task-subagent-${latestImplementer.subagentId}-report.md`);
        if (fs.existsSync(implementerReportFile)) {
            fs.renameSync(implementerReportFile, uniqueReportFile);
            console.log(`ARCHIVED: Renamed ${implementerReportFile} to ${uniqueReportFile}`);
        } else if (!fs.existsSync(uniqueReportFile) && latestImplementer.content) {
            fs.writeFileSync(uniqueReportFile, latestImplementer.content, 'utf8');
            console.log(`RECOVERED: Created missing report ${uniqueReportFile} from subagents.json`);
        }
        implementerReportFile = uniqueReportFile;
    }

    template = template.replace(/\[MODEL\]/g, '');
    template = template.replace(/\[BRIEF_FILE\]/g, `.shark/sdd/task-${taskNum}-brief.md`);
    template = template.replace(/\[REPORT_FILE\]/g, implementerReportFile.replace(/\\/g, '/'));
    template = template.replace(/\[GLOBAL_CONSTRAINTS\]/g, globalConstraints);
    template = template.replace(/\[BASE_SHA\]/g, base);
    template = template.replace(/\[HEAD_SHA\]/g, head);
    template = template.replace(/\[DIFF_FILE\]/g, `.shark/sdd/review-${baseShort}..${headShort}.diff`);
    template = template.replace(/\[REVIEW_REPORT_FILE\]/g, `.shark/sdd/task-${taskNum}-review-report.md`);

    const runReviewFile = path.join(sddDir, `task-${taskNum}-review-run.md`);
    const reviewContent = `---\ntype: self\nrole: Reviewer\n---\n\n${template}`;
    fs.writeFileSync(runReviewFile, reviewContent, 'utf8');
    console.log(`SUCCESS: Wrote reviewer brief to: ${runReviewFile}`);
    console.log(`[INSTRUCTION] Reviewer briefing prepared successfully. Now, you MUST call 'invoke_subagent' with role="Reviewer", type_name="self", and task_file=".shark/sdd/task-${taskNum}-review-run.md". Then call 'wait' without duration_seconds (or set to null) to await the review verdict.`);
} else if (mode === 'complete') {
    const [_, planFile, taskNum] = args;
    
    // Archive static Reviewer report on completion
    const latestReviewer = getLatestSubagentReportContent('Reviewer');
    if (latestReviewer && latestReviewer.subagentId) {
        const staticReviewReport = path.join(sddDir, `task-${taskNum}-review-report.md`);
        const uniqueReviewReport = path.join(sddDir, `task-subagent-${latestReviewer.subagentId}-review-report.md`);
        if (fs.existsSync(staticReviewReport)) {
            fs.renameSync(staticReviewReport, uniqueReviewReport);
            console.log(`ARCHIVED: Renamed ${staticReviewReport} to ${uniqueReviewReport}`);
        } else if (!fs.existsSync(uniqueReviewReport) && latestReviewer.content) {
            fs.writeFileSync(uniqueReviewReport, latestReviewer.content, 'utf8');
            console.log(`RECOVERED: Created missing review report ${uniqueReviewReport} from subagents.json`);
        }
    }

    const baseFile = path.join(sddDir, `task-${taskNum}-base.txt`);
    let baseHash = 'initial';
    if (fs.existsSync(baseFile)) {
        baseHash = fs.readFileSync(baseFile, 'utf8').trim();
    }
    let headHash = 'current';
    try {
        headHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch {}

    const ledgerFile = path.resolve('.shark', 'progress.md');
    if (!fs.existsSync(ledgerFile)) {
        console.error(`Ledger file not found at: ${ledgerFile}`);
        process.exit(2);
    }
    let ledgerContent = fs.readFileSync(ledgerFile, 'utf8');
    const lines = ledgerContent.split(/\r?\n/);
    const taskRegex = new RegExp(`^-\\s*\\[[^\\]]*\\]\\s*(Task\\s+${taskNum}(?:$|[^0-9]).*)`, 'i');
    let found = false;
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(taskRegex);
        if (match) {
            lines[i] = `- [x] ${match[1]} (commits ${baseHash}..${headHash}, review clean)`;
            found = true;
            break;
        }
    }
    if (!found) {
        console.error(`Task ${taskNum} not found in ledger progress.md`);
        process.exit(2);
    }
    fs.writeFileSync(ledgerFile, lines.join('\n'), 'utf8');
    console.log(`SUCCESS: Marked Task ${taskNum} as complete in ${ledgerFile}`);
    console.log(`[INSTRUCTION] Task marked complete in ledger. Now, call 'read_file' on '.agents/skills/subagent-driven-development-lite/steps/step1_setup.md' to prepare and launch the next pending task. Do NOT read the plan file.`);

} else if (mode === 'fix') {
    const [_, planFile, taskNum] = args;
    
    // Archive static Reviewer report to unique filename if it exists
    let reviewReportFile = path.join(sddDir, `task-${taskNum}-review-report.md`);
    const latestReviewer = getLatestSubagentReportContent('Reviewer');
    if (latestReviewer && latestReviewer.subagentId) {
        const uniqueReviewReport = path.join(sddDir, `task-subagent-${latestReviewer.subagentId}-review-report.md`);
        if (fs.existsSync(reviewReportFile)) {
            fs.renameSync(reviewReportFile, uniqueReviewReport);
            console.log(`ARCHIVED: Renamed ${reviewReportFile} to ${uniqueReviewReport}`);
        } else if (!fs.existsSync(uniqueReviewReport) && latestReviewer.content) {
            fs.writeFileSync(uniqueReviewReport, latestReviewer.content, 'utf8');
            console.log(`RECOVERED: Created missing review report ${uniqueReviewReport} from subagents.json`);
        }
        reviewReportFile = uniqueReviewReport;
    }

    let findings = "Please address all Critical and Important review issues reported by the reviewer.";
    if (fs.existsSync(reviewReportFile)) {
        findings = fs.readFileSync(reviewReportFile, 'utf8').trim();
    }

    const taskBriefFile = path.join(sddDir, `task-${taskNum}-brief.md`);
    
    // Resolve dynamic path for Implementer/Fixer report to show in context
    let implementerReportFile = path.join(sddDir, `task-${taskNum}-report.md`);
    const latestImplementer = getLatestSubagentReportContent('Implementer');
    if (latestImplementer && latestImplementer.subagentId) {
        implementerReportFile = path.join(sddDir, `task-subagent-${latestImplementer.subagentId}-report.md`);
    }

    const fixBrief = [
        'You are the Fixer subagent. Your task is to resolve issues identified by the Quality Reviewer.',
        '',
        '## Context Files',
        `- Task Brief: ${taskBriefFile}`,
        `- Original Implementer Report: ${implementerReportFile}`,
        `- Reviewer Findings/Report: ${reviewReportFile}`,
        '',
        '## Reviewer Findings to Address',
        findings,
        '',
        '## Instructions',
        '1. Carefully read the task brief and the reviewer findings.',
        '2. Modify the files needing fixes to address the Critical and Important findings.',
        '3. Re-run tests to ensure that everything passes and no regressions are introduced.',
        `4. Commit your fixes with a descriptive commit message (e.g. \`git commit -m "fix(task-${taskNum}): address reviewer findings"\`).`,
        '5. Document what you fixed, how you verified it, and write your report to the implementer report file.',
        '6. Call the `complete_task` action when done.'
    ].join('\n');

    const runFixFile = path.join(sddDir, `task-${taskNum}-fix-run.md`);
    const fixContent = `---\ntype: self\nrole: Fixer\n---\n\n${fixBrief}`;
    fs.writeFileSync(runFixFile, fixContent, 'utf8');

    console.log(`SUCCESS: Wrote fixer brief to: ${runFixFile}`);
    console.log(`[INSTRUCTION] Fixer briefing prepared successfully. Now, you MUST call 'invoke_subagent' with role="Fixer", type_name="self", and task_file=".shark/sdd/task-${taskNum}-fix-run.md". Then call 'wait' without duration_seconds (or set to null) to await fixer completion.`);

} else {
    console.error(`unknown mode: ${mode}`);
    process.exit(2);
}
