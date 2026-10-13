import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfigManager } from '../config-manager.js';

export interface MemorySnapshot {
  memory: string;
  user: string;
  soul: string;
  memoryUsage: { current: number; max: number; percentage: number };
  userUsage: { current: number; max: number; percentage: number };
  composedPromptBlock: string;
}

export interface MemoryStoreLimits {
  memory?: number;
  user?: number;
  soul?: number;
}

export interface MemoryStoreOptions {
  globalDir?: string;
  localDir?: string;
  limits?: MemoryStoreLimits;
}

export class MemoryStore {
  public static readonly DEFAULT_MEMORY_LIMIT = 2200;
  public static readonly DEFAULT_USER_LIMIT = 1375;
  public static readonly DEFAULT_SOUL_LIMIT = 1000;

  public static readonly MEMORY_LIMIT = MemoryStore.DEFAULT_MEMORY_LIMIT;
  public static readonly USER_LIMIT = MemoryStore.DEFAULT_USER_LIMIT;
  public static readonly SOUL_LIMIT = MemoryStore.DEFAULT_SOUL_LIMIT;

  private globalDir: string;
  private localDir: string;
  private limits: Record<'memory' | 'user' | 'soul', number>;

  constructor(customPaths?: MemoryStoreOptions) {
    this.globalDir = customPaths?.globalDir || path.join(os.homedir(), '.shark');
    this.localDir = customPaths?.localDir || path.join(process.cwd(), '.shark');

    const isCustomIsolatedTest = !!(customPaths?.globalDir || customPaths?.localDir);
    let rcMemory: any = {};
    if (!isCustomIsolatedTest) {
      try {
        rcMemory = ConfigManager.getInstance().getConfig()?.memory || {};
      } catch {}
    }

    this.limits = {
      memory: customPaths?.limits?.memory ?? rcMemory.memoryLimit ?? rcMemory.maxMemoryChars ?? MemoryStore.DEFAULT_MEMORY_LIMIT,
      user: customPaths?.limits?.user ?? rcMemory.userLimit ?? rcMemory.maxUserChars ?? MemoryStore.DEFAULT_USER_LIMIT,
      soul: customPaths?.limits?.soul ?? rcMemory.soulLimit ?? rcMemory.maxSoulChars ?? MemoryStore.DEFAULT_SOUL_LIMIT
    };
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

  public getLimit(target: 'memory' | 'user' | 'soul'): number {
    return this.limits[target] ?? MemoryStore.DEFAULT_MEMORY_LIMIT;
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

    const memLimit = this.getLimit('memory');
    const uLimit = this.getLimit('user');

    const memoryUsage = {
      current: memory.length,
      max: memLimit,
      percentage: Math.round((memory.length / memLimit) * 100)
    };

    const userUsage = {
      current: user.length,
      max: uLimit,
      percentage: Math.round((user.length / uLimit) * 100)
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

  public static readonly DELIMITER = '§';

  private sanitizeContent(content: string): string {
    if (!content) return '';
    // 1. Remove caracteres Unicode invisíveis e de controle
    let sanitized = content
      .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E]/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // 2. Desarmar tags de injeção de prompt que tentem fechar ou manipular o system prompt
    sanitized = sanitized.replace(/<\/?(soul|user_profile|project_memory|project_context|system)(?:\s+[^>]*)?>/gi, match => {
      return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    });

    // 3. Normalizar espaçamento excessivo
    return sanitized.replace(/\n{3,}/g, '\n\n').trim();
  }

  async getEntries(target: 'memory' | 'user' | 'soul'): Promise<string[]> {
    const text = await this.readFile(target);
    if (!text.trim()) return [];
    if (text.includes(MemoryStore.DELIMITER)) {
      return text
        .split(/(?:^|\n)§(?:\n|$)/)
        .map(e => e.trim())
        .filter(e => e.length > 0);
    }
    return text
      .split('\n')
      .map(e => e.trim())
      .filter(e => e.length > 0);
  }

  async updateFile(
    target: 'memory' | 'user',
    action: 'add' | 'replace' | 'remove',
    content: string,
    oldStr?: string
  ): Promise<{ success: boolean; usage: string; current_entries?: string[] }> {
    const ALLOWED_TARGETS = ['memory', 'user'] as const;
    if (!ALLOWED_TARGETS.includes(target as any) || (target as string).toLowerCase() === 'soul') {
      throw new Error(
        `Alvo inválido: '${target}'. O agente só possui permissão de escrita em 'MEMORY.md' e 'USER.md'. O arquivo 'SOUL.md' é estritamente somente-leitura.`
      );
    }

    const currentText = await this.readFile(target);
    const limit = this.getLimit(target);
    const sanitized = this.sanitizeContent(content);
    let newText = currentText;

    if (action === 'add') {
      newText = currentText
        ? `${currentText}\n${MemoryStore.DELIMITER}\n${sanitized}`
        : sanitized;
    } else if (action === 'replace') {
      if (!oldStr) throw new Error('Ação replace exige old_str para localizar o trecho a ser substituído.');
      if (!currentText.includes(oldStr)) {
        throw new Error(`Trecho '${oldStr}' não encontrado no arquivo ${target}.`);
      }
      newText = currentText.replace(oldStr, sanitized);
    } else if (action === 'remove') {
      const targetStr = oldStr || content;
      if (!targetStr) throw new Error('Ação remove exige conteúdo ou old_str para remoção.');
      newText = currentText
        .replace(targetStr, '')
        .replace(/(?:\n§)+\n?/g, '\n§\n')
        .replace(/\n\s*\n/g, '\n')
        .trim();
    }

    if (newText.length > limit) {
      const entries = await this.getEntries(target);
      let errorMsg = '';
      if (action === 'replace') {
        errorMsg = `Memory at ${currentText.length}/${limit} chars. Replacing with this content (${sanitized.length} chars) would exceed the limit (${newText.length}/${limit} chars). Please condense the replacement text before applying.`;
      } else {
        errorMsg = `Memory at ${currentText.length}/${limit} chars. Adding this entry (${sanitized.length} chars) would exceed the limit. Consolidate now: use 'replace' to merge overlapping entries into shorter ones or 'remove' stale entries, then retry this add — all in this turn.`;
      }
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
