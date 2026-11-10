# BUG-022: A removed machine type, machine or panel can't be added again under the same name

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Low |
| Area | Machines, Panels & camps (lead) |
| Reported | 2026-11-10 |
| Found by | E2E `ui/journey-approvals.spec.js` › Machines (lead only), Panels (lead only) |
| Assignee | — |
| Resolution | Fixed 2026-11-10 (uncommitted): adding a machine type, machine or panel whose name belongs to a removed one brings that record back (`src/routes/machines.js`, `src/routes/panels.js`); a revived panel starts without its old standing rates. A name in active use now gets its own message. Branches are unchanged: whether a removed branch's name and code may be reused is still to be decided. |
| Verified by | `npm run test:e2e`, 2026-11-10: the linked tests pass as ordinary tests |

## Summary

Removing a machine type, a machine or a panel hides it (a soft delete), but
its name stays taken. Adding one with the same name again fails with "That
already exists.", although nothing by that name is listed anywhere.

## Steps to reproduce

1. As the lead, open **Machines** and add a machine type "Analyser X".
2. Remove it. It leaves the list.
3. Add a machine type "Analyser X" again.

The same happens with a machine at the same branch, and with a panel on
**Panels & camps**.

## Expected

The name can be used again (or the removed record comes back), since the
lead can see nothing that uses it.

## Actual

The dialog shows "That already exists." and nothing is added. The only way
on is a different name.

## Root cause

The removes are soft deletes (`isActive: false`) in `src/routes/machines.js`
and `src/routes/panels.js`, while the names are unique across active and
removed rows alike (`MachineType.name`, `Machine (branchId, name)`,
`Panel.name` in `prisma/schema.prisma`). The create calls don't look for a
removed row, so Prisma's P2002 becomes the generic 409 of
`src/utils/route.js`.

Branches behave the same way (`Location.name`, `locationCode`), with their
own messages. A branch's code probably should stay taken, because it starts
every bill number raised there; that needs a decision before it is changed.

## Suggested fix

On create, when the only clash is a removed row, reactivate that row with
the new values (history keeps pointing at one record). Otherwise say what
clashes ("A machine type with that name already exists.").

## Linked tests

- `e2e/specs/ui/journey-approvals.spec.js` › "a machine type that was removed can be added again under the same name"
- `e2e/specs/ui/journey-approvals.spec.js` › "a machine that was removed can be added again at the same branch under the same name"
- `e2e/specs/ui/journey-approvals.spec.js` › "a panel that was removed can be added again under the same name"
