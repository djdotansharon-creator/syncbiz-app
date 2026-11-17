/**
 * PEOPLE ON THE PHONE (owner 2026-11-18): the pure rules the phone's people screens use (lib/mobile-people.ts) — what is offered to whom, what a request carries, how errors read.
 * The phone adds no rule of its own; these mirror the computer's Permissions screen (components/roles/person-page.tsx, people-grid.tsx). Run: npx tsx scripts/verify-mobile-people.ts
 */
import {
  accountActionsFor, approvalBody, branchChoiceState, branchReach, defaultApprovalRole, isAdminLevel, matchesPerson, orderPeople, peopleErrorText,
  type AccountRow, type BranchRow, type PersonRow, type RoleRow,
} from "../lib/mobile-people";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (cond) pass++; else fail++;
}
const person = (o: Partial<PersonRow>): PersonRow => ({ userId: "u1", name: "Amit", email: "a@x.test", level: "member", roleId: null, roleName: null, status: "active", lastSignInAt: null, joinedAt: "2026-01-01T00:00:00Z", isYou: false, ...o });
const acct = (o: Partial<AccountRow>): AccountRow => ({ email: "a@x.test", accessType: "BRANCH_USER", branchIds: [], ...o });

// ── who keeps their level
assert("P1 an owner and a manager keep their level (no role, no branch choice); a plain member does not", isAdminLevel(person({ level: "owner" }), null) && isAdminLevel(person({ level: "manager" }), null) && !isAdminLevel(person({}), acct({})) && isAdminLevel(person({}), acct({ accessType: "OWNER" })));

// ── pause / remove
assert("P2 a member may be paused and removed", JSON.stringify(accountActionsFor(person({}), acct({}))) === JSON.stringify({ canPause: true, canRemove: true }));
assert("P3 never yourself, never the owner, and nothing at all without an account row", !accountActionsFor(person({ isYou: true }), acct({})).canPause && !accountActionsFor(person({ isYou: true }), acct({})).canRemove && !accountActionsFor(person({ level: "owner" }), acct({})).canRemove && !accountActionsFor(person({}), null).canPause);
assert("P4 what the server says wins: canPauseInWorkspace / canRemoveFromWorkspace false hides the button", !accountActionsFor(person({}), acct({ canPauseInWorkspace: false })).canPause && accountActionsFor(person({}), acct({ canPauseInWorkspace: false })).canRemove && !accountActionsFor(person({}), acct({ canRemoveFromWorkspace: false })).canRemove);

// ── approving a request
const roles: RoleRow[] = [{ id: "r1", name: "Manager" }, { id: "r2", name: "Shift manager" }, { id: "r3", name: "Employee" }];
assert("P5 nobody picked a role → the LAST role of the list (the computer's rule), or a plain member when roles are off", defaultApprovalRole(roles) === "r3" && defaultApprovalRole([]) === "MEMBER");
assert("P6 with roles on the approval carries roleId; without them the level (anything but MANAGER is a member)", JSON.stringify(approvalBody("approve", "r2", true)) === JSON.stringify({ decision: "approve", roleId: "r2" }) && JSON.stringify(approvalBody("approve", "MANAGER", false)) === JSON.stringify({ decision: "approve", role: "MANAGER" }) && JSON.stringify(approvalBody("approve", "whatever", false)) === JSON.stringify({ decision: "approve", role: "MEMBER" }) && JSON.stringify(approvalBody("reject", "r1", true)) === JSON.stringify({ decision: "reject", roleId: "r1" }));

// ── branches
const branches: BranchRow[] = [{ id: "b1", name: "Haifa" }, { id: "b2", name: "Tel Aviv" }, { id: "b3", name: "Eilat" }];
assert("P7 a member's reach: all / some / none are told apart; an owner has no list", branchReach(acct({ branchIds: ["b1", "b2", "b3"] }), branches).all && branchReach(acct({ branchIds: ["b2"] }), branches).names.join() === "Tel Aviv" && branchReach(acct({ branchIds: [] }), branches).names.length === 0 && branchReach(acct({ accessType: "OWNER" }), branches).names.length === 0 && !branchReach(null, branches).all);
assert("P8 a change of branches needs at least one branch, and 'Save' is only for a real change", !branchChoiceState(acct({ branchIds: ["b1"] }), []).valid && branchChoiceState(acct({ branchIds: ["b1"] }), ["b1"]).dirty === false && branchChoiceState(acct({ branchIds: ["b1"] }), ["b1", "b2"]).dirty && branchChoiceState(acct({ branchIds: ["b1", "b2"] }), ["b2", "b1"]).dirty === false);

// ── the list
assert("P9 people who can sign in come first, a paused one last, each group by name", orderPeople([person({ name: "Zoe", status: "paused" }), person({ name: "Dana" }), person({ name: "Amit" })]).map((p) => p.name).join() === "Amit,Dana,Zoe");
assert("P10 the search finds a name, an e-mail, a role and a level, ignoring case and spaces around it", matchesPerson(person({ name: "Amit Peretz", roleName: "Shift manager" }), "Member", "  amit ") && matchesPerson(person({ email: "dana@x.test" }), "Member", "DANA@") && matchesPerson(person({ roleName: "Shift manager" }), "Member", "shift") && matchesPerson(person({}), "Manager", "manag") && !matchesPerson(person({}), "Member", "zzz") && matchesPerson(person({}), "Member", ""));

// ── errors
assert("P11 a known server code reads as the computer's sentence; an unknown one (or none) as the generic line", peopleErrorText("not_yourself") === "You cannot change your own role." && peopleErrorText("limit").startsWith("This business has no room") && peopleErrorText("nope") === "Something went wrong. Please try again." && peopleErrorText(undefined) === "Something went wrong. Please try again.");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
