import { describe, it, expect } from 'vitest';
import { generateTieredManifest } from '../../../../src/core/tools/bridge/tiered-disclosure.js';
import { DeferredToolEntry } from '../../../../src/core/tools/bridge/tool-catalog-search.js';

describe('generateTieredManifest', () => {
  it('Tier 1: deve truncar descrições em 60 caracteres no catálogo normal', () => {
    const tools: DeferredToolEntry[] = [{
      name: 'tool_a',
      source: 'src1',
      description: 'Esta é uma descrição extremamente longa que ultrapassa com certeza o limite de sessenta caracteres'
    }];
    const res = generateTieredManifest(tools, { listingMaxTokens: 4000 });
    expect(res.tier).toBe(1);
    expect(res.isNamesOnly).toBe(false);
    expect(res.manifestText).toContain('tool_a');
    expect(res.manifestText.length).toBeLessThan(120);
  });

  it('Fallback Names-Only: deve remover descrições se ultrapassar orçamento moderado', () => {
    const tools: DeferredToolEntry[] = Array.from({ length: 50 }, (_, i) => ({
      name: `tool_number_${i}`,
      source: 'srv',
      description: 'Descrição de teste média para a ferramenta'
    }));
    // Orçamento que rejeita descrições (~560 tokens) mas aceita apenas nomes (~190 tokens)
    const res = generateTieredManifest(tools, { listingMaxTokens: 250 });
    expect(res.isNamesOnly).toBe(true);
    expect(res.manifestText).toContain('tool_number_0');
    expect(res.manifestText).not.toContain('Descrição de teste');
  });

  it('Tier 2: deve resumir por servidor se estourar até mesmo a lista de nomes', () => {
    const tools: DeferredToolEntry[] = Array.from({ length: 200 }, (_, i) => ({
      name: `mass_tool_${i}`,
      source: 'massive_server',
      description: 'Desc'
    }));
    const res = generateTieredManifest(tools, { listingMaxTokens: 10 });
    expect(res.tier).toBe(2);
    expect(res.manifestText).toContain('massive_server: 200 tools');
  });
});
