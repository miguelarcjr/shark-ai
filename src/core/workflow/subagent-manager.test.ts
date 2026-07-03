import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

afterEach(() => {
    subagentManager.destroy();
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

    it('sets status to cancelled and notifies mailbox when killSubagent is called', () => {
        const id = 'kill-notify-id';
        const parentId = 'parent-notify';
        subagentManager.registerSubagent(id, 'self', 'Tester', parentId);

        // Mock childProcess with kill
        const mockChild = { kill: vi.fn() };
        const state = subagentManager.getSubagentState(id);
        if (state) {
            state.childProcess = mockChild;
        }

        subagentManager.killSubagent(id);
        expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
        expect(subagentManager.getSubagentState(id)?.status).toBe('cancelled');

        const msgs = subagentManager.retrieveMessages(parentId);
        expect(msgs[0]).toContain('status: CANCELLED');
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

    it('throws an error if subagent ID format is invalid', () => {
        const invalidId = '../../some-evil-path';
        expect(() => subagentManager.getSubagentLogs(invalidId)).toThrow('Invalid subagent ID format');
    });

    it('retains cancelled status and summary on exit when cancelled early', async () => {
        const queue = new MessageQueue();
        const subagents = [{ TypeName: 'self', Role: 'Tester', Prompt: 'Test prompt' }];
        const parentId = 'parent-1';
        
        const invoked = await subagentManager.invokeSubagents(subagents, parentId, queue);
        const subId = invoked[0].id;
        
        // Immediately terminate as cancelled before child exits
        subagentManager.killSubagent(subId);
        
        // Wait for the exit handler promise to run
        await new Promise(resolve => setTimeout(resolve, 50));
        
        const state = subagentManager.getSubagentState(subId);
        expect(state?.status).toBe('cancelled');
        expect(state?.summary).toBe('Terminated by parent agent.');
        
        // Retrieve queue messages
        const msgs: any[] = [];
        while (!queue.isEmpty()) {
            msgs.push(await queue.next());
        }
        
        const subNotification = msgs.find(m => m.type === 'subagent_notification');
        expect(subNotification).toBeDefined();
        expect(subNotification.metadata?.status).toBe('cancelled');
        expect(subNotification.content).toBe('Terminated by parent agent.');
    });

    it('should inject specialized subagent instructions into the instruction prompt', async () => {
        const { fork } = await import('node:child_process');
        const forkMock = vi.mocked(fork);
        forkMock.mockClear();

        const subagents = [{ TypeName: 'self', Role: 'Tester', Prompt: 'Verify code' }];
        const parentId = 'parent-test';

        await subagentManager.invokeSubagents(subagents, parentId);

        // Wait briefly for the background promise to resolve (or at least spawn)
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(forkMock).toHaveBeenCalled();
        const args = forkMock.mock.calls[0][1];
        const taskFileIndex = args.indexOf('--task-file');
        expect(taskFileIndex).not.toBe(-1);
        const briefFilePath = args[taskFileIndex + 1];

        expect(fs.existsSync(briefFilePath)).toBe(true);
        const instructionArg = fs.readFileSync(briefFilePath, 'utf-8');

        expect(instructionArg).toContain('Você está executando em modo SUBAGENTE.');
        expect(instructionArg).toContain('Seu ID é:');
        expect(instructionArg).toContain('O ID do seu Agente Pai é: parent-test');
        expect(instructionArg).toContain('Não use \'talk_with_user\' para interagir.');
        expect(instructionArg).toContain('complete_task');
        expect(instructionArg).toContain('Verify code');
    });

    it('should inject custom type system prompt into customContext', async () => {
        const { fork } = await import('node:child_process');
        const forkMock = vi.mocked(fork);
        forkMock.mockClear();

        const name = 'code-writer-custom';
        const description = 'Writes code';
        const systemPrompt = 'You are a code writer...';
        subagentManager.defineSubagentType(name, description, systemPrompt, {
            enableWriteTools: true,
            enableSubagentTools: false
        });

        const subagents = [{ TypeName: name, Role: 'Writer', Prompt: 'Write this code' }];
        const parentId = 'parent-test-custom';

        await subagentManager.invokeSubagents(subagents, parentId);

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(forkMock).toHaveBeenCalled();
        const args = forkMock.mock.calls[0][1];
        const taskFileIndex = args.indexOf('--task-file');
        expect(taskFileIndex).not.toBe(-1);
        const briefFilePath = args[taskFileIndex + 1];

        expect(fs.existsSync(briefFilePath)).toBe(true);
        const instructionArg = fs.readFileSync(briefFilePath, 'utf-8');

        expect(instructionArg).toContain('Custom Prompt: You are a code writer...');
        expect(instructionArg).toContain('Write this code');
    });

    it('writes real-time status and action updates to .shark/subagents.json', () => {
        const id = 'ledger-test-id';
        subagentManager.registerSubagent(id, 'self', 'Tester', 'parent-ledger');
        
        const ledgerFile = path.resolve(process.cwd(), '.shark', 'subagents.json');
        expect(fs.existsSync(ledgerFile)).toBe(true);
        
        let ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf-8'));
        expect(ledger.subagents[id]).toBeDefined();
        expect(ledger.subagents[id].status).toBe('running');
        expect(ledger.subagents[id].type).toBe('self');

        // Test action update
        subagentManager.updateSubagentAction(id, 'read_file', { path: 'some-file.txt', type: 'read_file' });
        ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf-8'));
        expect(ledger.subagents[id].lastAction).toEqual({
            tool: 'read_file',
            params: { path: 'some-file.txt' }
        });

        // Test terminate
        subagentManager.terminateSubagent(id, true);
        ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf-8'));
        expect(ledger.subagents[id].status).toBe('completed');
    });

    it('watchdog terminates a hung subagent after timeout', async () => {
        const id = 'hung-id';
        const parentId = 'parent-watchdog';
        subagentManager.registerSubagent(id, 'self', 'Tester', parentId);

        // Mock child process and kill method
        const mockChild = { kill: vi.fn() };
        const state = subagentManager.getSubagentState(id);
        if (state) {
            state.childProcess = mockChild;
            // Fake lastActiveAt to be 6 minutes ago
            (state as any).lastActiveAt = Date.now() - 6 * 60 * 1000;
        }

        // Trigger manual watchdog check
        (subagentManager as any).checkWatchdog();

        expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
        expect(subagentManager.getSubagentState(id)?.status).toBe('failed');

        const msgs = subagentManager.retrieveMessages(parentId);
        expect(msgs[0]).toContain('terminated by the Watchdog');
    });
});

