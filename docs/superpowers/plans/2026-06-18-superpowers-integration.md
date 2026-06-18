# Superpowers Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement native superpowers support (skills loading, subagent lifecycle management, setup command, and interactive `/skills` TUI menu) in Shark AI.

**Architecture:** We will implement an in-memory asynchronous execution loop in the CLI process to handle subagents, use a TUI-based Mutex queue to prevent prompt overlap, and parse internal package directories to copy skills globally using Node's fs promises.

**Tech Stack:** TypeScript, Node.js (v20+), Vitest, Zod, Commander.

## Global Constraints
- Target Node.js v20 runtime.
- Maintain existing codebase directory structure.
- Follow test-driven development (TDD) for all new files and logic.
- Avoid third-party npm packages; rely on Node.js built-in modules.

---

### Task 1: Schema Extension and Parser Normalization

**Files:**
- Modify: `src/core/agents/agent-response-parser.ts`
- Modify: `src/core/api/prompts.ts`
- Create: `src/core/agents/agent-response-parser.test.ts`

**Interfaces:**
- Consumes: None
- Produces: Normalized actions `activate_skill`, `define_subagent`, `invoke_subagent`, `send_message`, and `manage_subagents`.

- [ ] **Step 1: Write the failing test**

Create `src/core/agents/agent-response-parser.test.ts` to assert validation of the new actions and normalization of `commands`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseAgentResponse } from './agent-response-parser.js';

describe('parseAgentResponse - Superpowers actions', () => {
    it('parses activate_skill action correctly', () => {
        const raw = JSON.stringify({
            action: {
                type: 'activate_skill',
                skill_name: 'brainstorming'
            },
            summary: 'Activating skill'
        });
        const parsed = parseAgentResponse(raw);
        expect(parsed.action?.type).toBe('activate_skill');
        expect((parsed.action as any).skill_name).toBe('brainstorming');
    });

    it('normalizes commands arrays containing strings', () => {
        const raw = JSON.stringify({
            action: { type: 'talk_with_user', content: 'test' },
            commands: ['npm run test'],
            summary: 'Running test'
        });
        const parsed = parseAgentResponse(raw);
        expect(parsed.commands).toHaveLength(1);
        expect(parsed.commands?.[0].command).toBe('npm run test');
        expect(parsed.commands?.[0].critical).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/agents/agent-response-parser.test.ts`
Expected: FAIL due to missing enum values in Zod schema.

- [ ] **Step 3: Write minimal implementation**

Modify `src/core/agents/agent-response-parser.ts` to extend `AgentActionSchema`:
```typescript
// Insert into AgentActionSchema:
    type: z.enum([
        'create_file', 'modify_file', 'list_files', 'search_file', 'search_code', 'read_file', 'delete_file',
        'list_structure', 'modify_ast', 'search_ast', 'run_command',
        'talk_with_user', 'use_mcp_tool',
        'activate_skill', 'define_subagent', 'invoke_subagent', 'send_message', 'manage_subagents',
        // ... (existing ast types)
    ]),
    skill_name: z.string().nullable().optional(),
    Subagents: z.array(z.object({
        TypeName: z.string(),
        Role: z.string(),
        Prompt: z.string()
    })).nullable().optional(),
    Recipient: z.string().nullable().optional(),
    Message: z.string().nullable().optional(),
    Action: z.enum(['list', 'kill', 'kill_all']).nullable().optional(),
    ConversationIds: z.array(z.string()).nullable().optional()
```

Modify `src/core/api/prompts.ts` to update `AGENT_RESPONSE_JSON_SCHEMA` and `UNIFIED_SYSTEM_PROMPT` to include description of the new tools and system instructions.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/agents/agent-response-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/agent-response-parser.ts src/core/api/prompts.ts src/core/agents/agent-response-parser.test.ts
git commit -m "feat: extend schema and parse superpowers actions"
```

---

### Task 2: Skill Manager Implementation

**Files:**
- Create: `src/core/workflow/skill-manager.ts`
- Create: `src/core/workflow/skill-manager.test.ts`
- Modify: `src/core/agents/developer-agent.ts`

**Interfaces:**
- Consumes: `parseAgentResponse`
- Produces: `SkillManager.activateSkill(name: string): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `src/core/workflow/skill-manager.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { skillManager } from './skill-manager.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('SkillManager', () => {
    const tempSkillPath = path.join(os.tmpdir(), '.shark-test-skills', 'test-skill');

    beforeAll(async () => {
        await fs.mkdir(tempSkillPath, { recursive: true });
        await fs.writeFile(
            path.join(tempSkillPath, 'SKILL.md'),
            '---\nname: test-skill\ndescription: Test\n---\n# Test Skill Instructions'
        );
    });

    afterAll(async () => {
        await fs.rm(path.dirname(tempSkillPath), { recursive: true, force: true });
    });

    it('loads and parses skill instructions correctly', async () => {
        const skillContent = await skillManager.loadSkillFromFile(path.join(tempSkillPath, 'SKILL.md'));
        expect(skillContent).toContain('# Test Skill Instructions');
        expect(skillContent).not.toContain('name: test-skill');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/workflow/skill-manager.test.ts`
Expected: FAIL with "skillManager not found".

- [ ] **Step 3: Write minimal implementation**

Create `src/core/workflow/skill-manager.ts`:
```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export class SkillManager {
    private activeSkills: Set<string> = new Set();
    private skillPrompts: Map<string, string> = new Map();

    async loadSkillFromFile(filePath: string): Promise<string> {
        const content = await fs.readFile(filePath, 'utf-8');
        // Strip frontmatter
        const cleanContent = content.replace(/^---[\s\S]*?---\s*/, '');
        return cleanContent;
    }

    async activateSkill(skillName: string): Promise<string> {
        if (this.activeSkills.has(skillName)) {
            return `Skill ${skillName} is already active.`;
        }

        const globalPath = path.join(os.homedir(), '.shark', 'skills', skillName, 'SKILL.md');
        const localPath = path.join(process.cwd(), '.agents', 'skills', skillName, 'SKILL.md');

        let skillPath = '';
        try {
            await fs.access(localPath);
            skillPath = localPath;
        } catch {
            try {
                await fs.access(globalPath);
                skillPath = globalPath;
            } catch {
                throw new Error(`Skill '${skillName}' not found globally or locally.`);
            }
        }

        const prompt = await this.loadSkillFromFile(skillPath);
        this.activeSkills.add(skillName);
        this.skillPrompts.set(skillName, prompt);
        return prompt;
    }

    getSystemInstructionExtension(): string {
        if (this.activeSkills.size === 0) return '';
        let extension = '\n\n<EXTREMELY_IMPORTANT>\n';
        for (const [name, prompt] of this.skillPrompts.entries()) {
            extension += `\n--- ACTIVE SKILL: ${name} ---\n${prompt}\n`;
        }
        extension += '\n</EXTREMELY_IMPORTANT>\n';
        return extension;
    }

    reset() {
        this.activeSkills.clear();
        this.skillPrompts.clear();
    }
}

export const skillManager = new SkillManager();
```

Modify `src/core/agents/developer-agent.ts` to handle `activate_skill` action:
```typescript
            else if (action.type === 'activate_skill') {
                const name = action.skill_name || '';
                tui.log.info(`⚡ Activating skill: ${colors.bold(name)}`);
                try {
                    await skillManager.activateSkill(name);
                    resultMsg = `[System]: Skill '${name}' activated successfully.`;
                } catch (e: any) {
                    resultMsg = `[System]: Failed to activate skill '${name}': ${e.message}`;
                }
            }
```
Update prompt assembly to append `skillManager.getSystemInstructionExtension()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/workflow/skill-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/skill-manager.ts src/core/workflow/skill-manager.test.ts src/core/agents/developer-agent.ts
git commit -m "feat: implement SkillManager and activate_skill handler"
```

---

### Task 3: Subagent Manager Implementation

**Files:**
- Create: `src/core/workflow/subagent-manager.ts`
- Create: `src/core/workflow/subagent-manager.test.ts`
- Modify: `src/core/agents/developer-agent.ts`

**Interfaces:**
- Consumes: `interactiveDeveloperAgent`
- Produces: `SubagentManager.invokeSubagents(...)`

- [ ] **Step 1: Write the failing test**

Create `src/core/workflow/subagent-manager.test.ts` asserting subagent registration and lifecycle states:
```typescript
import { describe, it, expect } from 'vitest';
import { subagentManager } from './subagent-manager.js';

describe('SubagentManager', () => {
    it('registers and manages subagent status', () => {
        const id = 'test-id';
        subagentManager.registerSubagent(id, 'self', 'Tester');
        expect(subagentManager.isSubagentActive(id)).toBe(true);
        subagentManager.terminateSubagent(id);
        expect(subagentManager.isSubagentActive(id)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: FAIL with "subagentManager not found".

- [ ] **Step 3: Write minimal implementation**

Create `src/core/workflow/subagent-manager.ts`:
```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

interface SubagentState {
    id: string;
    type: string;
    role: string;
    status: 'running' | 'completed' | 'failed';
    promise?: Promise<any>;
}

export class SubagentManager {
    private subagents = new Map<string, SubagentState>();
    private mailbox = new Map<string, string[]>(); // targetId -> messages

    registerSubagent(id: string, type: string, role: string) {
        this.subagents.set(id, { id, type, role, status: 'running' });
    }

    terminateSubagent(id: string, success: boolean = true) {
        const state = this.subagents.get(id);
        if (state) {
            state.status = success ? 'completed' : 'failed';
        }
    }

    isSubagentActive(id: string): boolean {
        return this.subagents.get(id)?.status === 'running';
    }

    sendMessage(recipient: string, message: string) {
        if (!this.mailbox.has(recipient)) {
            this.mailbox.set(recipient, []);
        }
        this.mailbox.get(recipient)!.push(message);
    }

    retrieveMessages(id: string): string[] {
        const msgs = this.mailbox.get(id) || [];
        this.mailbox.set(id, []);
        return msgs;
    }
}

export const subagentManager = new SubagentManager();
```

Modify `src/core/agents/developer-agent.ts` to implement:
- `define_subagent`
- `invoke_subagent`
- `send_message`
- `manage_subagents`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/subagent-manager.ts src/core/workflow/subagent-manager.test.ts src/core/agents/developer-agent.ts
git commit -m "feat: implement SubagentManager class and CLI lifecycle hooks"
```

---

### Task 4: TUI Mutex Queue

**Files:**
- Modify: `src/ui/tui.ts`
- Create: `src/ui/tui.test.ts`

**Interfaces:**
- Consumes: None
- Produces: `tui.acquireLock(): Promise<void>`, `tui.releaseLock(): void`

- [ ] **Step 1: Write the failing test**

Create `src/ui/tui.test.ts` checking lock serialization:
```typescript
import { describe, it, expect } from 'vitest';
import { tui } from './tui.js';

describe('TUI Mutex Lock', () => {
    it('serializes concurrent acquisitions', async () => {
        let order: number[] = [];
        const task1 = async () => {
            await (tui as any).acquireLock();
            order.push(1);
            (tui as any).releaseLock();
        };
        const task2 = async () => {
            await (tui as any).acquireLock();
            order.push(2);
            (tui as any).releaseLock();
        };

        await Promise.all([task1(), task2()]);
        expect(order).toEqual([1, 2]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/tui.test.ts`
Expected: FAIL with "acquireLock is not a function".

- [ ] **Step 3: Write minimal implementation**

Modify `src/ui/tui.ts` to implement a Promise-based queue lock:
```typescript
class TuiMutex {
    private queue: (() => void)[] = [];
    private locked = false;

    async acquireLock(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return;
        }
        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
        });
    }

    releaseLock(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            next?.();
        } else {
            this.locked = false;
        }
    }
}
```
Wrap all `tui.confirm` and `tui.text` prompts inside `acquireLock` / `releaseLock` blocks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/tui.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/tui.ts src/ui/tui.test.ts
git commit -m "feat: serialize TUI prompt inputs with Mutex lock"
```

---

### Task 5: `shark super` Setup Command

**Files:**
- Create: `src/commands/super.ts`
- Modify: `src/bin/shark.ts`
- Modify: `package.json`
- Create: `src/commands/super.test.ts`

**Interfaces:**
- Consumes: Node `fs.cp`
- Produces: CLI command `super`

- [ ] **Step 1: Write the failing test**

Create `src/commands/super.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { superCommand } from './super.js';

describe('superCommand', () => {
    it('is registered as a Commander Command', () => {
        expect(superCommand.name).toBe('super');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/super.test.ts`
Expected: FAIL with "superCommand not found".

- [ ] **Step 3: Write minimal implementation**

Create `src/commands/super.ts`:
```typescript
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

export const superCommandAction = async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const packageRoot = path.resolve(__dirname, '../../');
    const internalSkillsPath = path.join(packageRoot, 'skills');

    const globalSkillsPath = path.join(os.homedir(), '.shark', 'skills');

    try {
        await fs.mkdir(globalSkillsPath, { recursive: true });
        await fs.cp(internalSkillsPath, globalSkillsPath, { recursive: true });
        console.log(`🚀 Superpowers skills installed successfully to ${globalSkillsPath}`);
    } catch (error: any) {
        console.error(`❌ Failed to install superpowers skills: ${error.message}`);
        process.exit(1);
    }
};

export const superCommand = new Command('super')
    .description('Install Superpowers skills globally')
    .action(superCommandAction);
```
Modify `src/bin/shark.ts` to register `superCommand`.
Modify `package.json` to ensure `"skills"` folder is included in published files list.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/commands/super.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/super.ts src/commands/super.test.ts src/bin/shark.ts package.json
git commit -m "feat: add shark super setup command"
```

---

### Task 6: Interactive Slash Command `/skills`

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: `tui.select`
- Produces: Interactive prompt interception when `/skills` is typed

- [ ] **Step 1: Write the failing test**

Modify `src/core/agents/developer-agent.test.ts` to assert that inputting `/skills` launches the TUI selection menu.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Modify `src/core/agents/developer-agent.ts` input prompt handler:
```typescript
    if (!currentTask) {
        let userTask = await tui.text({
            message: 'O que você gostaria que o Shark Dev fizesse?',
            placeholder: 'ex: crie uma API REST simples ou digite /skills para ativar diretrizes'
        });
        if (userTask === '/skills') {
            const selectedSkill = await tui.select({
                message: 'Selecione a Skill do Superpowers para ativar:',
                options: [
                    { value: 'brainstorming', label: '🧠 brainstorming' },
                    { value: 'test-driven-development', label: '🧪 test-driven-development' },
                    { value: 'systematic-debugging', label: '🔍 systematic-debugging' }
                ]
            });
            if (!tui.isCancel(selectedSkill)) {
                await skillManager.activateSkill(selectedSkill as string);
                tui.log.success(`✔ Skill '${selectedSkill}' ativada com sucesso!`);
            }
            // Ask again
            userTask = await tui.text({
                message: 'O que você gostaria que o Shark Dev fizesse?',
                placeholder: 'digite a instrução da tarefa...'
            });
        }
        if (tui.isCancel(userTask) || !userTask) {
        t
            return { success: false, summary: 'Task execution cancelled.' };
        }
        currentTask = userTask as string;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "feat: support /skills interactive select command"
```
