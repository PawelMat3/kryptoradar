
export interface Identifiers {
  fullName: string;
  usernames: string[];
  emails: string[];
  messengers: string[];
  profileUrls: string[];
  addresses: string[];
}

export interface RuleHit {
  rule: string;
  description: string;
  value: number;
  kind: 'base' | 'add' | 'factor' | 'exclude' | 'cap';
}

export interface Step {
  id: string;
  title: string;
  status: 'running' | 'done' | 'warning' | 'error';
  startedAt: string;
  finishedAt?: string;
  detail?: string;
}

export interface RunSummary {
  sources: number;
  profiles: number;
  addresses: number;
  attributed: number;
  excluded: number;
  high: number;
  maxScore: number;
  cashOutHigh: number;
  otherAuthorAddresses: { address: string; chain: string; author: string; url: string }[];
  rejectedCandidates: { raw: string; reason: string; url: string }[];
  diffSummary: string | null;
}

export interface RunListItem {
  id: string;
  seq: number;
  trigger: string;
  status: 'queued' | 'running' | 'done' | 'error';
  mode: string;
  started_at: string | null;
  finished_at: string | null;
  summary: RunSummary | null;
  error: string | null;
}

export interface Case {
  id: string;
  name: string;
  identifiers: Identifiers;
  schedule_minutes: number | null;
  mode: 'demo' | 'live';
  created_at: string;
  last_run_at: string | null;
  last_run?: RunListItem | null;
  run_count?: number;
  runs?: RunListItem[];
}

export interface Occurrence {
  artifactId: string;
  sourceId: string;
  sourceName: string;
  url: string;
  category: string;
  context: string;
  quoted: boolean;
  author: string | null;
  identity: { factor: number; hits: RuleHit[] };
  retrievedAt: string;
  score: number;
  hits: RuleHit[];
}

export interface Finding {
  id: string;
  chain: string;
  address: string;
  status: 'attributed' | 'excluded' | 'no-evidence';
  score: number;
  tier: string;
  hits: RuleHit[];
  occurrences: Occurrence[];
  exclusion: { rule: string; reason: string; category: string; evidence: string } | null;
  label: { name: string; category: string; source: string } | null;
  address_info: { isContract?: boolean | null; bytecodeEvidence?: string; provider?: string; error?: string; tags?: { name: string }[] } | null;
  validation: string;
  format: string;
}

export interface Artifact {
  id: string;
  url: string;
  final_url: string;
  source_id: string;
  source_name: string;
  category: string;
  discovery: string;
  discovered_via: string | null;
  retrieved_at: string;
  http_status: number;
  content_sha256: string;
  bytes: number;
  title: string;
  identity: { factor: number; hits: RuleHit[] } | null;
  meta: { username?: string; maigretSite?: string; searchQuery?: string; declaredName?: string | null };
}

export interface Flow {
  hash: string;
  time: string;
  direction: 'in' | 'out' | 'self';
  counterparty: string | null;
  counterpartyLabel: string | null;
  counterpartyCategory: string | null;
  asset: string;
  amount: number;
  method?: string;
}

export interface ChainReport {
  id: string;
  chain: string;
  address: string;
  provider: string;
  retrieved_at: string;
  metrics: {
    txCount: number;
    firstSeen: string | null;
    lastSeen: string | null;
    inflow: Record<string, number>;
    outflow: Record<string, number>;
    uniqueCounterparties: number;
    stablecoinVolume: number;
    byCategory: Record<string, { txs: number; label: string }>;
  };
  indicators: { id: string; severity: 'high' | 'medium' | 'info'; title: string; explanation: string; txs: string[] }[];
  flows: Flow[];
  cash_out_level: string;
}

export interface Conclusion {
  kind: 'FAKT' | 'OBLICZENIE' | 'WNIOSEK';
  text: string;
  refs?: string[];
}

export interface RunDiff {
  newAddresses: { chain: string; address: string; score: number }[];
  removedAddresses: { chain: string; address: string; score: number }[];
  scoreChanges: { address: string; chain: string; before: number; after: number }[];
  addressSwaps: { url: string; before: string[]; after: string[] }[];
  newProfiles: string[];
  removedProfiles: string[];
  summary: string;
}

export interface RunDetail {
  kase: Case;
  run: RunListItem & {
    case_id: string;
    steps: Step[];
    params: Record<string, unknown>;
    versions: Record<string, unknown>;
    request_log: { url: string; status: number | string; at: string; ms: number }[];
    conclusions: Conclusion[] | null;
    diff: RunDiff | null;
    ai_summary: string | null;
  };
  artifacts: Artifact[];
  findings: Finding[];
  chain: ChainReport[];
}

export interface Meta {
  liveEnabled: boolean;
  version: string;
  worker: { ok: boolean; maigret?: string };
  sources: { id: string; name: string; category: string; demo: boolean }[];
  chainProviders: { id: string; description: string; chains: string[] }[];
  labels: { count: number; files: string[] };
  egressAllowlist: string[];
  ai: string | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      msg = ((await r.json()) as { error?: string }).error ?? msg;
    } catch {
      /* brak treści */
    }
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

export const api = {
  meta: () => call<Meta>('/api/meta'),
  cases: () => call<Case[]>('/api/cases'),
  case: (id: string) => call<Case>(`/api/cases/${id}`),
  createCase: (body: { name: string; identifiers: Identifiers; scheduleMinutes: number | null; mode: 'demo' | 'live' }) => call<{ id: string; runId: string }>('/api/cases', { method: 'POST', body: JSON.stringify(body) }),
  deleteCase: (id: string) => call<{ ok: boolean }>(`/api/cases/${id}`, { method: 'DELETE' }),
  setSchedule: (id: string, scheduleMinutes: number | null) => call(`/api/cases/${id}`, { method: 'PATCH', body: JSON.stringify({ scheduleMinutes }) }),
  startRun: (id: string) => call<{ runId: string }>(`/api/cases/${id}/runs`, { method: 'POST', body: '{}' }),
  run: (id: string) => call<RunDetail>(`/api/runs/${id}`),
  diff: (id: string, against: string) => call<RunDiff>(`/api/runs/${id}/diff?against=${against}`),
  demoVersion: () => call<{ version: number }>('/api/demo/profile-version'),
  setDemoVersion: (version: number) => call<{ version: number }>('/api/demo/profile-version', { method: 'POST', body: JSON.stringify({ version }) }),
};
