/**
 * The only place the web app talks to the server.
 *
 * Everything here returns what the server said. There is deliberately no
 * client-side rule evaluation: the screen never decides whether a task may be
 * finished, whether a gate blocks, or who may verify. It asks, and renders the
 * answer. A UI check is a courtesy; the server is the control.
 */

/** A refusal the person can act on, as opposed to something that went wrong. */
export class ApiError extends Error {
  readonly status: number;
  /** Set when the server refused because a gate blocked, not because of a bug. */
  readonly canOverride: boolean;
  constructor(status: number, message: string, canOverride = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.canOverride = canOverride;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    // The server writes messages for people to read. Pass them through
    // unchanged rather than inventing a friendlier one that might be wrong.
    const body = (await res.json().catch(() => null)) as
      | { error?: string; canOverride?: boolean }
      | null;
    throw new ApiError(
      res.status,
      body?.error ?? 'Something went wrong. Please try again.',
      body?.canOverride ?? false,
    );
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  call<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

// ---- shapes, mirroring what the server actually returns --------------------

export interface Me {
  displayLabel: string;
  roleCodes: string[];
  clinicIds: string[];
  crossClinic: boolean;
}

export type BucketName = 'OVERDUE' | 'NOW' | 'NEXT' | 'LATER';

export interface TaskRow {
  id: string;
  title: string;
  standard: string | null;
  dueAt: string;
  status: string;
  started: boolean;
  blockedBy: string | null;
}

/**
 * Today's opening set at this clinic, as counts. `null` when there is no
 * opening set today — which is NOT the same as complete and must never be
 * rendered as "the clinic is open".
 */
export interface OpeningStatus {
  total: number;
  done: number;
  complete: boolean;
}

/**
 * Where the clinic is, right now. `null` for someone who can see every clinic
 * — they have no single "here".
 */
export interface ClinicContext {
  name: string;
  /** The clinic's timezone. Every time on screen is formatted with this. */
  timezone: string;
  /** null when there is no opening set today. Absent is not ready. */
  phase: 'OPENING' | 'OPEN' | null;
  opening: OpeningStatus | null;
  /** The clinic's own configured opening time for today. */
  readyBy: string | null;
  /** Always null until appointment integration lands. Never guessed. */
  firstPatientAt: string | null;
}

export interface MyDay {
  buckets: Record<BucketName, TaskRow[]>;
  attentionCount: number;
  clinic: ClinicContext | null;
  opening: OpeningStatus | null;
}

export interface SheetItem {
  id: string;
  label: string;
  requiresValue: boolean;
  unit: string | null;
  checked: boolean;
  value: number | null;
}

export interface TaskSheet {
  id: string;
  title: string;
  standard: string | null;
  status: string;
  dueAt: string;
  isMine: boolean;
  needsSomeoneElseToCheck: boolean;
  items: SheetItem[];
  cantConfirm: string | null;
  canOverrideBlock: boolean;
  blockedBy: string | null;
  problemKinds: Array<{ key: string; label: string }>;
}

export interface CompleteResult {
  status: string;
  selfVerified: boolean;
  waitingForCheck: boolean;
  outOfRange: Array<{ label: string; value: number; unit: string | null }>;
}

export interface AttentionRow {
  id: string;
  headline: string;
  severity: string;
  detail: string | null;
  mine: boolean;
  dueAt: string | null;
  escalated: boolean;
}

export interface CheckRow {
  id: string;
  title: string;
  completedAt: string;
  standard: string | null;
}

/** What the checker sees: the work as it was actually recorded. No names (Q6). */
export interface CheckDetail {
  id: string;
  title: string;
  standard: string | null;
  completedAt: string;
  items: Array<{
    id: string;
    label: string;
    checked: boolean;
    value: number | null;
    unit: string | null;
  }>;
}

export interface ChecklistAnswer {
  itemId: string;
  checked: boolean;
  numericValue?: number;
}

// ---- calls ------------------------------------------------------------------

export const api = {
  login: (email: string, password: string) =>
    post<{ displayLabel: string; roleCodes: string[] }>('/api/v1/auth/login', { email, password }),
  logout: () => post<{ ok: boolean }>('/api/v1/auth/logout'),
  me: () => call<Me>('/api/v1/auth/me'),

  myDay: () => call<MyDay>('/api/v1/my-day'),
  task: (id: string) => call<TaskSheet>(`/api/v1/tasks/${id}`),
  startTask: (id: string) => post<{ status: string }>(`/api/v1/tasks/${id}/start`),
  completeTask: (
    id: string,
    body: { responses: ChecklistAnswer[]; taps?: number; durationMs?: number; overrideReason?: string },
  ) => post<CompleteResult>(`/api/v1/tasks/${id}/complete`, body),
  reportProblem: (id: string, body: { itemId?: string; kind: string; note?: string }) =>
    post<{ headline: string; id: string }>(`/api/v1/tasks/${id}/report-problem`, body),

  attention: () => call<AttentionRow[]>('/api/v1/attention'),
  resolveAttention: (id: string, note: string) =>
    post<{ ok: boolean }>(`/api/v1/attention/${id}/resolve`, { note }),

  checks: () => call<CheckRow[]>('/api/v1/checks'),
  check: (id: string) => call<CheckDetail>(`/api/v1/checks/${id}`),
  submitCheck: (id: string, result: 'PASS' | 'FAIL', comment?: string) =>
    post<{ status: string }>(`/api/v1/checks/${id}`, { result, ...(comment ? { comment } : {}) }),
};
