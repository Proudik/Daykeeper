import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Rollup {
  date: string;             // YYYY-MM-DD local date
  bucket_start: string;     // ISO UTC instant
  domain: string;
  duration_s: number;
  session_count: number;
  edited: boolean;
  fields_touched: number;
  submits: number;
  forms: string[] | null;
  hints: { path: string | null; title: string | null }[] | null;
}

interface SignalsPayload {
  v: number;
  source: string;
  device_id: string;
  tz: string;
  days: string[];           // YYYY-MM-DD local dates the extension is reporting
  rollups: Rollup[];
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameDate(a: string, b: string): boolean {
  return new Date(a).getTime() === new Date(b).getTime();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonRes({ error: "Method not allowed" }, 405);
  }

  try {
    // --- Authenticate via Authorization: Bearer <plaintext device token> ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!bearerMatch) {
      return jsonRes({ error: "Missing Authorization header" }, 401);
    }
    const plaintextToken = bearerMatch[1].trim();
    if (!plaintextToken) {
      return jsonRes({ error: "Empty device token in Authorization header" }, 401);
    }

    const body = await req.json() as SignalsPayload;

    if (!Array.isArray(body.rollups) || !Array.isArray(body.days)) {
      return jsonRes({ error: "Missing rollups or days in payload" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Validate device token: SHA-256 hash, match against token_hash ---
    const tokenHash = await sha256Hex(plaintextToken);
    const { data: device, error: devErr } = await supabase
      .from("daykeeper_devices")
      .select("id, user_id, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (devErr || !device) {
      return jsonRes({ error: "Invalid device token" }, 401);
    }

    if (device.revoked_at) {
      return jsonRes({ error: "Device has been revoked" }, 401);
    }

    // --- Update last_seen_at ---
    await supabase
      .from("daykeeper_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", device.id);

    // --- Upsert rollups on (user_id, day, bucket_start, domain) ---
    // The extension sends rollups throughout the day. The same bucket+domain
    // may arrive again with a growing duration_s — upsert replaces the old
    // value with the new one. Different buckets are inserted as new rows.
    // We never delete rows that aren't in the payload — each send adds or
    // updates data, it doesn't replace the entire day.
    if (body.rollups.length > 0) {
      const rows = body.rollups.map((r) => ({
        user_id: device.user_id,
        device_id: device.id,
        day: r.date,
        bucket_start: r.bucket_start,
        domain: r.domain,
        duration_s: Math.max(0, Math.floor(r.duration_s)),
        session_count: Math.max(0, Math.floor(r.session_count)),
        fields_touched: Math.max(0, Math.floor(r.fields_touched)),
        submits: Math.max(0, Math.floor(r.submits)),
        forms: Array.isArray(r.forms) ? r.forms.length : 0,
        edited: Boolean(r.edited),
        hints: r.hints ? JSON.stringify(r.hints) : null,
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertErr } = await supabase
        .from("browser_signals")
        .upsert(rows, {
          onConflict: "user_id,day,bucket_start,domain",
        });

      if (upsertErr) {
        return jsonRes({ error: "Failed to store signals: " + upsertErr.message }, 500);
      }
    }

    return jsonRes({ ok: true, accepted: body.rollups.length });
  } catch (err) {
    return jsonRes({ error: (err as Error).message }, 500);
  }
});
