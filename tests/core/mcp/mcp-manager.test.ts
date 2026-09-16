import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpManager } from '../../../src/core/mcp/mcp-manager.js';

describe('McpManager', () => {
  let mcpManager: McpManager;

  beforeEach(() => {
    mcpManager = new McpManager();
  });

  it('deve registrar configurações de servidor e expor catálogo vazio se não houver servidores', async () => {
    const tools = await mcpManager.initialize({});
    expect(tools).toEqual([]);
    expect(mcpManager.hasActiveServers()).toBe(false);
  });

  it('deve registrar e executar ferramentas mapeadas', async () => {
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'query_db',
            description: 'Execute read-only SQL query',
            inputSchema: {
              type: 'object',
              properties: { sql: { type: 'string' } },
              required: ['sql']
            }
          }
        ]
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Resultado: 42' }]
      }),
      close: vi.fn().mockResolvedValue(undefined)
    };

    // Injetar mock no loader
    mcpManager.registerMockClient('postgres', mockClient as any);

    const tools = await mcpManager.initialize({
      postgres: { command: 'node', args: ['dummy.js'] }
    });

    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('mcp_postgres_query_db');
    expect(tools[0].source).toBe('postgres');

    const result = await mcpManager.executeTool('mcp_postgres_query_db', { sql: 'SELECT 1;' });
    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'query_db',
      arguments: { sql: 'SELECT 1;' }
    });
    expect(result).toBe('Resultado: 42');

    await mcpManager.closeAll();
    expect(mockClient.close).toHaveBeenCalled();
  });

  it('deve formatar erro amigável se a ferramenta não pertencer a nenhum servidor conectado', async () => {
    await expect(mcpManager.executeTool('mcp_desconhecido', {})).rejects.toThrow(
      "A ferramenta MCP 'mcp_desconhecido' não pertence a nenhum servidor ativo."
    );
  });

  it('deve conectar a um servidor MCP via HTTP (Streamable HTTP), descobrir ferramentas e executá-las', async () => {
    const http = await import('node:http');
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
    const { z } = await import('zod');

    // 1. Iniciar servidor MCP HTTP local
    const serverMcp = new McpServer({ name: 'remote-http-calc', version: '1.0.0' });
    serverMcp.tool(
      'add_numbers',
      { a: z.number(), b: z.number() },
      async ({ a, b }) => ({
        content: [{ type: 'text', text: `Resultado da soma: ${a + b}` }]
      })
    );

    let serverTransport: any;
    const httpServer = http.createServer(async (req, res) => {
      if (req.url === '/mcp') {
        if (!serverTransport) {
          serverTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => 'test-session-123'
          });
          await serverMcp.connect(serverTransport);
        }
        await serverTransport.handleRequest(req, res);
      } else {
        res.writeHead(404).end();
      }
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (httpServer.address() as any).port;
    const httpUrl = `http://127.0.0.1:${port}/mcp`;

    try {
      // 2. Conectar McpManager ao servidor via HTTP
      const tools = await mcpManager.initialize({
        'calc-service': {
          type: 'http',
          url: httpUrl
        }
      });

      expect(mcpManager.hasActiveServers()).toBe(true);
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('mcp_calc-service_add_numbers');
      expect(tools[0].source).toBe('calc-service');

      // 3. Executar ferramenta descoberta via HTTP
      const result = await mcpManager.executeTool('mcp_calc-service_add_numbers', { a: 15, b: 27 });
      expect(result).toBe('Resultado da soma: 42');

      // 4. Fechar conexões
      await mcpManager.closeAll();
      expect(mcpManager.hasActiveServers()).toBe(false);
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it('deve lidar com falha de conexão HTTP sem quebrar o McpManager', async () => {
    // Porta que não existe
    const tools = await mcpManager.initialize({
      'unreachable-service': {
        type: 'http',
        url: 'http://127.0.0.1:59999/mcp'
      }
    });

    expect(tools).toEqual([]);
    expect(mcpManager.hasActiveServers()).toBe(false);
  });
});
