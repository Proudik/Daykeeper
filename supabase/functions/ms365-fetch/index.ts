import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Ms365FetchRequest {
  action: "fetch" | "list_users";
  date?: string; // YYYY-MM-DD (for fetch)
  upn?: string; // user principal name (email) whose mailbox/calendar to read
}

interface Ms365ActivityItem {
  id: string;
  provider: "email" | "calendar";
  timestamp: string;
  endTimestamp?: string;
  durationMinutes?: number;
  summary: string;
  meta: {
    sender?: string;
    recipient?: string;
    subject?: string;
    threadId?: string;
    direction?: "incoming" | "outgoing";
    title?: string;
    attendeeCount?: number;
    accepted?: boolean;
    bodySnippet?: string;
  };
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

    const { data: member } = await supabase
      .from("organization_members")
      .select("org_id, role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member) {
      return new Response(
        JSON.stringify({ error: "No organization membership found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json() as Ms365FetchRequest;

    if (body.action !== "fetch" && body.action !== "list_users") {
      return new Response(
        JSON.stringify({ error: "Unknown action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Only org admins can impersonate mailboxes or list tenant users.
    // Regular members can only fetch their own mailbox.
    if (body.action === "list_users" && member.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only organization admins can list tenant users" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (body.action === "fetch" && member.role !== "admin" && body.upn && body.upn !== user.email) {
      return new Response(
        JSON.stringify({ error: "You can only fetch your own mailbox. Ask an admin to fetch on your behalf." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Read MS365 credentials from provider_tokens (org-level) — needed for both actions
    const { data: tokenRow } = await supabase
      .from("provider_tokens")
      .select("token_encrypted")
      .eq("org_id", member.org_id)
      .eq("provider", "microsoft365")
      .maybeSingle();

    if (!tokenRow) {
      return new Response(
        JSON.stringify({ error: "Microsoft 365 is not connected. Ask your admin to set it up." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let creds: { client_id: string; tenant_id: string; client_secret: string };
    try {
      creds = JSON.parse(tokenRow.token_encrypted);
    } catch {
      return new Response(
        JSON.stringify({ error: "Stored MS365 credentials are malformed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Exchange client credentials for an access token (needed for both actions)
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${creds.tenant_id}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: creds.client_id,
          client_secret: creds.client_secret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
      },
    );

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      let hint = "";
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error === "invalid_client") {
          hint = " — The client secret may be expired or the client ID is wrong. Check your Azure app registration.";
        } else if (errJson.error === "invalid_scope") {
          hint = " — The app doesn't have Mail.Read and Calendars.Read application permissions granted. Go to API permissions in Azure and grant admin consent.";
        }
      } catch {
        // ignore
      }
      return new Response(
        JSON.stringify({ error: `Failed to get MS365 access token: ${tokenResponse.status} ${errText.slice(0, 200)}${hint}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token as string;

    // ── list_users: return tenant directory for mailbox picker ──
    if (body.action === "list_users") {
      const usersResponse = await fetch(
        "https://graph.microsoft.com/v1.0/users?$select=displayName,mail,userPrincipalName&$top=50&$orderby=displayName",
        { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
      );

      if (!usersResponse.ok) {
        const errText = await usersResponse.text();
        let hint = "";
        try {
          const errJson = JSON.parse(errText);
          if (errJson.error?.code === "Authorization_RequestDenied") {
            hint = " — The app needs User.Read.All permission (Application) with admin consent granted in Azure.";
          }
        } catch { /* ignore */ }
        return new Response(
          JSON.stringify({ error: `Failed to list users: ${usersResponse.status} ${errText.slice(0, 200)}${hint}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const usersData = await usersResponse.json();
      const users = (usersData.value ?? []).map((u: any) => ({
        displayName: u.displayName ?? "",
        mail: u.mail ?? "",
        userPrincipalName: u.userPrincipalName ?? "",
      })).filter((u: any) => u.mail || u.userPrincipalName);

      return new Response(
        JSON.stringify({ ok: true, users }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── fetch: read emails and calendar for a specific user ──
    const { date, upn } = body;
    if (!date || !upn) {
      return new Response(
        JSON.stringify({ error: "Date and UPN (email) are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build date range for Graph API (UTC ISO strings)
    const startIso = `${date}T00:00:00Z`;
    const endIso = `${date}T23:59:59Z`;

    // Fetch emails (received + sent) and calendar events in parallel
    // Collect errors so we can surface them to the user
    const errors: string[] = [];

    const [receivedResult, sentResult, calendarResult] = await Promise.all([
      fetchReceivedEmails(accessToken, upn, startIso, endIso),
      fetchSentEmails(accessToken, upn, startIso, endIso),
      fetchCalendarEvents(accessToken, upn, startIso, endIso),
    ]);

    const items: Ms365ActivityItem[] = [];

    if (receivedResult.ok) items.push(...receivedResult.items);
    else errors.push(receivedResult.error);

    if (sentResult.ok) items.push(...sentResult.items);
    else errors.push(sentResult.error);

    if (calendarResult.ok) items.push(...calendarResult.items);
    else errors.push(calendarResult.error);

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

interface FetchResult {
  ok: boolean;
  items: Ms365ActivityItem[];
  error: string;
}

async function graphFetch(url: string, accessToken: string): Promise<any[]> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });

  if (!response.ok) {
    const errText = await response.text();
    let hint = "";
    try {
      const errJson = JSON.parse(errText);
      const code = errJson.error?.code ?? "";
      if (response.status === 403 || code === "Authorization_RequestDenied") {
        hint = " — Admin consent has not been granted for this permission. Go to Azure > API permissions > Grant admin consent.";
      } else if (code === "ErrorItemNotFound" || response.status === 404) {
        hint = ` — The email address "${url.split('/users/')[1]?.split('/')[0]}" was not found in this tenant. Check the UPN.`;
      }
    } catch {
      // ignore
    }
    throw new Error(`Graph API ${response.status}: ${errText.slice(0, 300)}${hint}`);
  }

  const data = await response.json();
  return data.value ?? [];
}

async function fetchReceivedEmails(
  accessToken: string,
  upn: string,
  startIso: string,
  endIso: string,
): Promise<FetchResult> {
  const filter = `receivedDateTime ge ${startIso} and receivedDateTime le ${endIso}`;
  const select = "subject,from,toRecipients,receivedDateTime,internetMessageId,hasAttachments,bodyPreview";
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}/messages?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=50&$orderby=receivedDateTime`;

  try {
    const messages = await graphFetch(url, accessToken);
    const items = messages.map((msg: any): Ms365ActivityItem => {
      const sender = msg.from?.emailAddress?.address ?? "";
      const recipients = (msg.toRecipients ?? [])
        .map((r: any) => r.emailAddress?.address ?? "")
        .filter(Boolean)
        .join(", ");
      return {
        id: `ms365-email-${msg.id}`,
        provider: "email",
        timestamp: msg.receivedDateTime,
        summary: msg.subject || "(no subject)",
        meta: {
          sender,
          recipient: recipients,
          subject: msg.subject || "",
          threadId: msg.internetMessageId ?? "",
          direction: "incoming",
          bodySnippet: msg.bodyPreview ?? "",
        },
      };
    });
    return { ok: true, items, error: "" };
  } catch (e) {
    return { ok: false, items: [], error: `Received emails: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function fetchSentEmails(
  accessToken: string,
  upn: string,
  startIso: string,
  endIso: string,
): Promise<FetchResult> {
  const filter = `sentDateTime ge ${startIso} and sentDateTime le ${endIso}`;
  const select = "subject,toRecipients,sentDateTime,internetMessageId,hasAttachments,bodyPreview";
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}/mailFolders/sentItems/messages?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=50&$orderby=sentDateTime`;

  try {
    const messages = await graphFetch(url, accessToken);
    const items = messages.map((msg: any): Ms365ActivityItem => {
      const recipients = (msg.toRecipients ?? [])
        .map((r: any) => r.emailAddress?.address ?? "")
        .filter(Boolean)
        .join(", ");
      return {
        id: `ms365-email-sent-${msg.id}`,
        provider: "email",
        timestamp: msg.sentDateTime,
        summary: msg.subject || "(no subject)",
        meta: {
          sender: upn,
          recipient: recipients,
          subject: msg.subject || "",
          threadId: msg.internetMessageId ?? "",
          direction: "outgoing",
          bodySnippet: msg.bodyPreview ?? "",
        },
      };
    });
    return { ok: true, items, error: "" };
  } catch (e) {
    return { ok: false, items: [], error: `Sent emails: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function fetchCalendarEvents(
  accessToken: string,
  upn: string,
  startIso: string,
  endIso: string,
): Promise<FetchResult> {
  const select = "subject,start,end,attendees,organizer,responseStatus";
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}/calendarView?startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(endIso)}&$select=${select}&$top=50`;

  try {
    const events = await graphFetch(url, accessToken);
    const items = events.map((evt: any): Ms365ActivityItem => {
      const startStr = evt.start?.dateTime ?? startIso;
      const endStr = evt.end?.dateTime ?? endIso;
      const durationMin = calcDurationMinutes(startStr, endStr);
      const attendeeCount = (evt.attendees ?? []).length;
      const accepted = evt.responseStatus?.response === "accepted" ||
        evt.responseStatus?.response === "organizer";

      return {
        id: `ms365-cal-${evt.id}`,
        provider: "calendar",
        timestamp: startStr,
        endTimestamp: endStr,
        durationMinutes: durationMin,
        summary: evt.subject || "(no title)",
        meta: {
          title: evt.subject || "",
          attendeeCount,
          accepted,
        },
      };
    });
    return { ok: true, items, error: "" };
  } catch (e) {
    return { ok: false, items: [], error: `Calendar: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function calcDurationMinutes(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Math.max(0, Math.round((end - start) / 60000));
}
