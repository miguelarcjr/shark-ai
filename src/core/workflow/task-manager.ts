
import fs from 'node:fs';
import path from 'node:path';

export interface SpecTask {
    id: string; // generated based on index (e.g., "task-1")
    description: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
    line_number: number; // 0-based line index in the file
}

export interface SpecState {
    status: 'MISSING' | 'PENDING' | 'COMPLETED';
    nextTask?: SpecTask;
    allTasks: SpecTask[];
}

export class TaskManager {
    private projectRoot: string;
    private specPath: string;

    constructor(projectRoot: string = process.cwd()) {
        this.projectRoot = projectRoot;
        this.specPath = path.resolve(this.projectRoot, 'tech-spec.md');
    }

    /**
     * Reads the tech-spec.md file and analyzes its current state.
     */
    public analyzeSpecState(): SpecState {
        if (!fs.existsSync(this.specPath)) {
            return { status: 'MISSING', allTasks: [] };
        }

        const content = fs.readFileSync(this.specPath, 'utf-8');
        const lines = content.split('\n');
        const tasks: SpecTask[] = [];

        let taskIndex = 1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            const pendingMatch = trimmed.match(/^- \[ \] (.*)/);
            const completedMatch = trimmed.match(/^- \[x\] (.*)/i);
            const progressMatch = trimmed.match(/^- \[\/\] (.*)/);

            let currentTask: SpecTask | null = null;
            let status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | null = null;
            let description = '';

            if (pendingMatch) {
                description = pendingMatch[1].trim();
                status = 'PENDING';
            } else if (completedMatch) {
                description = completedMatch[1].trim();
                status = 'COMPLETED';
            } else if (progressMatch) {
                description = progressMatch[1].trim();
                status = 'IN_PROGRESS';
            }

            if (status && description) {
                // Look ahead for sub-bullets or details
                let j = i + 1;
                while (j < lines.length) {
                    const nextLine = lines[j];
                    const nextTrimmed = nextLine.trim();
                    // Stop if next line is empty, a new task, or a new section
                    if (!nextTrimmed || nextTrimmed.match(/^- \[[ x\/]\]/) || nextTrimmed.startsWith('#')) {
                        break;
                    }
                    description += '\n' + nextTrimmed;
                    j++;
                }

                currentTask = {
                    id: `task-${taskIndex++}`,
                    description: description,
                    status: status,
                    line_number: i
                };
                tasks.push(currentTask);
            }
        }

        // Determine next actionable task
        // Priority: IN_PROGRESS -> First PENDING
        let nextTask = tasks.find(t => t.status === 'IN_PROGRESS');
        if (!nextTask) {
            nextTask = tasks.find(t => t.status === 'PENDING');
        }

        const status = (!nextTask && tasks.length > 0 && tasks.every(t => t.status === 'COMPLETED'))
            ? 'COMPLETED'
            : 'PENDING';

        return {
            status: tasks.length === 0 ? 'MISSING' : status, // Empty file is effectively "pending creation" but we treat as missing content logic elsewhere
            nextTask,
            allTasks: tasks
        };
    }

    /**
     * Marks a specific task as COMPLETED in the file.
     * Uses line-based replacement to be safe.
     */
    public markTaskAsDone(taskId: string): boolean {
        const state = this.analyzeSpecState();
        const task = state.allTasks.find(t => t.id === taskId);

        if (!task) {
            console.error(`Task ${taskId} not found.`);
            return false;
        }

        const content = fs.readFileSync(this.specPath, 'utf-8');
        const lines = content.split('\n');

        // Verify line content hasn't drifted (sanity check)
        const targetLine = lines[task.line_number];
        if (!targetLine.includes(task.description)) {
            console.error(`Concurrency Error: Task line content mistmatch. Expected "${task.description}" at line ${task.line_number}.`);
            // Fallback: search for the task description again
            // This is simple recovery, in a real DB we'd use IDs.
            return false;
        }

        // Replace [ ], [/] with [x]
        const newLine = targetLine
            .replace('- [ ]', '- [x]')
            .replace('- [/]', '- [x]');

        lines[task.line_number] = newLine;

        fs.writeFileSync(this.specPath, lines.join('\n'), 'utf-8');
        return true;
    }

    /**
     * Marks a task as IN_PROGRESS.
     */
    public markTaskInProgress(taskId: string): boolean {
        const state = this.analyzeSpecState();
        const task = state.allTasks.find(t => t.id === taskId);

        if (!task) return false;

        const content = fs.readFileSync(this.specPath, 'utf-8');
        const lines = content.split('\n');

        let targetLine = lines[task.line_number];

        // Replace [ ] with [/]
        targetLine = targetLine.replace('- [ ]', '- [/]');

        lines[task.line_number] = targetLine;
        fs.writeFileSync(this.specPath, lines.join('\n'), 'utf-8');
        return true;
    }

    /**
     * Completely updates the spec file content (used by Spec Agent).
     */
    public updateSpecContent(newContent: string): void {
        fs.writeFileSync(this.specPath, newContent, 'utf-8');
    }

    public getSpecPath(): string {
        return this.specPath;
    }
}
