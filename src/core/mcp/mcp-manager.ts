import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { DeferredToolEntry } from '../tools/bridge/tool-catalog-search.js';
import { FileLogger } from '../debug/file-logger.js';

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  type?: 'stdio' | 'http' | 'sse' | 'streamableHttp' | string;
  headers?: Record<string, string>;
}

export class McpManager {
  private clients: Map<string, { client: Client; transport?: any }> = new Map();
  private mockClients: Map<string, Client> = new Map();
  private toolMappings: Map<string, { serverName: string; originalName: string }> = new Map();

  public registerMockClient(serverName: string, client: Client): void {
    this.mockClients.set(serverName, client);
  }

  public hasActiveServers(): boolean {
    return this.clients.size > 0;
  }

  public async initialize(serversConfig: Record<string, McpServerConfig> = {}): Promise<DeferredToolEntry[]> {
    const discoveredTools: DeferredToolEntry[] = [];
    this.toolMappings.clear();

    for (const [serverName, config] of Object.entries(serversConfig)) {
      try {
        let client: Client;

        if (this.mockClients.has(serverName)) {
          client = this.mockClients.get(serverName)!;
          await client.connect({} as any);
          this.clients.set(serverName, { client });
        } else if (config.command) {
          FileLogger.log('MCP', `Conectando ao servidor stdio: ${serverName} (${config.command})`);
          const transport = new StdioClientTransport({
            command: config.command,
            args: config.args || [],
            env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
            cwd: config.cwd || process.cwd()
          });

          client = new Client(
            { name: 'shark-dev', version: '0.5.0' },
            { capabilities: {} }
          );

          await client.connect(transport);
          this.clients.set(serverName, { client, transport });
        } else if (config.url) {
          FileLogger.log('MCP', `Conectando ao servidor HTTP/SSE: ${serverName} (${config.url})`);
          const url = new URL(config.url);
          const requestInit = config.headers ? { headers: config.headers } : undefined;

          const transport = config.type === 'sse'
            ? new SSEClientTransport(url, requestInit ? { requestInit } : undefined)
            : new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined);

          client = new Client(
            { name: 'shark-dev', version: '0.5.0' },
            { capabilities: {} }
          );

          await client.connect(transport);
          this.clients.set(serverName, { client, transport });
        } else {
          FileLogger.log('MCP', `Servidor ${serverName} ignorado (transporte não suportado ou sem comando/url).`);
          continue;
        }

        const toolsResult = await client.listTools();
        if (toolsResult && Array.isArray(toolsResult.tools)) {
          for (const tool of toolsResult.tools) {
            const prefixedName = tool.name.startsWith('mcp_')
              ? tool.name
              : `mcp_${serverName}_${tool.name}`;

            this.toolMappings.set(prefixedName, {
              serverName,
              originalName: tool.name
            });

            discoveredTools.push({
              name: prefixedName,
              source: serverName,
              description: tool.description || `Tool from ${serverName} MCP server`,
              parameters: (tool.inputSchema as any)?.properties || {}
            });
          }
        }
      } catch (err: any) {
        FileLogger.log('MCP', `Erro ao conectar ao servidor ${serverName}: ${err?.message}`);
        console.warn(`⚠️ [Shark AI / MCP] Falha ao inicializar servidor '${serverName}': ${err?.message}`);
      }
    }

    return discoveredTools;
  }

  public async executeTool(toolName: string, args: Record<string, any>): Promise<any> {
    const mapping = this.toolMappings.get(toolName);
    if (!mapping) {
      throw new Error(`A ferramenta MCP '${toolName}' não pertence a nenhum servidor ativo.`);
    }

    const serverEntry = this.clients.get(mapping.serverName);
    if (!serverEntry) {
      throw new Error(`O servidor MCP '${mapping.serverName}' não está conectado.`);
    }

    const res = await serverEntry.client.callTool({
      name: mapping.originalName,
      arguments: args
    });

    if (res && res.isError) {
      const errorText = Array.isArray(res.content)
        ? res.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
        : 'Erro na execução da ferramenta MCP.';
      throw new Error(errorText);
    }

    if (res && Array.isArray(res.content)) {
      return res.content
        .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
        .join('\n');
    }

    return res;
  }

  public async closeAll(): Promise<void> {
    for (const [serverName, entry] of this.clients.entries()) {
      try {
        await entry.client.close();
      } catch (e: any) {
        FileLogger.log('MCP', `Erro ao fechar servidor ${serverName}: ${e?.message}`);
      }
    }
    this.clients.clear();
    this.toolMappings.clear();
  }
}
