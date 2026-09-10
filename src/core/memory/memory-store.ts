import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface MemorySnapshot {
  memory: string;
  user: string;
  soul: string;
  memoryUsage: { current: number; max: number; percentage: number };
  userUsage: { current: number; max: number; percentage: number };
  composedPromptBlock: string;
}

export class MemoryStore {
  public static readonly MEMORY_LIMIT = 2200;
  public static readonly USER_LIMIT = 1375;
  public static readonly SOUL_LIMIT = 1000;

  private globalDir: string;
  private localDir: string;

  constructor(customPaths?: { globalDir?: string; localDir?: string }) {
    this.globalDir = customPaths?.globalDir || path.join(os.homedir(), '.shark');
    this.localDir = customPaths?.localDir || path.join(process.cwd(), '.shark');
  }

  private getPath(target: 'memory' | 'user' | 'soul'): string {
    switch (target) {
      case 'memory':
        return path.join(this.localDir, 'MEMORY.md');
      case 'user':
        return path.join(this.globalDir, 'USER.md');
      case 'soul':
        return path.join(this.globalDir, 'SOUL.md');
    }
  }

  private getLimit(target: 'memory' | 'user' | 'soul'): number {
    switch (target) {
      case 'memory':
        return MemoryStore.MEMORY_LIMIT;
      case 'user':
        return MemoryStore.USER_LIMIT;
      case 'soul':
        return MemoryStore.SOUL_LIMIT;
    }
  }

  private async ensureDirAndFile(filePath: string, defaultContent: string): Promise<string> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      await fs.writeFile(filePath, defaultContent.trim(), 'utf-8');
      return defaultContent.trim();
    }
  }

  async readFile(target: 'memory' | 'user' | 'soul'): Promise<string> {
    const filePath = this.getPath(target);
    const defaults = {
      soul: 'Você é o Shark Dev, um agente de desenvolvimento colaborativo no Shark AI com foco em excelência técnica, código limpo e respostas concisas.',
      user: '# Perfil do Desenvolvedor\n- Ambiente: Node.js / TypeScript',
      memory: '# Memória do Projeto\n- Notas e convenções do repositório'
    };
    return this.ensureDirAndFile(filePath, defaults[target]);
  }

  async loadSnapshot(): Promise<MemorySnapshot> {
    const [soul, user, memory] = await Promise.all([
      this.readFile('soul'),
      this.readFile('user'),
      this.readFile('memory')
    ]);

    const memoryUsage = {
      current: memory.length,
      max: MemoryStore.MEMORY_LIMIT,
      percentage: Math.round((memory.length / MemoryStore.MEMORY_LIMIT) * 100)
    };

    const userUsage = {
      current: user.length,
      max: MemoryStore.USER_LIMIT,
      percentage: Math.round((user.length / MemoryStore.USER_LIMIT) * 100)
    };

    const composedPromptBlock = [
      `══════════════════════════════════════════════`,
      `MEMORY (notas do projeto) [${memoryUsage.percentage}% — ${memoryUsage.current}/${memoryUsage.max} chars]`,
      `══════════════════════════════════════════════`,
      memory,
      '',
      `══════════════════════════════════════════════`,
      `USER PROFILE [${userUsage.percentage}% — ${userUsage.current}/${userUsage.max} chars]`,
      `══════════════════════════════════════════════`,
      user
    ].join('\n');

    return { soul, user, memory, memoryUsage, userUsage, composedPromptBlock };
  }

  async updateFile(
    target: 'memory' | 'user',
    action: 'add' | 'replace' | 'remove',
    content: string,
    oldStr?: string
  ): Promise<{ success: boolean; usage: string; current_entries?: string[] }> {
    const ALLOWED_TARGETS = ['memory', 'user'] as const;
    if (!ALLOWED_TARGETS.includes(target as any)) {
      throw new Error(
        `Alvo inválido: '${target}'. O agente só possui permissão de escrita em 'MEMORY.md' e 'USER.md'. O arquivo 'SOUL.md' é estritamente somente-leitura.`
      );
    }

    const currentText = await this.readFile(target);
    const limit = this.getLimit(target);
    let newText = currentText;

    if (action === 'add') {
      newText = currentText ? `${currentText}\n${content.trim()}` : content.trim();
    } else if (action === 'replace') {
      if (!oldStr) throw new Error('Ação replace exige old_str para localizar o trecho a ser substituído.');
      if (!currentText.includes(oldStr)) {
        throw new Error(`Trecho '${oldStr}' não encontrado no arquivo ${target}.`);
      }
      newText = currentText.replace(oldStr, content.trim());
    } else if (action === 'remove') {
      const targetStr = oldStr || content;
      if (!targetStr) throw new Error('Ação remove exige conteúdo ou old_str para remoção.');
      newText = currentText.replace(targetStr, '').replace(/\n\s*\n/g, '\n').trim();
    }

    if (newText.length > limit) {
      const entries = currentText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const errorMsg = `Memory at ${currentText.length}/${limit} chars. Adding this entry (${content.length} chars) would exceed the limit. Consolidate now: use 'replace' to merge overlapping entries into shorter ones or 'remove' stale entries, then retry this add — all in this turn.`;
      const error = new Error(errorMsg);
      (error as any).current_entries = entries;
      (error as any).usage = `${currentText.length}/${limit}`;
      throw error;
    }

    const filePath = this.getPath(target);
    await fs.writeFile(filePath, newText, 'utf-8');

    return {
      success: true,
      usage: `${newText.length}/${limit}`
    };
  }
}
