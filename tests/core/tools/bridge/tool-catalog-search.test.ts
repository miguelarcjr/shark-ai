import { describe, it, expect } from 'vitest';
import { ToolCatalogSearch, DeferredToolEntry } from '../../../../src/core/tools/bridge/tool-catalog-search.js';

describe('ToolCatalogSearch', () => {
  const sampleTools: DeferredToolEntry[] = [
    {
      name: 'mcp_github_create_issue',
      source: 'github',
      description: 'Creates a new issue in a GitHub repository',
      parameters: { title: { type: 'string' }, body: { type: 'string' } }
    },
    {
      name: 'mcp_slack_post_message',
      source: 'slack',
      description: 'Send messages to Slack channels',
      parameters: { channel: { type: 'string' }, text: { type: 'string' } }
    }
  ];

  it('deve localizar ferramenta via BM25 e palavras-chave (inclusive plural)', () => {
    const catalog = new ToolCatalogSearch(sampleTools);
    const res = catalog.search(['create issues']);
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0].name).toBe('mcp_github_create_issue');
  });

  it('deve localizar ferramenta por busca literal de substring na ausência de BM25', () => {
    const catalog = new ToolCatalogSearch(sampleTools);
    const res = catalog.search(['hub']);
    expect(res.results.some(r => r.name === 'mcp_github_create_issue')).toBe(true);
  });

  it('deve retornar available_sources quando nada for encontrado', () => {
    const catalog = new ToolCatalogSearch(sampleTools);
    const res = catalog.search(['ferramenta_totalmente_inexistente_12345']);
    expect(res.results.length).toBe(0);
    expect(res.available_sources).toEqual(['github', 'slack']);
  });
});
