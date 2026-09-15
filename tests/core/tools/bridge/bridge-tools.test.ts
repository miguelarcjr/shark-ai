import { describe, it, expect, vi } from 'vitest';
import { BridgeToolsManager } from '../../../../src/core/tools/bridge/bridge-tools.js';
import { ToolCatalogSearch } from '../../../../src/core/tools/bridge/tool-catalog-search.js';

describe('BridgeToolsManager', () => {
  const tools = [{
    name: 'mcp_math_add',
    source: 'math',
    description: 'Add two numbers',
    parameters: { a: { type: 'number' }, b: { type: 'number' } }
  }];
  const catalog = new ToolCatalogSearch(tools);
  const mockExecutor = vi.fn().mockResolvedValue({ sum: 42 });

  it('executeToolSearch deve retornar ferramentas encontradas com dica de próximo passo', async () => {
    const manager = new BridgeToolsManager(catalog, mockExecutor);
    const res = await manager.executeToolSearch({ queries: ['add numbers'] });
    expect(res.success).toBe(true);
    expect(res.output.results.length).toBeGreaterThan(0);
    expect(res.output.hint).toContain('tool_describe');
  });

  it('executeToolDescribe deve carregar schema em lote com dica de tool_call', async () => {
    const manager = new BridgeToolsManager(catalog, mockExecutor);
    const res = await manager.executeToolDescribe({ names: ['mcp_math_add'] });
    expect(res.success).toBe(true);
    expect(res.output.tools.mcp_math_add).toBeDefined();
    expect(res.output.hint).toContain('tool_call');
  });

  it('executeToolCall deve desembrulhar e repassar parâmetros para o executor real', async () => {
    const manager = new BridgeToolsManager(catalog, mockExecutor);
    const res = await manager.executeToolCall({ name: 'mcp_math_add', arguments: { a: 20, b: 22 } });
    expect(res.success).toBe(true);
    expect(mockExecutor).toHaveBeenCalledWith('mcp_math_add', { a: 20, b: 22 });
  });

  it('executeToolCall deve rejeitar com erro instrucional se a ferramenta não existir', async () => {
    const manager = new BridgeToolsManager(catalog, mockExecutor);
    const res = await manager.executeToolCall({ name: 'mcp_inexistente', arguments: {} });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Action tool_call Failed');
    expect(res.error).toContain('tool_search');
  });
});
