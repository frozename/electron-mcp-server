import { z, type ZodType } from 'zod';

/**
 * Emit a JSON Schema (draft-7) for a Zod schema. MCP's
 * `tools/list` advertises each tool's input schema inline.
 */
export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
}
