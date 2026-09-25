import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Importa os módulos desacoplados do Shark AI (Core + WhatsApp Adapter)
import {
    AgentEngine,
    WhatsAppAdapter,
    type WhatsAppTransport
} from '../../../src/core/index.js';

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

    // 1. Tratamento de conexão e renderização do QR Code no terminal
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📲 Escaneie o QR Code abaixo com seu WhatsApp:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
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
        onRawMessage(handler) {
            rawMessageHandler = handler;
        }
    };

    // 3. Inicializa o WhatsAppAdapter com Debouncing de 800ms
    const whatsappAdapter = new WhatsAppAdapter(transport, {
        debounceMs: 800
    });

    // 4. Instancia o motor agnóstico do Shark AI apontando para o workspace inicial
    // Pode ser configurado via variável de ambiente SHARK_PROJECT_ROOT ou usar o diretório pai
    let currentWorkspace = process.env.SHARK_PROJECT_ROOT || process.cwd();

    const engine = new AgentEngine({
        sessionId: '*',
        projectRoot: currentWorkspace
    });
    engine.attachAdapter(whatsappAdapter);

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

            // Filtro de grupos: só responde se for mencionado com @Shark ou prefixo /shark
            if (isGroup) {
                const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const botJid = sock.user?.id.split(':')[0] + '@s.whatsapp.net';
                const isMentioned = mentions.includes(botJid) || text.toLowerCase().startsWith('/shark');

                if (!isMentioned) {
                    continue;
                }
            }

            console.log(`📩 Mensagem recebida [${chatId}]: "${text}"`);

            // --- Comandos de Controle Rápido via WhatsApp ---
            if (text === '/pwd' || text === '/workspace') {
                await transport.sendText(chatId, `📁 *Workspace ativo:*\n\`${engine.projectRoot}\``);
                continue;
            }

            if (text.startsWith('/use ') || text.startsWith('/workspace ')) {
                const targetDir = text.replace(/^(\/use|\/workspace)\s+/, '').trim();
                const resolved = path.resolve(targetDir);
                if (fs.existsSync(resolved)) {
                    engine.projectRoot = resolved;
                    await transport.sendText(chatId, `✅ *Workspace alterado para:*\n\`${resolved}\``);
                } else {
                    await transport.sendText(chatId, `❌ *Diretório não encontrado:*\n\`${resolved}\``);
                }
                continue;
            }

            if (text === '/help') {
                await transport.sendText(
                    chatId,
                    `🦈 *Shark AI WhatsApp Bot*\n\n` +
                    `• Envie qualquer comando em linguagem natural para o agente.\n` +
                    `• \`/pwd\` - Exibe o diretório/projeto onde o agente está trabalhando.\n` +
                    `• \`/use <caminho>\` - Altera o diretório do projeto ativo.\n` +
                    `• \`/stop\` ou \`/abort\` - Cancela a tarefa em execução imediatamente.\n`
                );
                continue;
            }

            // Despacha para o WhatsAppAdapter (onde passa pelo debouncer de 800ms antes do turno)
            if (rawMessageHandler) {
                rawMessageHandler(chatId, text, senderId);
            }
        }
    });
}

startWhatsAppBot().catch((err) => {
    console.error('Erro fatal ao iniciar bot do WhatsApp:', err);
});
