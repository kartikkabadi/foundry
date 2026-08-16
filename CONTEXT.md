# Foundry

**Issue tracker**:
Foundry’s own SQLite store on the operator’s machine. GitHub on a target repo only receives pull requests.
_Avoid_: GitHub Issues as the factory record, backlog manager

**Issue**:
A single tracked unit of work inside the **Issue tracker**. An idea becomes an Issue. An Issue walks stages.
_Avoid_: ticket (except **Decision ticket**)

**Decision ticket**:
An **Issue**-owned question whose resolution is a decision, not a slice of a build. Grill rounds are made of Decision tickets.

**Gate**:
A hard stop in the dashboard. Workers do not continue until the operator acts.

**Sandbox**:
A Docker checkout of the target git repo for one Issue. Disposable. Foundry data does not live here.

**Event log**:
Append-only JSONL of every stage enter, worker tool call, token count, and gate action. Durable on disk.

**Walk**:
The stages that actually run for one Issue. Collapse may mark a stage SKIPPED. Remaining stages run serially.

**Size**:
XS, S, M, L, or forced-L. Forced-L skips nothing (first Foundry self-job).

## Relationships

- The **Issue tracker** holds many **Issues**
- An **Issue** has one **Walk** and many **Decision tickets**
- A **Gate** blocks the next stage of a **Walk**
- A **Sandbox** belongs to one **Issue** and dies at hygiene
- The **Event log** records every drop for an **Issue**
