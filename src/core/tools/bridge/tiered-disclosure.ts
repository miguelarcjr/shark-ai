import { DeferredToolEntry } from './tool-catalog-search.js';

export interface TieredDisclosureOptions {
  listingMaxTokens?: number; // default: 4000
  contextWindow?: number;    // default: 128000
}

export function generateTieredManifest(
  tools: DeferredToolEntry[],
  options?: TieredDisclosureOptions
): { manifestText: string; tier: 1 | 2; isNamesOnly: boolean } {
  if (!tools || tools.length === 0) {
    return { manifestText: '', tier: 1, isNamesOnly: false };
  }

  const contextWindow = options?.contextWindow || 128000;
  const configuredMaxTokens = options?.listingMaxTokens ?? 4000;
  const effectiveMaxTokens = Math.min(configuredMaxTokens, Math.floor(contextWindow * 0.05));

  // Função auxiliar de estimativa de tokens (1 token ≈ 4 caracteres)
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  // Helper para truncar descrição em 60 caracteres ou primeira frase
  const formatShortDescription = (desc: string) => {
    if (!desc) return '';
    let clean = desc.split(/[\r\n]+/)[0].trim();
    const firstPeriod = clean.indexOf('. ');
    if (firstPeriod > 0 && firstPeriod <= 60) {
      clean = clean.slice(0, firstPeriod + 1);
    }
    if (clean.length > 60) {
      clean = clean.slice(0, 57).trim() + '...';
    }
    return clean;
  };

  // 1. Tentar Tier 1 Completo (Nome + Descrição Curta de até 60 chars)
  const tier1Lines = tools.map(t => {
    const shortDesc = formatShortDescription(t.description);
    return shortDesc ? `- ${t.name}: ${shortDesc}` : `- ${t.name}`;
  });
  const tier1Text = tier1Lines.join('\n');

  if (estimateTokens(tier1Text) <= effectiveMaxTokens) {
    return { manifestText: tier1Text, tier: 1, isNamesOnly: false };
  }

  // 2. Tentar Degradação Isolada por Servidor (se houver múltiplos servidores e um for desproporcional)
  const serverGroups: Map<string, DeferredToolEntry[]> = new Map();
  for (const t of tools) {
    const s = t.source || 'default';
    if (!serverGroups.has(s)) serverGroups.set(s, []);
    serverGroups.get(s)!.push(t);
  }

  if (serverGroups.size > 1) {
    const hybridLines: string[] = [];
    for (const [server, sTools] of serverGroups.entries()) {
      if (sTools.length > 25) {
        hybridLines.push(`- ${server}: ${sTools.length} tools`);
      } else {
        for (const t of sTools) {
          const shortDesc = formatShortDescription(t.description);
          hybridLines.push(shortDesc ? `- ${t.name}: ${shortDesc}` : `- ${t.name}`);
        }
      }
    }
    const hybridText = hybridLines.join('\n');
    if (estimateTokens(hybridText) <= effectiveMaxTokens) {
      return { manifestText: hybridText, tier: 1, isNamesOnly: false };
    }
  }

  // 3. Tentar Fallback Names-Only (Apenas Nomes de todas as ferramentas)
  const namesOnlyLines = tools.map(t => `- ${t.name}`);
  const namesOnlyText = namesOnlyLines.join('\n');

  if (estimateTokens(namesOnlyText) <= effectiveMaxTokens) {
    return { manifestText: namesOnlyText, tier: 1, isNamesOnly: true };
  }

  // 4. Tier 2: Resumo por Servidor (Catálogos Massivos que estouram até a lista de nomes)
  const serverSummaryLines: string[] = [];
  for (const [server, sTools] of serverGroups.entries()) {
    serverSummaryLines.push(`- ${server}: ${sTools.length} tools`);
  }
  const serverSummaryText = serverSummaryLines.join('\n');

  return { manifestText: serverSummaryText, tier: 2, isNamesOnly: true };
}
