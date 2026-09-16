import { describe, it, expect } from 'vitest';
import { ContextCompressor } from './context-compressor.js';
import { ChatMessage } from './history-manager.js';

describe('ContextCompressor', () => {
  describe('applyStructuralReadDeduplication', () => {
    it('should deduplicate multiple read_file calls for the same file path and keep the most recent one', () => {
      const history: ChatMessage[] = [
        { role: 'system', content: 'System Prompt' }, // 0: Pinned
        { role: 'user', content: 'Implement calculateTax' }, // 1: Pinned (Original Task)
        { role: 'assistant', content: '{"thought":"reading 1","action":{"type":"read_file","path":"src/calculator.ts"}}' }, // 2
        { role: 'user', content: '[Action read_file(src/calculator.ts) Success]:\nold content 1' }, // 3: Old read
        { role: 'assistant', content: '{"thought":"reading 2","action":{"type":"read_file","path":"src/calculator.ts"}}' }, // 4
        { role: 'user', content: '[Action read_file(src/calculator.ts) Success - 7 linhas, Arquivo completo]:\n[START_OF_FILE]\napple§export function add()...\n[END_OF_FILE]' }, // 5: Newer read
        { role: 'assistant', content: '{"thought":"next action"}' }, // 6: Tail T-1
        { role: 'user', content: 'What next?' } // 7: Tail T
      ];

      const deduplicated = ContextCompressor.applyStructuralReadDeduplication(history);

      // Verify old read (3) and its invoking assistant (2) are dropped
      expect(deduplicated.find(m => m.content.includes('old content 1'))).toBeUndefined();
      expect(deduplicated.find(m => m.content.includes('reading 1'))).toBeUndefined();

      // Verify newer read (5) is kept
      const keptRead = deduplicated.find(m => m.content.includes('Arquivo completo'));
      expect(keptRead).toBeDefined();

      // Verify pinned turns (0, 1, 6, 7) are kept
      expect(deduplicated[0].role).toBe('system');
      expect(deduplicated[1].content).toBe('Implement calculateTax');
      expect(deduplicated[deduplicated.length - 1].content).toBe('What next?');
    });

    it('should NOT drop run_command entries during structural deduplication', () => {
      const history: ChatMessage[] = [
        { role: 'system', content: 'System Prompt' },
        { role: 'user', content: 'Run tests' },
        { role: 'user', content: '[Action run_command(npm test) Success]:\nTest failed assertion 1' },
        { role: 'assistant', content: '{"thought":"analyzing"}' },
        { role: 'user', content: '[Action run_command(npm test) Success]:\nTest failed assertion 2' },
        { role: 'assistant', content: '{"thought":"fixing"}' },
        { role: 'user', content: 'Status?' }
      ];

      const deduplicated = ContextCompressor.applyStructuralReadDeduplication(history);
      const cmdOutputs = deduplicated.filter(m => m.content.startsWith('[Action run_command'));
      expect(cmdOutputs).toHaveLength(2);
    });

    it('should handle different files without deduplicating them against each other', () => {
      const history: ChatMessage[] = [
        { role: 'system', content: 'System Prompt' },
        { role: 'user', content: 'Original Task' },
        { role: 'assistant', content: '{"action":{"type":"read_file","path":"src/calculator.ts"}}' },
        { role: 'user', content: '[Action read_file(src/calculator.ts) Success]:\ncalc content' },
        { role: 'assistant', content: '{"action":{"type":"read_file","path":"src/calculator.test.ts"}}' },
        { role: 'user', content: '[Action read_file(src/calculator.test.ts) Success]:\ntest content' },
        { role: 'assistant', content: '{"thought":"done"}' },
        { role: 'user', content: 'Next' }
      ];

      const deduplicated = ContextCompressor.applyStructuralReadDeduplication(history);
      expect(deduplicated.find(m => m.content.includes('calc content'))).toBeDefined();
      expect(deduplicated.find(m => m.content.includes('test content'))).toBeDefined();
      expect(deduplicated).toHaveLength(history.length);
    });
  });

  describe('compress always-on integration', () => {
    it('should run deduplication unconditionally even when total tokens are well below limit', async () => {
      const history: ChatMessage[] = [
        { role: 'system', content: 'System Prompt' },
        { role: 'user', content: 'Task' },
        { role: 'assistant', content: '{"action":{"type":"read_file","path":"a.ts"}}' },
        { role: 'user', content: '[Action read_file(a.ts) Success]:\nversion 1' },
        { role: 'assistant', content: '{"action":{"type":"read_file","path":"a.ts"}}' },
        { role: 'user', content: '[Action read_file(a.ts) Success]:\nversion 2' },
        { role: 'assistant', content: '{"thought":"ok"}' },
        { role: 'user', content: 'prompt' }
      ];

      // Very large token limit, so normal summarization threshold won't trigger
      const { history: result, wasCompressed } = await ContextCompressor.compress(history, {
        tokenLimit: 100000,
        thresholdRatio: 0.8
      });

      expect(wasCompressed).toBe(true);
      expect(result.find(m => m.content.includes('version 1'))).toBeUndefined();
      expect(result.find(m => m.content.includes('version 2'))).toBeDefined();
    });
  });
});
