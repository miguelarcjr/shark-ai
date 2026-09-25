import { AgentEngine, type DevelopmentResult } from '../engine/agent-engine.js';
import { CliAdapter } from '../adapters/cli/cli-adapter.js';
import { truncateToolOutput } from '../utils/text-truncator.js';
import { waitForInputOrNotification } from '../workflow/interactive-prompt.js';

export { truncateToolOutput, waitForInputOrNotification };
export type { DevelopmentResult };

export interface DeveloperAgentOptions {
    taskId?: string;
    taskInstruction?: string;
    context?: string;
    history?: string;
    auto?: boolean;
}

/**
 * Fachada agnóstica para o Shark Developer Agent.
 * Delega 100% da orquestração, ciclo de vida, subagentes e ferramentas para o AgentEngine.
 */
export async function interactiveDeveloperAgent(options: DeveloperAgentOptions = {}): Promise<DevelopmentResult> {
    const isBatchMode = options.auto === true || process.argv.includes('--auto');
    const projectRoot = process.cwd();

    const cliAdapter = new CliAdapter({
        auto: isBatchMode
    });

    const engine = new AgentEngine({
        sessionId: options.taskId || `dev_${Date.now()}`,
        auto: isBatchMode,
        projectRoot,
        taskId: options.taskId,
        context: options.context
    });

    engine.attachAdapter(cliAdapter);

    return engine.runInteractive({
        taskInstruction: options.taskInstruction,
        taskId: options.taskId,
        context: options.context,
        history: options.history,
        auto: isBatchMode
    });
}
