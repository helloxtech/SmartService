import { z } from "zod";

export const organizationRoleSchema = z.enum(["admin", "agent"]);

export const organizationMembershipSchema = z.object({
    organization_id: z.uuid(),
    role: organizationRoleSchema,
});

export type OrganizationMembership = z.infer<typeof organizationMembershipSchema>;
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;
