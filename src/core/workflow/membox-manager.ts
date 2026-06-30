import * as fs from 'fs';
import * as path from 'path';
import crypto from 'node:crypto';
import { EmbeddingService } from './embedding-service.js';

export interface Membox {
    box_id: number;
    start_time: string;
    coverage: {
        session_id: string;
        start_step: number;
        end_step: number;
    };
    content_text: string;
    features: {
        topic: string;
        keywords: string[];
        events: string[];
        events_text: string;
    };
}

export interface TraceEntry {
    box_id: number;
    start_time: string;
    events: string[];
    order: number;
}

export interface Trace {
    trace_id: number;
    box_ids: number[];
    entries: TraceEntry[];
    entries_text: string;
}

export class MemboxManager {
    private storageDir: string;
    private boxesPath: string;
    private tracesPath: string;
    private embeddingService: EmbeddingService;

    constructor(storageDir: string = '.shark/membox') {
        this.storageDir = storageDir;
        this.boxesPath = path.join(storageDir, 'boxes.jsonl');
        this.tracesPath = path.join(storageDir, 'traces.jsonl');
        this.embeddingService = new EmbeddingService(storageDir);

        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
    }

    public saveBox(box: Membox) {
        fs.appendFileSync(this.boxesPath, JSON.stringify(box) + '\n', 'utf8');
    }

    public saveTrace(trace: Trace) {
        fs.appendFileSync(this.tracesPath, JSON.stringify(trace) + '\n', 'utf8');
    }

    public loadBoxes(): Membox[] {
        if (!fs.existsSync(this.boxesPath)) return [];
        const content = fs.readFileSync(this.boxesPath, 'utf8');
        return content.split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));
    }

    public loadTraces(): Trace[] {
        if (!fs.existsSync(this.tracesPath)) return [];
        const content = fs.readFileSync(this.tracesPath, 'utf8');
        return content.split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line));
    }

    private parseJSONSafely(text: string): any {
        try {
            let cleaned = text.trim();
            if (cleaned.startsWith('```')) {
                cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
            }
            return JSON.parse(cleaned);
        } catch {
            return null;
        }
    }

    private async callHelperLLM(prompt: string, apiProvider: any): Promise<string> {
        const response = await apiProvider.streamChat(
            prompt + '\n\nIMPORTANTE: Você deve responder usando a action \'talk_with_user\'. Coloque o resultado (seja texto simples ou uma string JSON contendo o formato solicitado) estritamente dentro do campo \'content\' do JSON de resposta. Não use outras actions.',
            {
                conversationId: `membox-helper-${crypto.randomUUID()}`,
                agentType: 'developer_agent'
            }
        );
        return response.action?.content || '';
    }

    public async retrieveContext(query: string, rawTail: any[]): Promise<string> {
        const boxes = this.loadBoxes();
        if (boxes.length === 0) return '';

        const qVec = await this.embeddingService.getEmbedding(query);
        const scoredBoxes: { box: Membox; score: number }[] = [];

        for (const box of boxes) {
            const textToEmbed = `${box.content_text} ${box.features.events_text} ${box.features.topic} ${box.features.keywords.join(' ')}`;
            const bVec = await this.embeddingService.getEmbedding(textToEmbed);
            const score = this.embeddingService.cosineSimilarity(qVec, bVec);
            scoredBoxes.push({ box, score });
        }

        // Ordenar caixas por score e selecionar top_k = 5
        scoredBoxes.sort((a, b) => b.score - a.score);
        const topKBoxes = scoredBoxes.slice(0, 5).map(sb => sb.box);

        // Buscar traces relevantes de eventos a partir dos eventos das caixas recuperadas
        const traces = this.loadTraces();
        const relevantTracesText: string[] = [];
        const topBoxIds = topKBoxes.map(b => b.box_id);

        for (const trace of traces) {
            const hasSharedBox = trace.box_ids.some(id => topBoxIds.includes(id));
            if (hasSharedBox && trace.entries_text) {
                relevantTracesText.push(trace.entries_text);
            }
        }

        // Montar bloco de prompt
        let prompt = '\n--- MEMÓRIA DE LONGO PRAZO: TRACES TEMÁTICOS ---\n';
        if (relevantTracesText.length > 0) {
            prompt += relevantTracesText.join('\n') + '\n';
        } else {
            prompt += 'Sem traces correspondentes históricos.\n';
        }

        prompt += '\n--- MEMÓRIA EPISÓDICA: CAIXAS DE DIÁLOGOS RECUPERADAS ---\n';
        for (const box of topKBoxes) {
            prompt += `Tópico: ${box.features.topic} [Sessão: ${box.coverage.session_id}]\n`;
            prompt += `${box.content_text}\n\n`;
        }

        return prompt;
    }

    public async compactHistory(rawMessages: any[], apiProvider: any, conversationId: string): Promise<any[]> {
        if (rawMessages.length < 10) return rawMessages;

        console.log(`[Membox] Iniciando compactação do histórico para: ${conversationId}`);

        // Separar as mensagens antigas para compactação (ex: as primeiras N-4 mensagens)
        const messagesToCompact = rawMessages.slice(0, -4);
        const rawTail = rawMessages.slice(-4);

        // 1. Topic Loom: Segmentar mensagensToCompact em caixas
        const segments: any[][] = [];
        let currentSegment: any[] = [];

        for (let i = 0; i < messagesToCompact.length; i++) {
            const msg = messagesToCompact[i];
            if (currentSegment.length < 2) {
                currentSegment.push(msg);
                continue;
            }

            const refText = currentSegment.slice(-2).map(m => `${m.role}: ${m.content}`).join('\n');
            const currText = `${msg.role}: ${msg.content}`;

            const checkPrompt = `Você é um analisador de continuidade temática. Sua tarefa é determinar se a mensagem atual (curr) continua o mesmo tópico das mensagens anteriores (ref).

Mensagens Anteriores (ref):
${refText}

Mensagem Atual (curr):
${currText}

Responda 'Yes' se continuar o mesmo tópico, ou 'No' se for um assunto diferente.`;

            const decision = await this.callHelperLLM(checkPrompt, apiProvider);
            if (decision.trim().toLowerCase().includes('yes')) {
                currentSegment.push(msg);
            } else {
                segments.push(currentSegment);
                currentSegment = [msg];
            }
        }
        if (currentSegment.length > 0) {
            segments.push(currentSegment);
        }

        // Carregar boxes existentes para atribuir ID sequencial
        const existingBoxes = this.loadBoxes();
        let boxIdCounter = existingBoxes.length > 0 ? Math.max(...existingBoxes.map(b => b.box_id)) + 1 : 0;

        // 2. Extrair metadados e costurar traces para cada segmento/caixa
        for (const segment of segments) {
            const segmentText = segment.map(m => `${m.role}: ${m.content}`).join('\n');
            const extractPrompt = `Analise o diálogo abaixo e extraia o tópico principal (topic), as palavras-chave (keywords) e a lista de fatos ou planos futuros explícitos (explicit_mentions).

Diálogo:
${segmentText}

Responda no formato JSON com as chaves: "topic", "keywords" (array), "explicit_mentions" (array).`;

            const extractResultRaw = await this.callHelperLLM(extractPrompt, apiProvider);
            const parsed = this.parseJSONSafely(extractResultRaw);

            const topic = parsed?.topic || 'Diálogo do desenvolvedor';
            const keywords = parsed?.keywords || [];
            const events = parsed?.explicit_mentions || [];

            const newBox: Membox = {
                box_id: boxIdCounter++,
                start_time: new Date().toISOString(),
                coverage: {
                    session_id: conversationId,
                    start_step: 0,
                    end_step: segment.length
                },
                content_text: segmentText,
                features: {
                    topic,
                    keywords,
                    events,
                    events_text: events.join(' | ')
                }
            };

            this.saveBox(newBox);

            // 3. Costurar Traces (Trace Weaver) se houver eventos
            if (events.length > 0) {
                await this.linkEventsToTraces(newBox, events, apiProvider);
            }
        }

        console.log(`[Membox] Compactação finalizada. Caixas gravadas. Retornando cauda recente.`);
        return rawTail;
    }

    private async linkEventsToTraces(box: Membox, events: string[], apiProvider: any) {
        const traces = this.loadTraces();
        let matched = false;

        for (const trace of traces) {
            const traceEvents = trace.entries.flatMap(e => e.events).join('\n');
            const filterPrompt = `Você é um analisador de coerência narrativa. Identifique se algum dos Novos Eventos abaixo está diretamente relacionado à Trace Existente (mesmo projeto, erro, arquivo ou assunto).

Trace Existente:
${traceEvents}

Novos Eventos:
${events.join('\n')}

Responda em JSON contendo:
{{
  "related_events": ["..."],
  "unrelated_events": ["..."]
}}`;

            const filterResRaw = await this.callHelperLLM(filterPrompt, apiProvider);
            const parsed = this.parseJSONSafely(filterResRaw);
            const related = parsed?.related_events || [];

            if (related.length > 0) {
                trace.box_ids.push(box.box_id);
                trace.entries.push({
                    box_id: box.box_id,
                    start_time: box.start_time,
                    events: related,
                    order: trace.entries.length
                });

                // Atualizar entries_text
                const texts = trace.entries.map(e => `${e.start_time}: ${e.events.join(', ')}`);
                trace.entries_text = texts.join(' -> ');
                
                // Sobrescrever arquivo de traces com a nova versão atualizada
                this.updateTraceInFile(trace);
                matched = true;
                break;
            }
        }

        if (!matched) {
            // Criar uma nova trace para estes eventos
            const initPrompt = `Organize os eventos abaixo em uma narrativa lógica coerente (primary_chain) e isolados (isolated_events).

Eventos:
${events.join('\n')}

Responda em JSON:
{{
  "primary_chain": ["..."],
  "isolated_events": ["..."]
}}`;

            const initResRaw = await this.callHelperLLM(initPrompt, apiProvider);
            const parsed = this.parseJSONSafely(initResRaw);
            const chain = parsed?.primary_chain || events;

            const nextTraceId = traces.length;
            const newTrace: Trace = {
                trace_id: nextTraceId,
                box_ids: [box.box_id],
                entries: [{
                    box_id: box.box_id,
                    start_time: box.start_time,
                    events: chain,
                    order: 0
                }],
                entries_text: `${box.start_time}: ${chain.join(', ')}`
            };

            this.saveTrace(newTrace);
        }
    }

    private updateTraceInFile(updatedTrace: Trace) {
        const traces = this.loadTraces();
        const index = traces.findIndex(t => t.trace_id === updatedTrace.trace_id);
        if (index !== -1) {
            traces[index] = updatedTrace;
            // Reescrever o arquivo completo
            fs.writeFileSync(this.tracesPath, '', 'utf8');
            for (const t of traces) {
                this.saveTrace(t);
            }
        }
    }
}
