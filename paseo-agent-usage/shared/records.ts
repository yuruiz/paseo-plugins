export interface UsageBucket {
  r: number;
  i: number;
  o: number;
  cr: number;
  cw: number;
  rz: number;
  cost: number;
  credits: number;
}

export interface CallRecord {
  t: number;
  m: string;
  p: string;
  s: string;
  i: number;
  o: number;
  cr: number;
  cw: number;
  rz: number;
  cost: number;
  credits: number;
  id?: string;
}

export interface SessionEntry {
  s: number;
  e: number;
  r: number;
  i: number;
  o: number;
  cr: number;
  cw: number;
  rz: number;
  cost: number;
  credits: number;
  p: string;
  title?: string;
}

/** Read-only report inputs; scanner bookkeeping never leaves the daemon. */
export interface ReportState {
  buckets: Record<string, UsageBucket>;
  sessions: Record<string, SessionEntry>;
  recent: Record<string, CallRecord[]>;
  hosts: Record<string, {
    buckets: Record<string, UsageBucket>;
    sessions: Record<string, SessionEntry>;
    recent: Record<string, CallRecord[]>;
  }>;
  meta: { scanError: string | null };
}
