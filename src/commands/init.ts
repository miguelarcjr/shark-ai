import { Command } from 'commander';
import { tui } from '../ui/tui.js';
import { workflowManager } from '../core/workflow/workflow-manager.js';
import { TechStackEnum } from '../core/workflow/shark-workflow.schema.js';
import { randomUUID } from 'crypto';
import { colors } from '../ui/colors.js';

export const initAction = async () => {
    tui.intro('Shark Project Initialization');

    // 1. Check if workflow already exists
    const existingState = await workflowManager.load();
    if (existingState) {
        // Smart Resume Context Card
        tui.log.info(colors.dim('----------------------------------------'));
        tui.log.info(`🦈  ${colors.primary('Welcome back to Shark CLI!')}`);
        tui.log.message(`   Project: ${colors.white(existingState.projectName)}`);
        tui.log.message(`   Stage:   ${colors.secondary(existingState.currentStage)}`);
        tui.log.message(`   Updated: ${colors.dim(new Date(existingState.lastUpdated).toLocaleString())}`);
        tui.log.info(colors.dim('----------------------------------------'));

        const action = await tui.select({
            message: 'An existing project was detected. What would you like to do?',
            options: [
                { value: 'resume', label: '🚀 Resume Work' },
                { value: 'overwrite', label: '⚠️  Overwrite (Start Fresh)' },
                { value: 'exit', label: '❌ Exit' }
            ]
        });

        if (tui.isCancel(action) || action === 'exit') {
            tui.outro('See you later! 👋');
            return;
        }

        if (action === 'resume') {
            tui.log.success(`Resuming work on ${colors.primary(existingState.projectName)}...`);
            // Future: Route to specific agent based on stage
            tui.outro(`To continue, run: "shark agent" (Context loaded)`);
            return;
        }

        // If overwrite, we just proceed to step 2...
    }

    // 2. Prompt for Project Name
    const projectName = await tui.text({
        message: 'What is the name of your project?',
        placeholder: 'e.g. My Awesome App',
        validate: (value) => {
            if (!value) return 'Project name is required';
            if (value.trim().length < 2) return 'Project name must be at least 2 characters';
        }
    });

    if (tui.isCancel(projectName)) {
        tui.outro('Initialization cancelled.');
        return;
    }

    // 3. Prompt for Tech Stack
    const techStackOptions = TechStackEnum.options.map(stack => ({
        value: stack,
        label: stack === 'node-ts' ? 'Node.js (TypeScript)' :
            stack === 'nextjs' ? 'Next.js' :
                stack.charAt(0).toUpperCase() + stack.slice(1)
    }));

    const techStack = await tui.select({
        message: 'Select your technology stack:',
        options: techStackOptions
    });

    if (tui.isCancel(techStack)) {
        tui.outro('Initialization cancelled.');
        return;
    }

    // 4. Create and Save State
    const spinner = tui.spinner();
    spinner.start('Initializing project workflow...');

    try {
        const newState = {
            projectId: randomUUID(),
            projectName: projectName as string,
            techStack: techStack as any,
            currentStage: 'business_analysis' as const,
            stageStatus: 'pending' as const,
            lastUpdated: new Date().toISOString(),
            artifacts: [],
            metadata: {
                initializedBy: 'shark-cli',
                version: '0.0.1'
            }
        };

        await workflowManager.save(newState);
        spinner.stop('Project workflow created!');

        tui.log.success(`Project ${colors.primary(projectName as string)} initialized successfully.`);
        tui.log.message(`Your Project ID: ${colors.dim(newState.projectId)}`);
        tui.outro('Ready to start! Run "shark agent" to begin analyzing requirements.'); // Placeholder hint
    } catch (error: any) {
        spinner.stop('Initialization failed.', 1);
        tui.log.error(error.message);
        process.exit(1);
    }
};

export const initCommand = new Command('init')
    .description('Initialize a new Shark project')
    .action(initAction);
