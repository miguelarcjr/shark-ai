import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../../src/core/memory/memory-store.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('MemoryStore', () => {
  let tmpGlobal: string;
  let tmpLocal: string;
  let store: MemoryStore;

  beforeEach(async () => {
    tmpGlobal = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-test-global-'));
    tmpLocal = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-test-local-'));
    store = new MemoryStore({ globalDir: tmpGlobal, localDir: tmpLocal });
  });

  afterEach(async () => {
    await fs.rm(tmpGlobal, { recursive: true, force: true });
    await fs.rm(tmpLocal, { recursive: true, force: true });
  });

  it('should initialize default template files on cold start and load snapshot', async () => {
    const snapshot = await store.loadSnapshot();
    expect(snapshot.soul).toContain('Shark');
    expect(snapshot.memoryUsage.max).toBe(2200);
    expect(snapshot.userUsage.max).toBe(1375);
    expect(snapshot.composedPromptBlock).toContain('MEMORY (notas do projeto)');
    expect(snapshot.composedPromptBlock).toContain('USER PROFILE');
  });

  it('should reject modification to SOUL.md with permission error', async () => {
    // @ts-expect-error test illegal target
    await expect(store.updateFile('soul', 'add', 'novo tom')).rejects.toThrow(
      "Alvo inválido: 'soul'. O agente só possui permissão de escrita em 'MEMORY.md' e 'USER.md'. O arquivo 'SOUL.md' é estritamente somente-leitura."
    );
  });

  it('should reject entry exceeding limit with structured overflow guidance', async () => {
    const hugeContent = 'A'.repeat(2201);
    await expect(store.updateFile('memory', 'add', hugeContent)).rejects.toMatchObject({
      message: expect.stringContaining('would exceed the limit. Consolidate now')
    });
  });

  it('should support add, replace and remove operations on memory and user', async () => {
    await store.updateFile('memory', 'add', 'Porta da API: 8080');
    let content = await store.readFile('memory');
    expect(content).toContain('Porta da API: 8080');

    await store.updateFile('memory', 'replace', 'Porta da API: 9090', 'Porta da API: 8080');
    content = await store.readFile('memory');
    expect(content).toContain('Porta da API: 9090');
    expect(content).not.toContain('Porta da API: 8080');

    await store.updateFile('memory', 'remove', '', 'Porta da API: 9090');
    content = await store.readFile('memory');
    expect(content).not.toContain('Porta da API: 9090');
  });
});
