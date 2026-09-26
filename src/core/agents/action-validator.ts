export interface ActionValidationResult {
    isValid: boolean;
    errorMessage?: string;
    candidateTool?: string;
}

export interface NativeToolDefinition {
    description: string;
    required: string[];
    optional?: string[];
    exampleArgs: Record<string, any>;
    recoveryHint?: string;
}

export const NATIVE_TOOLS_REGISTRY: Record<string, NativeToolDefinition> = {
    read_file: {
        description: 'Lê o conteúdo de um arquivo em disco com marcadores de linha e âncoras.',
        required: ['path'],
        exampleArgs: { path: 'src/routes/index.tsx' }
    },
    modify_file: {
        description: 'Substitui um trecho do arquivo identificado por âncoras exatas de início e fim.',
        required: ['path', 'start_anchor', 'end_anchor', 'content'],
        exampleArgs: {
            path: 'src/components/Header.tsx',
            start_anchor: 'anchor_start_word',
            end_anchor: 'anchor_end_word',
            content: 'export function Header() { return <div>Updated</div>; }'
        },
        recoveryHint: 'Se você ainda não inspecionou o arquivo, execute read_file primeiro para obter as palavras-âncora.'
    },
    create_file: {
        description: 'Cria ou sobrescreve completamente um arquivo no caminho especificado.',
        required: ['path', 'content'],
        exampleArgs: { path: 'src/utils/helpers.ts', content: 'export const sum = (a: number, b: number) => a + b;' }
    },
    delete_file: {
        description: 'Remove um arquivo do sistema de arquivos.',
        required: ['path'],
        exampleArgs: { path: 'temp/cache.json' }
    },
    list_files: {
        description: 'Lista arquivos e diretórios recursivamente a partir do caminho informado.',
        required: [],
        optional: ['path'],
        exampleArgs: { path: '.' }
    },
    search_code: {
        description: 'Busca por texto exato ou regex no código-fonte.',
        required: ['query'],
        optional: ['path', 'is_regex'],
        exampleArgs: { query: 'function authenticate', path: 'src/' }
    },
    search_file: {
        description: 'Busca arquivos pelo nome no repositório.',
        required: ['query'],
        optional: ['path'],
        exampleArgs: { query: 'package.json' }
    },
    run_command: {
        description: 'Executa um comando no terminal do sistema operacional.',
        required: ['command'],
        exampleArgs: { command: 'npm test' }
    },
    process: {
        description: 'Gerencia subprocessos assíncronos e interativos.',
        required: ['action'],
        optional: ['process_id', 'data', 'lines', 'offset'],
        exampleArgs: { action: 'list' }
    },
    send_file: {
        description: 'Envia um arquivo ou mídia para o usuário.',
        required: ['path'],
        optional: ['caption'],
        exampleArgs: { path: 'reports/summary.pdf', caption: 'Relatório final' }
    },
    tool_search: {
        description: 'Pesquisa ferramentas MCP no catálogo ativo usando busca léxica BM25.',
        required: ['queries'],
        optional: ['limit'],
        exampleArgs: { queries: ['database query'] }
    },
    tool_describe: {
        description: 'Obtém o schema JSON e descrição detalhada de ferramentas MCP sob demanda.',
        required: ['names'],
        exampleArgs: { names: ['mcp_sqlite_query'] }
    },
    tool_call: {
        description: 'Executa uma ferramenta MCP com seus respectivos argumentos.',
        required: ['name'],
        optional: ['arguments'],
        exampleArgs: { name: 'mcp_sqlite_query', arguments: { query: 'SELECT 1;' } }
    },
    skills_list: {
        description: 'Lista todas as habilidades instaladas no repositório.',
        required: [],
        optional: ['query'],
        exampleArgs: {}
    },
    skill_view: {
        description: 'Visualiza as instruções de uma habilidade específica.',
        required: ['name'],
        optional: ['file_path'],
        exampleArgs: { name: 'brainstorming' }
    },
    talk_with_user: {
        description: 'Envia uma mensagem direta de conversa ou pergunta para o usuário humano.',
        required: ['content'],
        exampleArgs: { content: 'Olá! Como posso ajudar você hoje?' }
    },
    complete_task: {
        description: 'Conclui a tarefa atual com o resumo e detalhes do trabalho realizado.',
        required: [],
        optional: ['summary', 'content'],
        exampleArgs: { summary: 'Tarefa finalizada com sucesso.', content: 'Todos os testes foram executados e passaram.' }
    }
};

export class ActionValidator {
    static validate(parsedObj: any, bridgeToolsManager?: any): ActionValidationResult {
        if (!parsedObj || typeof parsedObj !== 'object') {
            return {
                isValid: false,
                errorMessage: ActionValidator.formatEnvelopeError('A resposta não é um objeto JSON válido.', undefined, bridgeToolsManager)
            };
        }

        // Support legacy actions array
        const candidateAction = parsedObj.action || (Array.isArray(parsedObj.actions) && parsedObj.actions.length > 0 ? parsedObj.actions[0] : undefined);

        // Detect flat action representation e.g. { "action": "read_file", ... }
        if (typeof parsedObj.action === 'string') {
            const toolName = parsedObj.action.trim();
            return {
                isValid: false,
                candidateTool: toolName,
                errorMessage: ActionValidator.formatEnvelopeError(
                    `Você enviou uma chamada plana com "action": "${toolName}". Todas as ações DEVEM seguir o envelope padrão com bloco 'action' contendo 'type' e 'args'.`,
                    toolName,
                    bridgeToolsManager
                )
            };
        }

        // Detect root-level action e.g. { "type": "read_file", "path": "..." } without action envelope
        if (!parsedObj.action && (!parsedObj.actions || parsedObj.actions.length === 0) && typeof parsedObj.type === 'string') {
            const toolName = parsedObj.type.trim();
            return {
                isValid: false,
                candidateTool: toolName,
                errorMessage: ActionValidator.formatEnvelopeError(
                    `Você enviou a propriedade "type": "${toolName}" na raiz. Todas as ações DEVEM estar aninhadas no objeto "action": { "type": "...", "args": { ... } }.`,
                    toolName,
                    bridgeToolsManager
                )
            };
        }

        const action = candidateAction;
        if (!action || typeof action !== 'object' || typeof action.type !== 'string' || !action.type.trim()) {
            const content = parsedObj.message || (typeof parsedObj === 'object' ? JSON.stringify(parsedObj) : String(parsedObj));
            return {
                isValid: false,
                errorMessage: `[SYSTEM ERROR]: Nenhum bloco 'action' foi fornecido na sua resposta JSON. Você deve obrigatoriamente especificar uma ação com a ferramenta a ser executada (ex: read_file, create_file, modify_file, run_command, search_code, complete_task). Conteúdo recebido: ${content}`
            };
        }

        const toolName = action.type.trim();
        const args = (action.args && typeof action.args === 'object') ? action.args : (action.arguments && typeof action.arguments === 'object' ? action.arguments : {});

        // Check if native tool
        const nativeDef = NATIVE_TOOLS_REGISTRY[toolName];
        if (nativeDef) {
            for (const reqField of nativeDef.required) {
                const val = args[reqField] ?? action[reqField];
                if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
                    return {
                        isValid: false,
                        candidateTool: toolName,
                        errorMessage: ActionValidator.formatParameterError(toolName, `Parâmetro obrigatório '${reqField}' ausente ou vazio em 'args'.`, nativeDef)
                    };
                }
            }
            return { isValid: true, candidateTool: toolName };
        }

        // Check if MCP tool called via tool_call
        if (toolName === 'tool_call') {
            const mcpName = args.name || action.name;
            if (!mcpName) {
                return {
                    isValid: false,
                    candidateTool: 'tool_call',
                    errorMessage: ActionValidator.formatParameterError('tool_call', "Parâmetro 'name' é obrigatório em 'tool_call'.", NATIVE_TOOLS_REGISTRY['tool_call'])
                };
            }
            return { isValid: true, candidateTool: 'tool_call' };
        }

        // Check if MCP tool called directly
        if (bridgeToolsManager && bridgeToolsManager.isBridgeTool(toolName)) {
            // Advise wrapping in tool_call or describe MCP tool schema
            const mcpDesc = ActionValidator.getMcpToolDescribe(toolName, bridgeToolsManager);
            return {
                isValid: false,
                candidateTool: toolName,
                errorMessage: ActionValidator.formatMcpDirectCallError(toolName, mcpDesc)
            };
        }

        // Other action types pass to Zod schema validation
        return { isValid: true, candidateTool: toolName };
    }

    private static getMcpToolDescribe(toolName: string, bridgeToolsManager: any): any {
        try {
            if (bridgeToolsManager?.executeToolDescribe) {
                const res = bridgeToolsManager.executeToolDescribe({ names: [toolName] });
                if (res?.success && res?.output?.tools?.[toolName]) {
                    return res.output.tools[toolName];
                }
            }
        } catch {}
        return null;
    }

    static formatEnvelopeError(reason: string, toolName?: string, bridgeToolsManager?: any): string {
        let toolSection = '';
        if (toolName) {
            if (NATIVE_TOOLS_REGISTRY[toolName]) {
                const def = NATIVE_TOOLS_REGISTRY[toolName];
                toolSection = `\n\n💡 SCHEMA DA FERRAMENTA '${toolName}':\nDescrição: ${def.description}\nParâmetros obrigatórios em 'args': ${JSON.stringify(def.required)}\n\n💡 EXEMPLO DE USO CORRETO:\n${JSON.stringify({
                    thought: `Executando ${toolName}...`,
                    action: {
                        type: toolName,
                        args: def.exampleArgs
                    },
                    summary: `Chamando ${toolName}.`
                }, null, 2)}`;
            } else if (bridgeToolsManager && bridgeToolsManager.isBridgeTool(toolName)) {
                const mcpDesc = ActionValidator.getMcpToolDescribe(toolName, bridgeToolsManager);
                toolSection = `\n\n💡 SCHEMA DA FERRAMENTA MCP '${toolName}' (tool_describe automático):\n${JSON.stringify(mcpDesc || { name: toolName }, null, 2)}\n\n💡 EXEMPLO DE USO CORRETO VIA 'tool_call':\n${JSON.stringify({
                    thought: `Executando ferramenta MCP ${toolName}...`,
                    action: {
                        type: 'tool_call',
                        args: {
                            name: toolName,
                            arguments: {}
                        }
                    },
                    summary: `Chamando MCP ${toolName}.`
                }, null, 2)}`;
            }
        }

        return `[SYSTEM ERROR]: Formato de envelope de ação inválido.\nMotivo: ${reason}\n\n📋 ENVELOPE OBRIGATÓRIO:\n{\n  "thought": "Explicação detalhada do raciocínio...",\n  "action": {\n    "type": "nome_da_ferramenta",\n    "args": { /* parâmetros */ }\n  },\n  "summary": "Resumo de 1 frase."\n}${toolSection}`;
    }

    static formatParameterError(toolName: string, reason: string, def: NativeToolDefinition): string {
        const hint = def.recoveryHint ? `\n💡 DICA DE RECUPERAÇÃO:\n${def.recoveryHint}` : '';
        return `[SYSTEM ERROR]: [Action ${toolName} Failed]: Parâmetros inválidos em 'args'.\nMotivo: ${reason}\n\nCampos obrigatórios em 'args': ${JSON.stringify(def.required)}\n\n💡 EXEMPLO DE USO CORRETO:\n${JSON.stringify({
            thought: `Executando ${toolName}...`,
            action: {
                type: toolName,
                args: def.exampleArgs
            },
            summary: `Chamando ${toolName}.`
        }, null, 2)}${hint}`;
    }

    static formatMcpDirectCallError(toolName: string, mcpDesc: any): string {
        return `[SYSTEM ERROR]: A ferramenta '${toolName}' é uma extensão MCP e deve ser executada através do envelope 'tool_call'.\n\n💡 SCHEMA DA FERRAMENTA (tool_describe automático):\n${JSON.stringify(mcpDesc || { name: toolName }, null, 2)}\n\n💡 EXEMPLO DE USO CORRETO:\n${JSON.stringify({
            thought: `Executando ferramenta MCP ${toolName}...`,
            action: {
                type: 'tool_call',
                args: {
                    name: toolName,
                    arguments: {}
                }
            },
            summary: `Chamando ferramenta MCP ${toolName}.`
        }, null, 2)}`;
    }

    static formatUnknownToolError(toolName: string): string {
        const validTools = Object.keys(NATIVE_TOOLS_REGISTRY).join(', ');
        return `[SYSTEM ERROR]: Ação desconhecida '${toolName}'.\n\nFerramentas nativas disponíveis: [${validTools}].\n💡 DICA: Para ferramentas MCP adicionais, execute 'tool_search' com termos em linguagem natural para localizar o nome exato.`;
    }
}
