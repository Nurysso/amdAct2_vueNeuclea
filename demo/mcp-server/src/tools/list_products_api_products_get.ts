import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { callApi } from "../http-client.js";
import { BASE_URL } from "../config.js";

const list_products_api_products_getInputSchema = z.object({
  "category": z.unknown().optional().describe("Filter by category name"),
  "page": z.number().int().optional().describe("Page number (1-indexed)"),
  "limit": z.number().int().optional().describe("Items per page"),
});

export const list_products_api_products_getTool: ToolDefinition = {
  name: "list_products_api_products_get",
  description: "List Products\n\nReturn a paginated list of products.\nSupports optional ?category= filter and ?page= / ?limit= pagination.",
  inputSchema: list_products_api_products_getInputSchema,

  async execute(args: z.infer<typeof list_products_api_products_getInputSchema>) {
    const url = `${BASE_URL}/api/products`;
    const queryParams: Record<string, string> = {};
      if (args["category"] !== undefined) queryParams["category"] = String(args["category"]);
      if (args["page"] !== undefined) queryParams["page"] = String(args["page"]);
      if (args["limit"] !== undefined) queryParams["limit"] = String(args["limit"]);
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
