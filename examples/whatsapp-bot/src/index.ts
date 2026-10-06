import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { execSync } from 'node:child_process';

// Importa os módulos desacoplados do Shark AI (Core + WhatsApp Adapter)
import {
    AgentEngine,
    WhatsAppAdapter,
    CliAdapter,
    SessionWorkspaceManager,
    type WhatsAppTransport
} from '../../../src/core/index.js';

// Suprime timeouts internos de rede do Baileys para não poluir o processo
process.on('unhandledRejection', (err: any) => {
    if (err?.message?.includes('Timed Out') || err?.output?.statusCode === 408) {
        return;
    }
});

let isShuttingDown = false;
let currentSocket: any = null;

function handleGracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🛑 [${signal}] Encerrando o bot do WhatsApp com segurança...`);
    try {
        if (currentSocket) {
            currentSocket.ev.removeAllListeners('connection.update');
            currentSocket.ev.removeAllListeners('messages.upsert');
            currentSocket.ev.removeAllListeners('creds.update');
            currentSocket.end(undefined);
        }
    } catch {}
    process.exit(0);
}

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

// No Windows, garante captura confiável de Ctrl+C via readline e dados brutos do stdin
if (process.platform === 'win32') {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.on('SIGINT', () => {
        handleGracefulShutdown('SIGINT');
    });
}

if (process.stdin.isTTY && typeof process.stdin.on === 'function') {
    process.stdin.on('data', (data) => {
        if (data.length === 1 && data[0] === 3) {
            handleGracefulShutdown('SIGINT');
        }
    });
}

async function startWhatsAppBot() {
    const logger = pino({ level: 'warn' });
    const authDir = path.resolve(process.cwd(), '.baileys_auth');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    console.log('🤖 Conectando ao WhatsApp via Baileys...');

    const sock = makeWASocket({
        version,
        logger,
        auth: state,
        printQRInTerminal: false
    });
    currentSocket = sock;

    // 1. Tratamento de conexão e renderização do QR Code no terminal
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📲 Escaneie o QR Code abaixo com seu WhatsApp:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            if (isShuttingDown) return;
            const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ Conexão fechada. Reconectando?', shouldReconnect);
            if (shouldReconnect) {
                startWhatsAppBot();
            }
        } else if (connection === 'open') {
            console.log('✅ Bot do Shark AI conectado com sucesso ao WhatsApp!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // 2. Implementação da interface WhatsAppTransport (O driver que conecta a rede ao Shark)
    let rawMessageHandler: ((chatId: string, text: string, senderId: string) => void) | null = null;

    const transport: WhatsAppTransport = {
        async sendText(chatId: string, text: string) {
            await sock.sendMessage(chatId, { text });
        },
        async editMessage(chatId: string, messageId: string, text: string) {
            await sock.sendMessage(chatId, {
                text,
                edit: {
                    remoteJid: chatId,
                    id: messageId,
                    fromMe: true
                }
            } as any);
        },
        async sendMedia(chatId, media) {
            try {
                if (!fs.existsSync(media.filePath)) {
                    await sock.sendMessage(chatId, { text: `⚠️ Arquivo não encontrado: ${media.filePath}` });
                    return;
                }

                let effectiveFilePath = media.filePath;
                let effectiveMime = media.mimeType;

                // WhatsApp exige MP4 (H.264/AAC) para reprodução inline de vídeos.
                // Gravações do Playwright (.webm) são convertidas via ffmpeg para máxima compatibilidade.
                if (media.filePath.endsWith('.webm') || media.mimeType === 'video/webm') {
                    const mp4Path = media.filePath.replace(/\.webm$/i, '.mp4');
                    try {
                        execSync(`ffmpeg -y -i "${media.filePath}" -c:v libx264 -pix_fmt yuv420p -c:a aac "${mp4Path}"`, {
                            stdio: 'pipe',
                            timeout: 30000
                        });
                        if (fs.existsSync(mp4Path)) {
                            effectiveFilePath = mp4Path;
                            effectiveMime = 'video/mp4';
                        }
                    } catch (convErr: any) {
                        console.warn(`[sendMedia] Não foi possível converter .webm para .mp4 via ffmpeg:`, convErr?.message || convErr);
                    }
                }

                const stats = fs.statSync(effectiveFilePath);
                const fileSizeMB = stats.size / (1024 * 1024);

                if (fileSizeMB > 100) {
                    await sock.sendMessage(chatId, {
                        text: `⚠️ Arquivo muito grande para envio via WhatsApp (${fileSizeMB.toFixed(1)}MB > limite de 100MB):\n${effectiveFilePath}`
                    });
                    return;
                }

                const buffer = fs.readFileSync(effectiveFilePath);
                const fileName = path.basename(effectiveFilePath);
                const caption = media.caption;

                console.log(`📤 [sendMedia] Enviando para ${chatId}: ${fileName} (${effectiveMime}, ${fileSizeMB.toFixed(2)}MB)`);

                if (effectiveMime.startsWith('image/')) {
                    await sock.sendMessage(chatId, {
                        image: buffer,
                        mimetype: effectiveMime,
                        caption
                    });
                } else if (effectiveMime.startsWith('video/')) {
                    if (effectiveMime === 'video/mp4' && fileSizeMB <= 16) {
                        await sock.sendMessage(chatId, {
                            video: buffer,
                            mimetype: 'video/mp4',
                            caption
                        });
                    } else {
                        // Vídeos não-MP4 ou acima de 16MB são enviados como documento preservando o arquivo original
                        await sock.sendMessage(chatId, {
                            document: buffer,
                            mimetype: effectiveMime,
                            fileName,
                            caption
                        });
                    }
                } else if (effectiveMime.startsWith('audio/')) {
                    await sock.sendMessage(chatId, {
                        audio: buffer,
                        mimetype: effectiveMime
                    });
                } else {
                    await sock.sendMessage(chatId, {
                        document: buffer,
                        mimetype: effectiveMime,
                        fileName,
                        caption
                    });
                }
                console.log(`✅ [sendMedia] Mídia enviada com sucesso para ${chatId}: ${fileName}`);
            } catch (err: any) {
                console.error(`❌ [sendMedia] Erro ao enviar mídia para ${chatId}:`, err);
                try {
                    // Fallback resiliente: enviar como documento genérico se o envio nativo de mídia falhar
                    const buffer = fs.readFileSync(media.filePath);
                    const fileName = path.basename(media.filePath);
                    await sock.sendMessage(chatId, {
                        document: buffer,
                        mimetype: 'application/octet-stream',
                        fileName,
                        caption: media.caption ? `${media.caption} (anexo)` : undefined
                    });
                    console.log(`✅ [sendMedia] Mídia enviada via fallback de documento para ${chatId}: ${fileName}`);
                } catch (fallbackErr: any) {
                    console.error(`❌ [sendMedia] Falha também no fallback para ${chatId}:`, fallbackErr);
                    await sock.sendMessage(chatId, {
                        text: `⚠️ Erro ao enviar arquivo \`${path.basename(media.filePath)}\`: ${err.message || err}`
                    }).catch(() => {});
                }
            }
        },
        onRawMessage(handler) {
            rawMessageHandler = handler;
        }
    };

    // 3. Inicializa o WhatsAppAdapter com Debouncing de 800ms
    const whatsappAdapter = new WhatsAppAdapter(transport, {
        debounceMs: 800
    });

    // 4. Instancia o motor agnóstico do Shark AI e o gerenciador de workspaces isolados
    const defaultWorkspace = process.env.SHARK_PROJECT_ROOT || process.cwd();
    const workspaceManager = new SessionWorkspaceManager();

    const engine = new AgentEngine({
        sessionId: '*',
        projectRoot: defaultWorkspace
    });
    const cliAdapter = new CliAdapter();
    engine.attachAdapter(whatsappAdapter);
    engine.attachAdapter(cliAdapter);

    // 5. Escuta mensagens recebidas do WhatsApp e repassa ao adapter
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe) continue;

            const chatId = msg.key.remoteJid;
            if (!chatId) continue;

            const text = (msg.message?.conversation ||
                          msg.message?.extendedTextMessage?.text ||
                          msg.message?.imageMessage?.caption ||
                          '').trim();

            if (!text) continue;

            const isGroup = chatId.endsWith('@g.us');
            const senderId = msg.key.participant || chatId;

            let cleanText = text;

            // Filtro de grupos: só responde se for mencionado com @Shark ou prefixo /shark
            if (isGroup) {
                const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const botUser = sock.user?.id || '';
                const botNum = botUser.split(':')[0].replace(/[^0-9]/g, '');
                const isTaggedInJid = mentions.some((m: string) => botNum && m.includes(botNum));
                const lower = text.toLowerCase();
                const isTextMentioned = lower.startsWith('@shark') || lower.startsWith('/shark') || lower.includes('@shark');

                if (!isTaggedInJid && !isTextMentioned) {
                    continue;
                }

                // Remove o prefixo @shark ou /shark para deixar o comando/mensagem limpo
                cleanText = cleanText
                    .replace(/^@shark\b/i, '')
                    .replace(/^\/shark\b/i, '')
                    .trim();

                // Se a mensagem continha apenas a menção @shark sem instrução
                if (!cleanText) {
                    await transport.sendText(chatId, '🦈 Olá! Como posso te ajudar com o código hoje? Digite sua instrução ou `/help` para comandos.');
                    continue;
                }
            } else if (cleanText.toLowerCase().startsWith('@shark')) {
                // Em DM, se o usuário tiver o hábito de digitar @shark, remove o prefixo amigavelmente
                cleanText = cleanText.replace(/^@shark\b/i, '').trim() || cleanText;
            }

            console.log(`📩 Mensagem recebida [${chatId}]: "${cleanText}"`);

            const sessionId = `whatsapp:dm:${chatId}`;

            // Garante provisionamento e isolamento do workspace deste chat
            try {
                const sessionWorkspacePath = await workspaceManager.ensureWorkspace(chatId, async (statusMsg) => {
                    await transport.sendText(chatId, statusMsg);
                });
                engine.setSessionWorkspace(sessionId, sessionWorkspacePath);
            } catch (err: any) {
                console.error(`Erro ao preparar workspace para ${chatId}:`, err);
                await transport.sendText(chatId, `⚠️ *Erro ao preparar workspace:* ${err.message}`);
                continue;
            }

            // --- Comandos de Controle Rápido via WhatsApp ---
            if (cleanText === '/pwd' || cleanText === '/workspace') {
                const activeWs = engine.getSessionWorkspace(sessionId);
                await transport.sendText(chatId, `📁 *Workspace ativo:*\n\`${activeWs}\``);
                continue;
            }

            if (cleanText.startsWith('/use ') || cleanText.startsWith('/workspace ')) {
                const targetDir = cleanText.replace(/^(\/use|\/workspace)\s+/, '').trim();
                const resolved = path.resolve(targetDir);
                if (fs.existsSync(resolved)) {
                    engine.setSessionWorkspace(sessionId, resolved);
                    await transport.sendText(chatId, `✅ *Workspace alterado para:*\n\`${resolved}\``);
                } else {
                    await transport.sendText(chatId, `❌ *Diretório não encontrado:*\n\`${resolved}\``);
                }
                continue;
            }

            if (cleanText === '/help') {
                await transport.sendText(
                    chatId,
                    `🦈 *Shark AI WhatsApp Bot*\n\n` +
                    `• Envie qualquer comando em linguagem natural para o agente.\n` +
                    `• \`/pwd\` - Exibe o diretório/projeto onde o agente está trabalhando.\n` +
                    `• \`/use <caminho>\` - Altera o diretório do projeto ativo.\n` +
                    `• \`/refine [foco]\` - Aciona o aprendizado reflexivo (Learning Loop) para atualizar memória e skills.\n` +
                    `• \`/stop\` ou \`/abort\` - Cancela a tarefa em execução imediatamente.\n`
                );
                continue;
            }

            // Despacha para o WhatsAppAdapter (onde passa pelo debouncer de 800ms antes do turno)
            if (rawMessageHandler) {
                rawMessageHandler(chatId, cleanText, senderId);
            }
        }
    });
}

startWhatsAppBot().catch((err) => {
    console.error('Erro fatal ao iniciar bot do WhatsApp:', err);
});
