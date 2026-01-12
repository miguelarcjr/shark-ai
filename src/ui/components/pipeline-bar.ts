import { colors } from '../colors.js';
import { WorkflowStage } from '../../core/workflow/shark-workflow.schema.js';

const STAGES: { id: WorkflowStage; label: string }[] = [
    { id: 'business_analysis', label: 'Analysis' },
    { id: 'specification', label: 'Spec' },
    { id: 'architecture', label: 'Arch' },
    { id: 'development', label: 'Dev' },
    { id: 'verification', label: 'Verify' },
    { id: 'deployment', label: 'Deploy' }
];

export function renderPipeline(currentStage: WorkflowStage): string {
    const currentIndex = STAGES.findIndex(s => s.id === currentStage);

    // If unknown stage, default to 0
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;

    const parts = STAGES.map((stage, index) => {
        if (index < safeIndex) {
            // Completed
            return colors.success(`✔ ${stage.label}`);
        } else if (index === safeIndex) {
            // Active
            return colors.primary(`➤ ${colors.bold(stage.label)}`);
        } else {
            // Pending
            return colors.dim(stage.label);
        }
    });

    return parts.join(colors.dim(' → '));
}
