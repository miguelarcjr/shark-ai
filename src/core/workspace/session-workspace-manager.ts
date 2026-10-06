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
        // Sanitiza caracteres especiais extraindo o prefixo antes do arroba
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
            // Garante auto-cura caso a pasta já exista mas falte o shark-workflow.json na raiz
            const rootWorkflow = path.join(res.fullPath, 'shark-workflow.json');
            if (!existsSync(rootWorkflow)) {
                const legacyWorkflow = path.join(res.fullPath, '.shark', 'workflow.json');
                if (existsSync(legacyWorkflow)) {
                    await fs.copyFile(legacyWorkflow, rootWorkflow).catch(() => {});
                }
            }
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

                // 2. Inicializar shark-workflow.json na raiz e .shark/workflow.json
                const sharkDir = path.join(targetDir, '.shark');
                await fs.mkdir(sharkDir, { recursive: true });
                const workflowState = {
                    projectId: `ws-${res.dirName}`,
                    projectName: res.dirName,
                    techStack: 'unknown',
                    currentStage: 'business_analysis',
                    stageStatus: 'pending',
                    lastUpdated: new Date().toISOString(),
                    artifacts: [],
                    metadata: {
                        initializedBy: 'shark-whatsapp-workspace-manager',
                        version: '0.1.0'
                    }
                };
                const workflowJsonStr = JSON.stringify(workflowState, null, 2);
                await fs.writeFile(
                    path.join(targetDir, 'shark-workflow.json'),
                    workflowJsonStr,
                    'utf-8'
                );
                await fs.writeFile(
                    path.join(sharkDir, 'workflow.json'),
                    workflowJsonStr,
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
