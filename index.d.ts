
/** One dated record about the subject. */
export interface CaseRecord {
  subject: string;
  /** When the event happened, or when a standing fact took effect. */
  at: number;
  /** When the record was written. */
  recorded: number;
  /** The source named in the rule file, such as "billing.active". */
  source: string;
  /** Who wrote it. A record from anyone but the declared owner is not used. */
  by: string;
  value: boolean | number;
}

/** Exactly these four fields. Any other field is refused. */
export interface Case {
  subject: string;
  at: number;
  asOf: number;
  records: CaseRecord[];
}

export interface Need {
  fact: string;
  source: string;
  owner: string;
  /** conflicting_evidence, invalid_evidence or expired_evidence; absent when there is simply no record. */
  reason?: string;
  standing?: boolean;
  /** With standing: read what was in force at the request's own time. */
  atEvent?: boolean;
  latest?: boolean;
  within?: number;
  observations?: {at?: number; recorded: number; value: boolean | number}[];
}

export interface Action {
  /** release: every way of filling the unrecorded facts satisfies the rule. withhold: none does. hold: some do. */
  status: "release" | "withhold" | "hold";
  needs?: Need[];
}

export type Actions = Record<string, Action>;

/** Decide every guarantee in the rule file for one case. Throws an Error with a plain reason on bad input. */
export function decide(rules: string, subjectCase: Case): Actions;
export function decide(rules: string, subjectCase: Case, options: {explain: true}): {actions: Actions; undeclaredSourceRecords: number};
export function decide(rules: string, subjectCase: Case, options: {explain?: boolean}): Actions | {actions: Actions; undeclaredSourceRecords: number};

/** True only when the named guarantee is released. Throws if the rule file does not declare it. */
export function gate(rules: string, subjectCase: Case, guarantee: string): boolean;

export interface Change {
  id: string;
  kind: string;
  /** An input on which the two rule files differ. */
  witness?: Record<string, boolean | number>;
  before?: boolean;
  after?: boolean;
}

/** What a rule edit changes. "preserved" means no guarantee and no evidence source changed. */
export function compare(oldRules: string, newRules: string): {status: "preserved" | "review"; changes: Change[]; bindings: unknown[]};

/** Start the local service on 127.0.0.1. Port 0 picks a free port; read it from server.address(). */
/** The running local service: a Node http.Server, described here without requiring @types/node. */
export interface PhaselineServer {
  address(): {address: string; family: string; port: number} | string | null;
  close(callback?: (error?: Error) => void): unknown;
}
export function serve(port?: number): Promise<PhaselineServer>;

/** Check exact destination text across up to seven Boolean settings of a trusted, isolated fixture. */
export function inquireOutput(settings: string[], measure: (configuration: Readonly<Record<string, boolean>>, readBoolean: (name: string) => boolean) => string,
  proposed: string, access: {known: Record<string, boolean>; readable: string[]; budget: number}):
  {scope: "declared_boolean_settings"; configurations: number} & (
    {status: "decided"; matches: boolean} | {status: "ask"; setting: string} |
    {status: "hold"; reason: "over_budget" | "indistinguishable" | "setting_limit"} |
    {status: "hold"; reason: "undeclared_setting"; setting: string});
