import { z } from 'zod';

export const teamRoleSchema = z.object({
  id: z.string().min(1, 'role id is required'),
  reports_to: z.string().min(1).optional(),
  must_publish: z.boolean().default(false),
  handoff_artifact: z.string().min(1).default('handoff.md'),
  capabilities: z.array(z.string()).default([]),
});

export const teamSpecSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1, 'team name is required'),
  roles: z.array(teamRoleSchema).min(1, 'at least one role is required'),
});

export type TeamRole = z.infer<typeof teamRoleSchema>;
export type TeamSpec = z.infer<typeof teamSpecSchema>;
