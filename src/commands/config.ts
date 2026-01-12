import { tui } from '../ui/tui.js';
import { colors } from '../ui/colors.js';
import { ConfigManager } from '../core/config-manager.js';
import { saveGlobalRC } from '../core/config/sharkrc-loader.js';
import { t } from '../core/i18n/index.js';

export const configCommand = {
    action: async () => {
        tui.intro(t('commands.config.title'));

        const manager = ConfigManager.getInstance();
        const currentConfig = manager.getConfig();

        // Show current status
        tui.log.info(colors.dim('Current Configuration:'));
        tui.log.message(`• Project: ${colors.primary(currentConfig.project || 'Not Set')}`);
        tui.log.message(`• Language: ${colors.primary(currentConfig.language)}`);
        tui.log.message(`• Log Level: ${colors.primary(currentConfig.logLevel)}`);

        const action = await tui.select({
            message: t('commands.config.selectAction'),
            options: [
                { value: 'project', label: 'Set Default Project' },
                { value: 'language', label: t('commands.config.actions.language') },
                { value: 'logLevel', label: t('commands.config.actions.logLevel') },
                { value: 'agents', label: t('commands.config.actions.agents') },
                { value: 'exit', label: t('commands.config.actions.back') }
            ]
        });

        if (tui.isCancel(action) || action === 'exit') {
            tui.outro('Configuration unchanged.');
            return;
        }

        try {
            if (action === 'project') {
                const project = await tui.text({
                    message: 'Enter default project slug:',
                    initialValue: currentConfig.project,
                    placeholder: 'e.g., my-awesome-project'
                });

                if (!tui.isCancel(project)) {
                    saveGlobalRC({ project: project as string });
                    tui.log.success(`Updated project to: ${project}`);
                }
            }

            if (action === 'language') {
                const lang = await tui.select({
                    message: t('commands.config.selectLanguage'),
                    options: [
                        { value: 'pt-br', label: 'Português (Brasil)' },
                        { value: 'en-us', label: 'English (US)' },
                        { value: 'es-es', label: 'Español' }
                    ],
                    initialValue: currentConfig.language
                });

                if (!tui.isCancel(lang)) {
                    saveGlobalRC({ language: lang as any });
                    tui.log.success(t('commands.config.languageUpdated', lang as string));
                }
            }

            if (action === 'logLevel') {
                const level = await tui.select({
                    message: 'Select log level:',
                    options: [
                        { value: 'debug', label: 'Debug (Verbose)' },
                        { value: 'info', label: 'Info (Standard)' },
                        { value: 'warn', label: 'Warn (Important only)' },
                        { value: 'error', label: 'Error (Critical only)' }
                    ],
                    initialValue: currentConfig.logLevel
                });

                if (!tui.isCancel(level)) {
                    saveGlobalRC({ logLevel: level as any });
                    tui.log.success(`Updated log level to: ${level}`);
                }
            }

            if (action === 'agents') {
                const agentType = await tui.select({
                    message: t('commands.config.agentMenu.selectAgent'),
                    options: [
                        { value: 'dev', label: t('commands.config.agentMenu.options.dev') },
                        { value: 'ba', label: t('commands.config.agentMenu.options.ba') },
                        { value: 'spec', label: t('commands.config.agentMenu.options.spec') },
                        { value: 'qa', label: t('commands.config.agentMenu.options.qa') },
                        { value: 'scan', label: t('commands.config.agentMenu.options.scan') },
                        { value: 'back', label: t('commands.config.agentMenu.options.back') }
                    ]
                });

                if (!tui.isCancel(agentType) && agentType !== 'back') {
                    const agentId = await tui.text({
                        message: t('commands.config.agentMenu.enterId'),
                        initialValue: (currentConfig.agents as any)[agentType as string] || '',
                        placeholder: '01xxxxxxxxxxxxxxxxxxxxxxxx'
                    });

                    if (!tui.isCancel(agentId)) {
                        const newAgents = { ...currentConfig.agents, [agentType as string]: agentId };
                        saveGlobalRC({ agents: newAgents as any });
                        tui.log.success(t('commands.config.agentMenu.updated', agentType as string));
                    }
                }
            }

            // Reload to confirm
            manager.reloadConfig();
            tui.outro('Configuration saved successfully to ~/.sharkrc');

        } catch (error: any) {
            tui.log.error(`Failed to save configuration: ${error.message}`);
            process.exit(1);
        }
    }
};
