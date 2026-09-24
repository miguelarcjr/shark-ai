import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import * as path from 'node:path';

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

    // 4. Instancia o motor agnóstico do Shark AI e anexa o adaptador
    const engine = new AgentEngine({
        sessionId: 'whatsapp:main_session'
    });
    engine.attachAdapter(whatsappAdapter);

    // 5. Escuta mensagens recebidas do WhatsApp e repassa ao adapter
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            // Ignora mensagens enviadas pelo próprio bot
            if (msg.key.fromMe) continue;

            const chatId = msg.key.remoteJid;
            if (!chatId) continue;

            // Extrai texto de mensagem simples, extendida ou legenda de imagem
            const text = msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text ||
                         msg.message?.imageMessage?.caption ||
                         '';

            if (!text.trim()) continue;

            const isGroup = chatId.endsWith('@g.us');
            const senderId = msg.key.participant || chatId;

            // Regra para Grupos: só responde se for mencionado (@Shark ou prefixo /shark) ou em DM privada
            if (isGroup) {
                const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const botJid = sock.user?.id.split(':')[0] + '@s.whatsapp.net';
                const isMentioned = mentions.includes(botJid) || text.toLowerCase().startsWith('/shark');

                if (!isMentioned) {
                    continue; // Ignora conversas paralelas no grupo
                }
            }

            console.log(`📩 Mensagem recebida [${chatId}]: "${text}"`);

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
