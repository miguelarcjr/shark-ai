import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';
import { getActiveRealm } from '../auth/get-active-realm.js';
import { tokenStorage } from '../auth/token-storage.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import { parseAgentResponse, AgentAction, AgentResponse } from './agent-response-parser.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { handleReadFile, handleListFiles, handleSearchFile, handleRunCommand } from './agent-tools.js';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ConfigManager } from '../config-manager.js';

const AGENT_TYPE = 'qa_agent';

function getAgentId(): string {
    const config = ConfigManager.getInstance().getConfig();
    if (config.agents?.qa) return config.agents.qa;
    return process.env.STACKSPOT_QA_AGENT_ID || '01KEQFJZ3Q3JER11NH22HEZX9X';
}

function getAgentVersion(): string | undefined {
    const config: any = ConfigManager.getInstance().getConfig();
    if (config.agentVersions?.qa) return config.agentVersions.qa;
    return process.env.STACKSPOT_QA_AGENT_VERSION;
}

interface QAAgentOptions {
    initialUrl?: string;
    scenario?: string;
}

// MCP Client Wrapper
class ChromeDevToolsClient {
    private client: Client | null = null;
    private transport: StdioClientTransport | null = null;

    async connect() {
        if (this.client) return;

        try {
            this.transport = new StdioClientTransport({
                command: 'npx',
                args: ['-y', 'chrome-devtools-mcp@latest']
            });

            this.client = new Client({
                name: "shark-qa-client",
                version: "1.0.0"
            }, {
                capabilities: {}
            });

            await this.client.connect(this.transport);
            tui.log.success('🔌 Connected to Chrome DevTools MCP');
        } catch (e: any) {
            tui.log.error(`Failed to connect to Chrome MCP: ${e.message}`);
            throw e;
        }
    }

    async callTool(name: string, args: any) {
        if (!this.client) await this.connect();
        try {
            const result = await this.client!.callTool({
                name,
                arguments: args
            });
            return result;
        } catch (e: any) {
            return { isError: true, content: [{ type: 'text', text: `MCP Error: ${e.message}` }] };
        }
    }

    async close() {
        if (this.transport) {
            await this.transport.close();
        }
    }
}

const mcpClient = new ChromeDevToolsClient();

export async function runQAAgent(options: QAAgentOptions) {
    const isStackSpot = ConfigManager.getInstance().getConfig().provider === 'stackspot';
    const agentId = getAgentId();

    if (isStackSpot && !agentId) {
        tui.log.error('❌ STACKSPOT_QA_AGENT_ID not configured.');
        tui.log.info('Please run: set STACKSPOT_QA_AGENT_ID=<your-id>');
        return;
    }

    // Connect to MCP at start
    await mcpClient.connect();

    tui.intro('🦈 Shark QA Agent');
    tui.log.info('Connecting to Chrome DevTools...');

    if (isStackSpot) {
        const realm = await getActiveRealm();
        const token = await tokenStorage.getToken(realm);

        if (!token) {
            tui.log.error('Authentication required. Run "shark login".');
            return;
        }
    }

    // 1. Prepare Initial Context
    let projectContext = "";
    try {
        const contextPath = path.join(process.cwd(), '_sharkrc', 'project-context.md');
        if (fs.existsSync(contextPath)) {
            projectContext = fs.readFileSync(contextPath, 'utf-8');
            tui.log.info(`📘 Context loaded from: _sharkrc/project-context.md`);
        }
    } catch (e) {
        // Ignore if no context
    }

    let userMessage = `CONTEXTO DO PROJETO:\n${projectContext}\n\n`;

    if (options.initialUrl) {
        userMessage += `URL ALVO: ${options.initialUrl}\n`;
    }
    if (options.scenario) {
        userMessage += `CENÁRIO DE TESTE: ${options.scenario}\n`;
    } else {
        userMessage += `Por favor, aguarde instruções do usuário.`;
    }

    // 2. Interaction Loop
    let keepRunning = true;

    while (keepRunning) {
        const spinner = tui.spinner();
        spinner.start('🤖 Shark QA is thinking...');

        let agentResponseText = "";
        let agentResponse: AgentResponse | null = null;

        try {
            // API Interaction
            const existingConversationId = await conversationManager.getConversationId(AGENT_TYPE);
            const provider = ProviderResolver.getProvider('qa_agent');

            agentResponse = await provider.streamChat(userMessage, {
                conversationId: existingConversationId,
                agentType: 'qa_agent',
                onChunk: (chunk: string) => {
                    agentResponseText += chunk;
                    if (agentResponseText.length > 10 && agentResponseText.trim().startsWith('{')) {
                        spinner.message('Receiving structured plan...');
                    }
                }
            });

            if (agentResponse && agentResponse.conversation_id) {
                await conversationManager.saveConversationId(AGENT_TYPE, agentResponse.conversation_id);
            }

            spinner.stop('Response Received');

        } catch (error) {
            spinner.stop('Communication Error', 1);
            tui.log.error((error as Error).message);
            keepRunning = false;
            break;
        }

        const currentResponse = agentResponse as AgentResponse | null;
        if (!currentResponse) continue;

        // 3. Handle Actions
        if (currentResponse.summary) {
            tui.log.info(colors.primary(`📋 Plan: ${currentResponse.summary}`));
        }

        if (currentResponse.actions.length === 0) {
            // No actions usually means it's waiting for user or finished
            const reply = await tui.text({
                message: "🤖 Shark QA:",
                placeholder: "Your reply..."
            });

            if (tui.isCancel(reply)) {
                keepRunning = false;
            } else {
                userMessage = reply as string;
            }
            continue;
        }

        for (const action of currentResponse.actions) {
            tui.log.info(colors.dim(`Executing: ${action.type}`));

            let result = "";

            try {
                switch (action.type) {
                    case 'talk_with_user':
                        const reply = await tui.text({
                            message: `🤖 ${action.content}`,
                        });
                        if (tui.isCancel(reply)) keepRunning = false;
                        else result = reply as string;
                        break;

                    case 'use_mcp_tool':
                        if (action.tool_name) {
                            tui.log.info(`🔧 MCP Tool: ${colors.bold(action.tool_name)}`);
                            let args = {};
                            try {
                                args = typeof action.tool_args === 'string'
                                    ? JSON.parse(action.tool_args)
                                    : (action.tool_args || {});
                            } catch (e) {
                                tui.log.warning('Failed to parse tool_args, using empty object');
                            }
                            const mcpResult = await mcpClient.callTool(action.tool_name, args);
                            result = JSON.stringify(mcpResult);
                            // Brief preview
                            tui.log.success(`Result: ${result.substring(0, 100)}...`);
                        }
                        break;

                    case 'create_file':
                        if (action.path && action.content) {
                            const fullPath = path.resolve(process.cwd(), action.path);
                            const BOM = '\uFEFF';
                            const contentToWrite = action.content;
                            const finalContent = contentToWrite.startsWith(BOM) ? contentToWrite : BOM + contentToWrite;
                            fs.writeFileSync(fullPath, finalContent, { encoding: 'utf-8' });
                            tui.log.success(`File created: ${action.path}`);
                            result = "File created successfully.";
                        }
                        break;

                    case 'read_file':
                        result = handleReadFile(action.path || '');
                        break;

                    case 'run_command':
                        // Safety check?
                        const confirm = await tui.confirm({ message: `Run command: ${action.command}?` });
                        if (confirm && action.command) {
                            result = await handleRunCommand(action.command);
                        } else {
                            result = "Command execution denied by user.";
                        }
                        break;

                    default:
                        result = `Action ${action.type} not fully implemented in local client.`;
                }
            } catch (e: any) {
                result = `Error executing ${action.type}: ${e.message}`;
                tui.log.error(result);
            }

            // Feed result back to agent
            userMessage = `[Action ${action.type} Result]:\n${result}\n\n`;
        }
    }

    await mcpClient.close();
    tui.outro('🦈 Shark QA Session Ended');
}
