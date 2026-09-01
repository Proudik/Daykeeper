// Brand logo SVG components for connectors that need recognizable icons.
// lucide-react doesn't include brand logos, so we define them inline.

interface IconProps {
  size?: number;
  className?: string;
}

export function GoogleIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export function MicrosoftIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="9.5" height="9.5" fill="#F25022"/>
      <rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00"/>
      <rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF"/>
      <rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900"/>
    </svg>
  );
}

export function SingleCaseIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7l9-4 9 4-9 4-9-4z" stroke="#6366f1" strokeWidth="1.8" strokeLinejoin="round" fill="#e0e7ff"/>
      <path d="M7 9.5v5l5 2.5 5-2.5v-5" stroke="#6366f1" strokeWidth="1.8" strokeLinejoin="round" fill="none"/>
      <path d="M21 7v6" stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

export function SlackIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.04 14.42a2.02 2.02 0 0 1-2.02 2.02 2.02 2.02 0 0 1-2.02-2.02 2.02 2.02 0 0 1 2.02-2.02h2.02z" fill="#E01E5A"/>
      <path d="M6.06 14.42a2.02 2.02 0 0 1 2.02 2.02v5.05a2.02 2.02 0 0 1-2.02 2.02 2.02 2.02 0 0 1-2.02-2.02v-5.05a2.02 2.02 0 0 1 2.02-2.02z" fill="#E01E5A"/>
      <path d="M9.58 5.04a2.02 2.02 0 0 1-2.02 2.02 2.02 2.02 0 0 1-2.02-2.02 2.02 2.02 0 0 1 2.02-2.02h2.02z" fill="#36C5F0"/>
      <path d="M8.56 5.04a2.02 2.02 0 0 1 2.02-2.02h5.05a2.02 2.02 0 0 1 2.02 2.02 2.02 2.02 0 0 1-2.02 2.02h-5.05a2.02 2.02 0 0 1-2.02-2.02z" fill="#36C5F0"/>
      <path d="M14.42 9.58a2.02 2.02 0 0 1 2.02-2.02 2.02 2.02 0 0 1 2.02 2.02 2.02 2.02 0 0 1-2.02 2.02h-2.02z" fill="#2EB67D"/>
      <path d="M13.4 9.58a2.02 2.02 0 0 1-2.02-2.02V2.51a2.02 2.02 0 0 1 2.02-2.02 2.02 2.02 0 0 1 2.02 2.02v5.05a2.02 2.02 0 0 1-2.02 2.02z" fill="#2EB67D"/>
      <path d="M18.96 14.42a2.02 2.02 0 0 1 2.02-2.02 2.02 2.02 0 0 1 2.02 2.02 2.02 2.02 0 0 1-2.02 2.02h-2.02z" fill="#ECB22E"/>
      <path d="M19.98 14.42a2.02 2.02 0 0 1-2.02 2.02h-5.05a2.02 2.02 0 0 1-2.02-2.02 2.02 2.02 0 0 1 2.02-2.02h5.05a2.02 2.02 0 0 1 2.02 2.02z" fill="#ECB22E"/>
      <path d="M13.4 14.42a2.02 2.02 0 0 1 2.02 2.02v5.05a2.02 2.02 0 0 1-2.02 2.02 2.02 2.02 0 0 1-2.02-2.02v-5.05a2.02 2.02 0 0 1 2.02-2.02z" fill="#ECB22E"/>
    </svg>
  );
}

export function AsanaIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="17.5" r="4.5" fill="#F06A6A"/>
      <circle cx="6.5" cy="9.5" r="4.5" fill="#F06A6A"/>
      <circle cx="17.5" cy="9.5" r="4.5" fill="#F06A6A"/>
    </svg>
  );
}

export function JiraIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 1.3l6.36 6.36a4.5 4.5 0 0 1 0 6.36L12 20.38 5.64 14.02a4.5 4.5 0 0 1 0-6.36L12 1.3z" fill="#0052CC"/>
      <path d="M12 7.66l3.18 3.18a2.25 2.25 0 0 1 0 3.18L12 17.2l-3.18-3.18a2.25 2.25 0 0 1 0-3.18L12 7.66z" fill="#2684FF"/>
      <path d="M12 1.3l6.36 6.36a4.5 4.5 0 0 1 1.59 3.18H12V1.3z" fill="#2684FF" opacity="0.5"/>
      <path d="M12 1.3L5.64 7.66a4.5 4.5 0 0 0-1.59 3.18H12V1.3z" fill="#2684FF" opacity="0.5"/>
    </svg>
  );
}

export function GitHubIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.24-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.85 1.24 1.92 1.24 3.24 0 4.63-2.8 5.65-5.48 5.95.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.29 0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z"/>
    </svg>
  );
}

export function TrelloIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#0079BF"/>
      <rect x="5" y="5.5" width="5" height="13" rx="1.5" fill="#fff"/>
      <rect x="13" y="5.5" width="5" height="8" rx="1.5" fill="#fff"/>
    </svg>
  );
}

export function HubSpotIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="3.5" fill="#FF7A59"/>
      <circle cx="18.5" cy="6" r="2.5" fill="#FF7A59"/>
      <circle cx="18.5" cy="18" r="2.5" fill="#FF7A59"/>
      <line x1="12" y1="12" x2="18.5" y2="6" stroke="#FF7A59" strokeWidth="1.5"/>
      <line x1="12" y1="12" x2="18.5" y2="18" stroke="#FF7A59" strokeWidth="1.5"/>
    </svg>
  );
}

export function NotionIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#fff" stroke="#000" strokeWidth="1.2"/>
      <path d="M7 7.5v9M7 7.5l8 9M15 7.5v9" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function LinearIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 12a9 9 0 1 1 18 0" stroke="#5E6AD2" strokeWidth="2" strokeLinecap="round"/>
      <path d="M3 12a9 9 0 0 1 9-9v9z" fill="#5E6AD2"/>
      <circle cx="12" cy="12" r="2" fill="#5E6AD2"/>
    </svg>
  );
}

export function ZendeskIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 20V8l6 6v6z" fill="#03363D"/>
      <path d="M10 4v16l6-6V4z" fill="#03363D" opacity="0.7"/>
      <path d="M18 4v16l4-4V8z" fill="#03363D" opacity="0.5"/>
    </svg>
  );
}

export function ClickUpIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 15.5l4-2.5 5 3v4l-4 2.5z" fill="#7B68EE"/>
      <path d="M12 16l5-3 4 2.5v4l-4 2.5z" fill="#7B68EE" opacity="0.8"/>
      <path d="M12 4l5 3-5 3-5-3z" fill="#7B68EE"/>
      <path d="M3 8.5l4-2.5 5 3v4l-4 2.5z" fill="#7B68EE" opacity="0.6"/>
    </svg>
  );
}

export function GmailIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 6.5C2 5.4 2.9 4.5 4 4.5h16c1.1 0 2 .9 2 2v11c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6.5z" fill="#fff" stroke="#EA4335" strokeWidth="1"/>
      <path d="M2 7l10 7 10-7" stroke="#EA4335" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 6.5L12 14l10-7.5" stroke="#EA4335" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.4"/>
    </svg>
  );
}

export function GoogleCalendarIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="2.5" fill="#fff" stroke="#4285F4" strokeWidth="1.2"/>
      <rect x="3" y="3" width="18" height="4.5" rx="2.5" fill="#4285F4"/>
      <rect x="3" y="3" width="18" height="4.5" rx="2.5" fill="#4285F4"/>
      <path d="M3 7.5h18" stroke="#4285F4" strokeWidth="0.8" opacity="0.5"/>
      <text x="12" y="16.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#4285F4" fontFamily="Arial, sans-serif">31</text>
    </svg>
  );
}

export function ChromeIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" fill="#fff" stroke="#dee1e6" strokeWidth="0.5"/>
      <circle cx="12" cy="12" r="4" fill="#4285F4"/>
      <path d="M12 2a10 10 0 0 1 8.66 5H12a5 5 0 0 0-4.33 2.5L3.34 7A10 10 0 0 1 12 2z" fill="#EA4335"/>
      <path d="M2 12a10 10 0 0 0 5.34 8.83L10.67 14A5 5 0 0 1 12 7h8.66A10 10 0 0 1 2 12z" fill="#34A853"/>
      <path d="M22 12a10 10 0 0 1-10 10 10 10 0 0 1-4.66-1.17L10.67 14A5 5 0 0 0 12 7h8.66A10 10 0 0 1 22 12z" fill="#FBBC05" opacity="0.95"/>
      <circle cx="12" cy="12" r="4" fill="#4285F4"/>
      <circle cx="12" cy="12" r="2" fill="#fff"/>
    </svg>
  );
}

export const BRAND_ICON_MAP: Record<string, React.FC<IconProps>> = {
  slack: SlackIcon,
  asana: AsanaIcon,
  jira: JiraIcon,
  github: GitHubIcon,
  trello: TrelloIcon,
  hubspot: HubSpotIcon,
  notion: NotionIcon,
  linear: LinearIcon,
  zendesk: ZendeskIcon,
  clickup: ClickUpIcon,
  google: GoogleIcon,
  microsoft: MicrosoftIcon,
  singlecase: SingleCaseIcon,
  gmail: GmailIcon,
  google_calendar: GoogleCalendarIcon,
  chrome: ChromeIcon,
};
