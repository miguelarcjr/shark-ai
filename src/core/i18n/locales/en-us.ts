import { Locale } from "../types.js";

export const enUs: Locale = {
    common: {
        loading: 'Loading...',
        success: 'Success',
        error: 'Error',
        cancel: 'Cancel',
        operationCancelled: 'Operation cancelled.'
    },
    commands: {
        config: {
            title: 'Shark AI Configuration',
            selectAction: 'What matches your needs?',
            actions: {
                language: 'Set Language',
                logLevel: 'Log Level',
                back: 'Back'
            },
            selectLanguage: 'Select language:',
            languageUpdated: 'Updated language to: {0}'
        },
        login: {
            intro: 'StackSpot Login',
            alreadyLoggedIn: 'You are already logged in',
            success: 'Successfully logged in!',
            error: 'Login failed'
        }
    }
};
