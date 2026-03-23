/**
 * Stage 2 – User domain types for multi-user support.
 * Operational app data only. Kept separate from future analytics/events.
 */

/** V1 public access type – simple model. */
export type AccessType = "OWNER" | "BRANCH_USER";

/** Actor types – separates human users, devices, guests. */
export type ActorType = "USER" | "PLAYER_DEVICE" | "GUEST";

/** Tenant-level role (internal). Maps to AccessType: OWNER or BRANCH_USER. */
export type TenantRole = "TENANT_OWNER" | "TENANT_ADMIN" | "TENANT_MEMBER";

/** Branch-level role (internal). Kept for storage; V1 does not expose. */
export type BranchRole = "BRANCH_MANAGER" | "BRANCH_CONTROLLER";

/** Combined role for permission checks. */
export type UserRole = TenantRole | BranchRole;

/** Tenant – top-level org scope. */
export type Tenant = {
  id: string;
  name: string;
  createdAt: string;
};

/** User – human actor with stable identity. */
export type User = {
  id: string;
  email: string;
  tenantId: string;
  createdAt: string;
  /** Optional; for API-created users. Legacy TEST_USERS have no hash. */
  passwordHash?: string;
  /** Optional; not required for first slice. */
  name?: string;
};

/** Membership – user ↔ tenant, tenant-level role. */
export type Membership = {
  userId: string;
  tenantId: string;
  role: TenantRole;
  /** Optional; for future invite flow. */
  joinedAt?: string;
};

/** UserBranchAssignment – user ↔ branch, branch-level role. */
export type UserBranchAssignment = {
  userId: string;
  branchId: string;
  role: BranchRole;
  /** Optional; for future. */
  assignedAt?: string;
};

/** Resolved session identity – for API/runtime use. */
export type SessionUser = {
  id: string;
  email: string;
  tenantId: string;
  tenantRole: TenantRole | null;
  branchIds: string[];
  branchRoles: Record<string, BranchRole>;
};

/** V1 public session – simplified for API/UI. */
export type SessionPublic = {
  email: string;
  userId: string;
  accountId: string;
  accessType: AccessType;
  branchIds: string[];
};
