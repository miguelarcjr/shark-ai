import { Command } from 'commander';
import { tui } from '../ui/tui.js';
import { authenticate } from '../core/auth/stackspot-auth.js';
import { tokenStorage } from '../core/auth/token-storage.js';
import { connectivity } from '../core/network/connectivity.js';
import { ConfigManager } from '../core/config-manager.js';
import { colors } from '../ui/colors.js';
import { t } from '../core/i18n/index.js';
import { FileLogger } from '../core/debug/file-logger.js';

export const loginCommand = new Command('login')
    .description('Authenticate with StackSpot')
    .action(async () => {
        try {
            FileLogger.init();
            await connectivity.requireOnline();


            tui.intro(t('commands.login.intro'));

            const realm = await tui.text({
                message: 'Account Realm (Slug)',
                placeholder: 'e.g. stackspot-freemium',
                validate: (value) => {
                    if (!value) return 'Realm is required';
                    if (value.includes(' ')) return 'Realm cannot contain spaces';
                },
            });

            if (tui.isCancel(realm)) {
                tui.outro('Login cancelled');
                return;
            }

            const clientId = await tui.text({
                message: 'Client ID',
                validate: (value) => {
                    if (!value) return 'Client ID is required';
                },
            });

            if (tui.isCancel(clientId)) {
                tui.outro('Login cancelled');
                return;
            }

            const clientKey = await tui.password({
                message: 'Client Key',
                validate: (value) => {
                    if (!value) return 'Client Key is required';
                },
            });

            if (tui.isCancel(clientKey)) {
                tui.outro('Login cancelled');
                return;
            }

            const spinner = tui.spinner();
            spinner.start('Authenticating...');

            try {
                const tokens = await authenticate(
                    (realm as string).trim(),
                    (clientId as string).trim(),
                    (clientKey as string).trim()
                );

                FileLogger.log('LOGIN', 'Authentication success', { realm });

                // Save token and credentials for monitoring/refresh
                await tokenStorage.saveToken(
                    realm as string,
                    tokens.access_token,
                    clientId as string,
                    clientKey as string,
                    tokens.expires_in
                );

                // Save active realm to config
                const configManager = ConfigManager.getInstance();
                await configManager.set('activeRealm', realm as string);

                spinner.stop(t('commands.login.success'));
                tui.outro(t('commands.login.success'));

            } catch (error: any) {
                spinner.stop(t('commands.login.error'), 1);
                tui.log.error(error.message);
                FileLogger.log('LOGIN', 'Authentication failed', error);
                process.exit(1);
            }
        } catch (error: any) {
            tui.log.error(error.message);
            FileLogger.log('LOGIN', 'Unexpected error', error);
            process.exit(1);
        }
    });
