import type {
  CreateItemInput,
  GroceryAuthor,
  GroceryItem,
  GroceryItemId,
  GroceryTransition,
  UpdateItemInput,
} from "@hejmly/app-grocery/shared";
import { isPurchased, parseGroceryItemId, transition } from "@hejmly/app-grocery/shared";
import {
  AddItemForm,
  EditItemForm,
  EmptyState,
  Fab,
  type ItemSyncState,
  ListBody,
  ListSkeleton,
  TopBar,
} from "@hejmly/app-grocery/ui";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { match } from "ts-pattern";

import { BottomNav } from "@/components/BottomNav";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { createItem, deleteItem, fetchItems, togglePurchased, updateItem } from "@/lib/grocery-api";
import { useSessionAuthor } from "@/lib/session-author";

const ITEMS_QUERY_KEY = ["grocery", "items"] as const;
const TEMP_ID_PREFIX = "tmp_";

const isTempId = (id: GroceryItemId): boolean => id.startsWith(TEMP_ID_PREFIX);

type DrawerState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; id: GroceryItemId }
  | { kind: "remove"; id: GroceryItemId };

const DRAWER_NONE: DrawerState = { kind: "none" };

export const GroceryScreen = (): ReactElement => {
  const qc = useQueryClient();
  const online = useOnlineStatus();
  const identity: GroceryAuthor = useSessionAuthor();
  const [drawer, setDrawer] = useState<DrawerState>(DRAWER_NONE);
  const [pending, setPending] = useState<ReadonlyMap<GroceryItemId, ItemSyncState>>(
    () => new Map(),
  );

  const items = useQuery({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: fetchItems,
    refetchInterval: 20_000,
  });

  const setSync = (id: GroceryItemId, state: ItemSyncState | null): void => {
    setPending((prev) => {
      const next = new Map(prev);
      if (state === null) next.delete(id);
      else next.set(id, state);
      return next;
    });
  };

  const closeIfMatches = (id: GroceryItemId): void => {
    setDrawer((current) => {
      if ((current.kind === "edit" || current.kind === "remove") && current.id === id) {
        return DRAWER_NONE;
      }
      return current;
    });
  };

  useEffect(() => {
    if (items.data === undefined) return;
    const present = new Set(items.data.map((i) => i.id));
    setPending((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [id, state] of prev) {
        if (state === "error" || !present.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [items.data]);

  const create = useMutation({
    mutationFn: ({ input, tempId }: { input: CreateItemInput; tempId: GroceryItemId }) =>
      createItem(input, tempId),
    onMutate: async ({ input, tempId }) => {
      await qc.cancelQueries({ queryKey: ITEMS_QUERY_KEY });
      const optimistic: GroceryItem = {
        id: tempId,
        name: input.name,
        description: input.description ?? null,
        status: { kind: "pending" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        addedBy: identity,
      };
      qc.setQueryData<GroceryItem[]>(ITEMS_QUERY_KEY, (current) => {
        const list = current ?? [];
        return list.some((i) => i.id === tempId)
          ? list.map((i) => (i.id === tempId ? optimistic : i))
          : [optimistic, ...list];
      });
      setSync(tempId, "queued");
      return { tempId };
    },
    onError: (_e, _vars, ctx) => {
      if (!navigator.onLine) return;
      if (ctx) setSync(ctx.tempId, "error");
      toast.error("Could not add item — tap retry");
    },
    onSuccess: (saved, _vars, ctx) => {
      if (!ctx) return;
      qc.setQueryData<GroceryItem[]>(ITEMS_QUERY_KEY, (current) =>
        (current ?? []).map((i) => (i.id === ctx.tempId ? saved : i)),
      );
      setSync(ctx.tempId, null);
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, purchased }: { id: GroceryItemId; purchased: boolean }) =>
      togglePurchased(id, purchased),
    onMutate: async ({ id, purchased }) => {
      await qc.cancelQueries({ queryKey: ITEMS_QUERY_KEY });
      const prevItem = (qc.getQueryData<GroceryItem[]>(ITEMS_QUERY_KEY) ?? []).find(
        (i) => i.id === id,
      );
      const at = Date.now();
      const t: GroceryTransition =
        purchased && identity.kind === "user"
          ? { kind: "mark_purchased", by: identity.id, at }
          : { kind: "mark_pending" };
      qc.setQueryData<GroceryItem[]>(ITEMS_QUERY_KEY, (current) =>
        (current ?? []).map((i) => {
          if (i.id !== id) return i;
          const next = transition(i.status, t);
          return { ...i, status: next.kind === "ok" ? next.value : i.status, updatedAt: at };
        }),
      );
      setSync(id, "queued");
      return { prevItem, id };
    },
    onError: (_e, _vars, ctx) => {
      if (!navigator.onLine) return;
      if (ctx?.prevItem !== undefined) {
        const restore = ctx.prevItem;
        qc.setQueryData<GroceryItem[]>(ITEMS_QUERY_KEY, (current) =>
          (current ?? []).map((i) => (i.id === restore.id ? restore : i)),
        );
      }
      if (ctx) setSync(ctx.id, "error");
      toast.error("Could not update item");
    },
    onSuccess: (saved, _vars, ctx) => {
      if (!ctx) return;
      qc.setQueryData<GroceryItem[]>(ITEMS_QUERY_KEY, (current) =>
        (current ?? []).map((i) => (i.id === ctx.id ? saved : i)),
      );
      setSync(ctx.id, null);
    },
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: GroceryItemId; input: UpdateItemInput }) =>
      updateItem(id, input),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: ITEMS_QUERY_KEY });
      const prevItem = (qc.getQueryData<GroceryItem[]>(ITEMS_QUERY_KEY) ?? []).find(
        (i) => i.id === id,
      );
      qc.setQueryData<GroceryItem[]>(ITEMS_QUERY_KEY, (current) =>
        (current ?? []).map((i) =>
          i.id === id
            ? {
                ...i,
                ...(input.name !== undefined ? { name: input.name } : {}),
                ...(input.description !== undefined ? { description: input.description } : {}),
                updatedAt: Date.now(),
              }
            : i,
        ),
      );
      setSync(id, "queued");
      return { prevItem, id };
    },
    onError: (_e, _vars, ctx) => {
      if (!navigator.onLine) return;
      if (ctx?.prevItem !== undefined) {
        const restore = ctx.prevItem;
        qc.setQueryData<GroceryItem[]>(ITEMS_QUERY_KEY, (current) =>
          (current ?? []).map((i) => (i.id === restore.id ? restore : i)),
        );
      }
      if (ctx) setSync(ctx.id, "error");
      toast.error("Could not update item");
    },
    onSuccess: (saved, _vars, ctx) => {
      if (!ctx) return;
      qc.setQueryData<GroceryItem[]>(ITEMS_QUERY_KEY, (current) =>
        (current ?? []).map((i) => (i.id === ctx.id ? saved : i)),
      );
      setSync(ctx.id, null);
      closeIfMatches(ctx.id);
    },
  });

  const remove = useMutation({
    mutationFn: (id: GroceryItemId) => deleteItem(id),
    onMutate: async (id: GroceryItemId) => {
      await qc.cancelQueries({ queryKey: ITEMS_QUERY_KEY });
      const list = qc.getQueryData<GroceryItem[]>(ITEMS_QUERY_KEY) ?? [];
      const index = list.findIndex((i) => i.id === id);
      const prevItem = index >= 0 ? list[index] : undefined;
      qc.setQueryData<GroceryItem[]>(ITEMS_QUERY_KEY, (current) =>
        (current ?? []).filter((i) => i.id !== id),
      );
      setSync(id, null);
      return { index, prevItem };
    },
    onError: (_e, _vars, ctx) => {
      if (!navigator.onLine) return;
      if (ctx?.prevItem !== undefined) {
        const restore = ctx.prevItem;
        const at = ctx.index;
        qc.setQueryData<GroceryItem[]>(ITEMS_QUERY_KEY, (current) => {
          const next = [...(current ?? [])];
          next.splice(Math.min(Math.max(at, 0), next.length), 0, restore);
          return next;
        });
      }
      toast.error("Could not remove item");
    },
  });

  const visibleItems = items.data ?? [];

  const counts = useMemo(() => {
    const total = visibleItems.length;
    const done = visibleItems.filter((i) => isPurchased(i.status)).length;
    const queued = Array.from(pending.values()).filter((s) => s === "queued").length;
    return { total, done, queued };
  }, [visibleItems, pending]);

  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) {
      void qc.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
    }
    wasOnline.current = online;
  }, [online, qc]);

  useEffect(() => {
    if (drawer.kind !== "edit" && drawer.kind !== "remove") return;
    if (items.data === undefined) return;
    if (items.data.some((i) => i.id === drawer.id)) return;
    setDrawer(DRAWER_NONE);
    toast.info("That item was removed");
  }, [drawer, items.data]);

  const handleToggle = (id: GroceryItemId, purchased: boolean): void => {
    if (isTempId(id)) return;
    toggle.mutate({ id, purchased });
  };

  const handleRetry = (id: GroceryItemId): void => {
    const item = visibleItems.find((i) => i.id === id);
    if (item === undefined) return;
    if (isTempId(id)) {
      const input: CreateItemInput =
        item.description !== null
          ? { name: item.name, description: item.description }
          : { name: item.name };
      create.mutate({ input, tempId: id });
      return;
    }
    toggle.mutate({ id, purchased: !isPurchased(item.status) });
  };

  const handleCreate = (input: CreateItemInput): void => {
    const tempId = parseGroceryItemId(`${TEMP_ID_PREFIX}${crypto.randomUUID()}`);
    create.mutate({ input, tempId });
    setDrawer(DRAWER_NONE);
  };

  const handleRemove = (id: GroceryItemId): void => {
    if (isTempId(id)) return;
    setDrawer({ kind: "remove", id });
  };

  const handleConfirmRemove = (id: GroceryItemId): void => {
    remove.mutate(id);
    setDrawer(DRAWER_NONE);
  };

  const handleEditOpen = (id: GroceryItemId): void => {
    if (isTempId(id)) return;
    setDrawer({ kind: "edit", id });
  };

  const handleEditSubmit = (id: GroceryItemId, input: UpdateItemInput): void => {
    update.mutate({ id, input });
  };

  if (items.isPending) {
    return (
      <main className="flex h-dvh flex-col overflow-hidden bg-slate-50">
        <ListSkeleton />
        <BottomNav active="grocery" />
      </main>
    );
  }

  if (items.isError) {
    return (
      <main className="flex h-dvh flex-col overflow-hidden bg-slate-50">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <WarningCircleIcon size={40} weight="fill" className="text-slate-300" />
          <div>
            <p className="font-medium text-base text-slate-900">Couldn't load your list</p>
            <p className="mt-1 text-slate-500 text-sm">Check your connection and try again.</p>
          </div>
          <button
            type="button"
            onClick={() => void items.refetch()}
            className="flex min-h-11 items-center justify-center rounded-2xl bg-slate-900 px-6 font-medium text-base text-white transition active:scale-[0.98]"
          >
            Try again
          </button>
        </div>
        <BottomNav active="grocery" />
      </main>
    );
  }

  const editingItem = match(drawer)
    .with({ kind: "edit" }, ({ id }) => visibleItems.find((i) => i.id === id) ?? null)
    .with({ kind: "none" }, { kind: "add" }, { kind: "remove" }, () => null)
    .exhaustive();
  const removingItem = match(drawer)
    .with({ kind: "remove" }, ({ id }) => visibleItems.find((i) => i.id === id) ?? null)
    .with({ kind: "none" }, { kind: "add" }, { kind: "edit" }, () => null)
    .exhaustive();

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-slate-50">
      <TopBar count={counts.total} doneCount={counts.done} queuedCount={counts.queued} />
      {visibleItems.length === 0 ? (
        <EmptyState />
      ) : (
        <ListBody
          items={visibleItems}
          syncStates={pending}
          onToggle={handleToggle}
          onRetry={handleRetry}
          onEdit={handleEditOpen}
          onRemove={handleRemove}
        />
      )}
      <Fab onClick={() => setDrawer({ kind: "add" })} />
      <BottomNav active="grocery" />

      <Drawer
        open={drawer.kind === "add"}
        onOpenChange={(open) => {
          if (!open) setDrawer(DRAWER_NONE);
        }}
      >
        <DrawerContent className="rounded-t-3xl bg-white">
          <DrawerTitle className="sr-only">Add a grocery item</DrawerTitle>
          <DrawerDescription className="sr-only">
            Name the item, optionally add a description.
          </DrawerDescription>
          <div className="flex max-h-[70dvh] flex-col pt-3 pb-2">
            {drawer.kind === "add" && (
              <AddItemForm onSubmit={handleCreate} onCancel={() => setDrawer(DRAWER_NONE)} />
            )}
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer
        open={editingItem !== null}
        onOpenChange={(open) => {
          if (open) return;
          if (update.isPending) return;
          setDrawer(DRAWER_NONE);
        }}
      >
        <DrawerContent className="rounded-t-3xl bg-white">
          <DrawerTitle className="sr-only">Edit grocery item</DrawerTitle>
          <DrawerDescription className="sr-only">
            Change the item name or description.
          </DrawerDescription>
          <div className="flex max-h-[70dvh] flex-col pt-3 pb-2">
            {editingItem !== null && (
              <EditItemForm
                initialName={editingItem.name}
                initialDescription={editingItem.description ?? ""}
                pending={update.isPending && update.variables?.id === editingItem.id}
                onSubmit={(input) => handleEditSubmit(editingItem.id, input)}
                onCancel={() => setDrawer(DRAWER_NONE)}
              />
            )}
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer
        open={removingItem !== null}
        onOpenChange={(open) => {
          if (!open) setDrawer(DRAWER_NONE);
        }}
      >
        <DrawerContent
          className="rounded-t-3xl bg-white"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DrawerTitle className="px-5 pt-2 font-semibold text-lg text-slate-900">
            Remove {removingItem?.name ?? "item"}?
          </DrawerTitle>
          <DrawerDescription className="px-5 pt-1 text-slate-600 text-sm">
            This can't be undone — the item will be gone for everyone in the household.
          </DrawerDescription>
          <div className="flex flex-col gap-2.5 px-5 pt-5 pb-[max(env(safe-area-inset-bottom),1rem)]">
            <button
              type="button"
              onClick={() => setDrawer(DRAWER_NONE)}
              className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-slate-100 font-medium text-base text-slate-900 transition active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => removingItem !== null && handleConfirmRemove(removingItem.id)}
              className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-rose-600 font-medium text-base text-white transition active:scale-[0.98]"
            >
              Remove
            </button>
          </div>
        </DrawerContent>
      </Drawer>
    </main>
  );
};
