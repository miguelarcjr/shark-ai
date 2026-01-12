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
                agents: 'Configure Agents',
                back: 'Back'
            },
            selectLanguage: 'Select language:',
            agentMenu: {
                title: 'Agent Configuration',
                selectAgent: 'Which agent would you like to configure?',
                enterId: 'Enter StackSpot Agent ID (or empty for default):',
                updated: 'Agent ID {0} updated.',
                options: {
                    dev: 'Developer Agent',
                    ba: 'Business Analyst',
                    spec: 'Specification Agent',
                    qa: 'QA Agent',
                    scan: 'Scan Agent',
                    back: 'Back'
                }
            },
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
