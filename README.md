# Daykeeper

A daily timesheet generator for lawyers. A lawyer connects their work applications (email, calendar, chat, documents). At the end of the day they open the app, review everything they did across those apps, select which activity to include, press Generate, and receive a set of draft timesheet entries with suggested durations and client-ready narrative descriptions that they can edit before copying into their billing system.

## Stack

- React + TypeScript + Vite + Tailwind CSS
- Supabase (auth + database + edge functions)
- No other backend
- lucide-react for icons

## Architecture

### The ActivityProvider interface

Every provider integration sits behind a single interface defined in `src/types/index.ts`:

```typescript
interface ActivityProvider {
  readonly provider: Provider;
  readonly label: string;
  fetchActivity(dateRange: DateRange): Promise<ActivityItem[]>;
}
```

The UI talks only to `ActivityProvider[]` and never to a specific provider's API. This is the most important structural seam in the application — real providers can be dropped in later without touching any UI code.

### Adding a new provider

1. Create a new file in `src/providers/` (e.g. `src/providers/GoogleEmailProvider.ts`).
2. Implement the `ActivityProvider` interface — `fetchActivity` calls the real API and returns `ActivityItem[]`.
3. Register the provider in the provider registry.
4. No UI changes are needed — the Day view, timeline, and activity list all operate on `ActivityItem[]` and `ActivityProvider[]`.

### Absolute data rule

There is no table, column, or cache anywhere in this application that stores the body of an email, the text of a chat message, a document's contents, or an attachment. Activity data is fetched, held in memory, used, and discarded. Only the lawyer's own final timesheet text is persisted.

## Connections

### SingleCase (case management)

Connected at the organization level by an admin. The admin enters the firm's workspace URL (e.g. `https://cypress.singlecase-tc.app`) and pastes an API token. The token is stored encrypted server-side in `provider_tokens` and is never returned to the browser after entry. All SingleCase API calls are proxied through the `singlecase-proxy` edge function, which normalizes the URL to its HTTPS origin before every outbound request.

### Microsoft 365

A single OAuth connection grants access to Outlook mail, Calendar, Teams chat, and OneDrive files through one Microsoft Graph consent screen. The connection status of individual data types is tracked at fetch time — if one fails (e.g. Teams chat is unavailable), the others continue working.

### SharePoint — scope decision deferred

SharePoint document libraries are **not** included in the default Microsoft 365 connection. Reaching matter documents in SharePoint requires the `Files.Read.All` scope, which grants read access to everything the user can see across the tenant — not just matter-specific libraries. This is a broader permission than the other Graph scopes and should be a deliberate decision made with the firm.

SharePoint folder paths are one of the strongest attribution signals available (a document stored in `/Clients/Acme Corp/Litigation/` strongly implies the Acme Corp litigation matter), so enabling this scope is recommended once the firm has reviewed the access implications. Until then, OneDrive files (covered by the narrower `Files.Read` scope) are included.

## Database schema

All tables have Row Level Security enabled with deny-by-default policies. User-scoped tables use `auth.uid() = user_id` ownership checks; org-scoped tables use `user_org_id()` membership checks and `is_org_admin()` for write operations.

| Table | Purpose |
|---|---|
| `profiles` | One row per user: display name, timezone, working hours, billing preferences, onboarding state, org membership |
| `organizations` | Firm-level organization: name, SingleCase workspace subdomain |
| `organization_members` | Maps users to orgs with role (admin/member) |
| `connections` | One row per connected provider per user: status, account label, scopes. No tokens stored. |
| `provider_tokens` | Server-side encrypted API tokens (SingleCase). No SELECT policy — never readable from client. |
| `matters` | Org-scoped legal matters synced from SingleCase |
| `clients` | Org-scoped clients synced from SingleCase |
| `contacts` | Org-scoped contacts synced from SingleCase |
| `matter_contacts` | Maps contacts to matters with role (contact/adversary) |
| `activity_types` | Org-scoped activity type taxonomy synced from SingleCase |
| `matter_rules` | User-scoped rules for attributing activity to matters |
| `manual_entries` | User-scoped manual time entries |
| `timesheets` | One per generated timesheet per work day |
| `timesheet_entries` | Individual editable entries with matter attribution |
| `audit_log` | Append-only record of actions. Never records activity content. |

### Organization admin bootstrap

The first user to sign up automatically creates an organization (named after their email domain) and becomes its admin. If an organization ever has no admin (e.g. the last admin leaves), the oldest member is automatically promoted. Admins can promote or demote members from the Settings page.

## Development

```bash
npm install
npm run dev
```

The dev server runs automatically in the Bolt environment. To verify the build:

```bash
npm run build
npm run typecheck
```

## Screens

1. **Auth** — Supabase email/password sign up, sign in, and password reset.
2. **Onboarding** — Three steps (profile, billing preferences, connect apps).
3. **Day view** — The core screen. Date picker, running totals, timeline strip, activity list grouped by provider with checkboxes, keyboard navigation, and a Generate button.
4. **Timesheet result** — Editable entries with per-entry actions and global actions.
5. **Connections** — SingleCase admin connection form, Microsoft 365 single-row OAuth, and connection status derived exclusively from database rows.
6. **Settings** — Profile, billing preferences, activity type taxonomy, exclusion rules, organization management (admin-only), and privacy section.
