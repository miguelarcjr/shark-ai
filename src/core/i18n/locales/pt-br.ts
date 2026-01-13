import { Locale } from "../types.js";

export const ptBr: Locale = {
    common: {
        loading: 'Carregando...',
        success: 'Sucesso',
        error: 'Erro',
        cancel: 'Cancelar',
        operationCancelled: 'Operação cancelada.'
    },
    commands: {
        config: {
            title: 'Configurações do Shark AI',
            selectAction: 'O que você deseja configurar?',
            actions: {
                language: 'Alterar Idioma',
                logLevel: 'Nível de Log',
                agents: 'Configurar Agentes',
                back: 'Voltar'
            },
            selectLanguage: 'Selecione o idioma:',
            agentMenu: {
                title: 'Configuração de Agentes',
                selectAgent: 'Qual agente você deseja configurar?',
                enterId: 'Digite o ID do Agente StackSpot (ou deixe vazio para padrão):',
                updated: 'ID do Agente {0} atualizado.',
                options: {
                    dev: 'Developer Agent',
                    ba: 'Business Analyst',
                    spec: 'Specification Agent',
                    qa: 'QA Agent',
                    scan: 'Scan Agent',
                    back: 'Voltar'
                }
            },
            languageUpdated: 'Idioma atualizado para: {0}'
        },
        login: {
            intro: 'Login StackSpot',
            alreadyLoggedIn: 'Você já está logado',
            success: 'Login realizado com sucesso!',
            error: 'Falha no login'
        },
        scan: {
            intro: '🕵️‍♂️  Scan Agent',
            scanningProject: 'Escaneando projeto em:',
            outputTarget: 'Arquivo de saída:',
            language: 'Idioma:',
            templateCreated: '✅ Template criado em:',
            fileExists: '📄 Arquivo já existe, será atualizado',
            analyzing: '🕵️‍♂️  Scan Agent analisando (Passo {step})...',
            completed: '✨ Scan concluído com sucesso!',
            error: 'Erro ao executar scan',
            stepComplete: 'Passo concluído',
            scanningDir: '📂 Escaneando pasta: {0}',
            readingFile: '📖 Lendo arquivo: {0}',
            searching: '🔍 Buscando: {0}',
            generated: '✅ Contexto Gerado: {0}',
            updated: '✅ Contexto Atualizado: {0}',
            notFound: 'Arquivo não encontrado.',
            stopped: 'Scan Agent parou sem ações.',
            agentAsks: '🤖 Scan Agent pergunta:',
            agentInput: 'Agente precisa de input:',
            replyPlaceholder: 'Resposta...',
            targetRedirect: "Agente mirou '{0}' mas forçamos '{1}'. Redirecionando escrita.",
            contentNotFound: 'Conteúdo alvo não encontrado para substituição.',
            skipped: 'Pulado (Scan Agent só escreve no arquivo de contexto)',
            pendingSections: 'As seguintes seções ainda precisam de análise: {0}.',
            allPopulated: 'Todas as seções parecem preenchidas!'
        }
    }
};
