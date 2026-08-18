import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface GoogleFetchRequest {
  action: "fetch";
  date: string; // YYYY-MM-DD
  user_email: string; // the user to impersonate
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

// ── PEM → ArrayBuffer for Web Crypto importKey ──
function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ── Base64url encode ──
function b64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Create & sign a JWT for service-account domain-wide delegation ──
async function createDelegationToken(
  sa: ServiceAccountKey,
  userEmail: string,
  scopes: string[],
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: sa.private_key_id ?? undefined };
  const payload = {
    iss: sa.client_email,
    sub: userEmail,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

  const keyData = pemToDer(sa.private_key);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );

  return `${unsigned}.${b64urlBuffer(signature)}`;
}

// ── Exchange signed JWT for an access token ──
async function exchangeJwt(jwt: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    let hint = "";
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error === "invalid_grant") {
        hint = " — The service account may not have domain-wide delegation enabled, or the user email is not in the Google Workspace domain. Check that delegation is configured in the Google Workspace admin console.";
      }
    } catch { /* ignore */ }
    throw new Error(`Google token exchange failed: ${response.status} ${errText.slice(0, 200)}${hint}`);
  }

  const data = await response.json();
  return data.access_token as string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Get the user's org
    const { data: member } = await supabase
      .from("organization_members")
      .select("org_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member?.org_id) {
      return new Response(
        JSON.stringify({ error: "No organization found for user" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load Google service account key from provider_tokens
    const { data: credRow } = await supabase
      .from("provider_tokens")
      .select("token_encrypted")
      .eq("org_id", member.org_id)
      .eq("provider", "google")
      .maybeSingle();

    if (!credRow?.token_encrypted) {
      return new Response(
        JSON.stringify({ error: "Google Workspace is not connected. Ask your administrator to set it up." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sa = JSON.parse(credRow.token_encrypted) as ServiceAccountKey;

    if (!sa.client_email || !sa.private_key) {
      return new Response(
        JSON.stringify({ error: "Google service account credentials are incomplete. Reconnect in Settings → Connections." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parse request
    const body = await req.json() as GoogleFetchRequest;
    if (body.action !== "fetch" || !body.date || !body.user_email) {
      return new Response(
        JSON.stringify({ error: "Expected { action: 'fetch', date, user_email }" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Only org admins can impersonate mailboxes via Google Workspace delegation.
    // Regular members can only fetch their own mailbox.
    if (member.role !== "admin" && body.user_email !== user.email) {
      return new Response(
        JSON.stringify({ error: "You can only fetch your own mailbox. Ask an admin to fetch on your behalf." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Mint a delegated access token for the specific user
    const scopes = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
    ];

    let accessToken: string;
    try {
      const jwtToken = await createDelegationToken(sa, body.user_email, scopes);
      accessToken = await exchangeJwt(jwtToken);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Failed to get Google access token" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parse the date and build UTC range
    const dateStart = `${body.date}T00:00:00Z`;
    const dateEnd = `${body.date}T23:59:59Z`;

    // Gmail's after:/before: operators use YYYY/MM/DD format
    const gmailDate = body.date.replace(/-/g, "/");
    const dateObj = new Date(`${body.date}T00:00:00Z`);
    dateObj.setUTCDate(dateObj.getUTCDate() + 1);
    const nextDay = dateObj.toISOString().slice(0, 10).replace(/-/g, "/");

    const errors: string[] = [];
    const items: any[] = [];
    const userEmail = body.user_email;

    // ── Fetch Gmail messages (received + sent) ──
    try {
      // Received: query inbox for date range
      const receivedResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in:inbox+after:${gmailDate}+before:${nextDay}&maxResults=50`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      );

      if (receivedResponse.ok) {
        const receivedData = await receivedResponse.json();
        const messages = receivedData.messages ?? [];
        const messageDetails = await Promise.all(
          messages.slice(0, 20).map(async (msg: any) => {
            const detailRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
              { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
            );
            if (!detailRes.ok) return null;
            return detailRes.json();
          }),
        );

        for (const detail of messageDetails) {
          if (!detail) continue;
          const headers = (detail.payload?.headers ?? []).reduce((acc: Record<string, string>, h: any) => {
            acc[h.name.toLowerCase()] = h.value;
            return acc;
          }, {});

          const ts = parseInt(detail.internalDate) / 1000;
          items.push({
            id: `gmail-recv-${detail.id}`,
            provider: "email",
            timestamp: new Date(ts * 1000).toISOString(),
            summary: headers.subject || "(no subject)",
            meta: {
              sender: headers.from,
              recipient: userEmail,
              subject: headers.subject,
              threadId: detail.threadId,
              direction: "incoming",
              bodySnippet: detail.snippet ?? "",
            },
          });
        }
      } else {
        const errText = await receivedResponse.text();
        errors.push(`Gmail inbox: ${receivedResponse.status} ${errText.slice(0, 150)}`);
      }

      // Sent: query sent mail
      const sentResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in:sent+after:${gmailDate}+before:${nextDay}&maxResults=50`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      );

      if (sentResponse.ok) {
        const sentData = await sentResponse.json();
        const sentMessages = sentData.messages ?? [];
        const sentDetails = await Promise.all(
          sentMessages.slice(0, 20).map(async (msg: any) => {
            const detailRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
              { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
            );
            if (!detailRes.ok) return null;
            return detailRes.json();
          }),
        );

        for (const detail of sentDetails) {
          if (!detail) continue;
          const headers = (detail.payload?.headers ?? []).reduce((acc: Record<string, string>, h: any) => {
            acc[h.name.toLowerCase()] = h.value;
            return acc;
          }, {});

          const ts = parseInt(detail.internalDate) / 1000;
          items.push({
            id: `gmail-sent-${detail.id}`,
            provider: "email",
            timestamp: new Date(ts * 1000).toISOString(),
            summary: headers.subject || "(no subject)",
            meta: {
              sender: userEmail,
              recipient: headers.to,
              subject: headers.subject,
              threadId: detail.threadId,
              direction: "outgoing",
              bodySnippet: detail.snippet ?? "",
            },
          });
        }
      } else {
        const errText = await sentResponse.text();
        errors.push(`Gmail sent: ${sentResponse.status} ${errText.slice(0, 150)}`);
      }
    } catch (err) {
      errors.push(`Gmail: ${err instanceof Error ? err.message : "unknown error"}`);
    }

    // ── Fetch Google Calendar events ──
    try {
      const calResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(dateStart)}&timeMax=${encodeURIComponent(dateEnd)}&singleEvents=true&maxResults=50&orderBy=startTime`,
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      );

      if (calResponse.ok) {
        const calData = await calResponse.json();
        const events = calData.items ?? [];
        for (const ev of events) {
          const start = ev.start?.dateTime ?? ev.start?.date;
          const end = ev.end?.dateTime ?? ev.end?.date;
          let durationMinutes: number | undefined;
          if (start && end) {
            durationMinutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
          }
          items.push({
            id: `gcal-${ev.id}`,
            provider: "calendar",
            timestamp: start ?? dateStart,
            endTimestamp: end,
            durationMinutes,
            summary: ev.summary || "(no title)",
            meta: {
              title: ev.summary,
              attendeeCount: ev.attendees?.length ?? 0,
              accepted: ev.attendees?.some((a: any) => a.self && a.responseStatus === "accepted") ?? false,
            },
          });
        }
      } else {
        const errText = await calResponse.text();
        errors.push(`Calendar: ${calResponse.status} ${errText.slice(0, 150)}`);
      }
    } catch (err) {
      errors.push(`Calendar: ${err instanceof Error ? err.message : "unknown error"}`);
    }

    return new Response(
      JSON.stringify({ ok: true, items, errors: errors.length > 0 ? errors : undefined }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
