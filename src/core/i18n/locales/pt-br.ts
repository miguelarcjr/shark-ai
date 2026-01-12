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
        }
    }
};
