import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { callApi } from "../http-client.js";
import { BASE_URL } from "../config.js";

const get_product_api_products__product_id__getInputSchema = z.object({
  "product_id": z.number().int(),
});

export const get_product_api_products__product_id__getTool: ToolDefinition = {
  name: "get_product_api_products__product_id__get",
  description: "Get Product\n\nReturn a single product by its numeric ID.",
  inputSchema: get_product_api_products__product_id__getInputSchema,

  async execute(args: z.infer<typeof get_product_api_products__product_id__getInputSchema>) {
    const url = `${BASE_URL}/api/products/${encodeURIComponent(String(args["product_id"]))}`;
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
