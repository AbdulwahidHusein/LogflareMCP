/**
 * Logflare API client functions.
 */

import { LOGFLARE_API_BASE_URL } from "./config.js";
import { LogflareApiConfig } from "./types.js";

/**
 * Executes a BigQuery SQL query against Logflare.
 */
export async function executeQuery(
  sql: string,
  config: LogflareApiConfig
): Promise<unknown> {
  const params = new URLSearchParams({ bq_sql: sql });
  params.append("source", config.sourceToken);

  const response = await fetch(`${LOGFLARE_API_BASE_URL}/api/query?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Logflare API Error: ${await response.text()}`);
  }

  const data = await response.json();
  return data.result || data;
}

/**
 * Fetches all available Logflare sources.
 */
export async function listSources(config: LogflareApiConfig): Promise<unknown> {
  const response = await fetch(`${LOGFLARE_API_BASE_URL}/api/sources`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Logflare API Error: ${await response.text()}`);
  }

  return await response.json();
}

/**
 * Fetches the schema for a specific Logflare source.
 */
export async function getSourceSchema(config: LogflareApiConfig): Promise<unknown> {
  const response = await fetch(
    `${LOGFLARE_API_BASE_URL}/api/sources/${config.sourceToken}/schema`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Logflare API Error: ${await response.text()}`);
  }

  return await response.json();
}

