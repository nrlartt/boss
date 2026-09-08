import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { BossError } from "../lib/errors.ts";
import { bpsDiff, D } from "../lib/money.ts";
import type { AccountSnapshot, Approval, Observation, Plan } from "../types.ts";

const plans = new Map<string, Plan>();
const approvals = new Map<string, Approval>();
let attachedAccount: AccountSnapshot | null = null;

loadSession();

function sessionFile(): string {
  mkdirSync(config.dataDir, { recursive: true });
  return path.join(config.dataDir, "session.json");
}

function persist(): void {
  const plansArr = [...plans.entries()].slice(-100);
  const approvalsArr = [...approvals.entries()].filter(
    ([, row]) => !row.used && Date.parse(row.expiresAt) > Date.now(),
  );
  writeFileSync(
    sessionFile(),
    JSON.stringify(
      {
        account: attachedAccount,
        plans: plansArr,
        approvals: approvalsArr,
      },
      null,
      2,
    ),
  );
}

function loadSession(): void {
  const file = sessionFile();
  if (!existsSync(file)) return;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      account?: AccountSnapshot | null;
      plans?: [string, Plan][];
      approvals?: [string, Approval][];
    };
    attachedAccount = parsed.account ?? null;
    for (const [id, plan] of parsed.plans ?? []) plans.set(id, plan);
    for (const [id, approval] of parsed.approvals ?? []) approvals.set(id, approval);
  } catch {
    // Corrupt session files must not take the desk down.
  }
}

export function listPlans(): Plan[] {
  return [...plans.values()].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export function putPlan(plan: Plan): Plan {
  plans.set(plan.id, plan);
  persist();
  return plan;
}

export function getPlan(id: string): Plan {
  const plan = plans.get(id);
  if (!plan) throw new BossError("PLAN_NOT_FOUND", `Unknown plan ${id}.`);
  return plan;
}

export function attachAccount(snapshot: AccountSnapshot): AccountSnapshot {
  attachedAccount = snapshot;
  persist();
  return snapshot;
}

export function currentAccount(): AccountSnapshot | null {
  return attachedAccount;
}

export function clearAccount(): void {
  attachedAccount = null;
  persist();
}

export function issueApproval(plan: Plan, ttlMs: number): Approval {
  if (plan.policy.verdict !== "CLEAR") {
    throw new BossError(
      "NOT_CLEAR",
      `Only a CLEAR plan can be approved (this plan is ${plan.policy.verdict}). Attach balances and re-plan.`,
    );
  }
  const created = Date.now();
  const approval: Approval = {
    id: `appr_${randomUUID().slice(0, 12)}`,
    planId: plan.id,
    planHash: plan.planHash,
    createdAt: new Date(created).toISOString(),
    expiresAt: new Date(created + ttlMs).toISOString(),
    used: false,
  };
  approvals.set(approval.id, approval);
  persist();
  return approval;
}

export function peekApproval(approvalId: string, plan: Plan): Approval {
  const approval = approvals.get(approvalId);
  if (!approval) throw new BossError("APPROVAL", "Unknown approval token.");
  if (approval.used) throw new BossError("APPROVAL", "Approval token already used.");
  if (approval.planId !== plan.id || approval.planHash !== plan.planHash) {
    throw new BossError("APPROVAL", "Approval token does not match this plan.");
  }
  if (Date.now() > Date.parse(approval.expiresAt)) {
    throw new BossError("APPROVAL", "Approval token expired. Run a fresh plan.");
  }
  return approval;
}

export function consumeApproval(approvalId: string, plan: Plan): Approval {
  const approval = peekApproval(approvalId, plan);
  approval.used = true;
  persist();
  return approval;
}

export function assertFreshPlan(plan: Plan, live: Observation, maxDriftBps: string): void {
  if (plan.observation.symbol !== live.symbol) {
    throw new BossError("DRIFT", "Live symbol does not match the plan.");
  }
  const drift = bpsDiff(live.last, plan.observation.last);
  if (drift.gt(maxDriftBps)) {
    throw new BossError(
      "DRIFT",
      `Last moved ${drift.toFixed(2)} bps since the plan (cap ${maxDriftBps}). Re-plan.`,
    );
  }
  if (D(live.spreadBps).gt(D(plan.observation.spreadBps).times(3))) {
    throw new BossError("DRIFT", "Spread widened more than 3× since the plan. Re-plan.");
  }
}
