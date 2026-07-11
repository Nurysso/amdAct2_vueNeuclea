import fetch from "node-fetch";
import { BASE_URL } from "./config.js";

export interface ApiCallOptions {
  method: string;
  url: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
}

export async function callApi(options: ApiCallOptions): Promise<unknown> {
  const { method, params = {}, headers = {}, body } = options;

  // Build URL with query parameters
  let url = options.url;
  const queryString = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  ).toString();
  if (queryString) url += `?${queryString}`;

  const fetchOptions: Parameters<typeof fetch>[1] = {
    method,
    headers,
  };

  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);

  const contentType = response.headers.get("content-type") ?? "";
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}: ${responseText}`
    );
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(responseText);
    } catch {
      return responseText;
    }
  }

  return responseText;
}
