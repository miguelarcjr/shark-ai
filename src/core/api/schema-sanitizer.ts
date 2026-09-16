export interface SanitizeSchemaOptions {
  hasMcpServers?: boolean;
}

export function sanitizeResponseSchema(
  schema: Record<string, any>,
  options: SanitizeSchemaOptions = {}
): Record<string, any> {
  const cloned = JSON.parse(JSON.stringify(schema));
  const hasMcp = options.hasMcpServers ?? false;

  if (!hasMcp) {
    const actionProp = cloned?.properties?.action;
    if (actionProp?.properties?.type?.enum) {
      actionProp.properties.type.enum = actionProp.properties.type.enum.filter(
        (t: string) => !['tool_search', 'tool_describe', 'tool_call'].includes(t)
      );
    }
    if (Array.isArray(actionProp?.anyOf)) {
      actionProp.anyOf = actionProp.anyOf.filter((branch: any) => {
        const typeEnum = branch?.properties?.type?.enum;
        if (Array.isArray(typeEnum)) {
          return !typeEnum.some((t: string) => ['tool_search', 'tool_describe', 'tool_call'].includes(t));
        }
        return true;
      });
    }
  }

  return cloned;
}
