import { Command } from 'commander';
import { tui } from '../ui/tui.js';
import { authenticate } from '../core/auth/stackspot-auth.js';
import { tokenStorage } from '../core/auth/token-storage.js';
import { connectivity } from '../core/network/connectivity.js';
import { ConfigManager } from '../core/config-manager.js';
import { colors } from '../ui/colors.js';

export const loginCommand = new Command('login')
    .description('Authenticate with StackSpot')
    .action(async () => {
        try {
            await connectivity.requireOnline();

            tui.intro('Shark CLI Login');

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

                spinner.stop('✅ Login successful');
                tui.outro(`You are now authenticated as ${colors.primary(realm as string)}`);

            } catch (error: any) {
                spinner.stop('Authentication failed.', 1);
                tui.log.error(error.message);
                process.exit(1);
            }
        } catch (error: any) {
            tui.log.error(error.message);
            process.exit(1);
        }
    });
