import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { callApi } from "../http-client.js";
import { BASE_URL } from "../config.js";

const list_categories_api_categories_getInputSchema = z.object({});

export const list_categories_api_categories_getTool: ToolDefinition = {
  name: "list_categories_api_categories_get",
  description: "List Categories\n\nReturn all distinct category names.",
  inputSchema: list_categories_api_categories_getInputSchema,

  async execute(args: z.infer<typeof list_categories_api_categories_getInputSchema>) {
    const url = `${BASE_URL}/api/categories`;
    const queryParams: Record<string, string> = {};
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      // AUTH EXTENSION POINT: inject Authorization headers here
    };
    const body = undefined;

    const result = await callApi({
      method: "GET",
      url,
      params: queryParams,
      headers,
      body,
    });

    return result;
  },
};
