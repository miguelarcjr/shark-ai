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
        },
        scan: {
            intro: '🕵️‍♂️  Scan Agent',
            scanningProject: 'Scanning project at:',
            outputTarget: 'Output file:',
            language: 'Language:',
            templateCreated: '✅ Template created at:',
            fileExists: '📄 File already exists, will be updated',
            analyzing: '🕵️‍♂️  Scan Agent analyzing (Step {step})...',
            completed: '✨ Scan completed successfully!',
            error: 'Error executing scan',
            stepComplete: 'Step complete',
            scanningDir: '📂 Scanning dir: {0}',
            readingFile: '📖 Reading file: {0}',
            searching: '🔍 Searching: {0}',
            generated: '✅ Context Generated: {0}',
            updated: '✅ Context Updated: {0}',
            notFound: 'File not found.',
            stopped: 'Scan Agent stopped without actions.',
            agentAsks: '🤖 Scan Agent asks:',
            agentInput: 'Agent needs input:',
            replyPlaceholder: 'Reply...',
            targetRedirect: "Agent targeted '{0}' but we enforce '{1}'. Redirecting write.",
            contentNotFound: 'Target content not found for replacement.',
            skipped: 'Skipped (Scan Agent only writes context file)',
            pendingSections: 'The following sections still need analysis: {0}.',
            allPopulated: 'All sections appear to be populated!'
        }
    }
};
