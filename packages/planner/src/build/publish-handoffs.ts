import {
  logHandoffPublished,
  writeHandoffTemplate,
} from '@foundry/core/team/comms.js';
import { loadTeamSpecFromProject } from '@foundry/core/team/spec.js';

/** Publish governed handoff artifacts for all roles that must_publish. */
export function publishTeamHandoffs(projectRoot: string, runDir: string): void {
  const spec = loadTeamSpecFromProject(projectRoot);
  if (!spec) {
    return;
  }

  for (const role of spec.roles) {
    if (!role.must_publish) {
      continue;
    }
    writeHandoffTemplate(runDir, role.handoff_artifact);
    logHandoffPublished(runDir, role.id, role.handoff_artifact);
  }
}
