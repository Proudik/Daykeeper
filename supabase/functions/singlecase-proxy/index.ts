import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TestConnectionRequest {
  action: "test";
  workspace_url: string;
  token: string;
}

interface SaveTokenRequest {
  action: "save";
  workspace_url: string;
  token: string;
}

interface RemoveTokenRequest {
  action: "remove";
}

interface FetchRequest {
  action: "fetch";
  path: string;
}

interface SaveMs365Request {
  action: "save_ms365";
  client_id: string;
  tenant_id: string;
  client_secret: string;
}

interface SaveGoogleSaRequest {
  action: "save_google_sa";
  service_account_key: string; // JSON key file content
}

interface SyncRequest {
  action: "sync";
}

type RequestBody = TestConnectionRequest | SaveTokenRequest | RemoveTokenRequest | FetchRequest | SaveMs365Request | SaveGoogleSaRequest | SyncRequest;

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

    // Verify the user is an org admin
    const { data: member } = await supabase
      .from("organization_members")
      .select("org_id, role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member || member.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Only organization admins can manage SingleCase connections" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json() as RequestBody;

    switch (body.action) {
      case "test":
        return await handleTestConnection(body, corsHeaders);
      case "save":
        return await handleSaveToken(body, supabase, member.org_id, corsHeaders);
      case "remove":
        return await handleRemoveToken(supabase, member.org_id, corsHeaders);
      case "fetch":
        return await handleFetch(body, supabase, member.org_id, corsHeaders);
      case "save_ms365":
        return await handleSaveMs365(body, supabase, member.org_id, corsHeaders);
      case "save_google_sa":
        return await handleSaveGoogleSa(body, supabase, member.org_id, corsHeaders);
      case "sync":
        return await handleSync(supabase, member.org_id, corsHeaders);
      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function normalizeBaseUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (!url) throw new Error("Workspace URL is required");
  if (!/^https?:\/\//.test(url)) url = `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid workspace URL");
  }
  if (parsed.protocol !== "https:") throw new Error("Workspace URL must use HTTPS");
  return parsed.origin;
}

async function handleTestConnection(
  body: TestConnectionRequest,
  cors: Record<string, string>,
): Promise<Response> {
  const { workspace_url, token } = body;

  if (!workspace_url || !token) {
    return new Response(
      JSON.stringify({ error: "Workspace URL and token are required" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(workspace_url);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Invalid workspace URL" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const cleanToken = token.trim().replace(/^Bearer\s+/i, "");

  // Diagnostic: confirm what we received (mask for safety)
  const tokenDiag = `token received: length=${cleanToken.length}, prefix=${cleanToken.slice(0, 4)}***, workspace=${workspace_url}`;

  const headerFormats: Record<string, string>[] = [
    { "Authentication": cleanToken },
  ];

  const diagnostics: string[] = [];

  // Probe the base URL to understand the workspace structure
  try {
    const probeResponse = await fetch(baseUrl, { redirect: "follow" });
    const probeBody = await probeResponse.text();
    diagnostics.push(`BASE ${baseUrl}: HTTP ${probeResponse.status}, content-type=${probeResponse.headers.get("content-type") ?? "none"}, body=${probeBody.slice(0, 200)}`);
  } catch (err) {
    diagnostics.push(`BASE: network error ${err instanceof Error ? err.message : "unknown"}`);
  }

  for (const authHeader of headerFormats) {
    const headerName = Object.keys(authHeader)[0];
    try {
      const response = await fetch(`${baseUrl}/publicapi/v1/clients`, {
        headers: { ...authHeader, "Accept": "application/json" },
      });

      let bodySnippet = "";
      try { bodySnippet = (await response.text()).slice(0, 300); } catch { /* ignore */ }
      diagnostics.push(`${headerName}: HTTP ${response.status} ${bodySnippet}`);

      if (response.ok) {
        const workspaceName = baseUrl.replace(/^https?:\/\//, '');
        return new Response(
          JSON.stringify({ ok: true, workspace_name: workspaceName }),
          { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      diagnostics.push(`${headerName}: network error ${msg}`);
    }
  }

  // All formats rejected — return full diagnostics
  return new Response(
    JSON.stringify({ error: `Token rejected. ${tokenDiag} | Diagnostics: ${diagnostics.join(" | ")}` }),
    { status: 401, headers: { ...cors, "Content-Type": "application/json" } },
  );
}

async function handleSaveToken(
  body: SaveTokenRequest,
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const { workspace_url, token } = body;

  if (!workspace_url || !token) {
    return new Response(
      JSON.stringify({ error: "Workspace URL and token are required" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(workspace_url);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Invalid workspace URL" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const cleanToken = token.trim().replace(/^Bearer\s+/i, "");

  const headerFormats: Record<string, string>[] = [
    { "Authentication": cleanToken },
  ];

  const diagnostics: string[] = [];
  let testOk = false;

  for (const authHeader of headerFormats) {
    const headerName = Object.keys(authHeader)[0];
    try {
      const response = await fetch(`${baseUrl}/publicapi/v1/clients`, {
        headers: { ...authHeader, "Accept": "application/json" },
        redirect: "manual",
      });
      let bodySnippet = "";
      try { bodySnippet = (await response.text()).slice(0, 300); } catch { /* ignore */ }
      diagnostics.push(`${headerName}: HTTP ${response.status} ${bodySnippet}`);
      if (response.ok) { testOk = true; break; }
    } catch { /* try next */ }
  }

  if (!testOk) {
    return new Response(
      JSON.stringify({ error: `Token rejected. Diagnostics: ${diagnostics.join(" | ")}` }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const workspaceName = baseUrl.replace(/^https?:\/\//, '');

  try {
    // Upsert the token (encrypted at rest by Supabase)
    const { error: upsertError } = await supabase
      .from("provider_tokens")
      .upsert(
        {
          org_id: orgId,
          provider: "singlecase",
          token_encrypted: cleanToken,
          scopes: ["read"],
          connected_at: new Date().toISOString(),
          last_refreshed_at: null,
        },
        { onConflict: "org_id,provider" },
      );

    if (upsertError) {
      return new Response(
        JSON.stringify({ error: "Failed to save token" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Update org workspace URL
    await supabase
      .from("organizations")
      .update({ workspace_subdomain: baseUrl })
      .eq("id", orgId);

    // Auto-sync reference data (non-fatal — save succeeds even if sync fails)
    let syncResult: SyncResult | null = null;
    let syncError: string | null = null;
    try {
      syncResult = await syncSingleCaseData(supabase, orgId, baseUrl, cleanToken);
    } catch (err) {
      syncError = err instanceof Error ? err.message : "Unknown sync error";
    }

    return new Response(
      JSON.stringify({ ok: true, workspace_name: workspaceName, synced: syncResult, syncError }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return new Response(
      JSON.stringify({ error: `Network failure: ${msg}` }),
      { status: 504, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
}

async function handleRemoveToken(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const { error } = await supabase
    .from("provider_tokens")
    .delete()
    .eq("org_id", orgId)
    .eq("provider", "singlecase");

  if (error) {
    return new Response(
      JSON.stringify({ error: "Failed to remove token" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  await supabase
    .from("organizations")
    .update({ workspace_subdomain: null })
    .eq("id", orgId);

  return new Response(
    JSON.stringify({ ok: true }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
  );
}

async function handleSaveMs365(
  body: SaveMs365Request,
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const { client_id, tenant_id, client_secret } = body;
  if (!client_id || !tenant_id || !client_secret) {
    return new Response(
      JSON.stringify({ error: "Client ID, Tenant ID, and Client Secret are all required" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const { error } = await supabase
    .from("provider_tokens")
    .upsert(
      {
        org_id: orgId,
        provider: "microsoft365",
        token_encrypted: JSON.stringify({ client_id, tenant_id, client_secret }),
        scopes: ["read"],
        connected_at: new Date().toISOString(),
        last_refreshed_at: null,
      },
      { onConflict: "org_id,provider" },
    );

  if (error) {
    return new Response(
      JSON.stringify({ error: "Failed to save Microsoft 365 credentials" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
  );
}

async function handleSaveGoogleSa(
  body: SaveGoogleSaRequest,
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const { service_account_key } = body;
  if (!service_account_key) {
    return new Response(
      JSON.stringify({ error: "service_account_key is required" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  let parsed: { client_email?: string; private_key?: string; private_key_id?: string };
  try {
    parsed = JSON.parse(service_account_key);
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON — paste the entire contents of the service account JSON key file." }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    return new Response(
      JSON.stringify({ error: "The JSON key must contain client_email and private_key fields." }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const { error } = await supabase
    .from("provider_tokens")
    .upsert(
      {
        org_id: orgId,
        provider: "google",
        token_encrypted: service_account_key,
        scopes: [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/calendar.readonly",
        ],
        connected_at: new Date().toISOString(),
        last_refreshed_at: new Date().toISOString(),
      },
      { onConflict: "org_id,provider" },
    );

  if (error) {
    return new Response(
      JSON.stringify({ error: "Failed to save Google service account credentials" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, client_email: parsed.client_email }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
  );
}

async function handleFetch(
  body: FetchRequest,
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const { data: tokenRow } = await supabase
    .from("provider_tokens")
    .select("token_encrypted")
    .eq("org_id", orgId)
    .eq("provider", "singlecase")
    .maybeSingle();

  if (!tokenRow) {
    return new Response(
      JSON.stringify({ error: "SingleCase not connected" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("workspace_subdomain")
    .eq("id", orgId)
    .maybeSingle();

  if (!org?.workspace_subdomain) {
    return new Response(
      JSON.stringify({ error: "Workspace URL not configured" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const baseUrl = org.workspace_subdomain;

  // Prevent SSRF: reject absolute URLs, protocol-relative URLs, or paths
  // that escape the base origin. Only allow relative API paths.
  const rawPath = body.path;
  if (!rawPath || typeof rawPath !== "string") {
    return new Response(
      JSON.stringify({ error: "Path is required" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
  if (/^[a-z]+:\/\\/i.test(rawPath) || rawPath.startsWith("//")) {
    return new Response(
      JSON.stringify({ error: "Absolute URLs are not allowed" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
  const cleanPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const targetUrl = new URL(`${baseUrl}${cleanPath}`);
  if (targetUrl.origin !== new URL(baseUrl).origin) {
    return new Response(
      JSON.stringify({ error: "Request must stay within the configured workspace origin" }),
      { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  try {
    const response = await fetch(targetUrl.href, {
      headers: {
        "Authentication": tokenRow.token_encrypted,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `SingleCase API error: ${response.status}` }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    return new Response(
      JSON.stringify({ ok: true, data }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return new Response(
      JSON.stringify({ error: `Network failure: ${msg}` }),
      { status: 504, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
}

// ─── Sync reference data from SingleCase into the database ────────────────

async function handleSync(
  supabase: any,
  orgId: string,
  cors: Record<string, string>,
): Promise<Response> {
  try {
    // Get the stored token and workspace URL
    const { data: tokenRow, error: tokenErr } = await supabase
      .from("provider_tokens")
      .select("token_encrypted")
      .eq("org_id", orgId)
      .eq("provider", "singlecase")
      .single();

    if (tokenErr || !tokenRow) {
      return new Response(
        JSON.stringify({ error: `SingleCase not connected: ${tokenErr?.message ?? 'no token'}` }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const { data: orgRow, error: orgErr } = await supabase
      .from("organizations")
      .select("singlecase_base_url, workspace_subdomain")
      .eq("id", orgId)
      .single();

    if (orgErr || !orgRow) {
      return new Response(
        JSON.stringify({ error: `Organization not found: ${orgErr?.message ?? 'not found'}` }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const baseUrl = orgRow.singlecase_base_url || orgRow.workspace_subdomain;
    if (!baseUrl) {
      return new Response(
        JSON.stringify({ error: "Workspace URL not configured" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const result = await syncSingleCaseData(supabase, orgId, baseUrl, tokenRow.token_encrypted);
    return new Response(
      JSON.stringify({ ok: true, ...result }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: `Sync failed: ${msg}` }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
}

interface SyncResult {
  clients: number;
  matters: number;
  contacts: number;
  matterContacts: number;
  activityTypes: number;
  emailLookups: number;
}

async function syncSingleCaseData(
  supabase: any,
  orgId: string,
  baseUrl: string,
  token: string,
): Promise<SyncResult> {
  const headers: Record<string, string> = {
    "Authentication": token,
    "Accept": "application/json",
  };

  // 1. Fetch all clients
  const clientsResp = await fetch(`${baseUrl}/publicapi/v1/clients`, { headers });
  if (!clientsResp.ok) {
    const errBody = await clientsResp.text().catch(() => "");
    throw new Error(`Failed to fetch clients: HTTP ${clientsResp.status} ${errBody.slice(0, 200)}`);
  }
  const clientsRaw = await clientsResp.json();
  // Handle various response shapes: array, {data: [...]}, {clients: [...]}
  const clients: any[] = Array.isArray(clientsRaw) ? clientsRaw : (clientsRaw?.data ?? clientsRaw?.clients ?? clientsRaw?.items ?? []);

  // 2. Fetch all cases — try bulk endpoint first, fall back to per-client in parallel
  let allCases: any[] = [];
  try {
    const allCasesResp = await fetch(`${baseUrl}/publicapi/v1/cases`, { headers });
    if (allCasesResp.ok) {
      const casesRaw = await allCasesResp.json();
      allCases = Array.isArray(casesRaw) ? casesRaw : (casesRaw?.data ?? casesRaw?.cases ?? casesRaw?.items ?? []);
    }
  } catch {
    // ignore — will try per-client
  }

  if (allCases.length === 0 && clients.length > 0) {
    const casePromises = clients.map((client) =>
      fetch(`${baseUrl}/publicapi/v1/client_cases/${client.id}`, { headers })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    );
    const caseResults = await Promise.all(casePromises);
    for (const casesRaw of caseResults) {
      if (!casesRaw) continue;
      const cases: any[] = Array.isArray(casesRaw) ? casesRaw : (casesRaw?.data ?? casesRaw?.cases ?? casesRaw?.items ?? []);
      allCases.push(...cases);
    }
  }

  // 3. Fetch all contacts
  let allContacts: any[] = [];
  try {
    const contactsResp = await fetch(`${baseUrl}/publicapi/v1/contacts`, { headers });
    if (contactsResp.ok) {
      const contactsRaw = await contactsResp.json();
      allContacts = Array.isArray(contactsRaw) ? contactsRaw : (contactsRaw?.data ?? contactsRaw?.contacts ?? contactsRaw?.items ?? []);
    }
  } catch {
    // contacts may not be available
  }

  // 4. Fetch activity types
  let activityTypes: any[] = [];
  try {
    const atResp = await fetch(`${baseUrl}/publicapi/v1/activity_types`, { headers });
    if (atResp.ok) {
      const atRaw = await atResp.json();
      activityTypes = Array.isArray(atRaw) ? atRaw : (atRaw?.data ?? atRaw?.activity_types ?? atRaw?.items ?? []);
    }
  } catch {
    // activity types may not be available
  }

  // 5. Upsert clients
  let clientCount = 0;
  if (clients.length > 0) {
    const clientRows = clients.map((c) => ({
      org_id: orgId,
      external_id: c.id,
      name: c.name,
      primary_domain: null,
      synced_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("clients")
      .upsert(clientRows, { onConflict: "org_id,external_id" });
    if (error) throw new Error(`Client upsert failed: ${error.message}`);
    clientCount = clientRows.length;
  }

  // 6. Upsert contacts
  let contactCount = 0;
  if (allContacts.length > 0) {
    const contactRows = allContacts.map((c) => ({
      org_id: orgId,
      external_id: c.id,
      display_name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || c.id,
      emails: c.email ? [c.email.toLowerCase()] : [],
      synced_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("contacts")
      .upsert(contactRows, { onConflict: "org_id,external_id" });
    if (error) throw new Error(`Contact upsert failed: ${error.message}`);
    contactCount = contactRows.length;
  }

  // 7. Upsert matters
  let matterCount = 0;
  if (allCases.length > 0) {
    const matterRows = allCases.map((c) => ({
      org_id: orgId,
      external_id: c.id,
      case_id_visible: c.case_id_visible ?? null,
      name: c.name ?? "",
      client_external_id: c.client_id ?? null,
      parent_external_id: c.parent_id ?? null,
      project_state_id: c.project_state_id ?? "",
      state_is_open: true,
      responsible_user_id: c.responsible_user?.id ?? null,
      responsible_user_name: c.responsible_user
        ? [c.responsible_user.first_name, c.responsible_user.last_name].filter(Boolean).join(" ")
        : null,
      language: (c.language === "ces" || c.language === "eng") ? c.language : "other",
      currency: c.currency ?? "CZK",
      case_no: c.case_no ?? "",
      court_case_no: c.court_case_no ?? null,
      custom_fields: Array.isArray(c.custom_fields)
        ? Object.fromEntries(c.custom_fields.map((f: any) => [f.name, f.value]))
        : (c.custom_fields ?? {}),
      is_internal: false,
      synced_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("matters")
      .upsert(matterRows, { onConflict: "org_id,external_id" });
    if (error) throw new Error(`Matter upsert failed: ${error.message}`);
    matterCount = matterRows.length;
  }

  // 8. Upsert matter_contacts + email_matter_lookup
  // Need to fetch matter IDs (internal UUIDs) for the lookup table
  const { data: dbMatters } = await supabase
    .from("matters")
    .select("id, external_id")
    .eq("org_id", orgId);

  const matterExternalToInternal = new Map<string, string>();
  for (const m of dbMatters ?? []) {
    matterExternalToInternal.set(m.external_id, m.id);
  }

  const contactById = new Map<string, any>();
  for (const c of allContacts) {
    contactById.set(c.id, c);
  }

  let matterContactCount = 0;
  let emailLookupCount = 0;

  if (allCases.length > 0) {
    const mcRows: any[] = [];
    const emailRows: any[] = [];

    for (const scCase of allCases) {
      const matterInternalId = matterExternalToInternal.get(scCase.id);
      if (!matterInternalId) continue;

      for (const ref of scCase.contacts ?? []) {
        const contact = contactById.get(ref.id);
        if (!contact) continue;
        mcRows.push({
          org_id: orgId,
          matter_id: matterInternalId,
          contact_external_id: ref.id,
          role: "contact",
        });
        if (contact.email) {
          const email = contact.email.toLowerCase();
          const domain = email.split("@")[1] ?? "";
          emailRows.push({
            org_id: orgId,
            email_address: email,
            email_domain: domain,
            matter_id: matterInternalId,
            contact_external_id: ref.id,
          });
        }
      }

      for (const ref of scCase.adversaries ?? []) {
        const contact = contactById.get(ref.id);
        if (!contact) continue;
        mcRows.push({
          org_id: orgId,
          matter_id: matterInternalId,
          contact_external_id: ref.id,
          role: "adversary",
        });
      }
    }

    if (mcRows.length > 0) {
      const { error } = await supabase
        .from("matter_contacts")
        .upsert(mcRows, { onConflict: "org_id,matter_id,contact_external_id" });
      if (error) throw new Error(`Matter contact upsert failed: ${error.message}`);
      matterContactCount = mcRows.length;
    }

    if (emailRows.length > 0) {
      // Delete old lookup rows for this org, then insert fresh
      await supabase.from("email_matter_lookup").delete().eq("org_id", orgId);
      const { error } = await supabase
        .from("email_matter_lookup")
        .insert(emailRows);
      if (error) throw new Error(`Email lookup upsert failed: ${error.message}`);
      emailLookupCount = emailRows.length;
    }
  }

  // 9. Upsert activity types
  let activityTypeCount = 0;
  if (activityTypes.length > 0) {
    const atRows = activityTypes.map((at, i) => ({
      org_id: orgId,
      external_id: at.id,
      label: at.name,
      sort_order: i,
    }));
    const { error } = await supabase
      .from("activity_types")
      .upsert(atRows, { onConflict: "org_id,external_id" });
    if (error) throw new Error(`Activity type upsert failed: ${error.message}`);
    activityTypeCount = atRows.length;
  }

  return {
    clients: clientCount,
    matters: matterCount,
    contacts: contactCount,
    matterContacts: matterContactCount,
    activityTypes: activityTypeCount,
    emailLookups: emailLookupCount,
  };
}
