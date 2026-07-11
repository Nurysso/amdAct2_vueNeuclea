import type { z } from "zod";

/** Contract for a single MCP tool backed by one API operation */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  execute(args: unknown): Promise<unknown>;
}
