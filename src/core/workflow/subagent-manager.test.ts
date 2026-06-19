import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subagentManager } from './subagent-manager.js';
import { interactiveDeveloperAgent } from '../agents/developer-agent.js';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { MessageQueue } from './message-queue.js';

vi.mock('../agents/developer-agent.js', () => ({
    interactiveDeveloperAgent: vi.fn()
}));

vi.mock('node:child_process', () => {
    return {
        fork: vi.fn().mockImplementation((modulePath, args, options) => {
            const child: any = new EventEmitter();
            child.stdout = new Readable({ read() {} });
            child.stderr = new Readable({ read() {} });
            
            const parentId = options.env?.SHARK_PARENT_ID;
            const taskId = args[args.indexOf('--taskId') + 1];
            const role = options.env?.SHARK_SUBAGENT_ROLE;

            process.nextTick(() => {
                if (parentId && taskId) {
                    subagentManager.sendMessage(
                        parentId,
                        `[Subagent Notification] Subagent ${role} (${taskId}) has finished with status: COMPLETED. Summary: Passed test checks`
                    );
                }
                child.emit('exit', 0);
            });
            return child;
        })
    };
});

beforeEach(() => {
    const mailboxDir = path.resolve(process.cwd(), '.shark', 'mailbox');
    if (fs.existsSync(mailboxDir)) {
        fs.rmSync(mailboxDir, { recursive: true, force: true });
    }
});

describe('SubagentManager', () => {
    it('registers and manages subagent status', () => {
        const id = 'test-id';
        subagentManager.registerSubagent(id, 'self', 'Tester');
        expect(subagentManager.isSubagentActive(id)).toBe(true);
        subagentManager.terminateSubagent(id);
        expect(subagentManager.isSubagentActive(id)).toBe(false);
    });

    it('sends and retrieves messages (mailbox)', () => {
        const subagentId = 'subagent-1';
        subagentManager.sendMessage(subagentId, 'Hello from parent!');
        subagentManager.sendMessage(subagentId, 'Are you done yet?');

        const messages = subagentManager.retrieveMessages(subagentId);
        expect(messages).toEqual(['Hello from parent!', 'Are you done yet?']);

        // Mailbox should be cleared after retrieval
        const emptyMessages = subagentManager.retrieveMessages(subagentId);
        expect(emptyMessages).toEqual([]);
    });

    it('defines and retrieves custom subagent types', () => {
        const name = 'code-writer';
        const description = 'Writes code';
        const systemPrompt = 'You are a code writer...';
        subagentManager.defineSubagentType(name, description, systemPrompt, {
            enableWriteTools: true,
            enableSubagentTools: false
        });

        const customType = subagentManager.getCustomSubagentType(name);
        expect(customType).toBeDefined();
        expect(customType?.name).toBe(name);
        expect(customType?.description).toBe(description);
        expect(customType?.systemPrompt).toBe(systemPrompt);
        expect(customType?.enableWriteTools).toBe(true);
        expect(customType?.enableSubagentTools).toBe(false);
    });

    it('lists and terminates active subagents', () => {
        const id1 = 'id-1';
        const id2 = 'id-2';
        subagentManager.registerSubagent(id1, 'self', 'Tester 1');
        subagentManager.registerSubagent(id2, 'self', 'Tester 2');

        let active = subagentManager.getActiveSubagents();
        expect(active.some(s => s.id === id1)).toBe(true);
        expect(active.some(s => s.id === id2)).toBe(true);

        subagentManager.killSubagent(id1);
        expect(subagentManager.isSubagentActive(id1)).toBe(false);
        expect(subagentManager.isSubagentActive(id2)).toBe(true);

        subagentManager.killAllSubagents();
        expect(subagentManager.isSubagentActive(id2)).toBe(false);
        expect(subagentManager.getActiveSubagents()).toEqual([]);
    });

    it('correctly tracks and filters active subagents by parentId', () => {
        const id1 = 'parent1-child1';
        const id2 = 'parent1-child2';
        const id3 = 'parent2-child1';
        
        subagentManager.registerSubagent(id1, 'self', 'Tester 1', 'parent1');
        subagentManager.registerSubagent(id2, 'self', 'Tester 2', 'parent1');
        subagentManager.registerSubagent(id3, 'self', 'Tester 3', 'parent2');
        
        const activeParent1 = subagentManager.getActiveSubagentsForParent('parent1');
        expect(activeParent1.length).toBe(2);
        expect(activeParent1.some(s => s.id === id1)).toBe(true);
        expect(activeParent1.some(s => s.id === id2)).toBe(true);
        expect(activeParent1.some(s => s.id === id3)).toBe(false);
        
        subagentManager.terminateSubagent(id1);
        const activeParent1PostTerminate = subagentManager.getActiveSubagentsForParent('parent1');
        expect(activeParent1PostTerminate.length).toBe(1);
        expect(activeParent1PostTerminate[0].id).toBe(id2);
    });

    it('sends notification to parent mailbox on subagent completion', async () => {
        vi.mocked(interactiveDeveloperAgent).mockResolvedValue({ success: true, summary: 'Passed test checks' });
        const subagents = [{ TypeName: 'self', Role: 'Tester', Prompt: 'Verify code' }];
        const parentId = 'parent-test';

        await subagentManager.invokeSubagents(subagents, parentId);
        
        // Wait briefly for the background promise to resolve
        await new Promise(resolve => setTimeout(resolve, 10));

        const parentMsgs = subagentManager.retrieveMessages(parentId);
        expect(parentMsgs.length).toBe(1);
        expect(parentMsgs[0]).toContain('[Subagent Notification]');
        expect(parentMsgs[0]).toContain('Tester');
        expect(parentMsgs[0]).toContain('Passed test checks');
    });

    it('sends notification to parent mailbox on subagent failure', async () => {
        const { fork } = await import('node:child_process');
        vi.mocked(fork).mockImplementationOnce((modulePath, args: any, options: any) => {
            const child: any = new EventEmitter();
            child.stdout = new Readable({ read() {} });
            child.stderr = new Readable({ read() {} });
            const parentId = options.env?.SHARK_PARENT_ID;
            const taskId = args[args.indexOf('--taskId') + 1];
            const role = options.env?.SHARK_SUBAGENT_ROLE;

            process.nextTick(() => {
                if (parentId && taskId) {
                    subagentManager.sendMessage(
                        parentId,
                        `[Subagent Notification] Subagent ${role} (${taskId}) has finished with status: FAILED. Summary: Error: Simulated subagent failure`
                    );
                }
                child.emit('exit', 1);
            });
            return child;
        });

        const subagents = [{ TypeName: 'self', Role: 'Tester', Prompt: 'Verify code' }];
        const parentId = 'parent-test';

        await subagentManager.invokeSubagents(subagents, parentId);
        
        // Wait briefly for the background promise to resolve
        await new Promise(resolve => setTimeout(resolve, 10));

        const parentMsgs = subagentManager.retrieveMessages(parentId);
        expect(parentMsgs.length).toBe(1);
        expect(parentMsgs[0]).toContain('[Subagent Notification]');
        expect(parentMsgs[0]).toContain('Tester');
        expect(parentMsgs[0]).toContain('FAILED');
    });

    it('creates files on the filesystem inside .shark/mailbox when sending messages', () => {
        const subagentId = 'subagent-fs-test';
        subagentManager.sendMessage(subagentId, 'Test FS Message');

        const mailboxDir = path.resolve(process.cwd(), '.shark', 'mailbox', subagentId);
        expect(fs.existsSync(mailboxDir)).toBe(true);
        const files = fs.readdirSync(mailboxDir);
        expect(files.length).toBe(1);

        const content = fs.readFileSync(path.join(mailboxDir, files[0]), 'utf-8');
        expect(JSON.parse(content)).toEqual({ message: 'Test FS Message' });

        const retrieved = subagentManager.retrieveMessages(subagentId);
        expect(retrieved).toEqual(['Test FS Message']);
        expect(fs.existsSync(path.join(mailboxDir, files[0]))).toBe(false);
    });

    it('pushes completion event to parent queue when subagent exits', async () => {
        const queue = new MessageQueue();
        const subagents = [{ TypeName: 'self', Role: 'Tester', Prompt: 'Test prompt' }];
        const parentId = 'parent-1';
        
        await subagentManager.invokeSubagents(subagents, parentId, queue);
        
        const nextMsg = await queue.next();
        expect(nextMsg.type).toBe('subagent_notification');
        expect(nextMsg.metadata?.role).toBe('Tester');
        expect(nextMsg.metadata?.status).toBe('completed');
        expect(nextMsg.content).toContain('Passed test checks');
    });

    it('supports cancelled status for terminated subagents', () => {
        const id = 'cancelled-test-id';
        subagentManager.registerSubagent(id, 'self', 'Tester');
        expect(subagentManager.isSubagentActive(id)).toBe(true);
        subagentManager.terminateSubagent(id, false, true); // new parameter or logic
        const state = subagentManager.getSubagentState(id);
        expect(state?.status).toBe('cancelled');
        expect(subagentManager.isSubagentActive(id)).toBe(false);
    });

    it('reads console logs of a subagent from the filesystem', () => {
        const id = 'log-test-id';
        const projectRoot = process.cwd();
        const historyDir = path.resolve(projectRoot, '_sharkrc', 'history');
        fs.mkdirSync(historyDir, { recursive: true });
        const logFile = path.join(historyDir, `subagent-${id}-console.log`);
        fs.writeFileSync(logFile, "Line 1\nLine 2\nLine 3\n", 'utf-8');

        // Test reading
        const logs = subagentManager.getSubagentLogs(id, 2);
        expect(logs).toContain("Line 2\nLine 3");
        fs.unlinkSync(logFile);
    });
});
