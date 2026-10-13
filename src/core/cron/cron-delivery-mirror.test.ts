import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { CronDeliveryMirror } from './cron-delivery-mirror.js';
import type { CronJob } from './cron-types.js';
import { StateDB } from '../memory/state-db.js';
import { HistoryManager } from '../workflow/history-manager.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { workflowManager } from '../workflow/workflow-manager.js';

describe('CronDeliveryMirror', () => {
    const testDir = path.resolve(process.cwd(), '.shark', 'test-cron-mirror');
    const baseJob: CronJob = {
        id: 'job-123',
        name: 'Daily Audit',
        schedule: 'every 1h',
        status: 'scheduled',
        deliver: 'origin',
        origin_channel: 'whatsapp',
        origin_recipient_id: 'user_999',
        created_at: Date.now(),
        next_run_at: Date.now() + 3600000,
        run_count: 1
    };

    beforeEach(async () => {
        fs.mkdirSync(testDir, { recursive: true });
    });

    afterEach(async () => {
        try {
            fs.rmSync(testDir, { recursive: true, force: true });
        } catch {}
        try {
            const historyFile = path.resolve(process.cwd(), '_sharkrc', 'history', 'conv-test-mirror-session.json');
            if (fs.existsSync(historyFile)) {
                fs.unlinkSync(historyFile);
            }
        } catch {}
    });

    it('should mirror to state.db when delivery succeeds and deliver is origin', async () => {
        const stateDb = new StateDB();
        const mirrored = await CronDeliveryMirror.mirrorToSession({
            job: baseJob,
            deliveredText: 'Audit finished successfully.',
            deliverySuccess: true,
            stateDb
        });
        expect(mirrored).toBe(true);

        const results = stateDb.search('Audit finished');
        stateDb.close();
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].content).toContain('[Cron delivery: Daily Audit]');
        expect(results[0].content).toContain('Audit finished successfully.');
        expect(results[0].role).toBe('user');
    });

    it('should suppress mirroring when deliveredText contains [SILENT] or NO_REPLY', async () => {
        const mirroredSilent = await CronDeliveryMirror.mirrorToSession({
            job: baseJob,
            deliveredText: '[SILENT] No change detected',
            deliverySuccess: true
        });
        expect(mirroredSilent).toBe(false);

        const mirroredNoReply = await CronDeliveryMirror.mirrorToSession({
            job: baseJob,
            deliveredText: 'NO_REPLY',
            deliverySuccess: true
        });
        expect(mirroredNoReply).toBe(false);
    });

    it('should suppress mirroring when deliverySuccess is false', async () => {
        const mirrored = await CronDeliveryMirror.mirrorToSession({
            job: baseJob,
            deliveredText: 'Failed to send',
            deliverySuccess: false
        });
        expect(mirrored).toBe(false);
    });

    it('should suppress mirroring when deliver is local or all', async () => {
        const localJob: CronJob = { ...baseJob, deliver: 'local' };
        const mirroredLocal = await CronDeliveryMirror.mirrorToSession({
            job: localJob,
            deliveredText: 'Report generated locally',
            deliverySuccess: true
        });
        expect(mirroredLocal).toBe(false);

        const allJob: CronJob = { ...baseJob, deliver: 'all' };
        const mirroredAll = await CronDeliveryMirror.mirrorToSession({
            job: allJob,
            deliveredText: 'Broadcast notification',
            deliverySuccess: true
        });
        expect(mirroredAll).toBe(false);
    });

    it('should suppress mirroring for third-party recipient unless attach_to_session is true', async () => {
        const thirdPartyJob: CronJob = {
            ...baseJob,
            deliver: 'whatsapp:group_123',
            attach_to_session: false
        };
        const mirroredSuppressed = await CronDeliveryMirror.mirrorToSession({
            job: thirdPartyJob,
            deliveredText: 'Group alert',
            deliverySuccess: true
        });
        expect(mirroredSuppressed).toBe(false);

        const explicitAttachJob: CronJob = {
            ...baseJob,
            deliver: 'whatsapp:group_123',
            attach_to_session: true
        };
        const mirroredAttached = await CronDeliveryMirror.mirrorToSession({
            job: explicitAttachJob,
            deliveredText: 'Group alert with attach',
            deliverySuccess: true
        });
        expect(mirroredAttached).toBe(true);
    });

    it('should append message to HistoryManager when session conversation exists', async () => {
        const convKey = 'session_whatsapp:dm:user_999';
        const convId = 'conv-test-mirror-session';
        
        // Mock or setup conversation in workflowManager
        const state = (await workflowManager.load()) || {
            projectId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            projectName: 'test-project',
            techStack: 'node-ts' as const,
            currentStage: 'business_analysis' as const,
            stageStatus: 'pending' as const,
            lastUpdated: new Date().toISOString(),
            artifacts: [],
            conversations: {}
        };
        state.conversations = state.conversations || {};
        state.conversations[convKey] = convId;
        await workflowManager.save(state);

        await HistoryManager.saveRawHistory(convId, []);

        const mirrored = await CronDeliveryMirror.mirrorToSession({
            job: baseJob,
            deliveredText: 'Synced with history',
            deliverySuccess: true
        });
        expect(mirrored).toBe(true);

        const raw = await HistoryManager.getRawHistory(convId);
        expect(raw.length).toBeGreaterThan(0);
        expect(raw[raw.length - 1].role).toBe('user');
        expect(raw[raw.length - 1].content).toContain('[Cron delivery: Daily Audit]');
    });
});
