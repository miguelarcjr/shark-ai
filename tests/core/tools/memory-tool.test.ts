import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeMemoryTool, memoryToolSchema } from '../../../src/core/tools/memory-tool.js';
import { MemoryStore } from '../../../src/core/memory/memory-store.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('memoryTool', () => {
  let tmpGlobal: string;
  let tmpLocal: string;
  let store: MemoryStore;

  beforeEach(async () => {
    tmpGlobal = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-test-tool-g-'));
    tmpLocal = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-test-tool-l-'));
    store = new MemoryStore({ globalDir: tmpGlobal, localDir: tmpLocal });
  });

  afterEach(async () => {
    await fs.rm(tmpGlobal, { recursive: true, force: true });
    await fs.rm(tmpLocal, { recursive: true, force: true });
  });

  it('should validate and execute add action', async () => {
    const args = memoryToolSchema.parse({
      action: 'add',
      target: 'memory',
      content: 'Porta Docker: 5432'
    });

    const result = await executeMemoryTool(store, args);
    expect(result.success).toBe(true);
    expect(result.usage).toBeDefined();

    const readArgs = memoryToolSchema.parse({ action: 'read', target: 'memory' });
    const readResult = await executeMemoryTool(store, readArgs);
    expect(readResult.content).toContain('Porta Docker: 5432');
  });

  it('should reject invalid targets via Zod schema', () => {
    expect(() =>
      // @ts-expect-error test schema rejection
      memoryToolSchema.parse({ action: 'add', target: 'soul', content: 'teste' })
    ).toThrow();
  });

  it('should reject target soul at runtime in executeMemoryTool with permission error', async () => {
    await expect(
      // @ts-expect-error test direct runtime call
      executeMemoryTool(store, { action: 'add', target: 'soul', content: 'teste' })
    ).rejects.toThrow("Permissão negada: O arquivo 'SOUL.md' é estritamente somente-leitura");
  });
});
