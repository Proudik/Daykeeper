import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface IncomingItem {
  timestamp: string;
  summary: string;
  durationMinutes?: number;
  endTimestamp?: string;
  source?: string;
  externalId?: string;
  meta?: Record<string, unknown>;
}

interface WebhookPayload {
  items: IncomingItem[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing or invalid Authorization header. Use: Bearer <endpoint_id>|<token>" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawToken = authHeader.slice(7).trim();
    const sepIdx = rawToken.indexOf("|");
    if (sepIdx === -1) {
      return new Response(JSON.stringify({ error: "Invalid token format. Expected: <endpoint_id>|<token>" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const endpointId = rawToken.slice(0, sepIdx);
    const token = rawToken.slice(sepIdx + 1);

    // Hash the token part
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Look up the endpoint by id and token hash
    const { data: endpoint, error: endpointErr } = await supabase
      .from("webhook_endpoints")
      .select("id, user_id, revoked_at")
      .eq("id", endpointId)
      .maybeSingle();

    if (endpointErr || !endpoint) {
      return new Response(JSON.stringify({ error: "Invalid endpoint" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (endpoint.revoked_at) {
      return new Response(JSON.stringify({ error: "This endpoint has been revoked" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify token hash matches — service role bypasses RLS and column privileges
    const { data: endpointRow } = await supabase
      .from("webhook_endpoints")
      .select("token_hash")
      .eq("id", endpointId)
      .maybeSingle();

    if (!endpointRow || endpointRow.token_hash !== tokenHash) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse the payload
    let payload: WebhookPayload;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!payload.items || !Array.isArray(payload.items) || payload.items.length === 0) {
      return new Response(JSON.stringify({ error: "Body must contain a non-empty 'items' array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate and transform items
    const rows: Array<{
      user_id: string;
      endpoint_id: string;
      day: string;
      timestamp: string;
      summary: string;
      duration_minutes: number;
      end_timestamp: string | null;
      source: string | null;
      meta: Record<string, unknown>;
      external_id: string | null;
    }> = [];

    for (const item of payload.items) {
      if (!item.timestamp || !item.summary) {
        return new Response(JSON.stringify({
          error: `Each item must have at least 'timestamp' and 'summary'. Got: ${JSON.stringify(item).slice(0, 200)}`,
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const ts = item.timestamp;
      const day = ts.slice(0, 10);

      rows.push({
        user_id: endpoint.user_id,
        endpoint_id: endpointId,
        day,
        timestamp: ts,
        summary: String(item.summary).slice(0, 500),
        duration_minutes: Math.max(0, Math.floor(item.durationMinutes ?? 0)),
        end_timestamp: item.endTimestamp ?? null,
        source: item.source ? String(item.source).slice(0, 200) : null,
        meta: item.meta ?? {},
        external_id: item.externalId ? String(item.externalId).slice(0, 200) : null,
      });
    }

    // Upsert with dedup on (user_id, endpoint_id, external_id)
    const { error: insertError } = await supabase
      .from("webhook_signals")
      .upsert(rows, {
        onConflict: "user_id,endpoint_id,external_id",
        ignoreDuplicates: false,
      });

    if (insertError) {
      // If the unique constraint doesn't cover items without external_id, just insert
      if (insertError.code === "23505") {
        // Duplicate — acceptable, just skip
      } else {
        // Try inserting one by one for items without external_id
        const { error: simpleInsertError } = await supabase
          .from("webhook_signals")
          .insert(rows.filter((r) => !r.external_id));
        if (simpleInsertError) {
          return new Response(JSON.stringify({ error: "Failed to store signals", detail: simpleInsertError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Update last_used_at on the endpoint
    await supabase
      .from("webhook_endpoints")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", endpointId);

    return new Response(JSON.stringify({ ok: true, accepted: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
