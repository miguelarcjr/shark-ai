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
                back: 'Voltar'
            },
            selectLanguage: 'Selecione o idioma:',
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
