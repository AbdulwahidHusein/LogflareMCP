/**
 * Utility functions for time parsing and field analysis.
 */

import { FieldInfo } from "./types.js";

/**
 * Parses various time formats to BigQuery TIMESTAMP expressions.
 */
export function parseTimeToTimestamp(timeStr: string): string {
  const lower = timeStr.toLowerCase().trim();

  if (lower === "now" || lower === "current") {
    return "CURRENT_TIMESTAMP()";
  }

  const intervalMap: Record<string, string> = {
    second: "SECOND",
    minute: "MINUTE",
    hour: "HOUR",
    day: "DAY",
    week: "WEEK",
    month: "MONTH",
    year: "YEAR",
  };

  const agoMatch = lower.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i);
  if (agoMatch) {
    const amount = parseInt(agoMatch[1]);
    const unit = intervalMap[agoMatch[2].toLowerCase()];
    return `TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${amount} ${unit})`;
  }

  const lastMatch = lower.match(/last\s+(\d+)\s*(second|minute|hour|day|week|month|year)s?/i);
  if (lastMatch) {
    const amount = parseInt(lastMatch[1]);
    const unit = intervalMap[lastMatch[2].toLowerCase()];
    return `TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${amount} ${unit})`;
  }

  if (lower === "yesterday" || lower === "today") {
    return `TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)`;
  }

  const date = new Date(timeStr);
  if (!isNaN(date.getTime())) {
    return `TIMESTAMP('${date.toISOString()}')`;
  }

  const unixSeconds = parseFloat(timeStr);
  if (!isNaN(unixSeconds) && unixSeconds > 0 && unixSeconds > 946684800) {
    const dateFromUnix = new Date(unixSeconds * 1000);
    return `TIMESTAMP('${dateFromUnix.toISOString()}')`;
  }

  throw new Error(
    `Invalid time format: ${timeStr}. Use ISO 8601, relative time (e.g., '1 hour ago'), or Unix timestamp.`
  );
}

/**
 * Parses time range string to hours.
 */
export function parseTimeRangeToHours(timeRange: string): number {
  if (timeRange.includes("h")) {
    return parseInt(timeRange);
  }
  if (timeRange.includes("d")) {
    return parseInt(timeRange) * 24;
  }
  return 24;
}

/**
 * Analyzes log objects to discover field structure and nested fields.
 */
export function analyzeFieldStructure(
  logs: Record<string, unknown>[]
): Record<string, FieldInfo> {
  const fieldAnalysis: Record<string, FieldInfo> = {};

  const analyzeObject = (obj: Record<string, unknown>, prefix = ""): void => {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (!fieldAnalysis[fullKey]) {
        fieldAnalysis[fullKey] = {
          type: typeof value,
          sampleValues: [],
          isNested: false,
        };
      }

      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        fieldAnalysis[fullKey].isNested = true;
        analyzeObject(value as Record<string, unknown>, fullKey);
      } else {
        if (fieldAnalysis[fullKey].sampleValues.length < 3) {
          fieldAnalysis[fullKey].sampleValues.push(value);
        }
      }
    }
  };

  logs.forEach((log) => {
    analyzeObject(log);
  });

  return fieldAnalysis;
}

