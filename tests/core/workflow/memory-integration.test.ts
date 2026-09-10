import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../../src/core/memory/memory-store.js';
import { buildUnifiedSystemPrompt } from '../../../src/core/api/prompts.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Integration: Frozen Snapshot & Modular System Prompt', () => {
  let tmpGlobal: string;
  let tmpLocal: string;
  let store: MemoryStore;

  beforeEach(async () => {
    tmpGlobal = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-frozen-g-'));
    tmpLocal = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-frozen-l-'));
    store = new MemoryStore({ globalDir: tmpGlobal, localDir: tmpLocal });
  });

  afterEach(async () => {
    await fs.rm(tmpGlobal, { recursive: true, force: true });
    await fs.rm(tmpLocal, { recursive: true, force: true });
  });

  it('should build 3-layer system prompt with SOUL, USER, MEMORY and AGENTS context', async () => {
    await store.updateFile('memory', 'add', 'Porta do Serviço: 3000');
    await store.updateFile('user', 'add', 'Prefere respostas curtas');

    const snapshot = await store.loadSnapshot();
    const prompt = buildUnifiedSystemPrompt({
      snapshot,
      repositoryContext: '# AGENTS.md\nRegras de build com pnpm'
    });

    expect(prompt).toContain('Você é o Shark Dev');
    expect(prompt).toContain('<soul>');
    expect(prompt).toContain('<user_profile>');
    expect(prompt).toContain('Prefere respostas curtas');
    expect(prompt).toContain('<project_memory>');
    expect(prompt).toContain('Porta do Serviço: 3000');
    expect(prompt).toContain('<project_context>');
    expect(prompt).toContain('Regras de build com pnpm');
    expect(prompt).not.toContain('SISTEMA DE CONTEXTO ELÁSTICO (ACE)');
  });

  it('should maintain Frozen Snapshot unchanged in the active prompt even after memory updates', async () => {
    const snapshotAtBoot = await store.loadSnapshot();
    const activeSystemPrompt = buildUnifiedSystemPrompt({ snapshot: snapshotAtBoot });

    // Agente escreve uma nova memória no disco durante a sessão
    await store.updateFile('memory', 'add', 'Nova anotação no meio da sessão');

    // Prompt em execução na sessão DEVE permanecer idêntico para preservar o cache
    expect(activeSystemPrompt).not.toContain('Nova anotação no meio da sessão');

    // Na sessão seguinte (novo boot), o novo snapshot incorpora a alteração
    const snapshotNextBoot = await store.loadSnapshot();
    const nextSystemPrompt = buildUnifiedSystemPrompt({ snapshot: snapshotNextBoot });
    expect(nextSystemPrompt).toContain('Nova anotação no meio da sessão');
  });
});
