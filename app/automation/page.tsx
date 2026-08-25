import { automationAuthorityAction, automationControlAction, automationSettingsAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AUTOMATION_AUTHORITIES,
  AUTOMATION_AUTHORITY_META,
  AUTOMATION_LIMIT_CAP,
  AUTOMATION_LIMIT_MIN,
  type AutomationAuthority,
  type AutomationControl,
} from "@/lib/foundry/automation-control";
import { createAutomationControlStore } from "@/lib/foundry/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AutomationStatus = "enabled" | "paused" | "disabled";

function statusOf(control: AutomationControl): AutomationStatus {
  if (!control.enabled) return "disabled";
  return control.operatorHold ? "paused" : "enabled";
}

/**
 * Remount key for the authority form. Derived from the durable authority so a
 * redirect after a saved authority change remounts the radio group and
 * re-reads `defaultChecked` — an unchanged key would let a stale checked radio
 * survive the RSC update and resubmit an old authority.
 */
export function authorityFormKey(authority: AutomationAuthority): string {
  return `authority-${authority}`;
}

const STATUS_META: Record<
  AutomationStatus,
  { label: string; description: string; variant: "default" | "secondary" | "outline" }
> = {
  enabled: {
    label: "Enabled",
    description:
      "Bounded passes may run within the ceilings below. This control surface never starts work; the autonomous driver consults this record and only then decides.",
    variant: "default",
  },
  paused: {
    label: "Paused",
    description:
      "Enabled but on operator hold. No pass starts while the hold is on, without disabling automation.",
    variant: "secondary",
  },
  disabled: {
    label: "Disabled",
    description:
      "Fail-closed. No autonomous pass can run until an operator enables automation. Defaults are inert until then.",
    variant: "outline",
  },
};

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

export default function AutomationPage() {
  const control = createAutomationControlStore().get();
  const status = statusOf(control);
  const meta = STATUS_META[status];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <header>
        <h1 className="text-2xl font-medium tracking-tight">Automation</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Operator control for bounded autonomous passes and the explicit
          authority granted to them. This page only configures durable control
          state, authority, and ceilings — it never starts a pass, and nothing
          here publishes, merges, or deploys.
        </p>
      </header>

      <section className="rounded-md border border-border p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm text-muted-foreground">Run state</h2>
            <div className="text-lg font-medium">{meta.label}</div>
          </div>
          <Badge variant={meta.variant}>{meta.label}</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{meta.description}</p>
        <form action={automationControlAction} className="mt-4 flex flex-wrap gap-2">
          <input name="version" type="hidden" value={control.version} />
          {status === "disabled" ? (
            <Button name="op" type="submit" value="enable">
              Enable automation
            </Button>
          ) : (
            <>
              {status === "paused" ? (
                <Button name="op" type="submit" value="resume" variant="secondary">
                  Resume
                </Button>
              ) : (
                <Button name="op" type="submit" value="pause" variant="secondary">
                  Pause
                </Button>
              )}
              <Button name="op" type="submit" value="disable" variant="outline">
                Disable
              </Button>
            </>
          )}
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          Run-state changes only update durable control state. They do not start or stop a pass.
        </p>
      </section>

      <section className="rounded-md border border-border p-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm text-muted-foreground">Authority</h2>
          <p className="text-xs text-muted-foreground">
            What autonomous automation is explicitly permitted to do. Authority is operator policy
            only: saving it updates the durable control record and starts no work.
          </p>
        </div>
        <form
          action={automationAuthorityAction}
          className="mt-4 flex flex-col gap-3"
          key={authorityFormKey(control.authority)}
        >
          <input name="version" type="hidden" value={control.version} />
          {AUTOMATION_AUTHORITIES.map((authority) => {
            const meta = AUTOMATION_AUTHORITY_META[authority];
            return (
              <label
                key={authority}
                className="flex cursor-pointer gap-3 rounded-md border border-border p-3 text-sm"
              >
                <input
                  className="mt-1"
                  defaultChecked={control.authority === authority}
                  name="authority"
                  type="radio"
                  value={authority}
                />
                <span>
                  <span className="block text-foreground">{meta.label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Permits: {meta.permits.join("; ")}. Never: {meta.never.join(", ")}.
                  </span>
                </span>
              </label>
            );
          })}
          <p className="text-xs text-muted-foreground">
            Publish is the highest grant and stays narrow: branch and PR publication, and only
            after exact-SHA verification. No authority level merges, deploys, cleans up, mutates a
            VPS, or self-modifies.
          </p>
          <Button className="w-fit" type="submit">
            Save authority
          </Button>
        </form>
      </section>

      <section className="rounded-md border border-border p-4">
        <h2 className="text-sm text-muted-foreground">Current control</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Per-pass issue limit</dt>
            <dd className="font-mono">{control.limit}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Iteration ceiling</dt>
            <dd className="font-mono">{control.maxIterations}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Total cost ceiling</dt>
            <dd className="font-mono">{money(control.maxCostUsd)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Per-candidate ceiling</dt>
            <dd className="font-mono">{money(control.perCandidateCeilingUsd)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Paid authorization</dt>
            <dd className="font-mono">{control.paidAuthorization ? "Granted" : "Not granted"}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Authority</dt>
            <dd className="font-mono">{AUTOMATION_AUTHORITY_META[control.authority].label}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Updated</dt>
            <dd className="font-mono">{new Date(control.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      <form
        action={automationSettingsAction}
        className="flex flex-col gap-4 rounded-md border border-border p-4"
      >
        <input name="version" type="hidden" value={control.version} />
        <div className="flex flex-col gap-1">
          <h2 className="text-sm text-muted-foreground">Bounded settings</h2>
          <p className="text-xs text-muted-foreground">
            Ceilings that bound a pass. Values outside legal bounds are rejected; the page always
            shows the last accepted durable values.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm">
            <span>Per-pass issue limit</span>
            <Input
              defaultValue={control.limit}
              max={AUTOMATION_LIMIT_CAP}
              min={AUTOMATION_LIMIT_MIN}
              name="limit"
              required
              step={1}
              type="number"
            />
            <span className="text-xs text-muted-foreground">
              Integer from {AUTOMATION_LIMIT_MIN} to {AUTOMATION_LIMIT_CAP}.
            </span>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span>Iteration ceiling</span>
            <Input
              defaultValue={control.maxIterations}
              min={0}
              name="maxIterations"
              required
              step={1}
              type="number"
            />
            <span className="text-xs text-muted-foreground">
              Recursive-improvement iterations before the loop stops.
            </span>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span>Total cost ceiling (USD)</span>
            <Input
              defaultValue={control.maxCostUsd}
              min={0}
              name="maxCostUsd"
              required
              step={0.01}
              type="number"
            />
            <span className="text-xs text-muted-foreground">
              Total spend cap for the improvement loop.
            </span>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            <span>Per-candidate cost ceiling (USD)</span>
            <Input
              defaultValue={control.perCandidateCeilingUsd}
              min={0}
              name="perCandidateCeilingUsd"
              required
              step={0.01}
              type="number"
            />
            <span className="text-xs text-muted-foreground">
              Max estimated cost for one improvement candidate.
            </span>
          </label>
        </div>
        <label className="flex cursor-pointer gap-3 rounded-md border border-border p-3 text-sm">
          <input
            className="mt-1"
            defaultChecked={control.paidAuthorization}
            name="paidAuthorization"
            type="checkbox"
          />
          <span>
            <span className="block text-foreground">Authorize paid work</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Paid work (billable model calls) only runs after you explicitly authorize it here, and
              only within the cost ceilings above. Unchecking revokes authorization.
            </span>
          </span>
        </label>
        <Button className="w-fit" type="submit">
          Save bounds
        </Button>
      </form>
    </main>
  );
}
