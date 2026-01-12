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
                back: string;
            };
            selectLanguage: string;
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
