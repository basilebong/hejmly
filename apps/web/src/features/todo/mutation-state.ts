import { type LocalRowState, localRowStates } from "@hejmly/app-todo/shared";
import { type MutationKey, type QueryClient, useMutationState } from "@tanstack/react-query";
import { useMemo } from "react";
import * as v from "valibot";

const CreateVariablesSchema = v.object({ tempId: v.string() });

const localIdOf = (variables: unknown): string | null => {
  const parsed = v.safeParse(CreateVariablesSchema, variables);
  return parsed.success ? parsed.output.tempId : null;
};

export const useLocalRowStates = (mutationKey: MutationKey): ReadonlyMap<string, LocalRowState> => {
  const attempts = useMutationState({
    filters: { mutationKey },
    select: (m) => ({
      localId: localIdOf(m.state.variables),
      status: m.state.status,
      submittedAt: m.state.submittedAt,
    }),
  });
  return useMemo(() => localRowStates(attempts), [attempts]);
};

export const pendingIds = <T extends string>(
  qc: QueryClient,
  mutationKey: MutationKey,
  idSchema: v.GenericSchema<unknown, T>,
): ReadonlySet<T> =>
  new Set(
    qc
      .getMutationCache()
      .findAll({ mutationKey, status: "pending" })
      .flatMap((m) => {
        const parsed = v.safeParse(idSchema, m.state.variables);
        return parsed.success ? [parsed.output] : [];
      }),
  );
