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
        };
        scan: {
            intro: string;
            scanningProject: string;
            outputTarget: string;
            language: string;
            templateCreated: string;
            fileExists: string;
            analyzing: string;
            completed: string;
            error: string;
            stepComplete: string;
            scanningDir: string;
            readingFile: string;
            searching: string;
            generated: string;
            updated: string;
            notFound: string;
            stopped: string;
            agentAsks: string;
            agentInput: string;
            replyPlaceholder: string;
            targetRedirect: string;
            contentNotFound: string;
            skipped: string;
            pendingSections: string;
            allPopulated: string;
        }
    }
}
