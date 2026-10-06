# Workspaces Isolados por Perfil/Grupo no WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o provisionamento e resolução automática de workspaces isolados por usuário (DM) ou grupo no bot de WhatsApp do Shark AI, com inicialização programática de skills e contexto (`shark init` + `shark super --local`).

**Architecture:** Criar o serviço `SessionWorkspaceManager` dentro de `src/core/workspace/`, responsável por sanitizar e resolver caminhos de diretório a partir do `chatId`, e por provisionar atomicamente os recursos de workspace sob demanda com suporte a in-flight mutex. Integrar o serviço no `examples/whatsapp-bot/src/index.ts` e exportá-lo no `src/core/index.ts`.

**Tech Stack:** Node.js, TypeScript, Vitest, Baileys (@whiskeysockets/baileys), fs/promises.

## Global Constraints

- Raiz base configurada via `SHARK_WORKSPACES_ROOT` ou padrão `<cwd>/workspaces`.
- Prefixo de pastas: `workspaces/user_<telefone>` para DMs e `workspaces/group_<id>` para grupos.
- Sanitização rigorosa de caracteres para evitar problemas em Windows e Linux.
- Concorrência protegida por Promise cache por `chatId`.
- Preservar integridade dos testes e tipos existentes sem introduzir quebras na API do `AgentEngine`.

---

### Task 1: Criar o `SessionWorkspaceManager` e testes unitários

**Files:**
- Create: `src/core/workspace/session-workspace-manager.ts`
- Test: `src/core/workspace/session-workspace-manager.test.ts`
- Modify: `src/core/index.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface WorkspaceResolution {
      dirName: string;
      fullPath: string;
      exists: boolean;
      isGroup: boolean;
  }

  export interface SessionWorkspaceManagerOptions {
      baseDir?: string;
      skillsSourceDir?: string;
  }

  export class SessionWorkspaceManager {
      constructor(options?: SessionWorkspaceManagerOptions);
      resolve(chatId: string): WorkspaceResolution;
      ensureWorkspace(
          chatId: string,
          onProgress?: (message: string) => Promise<void>
      ): Promise<string>;
  }
  ```

- [ ] **Step 1: Escrever teste unitário falhando para resolução e inicialização de workspace**

Criar `src/core/workspace/session-workspace-manager.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { SessionWorkspaceManager } from './session-workspace-manager.js';

describe('SessionWorkspaceManager', () => {
    let tmpDir: string;
    let mockSkillsDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-ws-test-'));
        mockSkillsDir = path.join(tmpDir, 'mock-skills');
        await fs.mkdir(mockSkillsDir, { recursive: true });
        await fs.writeFile(path.join(mockSkillsDir, 'dummy-skill.md'), '# Dummy Skill');
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('resolve corretamente nomes para DM e grupo sanitizando identificadores', () => {
        const manager = new SessionWorkspaceManager({ baseDir: tmpDir });

        const dm = manager.resolve('5511999999999@s.whatsapp.net');
        expect(dm.isGroup).toBe(false);
        expect(dm.dirName).toBe('user_5511999999999');
        expect(dm.fullPath).toBe(path.join(tmpDir, 'user_5511999999999'));
        expect(dm.exists).toBe(false);

        const group = manager.resolve('12036302837482910@g.us');
        expect(group.isGroup).toBe(true);
        expect(group.dirName).toBe('group_12036302837482910');
        expect(group.fullPath).toBe(path.join(tmpDir, 'group_12036302837482910'));
    });

    it('inicializa a estrutura do workspace sob demanda com skills, workflow e contexto', async () => {
        const manager = new SessionWorkspaceManager({
            baseDir: tmpDir,
            skillsSourceDir: mockSkillsDir
        });

        const progressMessages: string[] = [];
        const wsPath = await manager.ensureWorkspace('5511888888888@s.whatsapp.net', async (msg) => {
            progressMessages.push(msg);
        });

        expect(wsPath).toBe(path.join(tmpDir, 'user_5511888888888'));
        expect(progressMessages.length).toBeGreaterThan(0);

        // Verifica diretórios e arquivos criados
        const skillCopied = await fs.readFile(
            path.join(wsPath, '.agents', 'skills', 'dummy-skill.md'),
            'utf-8'
        );
        expect(skillCopied).toBe('# Dummy Skill');

        const gitignore = await fs.readFile(path.join(wsPath, '.gitignore'), 'utf-8');
        expect(gitignore).toContain('.shark/');

        const context = await fs.readFile(path.join(wsPath, '_sharkrc', 'project-context.md'), 'utf-8');
        expect(context).toContain('user_5511888888888');

        const workflowRaw = await fs.readFile(path.join(wsPath, '.shark', 'workflow.json'), 'utf-8');
        const workflow = JSON.parse(workflowRaw);
        expect(workflow.projectName).toBe('user_5511888888888');
        expect(workflow.techStack).toBe('node-ts');
    });

    it('reutiliza a inicialização sem recriar se o diretório já existir', async () => {
        const manager = new SessionWorkspaceManager({
            baseDir: tmpDir,
            skillsSourceDir: mockSkillsDir
        });

        await manager.ensureWorkspace('5511777777777@s.whatsapp.net');

        const progressMessages: string[] = [];
        await manager.ensureWorkspace('5511777777777@s.whatsapp.net', async (msg) => {
            progressMessages.push(msg);
        });

        // Não deve emitir mensagens de criação se já existe
        expect(progressMessages).toHaveLength(0);
    });

    it('gerencia concorrência com mutex compartilhado em chamadas simultâneas', async () => {
        const manager = new SessionWorkspaceManager({
            baseDir: tmpDir,
            skillsSourceDir: mockSkillsDir
        });

        const [res1, res2] = await Promise.all([
            manager.ensureWorkspace('5511666666666@s.whatsapp.net'),
            manager.ensureWorkspace('5511666666666@s.whatsapp.net')
        ]);

        expect(res1).toBe(res2);
    });
});
```

- [ ] **Step 2: Executar teste para verificar falha inicial**

Comando: `npx vitest run src/core/workspace/session-workspace-manager.test.ts`  
Resultado esperado: FAIL ("Cannot find module './session-workspace-manager.js'")

- [ ] **Step 3: Implementar `SessionWorkspaceManager`**

Criar `src/core/workspace/session-workspace-manager.ts`:
```typescript
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface WorkspaceResolution {
    dirName: string;
    fullPath: string;
    exists: boolean;
    isGroup: boolean;
}

export interface SessionWorkspaceManagerOptions {
    baseDir?: string;
    skillsSourceDir?: string;
}

export class SessionWorkspaceManager {
    private baseDir: string;
    private skillsSourceDir: string;
    private inFlightInits = new Map<string, Promise<string>>();

    constructor(options: SessionWorkspaceManagerOptions = {}) {
        this.baseDir = options.baseDir || process.env.SHARK_WORKSPACES_ROOT || path.resolve(process.cwd(), 'workspaces');

        if (options.skillsSourceDir) {
            this.skillsSourceDir = options.skillsSourceDir;
        } else {
            try {
                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);
                this.skillsSourceDir = path.resolve(__dirname, '../../../skills');
            } catch {
                this.skillsSourceDir = path.resolve(process.cwd(), 'skills');
            }
        }
    }

    public resolve(chatId: string): WorkspaceResolution {
        const isGroup = chatId.endsWith('@g.us');
        // Sanitiza caracteres especiais
        const rawId = chatId.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_');
        const prefix = isGroup ? 'group_' : 'user_';
        const dirName = `${prefix}${rawId}`;
        const fullPath = path.resolve(this.baseDir, dirName);
        const exists = existsSync(fullPath);

        return {
            dirName,
            fullPath,
            exists,
            isGroup
        };
    }

    public async ensureWorkspace(
        chatId: string,
        onProgress?: (message: string) => Promise<void>
    ): Promise<string> {
        const res = this.resolve(chatId);
        if (res.exists) {
            return res.fullPath;
        }

        // Controle de concorrência por chatId
        const existingPromise = this.inFlightInits.get(chatId);
        if (existingPromise) {
            return existingPromise;
        }

        const initPromise = (async () => {
            try {
                if (onProgress) {
                    await onProgress('⏳ *Criando e preparando seu workspace dedicado...*');
                }

                const targetDir = res.fullPath;
                await fs.mkdir(targetDir, { recursive: true });

                // 1. Instalar skills em .agents/skills (equivalente ao shark super --local)
                const targetSkills = path.join(targetDir, '.agents', 'skills');
                await fs.mkdir(targetSkills, { recursive: true });

                if (existsSync(this.skillsSourceDir)) {
                    await fs.cp(this.skillsSourceDir, targetSkills, { recursive: true, force: true });
                }

                // 2. Inicializar .shark/workflow.json
                const sharkDir = path.join(targetDir, '.shark');
                await fs.mkdir(sharkDir, { recursive: true });
                const workflowState = {
                    projectId: `ws-${res.dirName}`,
                    projectName: res.dirName,
                    techStack: 'node-ts',
                    currentStage: 'business_analysis',
                    stageStatus: 'pending',
                    lastUpdated: new Date().toISOString(),
                    artifacts: [],
                    metadata: {
                        initializedBy: 'shark-whatsapp-workspace-manager',
                        version: '0.1.0'
                    }
                };
                await fs.writeFile(
                    path.join(sharkDir, 'workflow.json'),
                    JSON.stringify(workflowState, null, 2),
                    'utf-8'
                );

                // 3. Inicializar _sharkrc/project-context.md
                const sharkrcDir = path.join(targetDir, '_sharkrc');
                await fs.mkdir(sharkrcDir, { recursive: true });
                const contextContent = `# Contexto do Projeto: ${res.dirName}\n\nWorkspace dedicado criado para atendimento no WhatsApp (${res.isGroup ? 'Grupo' : 'Usuário'}).\n`;
                await fs.writeFile(
                    path.join(sharkrcDir, 'project-context.md'),
                    contextContent,
                    'utf-8'
                );

                // 4. Inicializar .gitignore
                const gitignoreContent = `# Shark AI Runtime & Logs\n.shark/\n_sharkrc/\nshark-debug.log\nnode_modules/\n`;
                await fs.writeFile(path.join(targetDir, '.gitignore'), gitignoreContent, 'utf-8');

                // 5. Inicializar README.md
                const readmeContent = `# Workspace ${res.dirName}\n\nWorkspace individual e isolado criado pelo bot WhatsApp do Shark AI.\n`;
                await fs.writeFile(path.join(targetDir, 'README.md'), readmeContent, 'utf-8');

                if (onProgress) {
                    await onProgress('✅ *Workspace configurado com sucesso! Iniciando atendimento...*');
                }

                return targetDir;
            } finally {
                this.inFlightInits.delete(chatId);
            }
        })();

        this.inFlightInits.set(chatId, initPromise);
        return initPromise;
    }
}
```

Atualizar `src/core/index.ts` para exportar o novo módulo:
```typescript
export * from './workspace/session-workspace-manager.js';
```

- [ ] **Step 4: Executar testes para verificar aprovação**

Comando: `npx vitest run src/core/workspace/session-workspace-manager.test.ts`  
Resultado esperado: PASS (4 tests passing)

- [ ] **Step 5: Commit das alterações da Task 1**

```bash
git add src/core/workspace/ src/core/index.ts
git commit -m "feat(core): add SessionWorkspaceManager with auto-init and test suite"
```

---

### Task 2: Integrar o `SessionWorkspaceManager` no WhatsApp Bot

**Files:**
- Modify: `examples/whatsapp-bot/src/index.ts`
- Modify: `examples/whatsapp-bot/README.md`

**Interfaces:**
- Consumes:
  - `SessionWorkspaceManager` de `src/core/index.js`
  - `AgentEngine.setSessionWorkspace(sessionId, path)`
  - `AgentEngine.getSessionWorkspace(sessionId)`

- [ ] **Step 1: Atualizar `examples/whatsapp-bot/src/index.ts`**

Substituir o gerenciamento de workspace global pelo `SessionWorkspaceManager`:
1. Instanciar `const workspaceManager = new SessionWorkspaceManager();`
2. No loop de `messages.upsert`:
   - Chamar `await workspaceManager.ensureWorkspace(chatId, async (msg) => transport.sendText(chatId, msg));`
   - Associar a sessão: `const sessionId = 'whatsapp:dm:' + chatId;` e `engine.setSessionWorkspace(sessionId, wsPath);`
   - Atualizar `/pwd` e `/workspace` para responder com `engine.getSessionWorkspace(sessionId)`
   - Atualizar `/use <caminho>` e `/workspace <caminho>` para alterar somente `engine.setSessionWorkspace(sessionId, resolved)`
3. Preservar o fallback para `process.env.SHARK_PROJECT_ROOT` caso alguém passe um diretório fixo.

- [ ] **Step 2: Atualizar `examples/whatsapp-bot/README.md`**

Documentar as novas variáveis e o comportamento de workspaces isolados por usuário/grupo (`SHARK_WORKSPACES_ROOT`, `workspaces/user_<tel>`, `workspaces/group_<id>`).

- [ ] **Step 3: Testar e verificar compilação e execução**

Executar verificação de tipos e testes do projeto:
Comando: `npm run build`
Comando: `npm test`
Resultado esperado: Build e testes passam com sucesso.

- [ ] **Step 4: Commit das alterações da Task 2**

```bash
git add examples/whatsapp-bot/
git commit -m "feat(whatsapp-bot): isolate workspaces per user and group with auto provisioning"
```
