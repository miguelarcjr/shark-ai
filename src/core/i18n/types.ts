export type TranslationKey = string;

export interface Locale {
    common: {
        loading: string;
        success: string;
        error: string;
        cancel: string;
        operationCancelled: string;
    };
    commands: {
        config: {
            title: string;
            selectAction: string;
            actions: {
                language: string;
                logLevel: string;
                agents: string;
                back: string;
            };
            selectLanguage: string;
            agentMenu: {
                title: string;
                selectAgent: string;
                enterId: string;
                updated: string;
                options: {
                    dev: string;
                    ba: string;
                    spec: string;
                    qa: string;
                    scan: string;
                    back: string;
                }
            };
            languageUpdated: string;
        };
        login: {
            intro: string;
            alreadyLoggedIn: string;
            success: string;
            error: string;
        }
    }
}
