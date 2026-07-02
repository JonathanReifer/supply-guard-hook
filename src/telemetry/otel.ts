// Minimal OTLP/HTTP logs emitter — no SDK dependency, matches this repo's
// zero-runtime-dependency convention. See aih-security/docs/telemetry-schema.md.
//
// No-op unless OTEL_EXPORTER_OTLP_ENDPOINT_HTTP (or OTEL_EXPORTER_OTLP_ENDPOINT,
// with :4317 swapped for :4318) is set. Never throws — a telemetry failure must
// never affect a hook's security decision.

const SCHEMA_VERSION = "1";
const COMPONENT = "supply-guard-hook";

export interface TelemetryRecord {
  session_id?: string;
  project?: string;
  harness?: string;
  scanner_id?: string;
  event_type: "package_install";
  decision?: "allow" | "ask" | "block";
  severity?: "block" | "warn" | "info";
  atlas_technique?: string;
  owasp_category?: string;
  degraded?: boolean;
  duration_ms?: number;
}

function resolveEndpoint(): string | null {
  const http = process.env.OTEL_EXPORTER_OTLP_ENDPOINT_HTTP;
  if (http) return http;
  const grpc = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (grpc) return grpc.replace(/:4317\/?$/, ":4318");
  return null;
}

type OtlpAttrValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };

function attrValue(value: unknown): OtlpAttrValue {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return { doubleValue: value };
  return { stringValue: String(value) };
}

/**
 * Emits one OTLP log record over HTTP. Resolves once the request settles
 * (success or failure) but never rejects and never throws. This hook process
 * exits immediately after its decision, so callers must await this via
 * flushTelemetry() rather than fire-and-forget it — an unawaited promise
 * would be killed by process.exit() before the write completes.
 */
export async function emitLog(record: TelemetryRecord): Promise<void> {
  const endpoint = resolveEndpoint();
  if (!endpoint) return;

  try {
    const attributes = Object.entries({ schema_version: SCHEMA_VERSION, component: COMPONENT, ...record })
      .filter(([, v]) => v !== undefined)
      .map(([key, value]) => ({ key, value: attrValue(value) }));

    const body = JSON.stringify({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: COMPONENT } },
              { key: "service.namespace", value: { stringValue: "aih-security" } },
            ],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: `${BigInt(Date.now())}000000`,
                  severityText: record.severity ?? "info",
                  body: { stringValue: `${COMPONENT}.${record.event_type}` },
                  attributes,
                },
              ],
            },
          ],
        },
      ],
    });

    await fetch(`${endpoint.replace(/\/$/, "")}/v1/logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(300),
    });
  } catch {
    // fail open — telemetry must never affect a security decision
  }
}

/**
 * Awaits `promise` but gives up after `maxMs` so a slow/unreachable collector
 * never meaningfully delays a hook process that's about to exit.
 */
export async function flushTelemetry(promise: Promise<void>, maxMs = 50): Promise<void> {
  await Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, maxMs))]);
}
