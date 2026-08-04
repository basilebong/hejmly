import { err, ok, type Result, type UserId } from "@hejmly/core/shared";
import { match } from "ts-pattern";

export type GroceryStatus =
  | { kind: "pending" }
  | { kind: "purchased"; purchasedAt: number; purchasedBy: UserId };

export type GroceryTransition =
  | { kind: "mark_purchased"; by: UserId; at: number }
  | { kind: "mark_pending" };

export type TransitionError = { kind: "already_in_state"; state: GroceryStatus["kind"] };

export const transition = (
  status: GroceryStatus,
  t: GroceryTransition,
): Result<GroceryStatus, TransitionError> =>
  match<GroceryTransition, Result<GroceryStatus, TransitionError>>(t)
    .with({ kind: "mark_purchased" }, ({ by, at }) =>
      status.kind === "purchased"
        ? err({ kind: "already_in_state", state: "purchased" })
        : ok({ kind: "purchased", purchasedAt: at, purchasedBy: by }),
    )
    .with({ kind: "mark_pending" }, () =>
      status.kind === "pending"
        ? err({ kind: "already_in_state", state: "pending" })
        : ok({ kind: "pending" }),
    )
    .exhaustive();

export const isPurchased = (s: GroceryStatus): s is { kind: "purchased" } & GroceryStatus =>
  s.kind === "purchased";
