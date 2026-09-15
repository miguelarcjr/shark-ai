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
});
