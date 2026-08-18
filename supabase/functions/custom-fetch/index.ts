import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function formatDateParam(iso: string, format: string): string | number {
  const d = new Date(iso);
  if (format === "unix") return Math.floor(d.getTime() / 1000);
  if (format === "YYYY-MM-DD") return d.toISOString().slice(0, 10);
  return iso;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action = body.action as string;

    if (action === "test") {
      // Test a connector config without saving — caller provides full config inline
      const { config, api_key } = body;
      const testResult = await fetchFromConnector(config, api_key, { start: new Date(Date.now() - 86400000).toISOString(), end: new Date().toISOString() });
      return new Response(JSON.stringify({ ok: true, itemCount: testResult.length, sample: testResult.slice(0, 3) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "fetch") {
      const connectorId = body.connector_id as string;
      const dateRange = body.date_range as { start: string; end: string };

      // Load connector from DB (service role bypasses RLS, can read api_key_encrypted)
      const { data: connector, error: connErr } = await supabase
        .from("custom_connectors")
        .select("*")
        .eq("id", connectorId)
        .maybeSingle();

      if (connErr || !connector) {
        return new Response(JSON.stringify({ ok: false, error: "Connector not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify the user belongs to the connector's org
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      if (!profile || profile.org_id !== connector.org_id) {
        return new Response(JSON.stringify({ ok: false, error: "Not authorized for this connector" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const items = await fetchFromConnector(connector, connector.api_key_encrypted, dateRange);
      return new Response(JSON.stringify({ ok: true, items }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function fetchFromConnector(
  config: {
    base_url: string;
    endpoint_path: string;
    http_method: string;
    auth_type: string;
    date_param_name: string;
    date_param_format: string;
    end_date_param_name: string | null;
    response_items_path: string | null;
    field_mapping: Record<string, unknown>;
    extra_headers: Record<string, string> | null;
  },
  apiKey: string | null,
  dateRange: { start: string; end: string },
): Promise<unknown[]> {
  const url = new URL(config.base_url.replace(/\/$/, "") + config.endpoint_path);

  const startVal = formatDateParam(dateRange.start, config.date_param_format);
  const endVal = formatDateParam(dateRange.end, config.date_param_format);

  if (config.http_method === "GET") {
    if (config.date_param_name) url.searchParams.set(config.date_param_name, String(startVal));
    if (config.end_date_param_name) url.searchParams.set(config.end_date_param_name, String(endVal));
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (config.extra_headers) {
    for (const [key, val] of Object.entries(config.extra_headers)) {
      if (key.trim()) headers[key] = val;
    }
  }

  if (config.auth_type === "bearer" && apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (config.auth_type === "api_key" && apiKey) {
    headers["X-API-Key"] = apiKey;
  } else if (config.auth_type === "basic" && apiKey) {
    headers["Authorization"] = `Basic ${btoa(apiKey)}`;
  }

  const fetchOpts: RequestInit = { method: config.http_method, headers };
  if (config.http_method === "POST") {
    const body: Record<string, unknown> = {};
    if (config.date_param_name) body[config.date_param_name] = startVal;
    if (config.end_date_param_name) body[config.end_date_param_name] = endVal;
    fetchOpts.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), fetchOpts);
  if (!response.ok) {
    throw new Error(`API returned ${response.status}: ${await response.text().catch(() => "unknown")}`);
  }

  const json = await response.json();
  const items = config.response_items_path
    ? (getByPath(json, config.response_items_path) as unknown[])
    : Array.isArray(json) ? json : [];

  if (!Array.isArray(items)) return [];

  const mapping = config.field_mapping as {
    id?: string; timestamp?: string; summary?: string;
    durationMinutes?: string; endTimestamp?: string;
    meta?: Record<string, string>;
  };

  return items.map((raw, i) => {
    const obj = raw as Record<string, unknown>;
    const get = (path?: string) => (path ? getByPath(obj, path) : undefined);

    // Try the mapped summary path first, then fall back to common title fields
    let summary = get(mapping.summary);
    if (summary == null || summary === "") {
      // Notion-style: properties.<Name>.title[0].plain_text — scan all properties
      const props = getByPath(obj, "properties");
      if (props && typeof props === "object") {
        for (const [, val] of Object.entries(props as Record<string, unknown>)) {
          const titleArr = getByPath(val as Record<string, unknown>, "title");
          if (Array.isArray(titleArr) && titleArr.length > 0) {
            const plain = getByPath((titleArr[0] as Record<string, unknown>), "plain_text");
            if (plain) { summary = plain; break; }
          }
        }
      }
    }
    if (summary == null || summary === "") {
      // Try common generic field names
      for (const k of ["title", "name", "subject", "summary", "label", "text", "content", "description"]) {
        const v = getByPath(obj, k);
        if (v && typeof v === "string") { summary = v; break; }
      }
    }

    // Try the mapped timestamp, then fall back to common date fields
    let ts = get(mapping.timestamp);
    if (ts == null || ts === "") {
      for (const k of ["created_time", "last_edited_time", "timestamp", "date", "created_at", "updated_at"]) {
        const v = getByPath(obj, k);
        if (v && typeof v === "string") { ts = v; break; }
      }
    }

    // Extract a URL for deep-linking to the source item
    let url = get(mapping.url) as string | undefined;
    if (!url) {
      // Notion provides a top-level `url` field on each page
      const rawUrl = getByPath(obj, "url");
      if (rawUrl && typeof rawUrl === "string") url = rawUrl;
    }
    if (!url) {
      for (const k of ["url", "link", "href", "web_url", "permalink"]) {
        const v = getByPath(obj, k);
        if (v && typeof v === "string" && (v.startsWith("http://") || v.startsWith("https://"))) { url = v; break; }
      }
    }

    const meta: Record<string, unknown> = mapping.meta
      ? Object.fromEntries(
          Object.entries(mapping.meta).map(([k, v]) => [k, get(v as string)])
        )
      : {};
    if (url) meta.url = url;

    return {
      id: String(get(mapping.id) ?? i),
      provider: "custom",
      timestamp: String(ts ?? new Date().toISOString()),
      summary: String(summary ?? "Activity"),
      durationMinutes: get(mapping.durationMinutes) != null ? Number(get(mapping.durationMinutes)) : undefined,
      endTimestamp: get(mapping.endTimestamp) ? String(get(mapping.endTimestamp)) : undefined,
      meta,
    };
  });
}
