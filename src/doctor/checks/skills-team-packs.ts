import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DoctorCheck } from '../../types/doctor.js';
import type { DoctorDeps } from '../deps.js';
import { getDefaultSkillsDir } from '../deps.js';

export function checkSkillsTeamPacks(deps: DoctorDeps): DoctorCheck {
  const skillsDir = deps.skillsDir ?? getDefaultSkillsDir();
  if (!deps.fileExists(skillsDir)) {
    return {
      id: 'skills-team-packs',
      status: 'warn',
      message: `Skills directory missing: ${skillsDir}`,
      repair: 'Install team skill packs under ~/.cursor/skills or project .cursor/skills.',
    };
  }

  const entries = readdirSync(skillsDir).filter((name) => !name.startsWith('.'));
  if (entries.length === 0) {
    return {
      id: 'skills-team-packs',
      status: 'warn',
      message: `Skills directory empty: ${skillsDir}`,
      repair: 'Add team skill packs to enable multi-agent workflows.',
    };
  }

  return {
    id: 'skills-team-packs',
    status: 'pass',
    message: `Skills team packs present (${entries.length} entries in ${skillsDir})`,
  };
}
