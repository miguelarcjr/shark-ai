import { ToolCatalogSearch, DeferredToolEntry } from './tool-catalog-search.js';
import { FileLogger } from '../../debug/file-logger.js';

export interface BridgeExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
}

export class BridgeToolsManager {
  private catalog: ToolCatalogSearch;
  private toolExecutor: (name: string, args: any) => Promise<any>;
  private knownToolsMap: Map<string, DeferredToolEntry> = new Map();

  constructor(
    catalog: ToolCatalogSearch,
    toolExecutor: (name: string, args: any) => Promise<any>,
    toolsList: DeferredToolEntry[] = []
  ) {
    this.catalog = catalog;
    this.toolExecutor = toolExecutor;
    for (const t of toolsList) {
      this.knownToolsMap.set(t.name, t);
    }
  }

  public registerTools(toolsList: DeferredToolEntry[]): void {
    for (const t of toolsList) {
      this.knownToolsMap.set(t.name, t);
    }
  }

  public async executeToolSearch(args: { queries: string[]; limit?: number }): Promise<BridgeExecutionResult> {
    const queries = Array.isArray(args.queries) ? args.queries : [String(args.queries || '')];
    const limit = args.limit || 5;

    const res = this.catalog.search(queries, limit);

    return {
      success: true,
      output: {
        ...res,
        hint: "Para ver os parâmetros detalhados de uma ferramenta, execute 'tool_describe' informando os nomes desejados em 'names'."
      }
    };
  }

  public async executeToolDescribe(args: { names: string[] }): Promise<BridgeExecutionResult> {
    const names = Array.isArray(args.names) ? args.names : [String(args.names || '')];
    const toolsResult: Record<string, any> = {};
    const notFound: string[] = [];

    for (const name of names) {
      // Procura no knownToolsMap ou busca no catalog
      let tool = this.knownToolsMap.get(name);
      if (!tool) {
        const search = this.catalog.search([name], 1);
        if (search.results.length > 0 && search.results[0].name === name) {
          tool = {
            name: search.results[0].name,
            source: search.results[0].source,
            description: search.results[0].description,
            parameters: {}
          };
        }
      }

      if (tool) {
        toolsResult[tool.name] = {
          description: tool.description,
          source: tool.source,
          parameters: tool.parameters || {}
        };
      } else {
        notFound.push(name);
      }
    }

    if (notFound.length > 0 && Object.keys(toolsResult).length === 0) {
      return {
        success: false,
        error: `[Action tool_describe Failed]: Nenhuma ferramenta foi encontrada para os nomes: [${notFound.join(', ')}].\n💡 DICA: Execute 'tool_search' com termos em linguagem natural para localizar os nomes corretos.`
      };
    }

    return {
      success: true,
      output: {
        tools: toolsResult,
        notFound: notFound.length > 0 ? notFound : undefined,
        hint: "Parâmetros carregados acima. Agora execute 'tool_call' passando o 'name' e o objeto 'arguments'."
      }
    };
  }

  public async executeToolCall(args: { name: string; arguments: Record<string, any> }): Promise<BridgeExecutionResult> {
    const toolName = args.name;
    const toolArgs = args.arguments || {};

    if (!toolName) {
      return {
        success: false,
        error: "[Action tool_call Failed]: Parâmetro 'name' é obrigatório em 'tool_call'."
      };
    }

    // Verificar se ferramenta existe no registro
    const exists = this.knownToolsMap.has(toolName) || this.catalog.search([toolName], 1).results.some(r => r.name === toolName);
    if (!exists) {
      return {
        success: false,
        error: `[Action tool_call Failed]: A ferramenta '${toolName}' não foi encontrada no catálogo ativo.\n💡 DICA: Execute 'tool_search' para verificar ferramentas disponíveis ou 'available_sources'.`
      };
    }

    FileLogger.log('BRIDGE', `[tool_call -> ${toolName}] Dispatching execution with args: ${JSON.stringify(toolArgs)}`);

    try {
      const output = await this.toolExecutor(toolName, toolArgs);
      return {
        success: true,
        output
      };
    } catch (err: any) {
      FileLogger.log('BRIDGE', `[tool_call -> ${toolName}] Execution failed: ${err?.message}`);
      return {
        success: false,
        error: `[Action tool_call Failed]: Erro ao executar '${toolName}': ${err?.message || String(err)}\n💡 DICA: Verifique se os tipos de argumentos conferem com o schema obtido via 'tool_describe'.`
      };
    }
  }
}
