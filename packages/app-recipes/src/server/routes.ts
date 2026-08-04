import type { SessionVariables } from "@hejmly/core/server";
import { parseUserId } from "@hejmly/core/shared";
import { Hono } from "hono";
import { match } from "ts-pattern";
import * as v from "valibot";
import {
  CreateRecipeInputSchema,
  IMAGE_DATA_URL_RE,
  type RecipeError,
  type RecipeId,
  RecipeIdSchema,
  recipeErrorStatus,
} from "../shared/index.ts";
import type { RecipeService } from "./service.ts";

export type RecipeDeps = { service: RecipeService };

const handleError = (e: RecipeError) =>
  match(e)
    .with({ kind: "not_found" }, (it) => ({ status: recipeErrorStatus(it), body: it }) as const)
    .with({ kind: "invalid_input" }, (it) => ({ status: recipeErrorStatus(it), body: it }) as const)
    .exhaustive();

type ParsedBody<T> = { ok: true; value: T } | { ok: false };

const parseBody = async <S extends v.GenericSchema>(
  req: Request,
  schema: S,
): Promise<ParsedBody<v.InferOutput<S>>> => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false };
  }
  const parsed = v.safeParse(schema, raw);
  if (!parsed.success) return { ok: false };
  return { ok: true, value: parsed.output };
};

const tryParseRecipeId = (raw: string | undefined): RecipeId | null => {
  const parsed = v.safeParse(RecipeIdSchema, raw);
  return parsed.success ? parsed.output : null;
};

const invalidInput = (message = "Invalid input") =>
  ({ kind: "invalid_input" as const, message }) as const;

const IMAGE_CACHE_CONTROL = "private, max-age=0, must-revalidate";

const decodeImageDataUrl = (
  value: string,
): { mime: string; bytes: Uint8Array<ArrayBuffer> } | null => {
  const match = IMAGE_DATA_URL_RE.exec(value);
  if (match === null) return null;
  const mime = match[1];
  const base64 = match[2];
  if (mime === undefined || base64 === undefined) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { mime, bytes };
};

const weakImageETag = (input: string): string => {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca77);
  }
  const high = (h1 >>> 0).toString(16).padStart(8, "0");
  const low = (h2 >>> 0).toString(16).padStart(8, "0");
  return `W/"${high}${low}"`;
};

export const createRecipeRoutes = (deps: RecipeDeps) =>
  new Hono<{ Variables: SessionVariables }>()
    .get("/", async (c) => {
      const recipes = await deps.service.list();
      return c.json({ recipes });
    })
    .get("/:id", async (c) => {
      const id = tryParseRecipeId(c.req.param("id"));
      if (id === null) return c.json(invalidInput("Invalid recipe id"), 400);
      const result = await deps.service.get(id);
      if (result.kind === "err") {
        const e = handleError(result.error);
        return c.json(e.body, e.status);
      }
      return c.json({ recipe: result.value });
    })
    .get("/:id/image", async (c) => {
      const id = tryParseRecipeId(c.req.param("id"));
      if (id === null) return c.json(invalidInput("Invalid recipe id"), 400);
      const result = await deps.service.get(id);
      if (result.kind === "err") {
        const e = handleError(result.error);
        return c.json(e.body, e.status);
      }
      const image = result.value.image;
      if (image === null) {
        const e = handleError({ kind: "not_found", id });
        return c.json(e.body, e.status);
      }
      const etag = weakImageETag(image);
      if (c.req.header("if-none-match") === etag) {
        return new Response(null, {
          status: 304,
          headers: { etag, "cache-control": IMAGE_CACHE_CONTROL },
        });
      }
      const decoded = decodeImageDataUrl(image);
      if (decoded === null) {
        const e = handleError({ kind: "invalid_input", message: "Corrupt image" });
        return c.json(e.body, e.status);
      }
      return new Response(decoded.bytes, {
        headers: {
          "content-type": decoded.mime,
          "cache-control": IMAGE_CACHE_CONTROL,
          etag,
        },
      });
    })
    .post("/", async (c) => {
      const parsed = await parseBody(c.req.raw, CreateRecipeInputSchema);
      if (!parsed.ok) return c.json(invalidInput(), 400);
      const user = c.get("user");
      const result = await deps.service.create(parsed.value, parseUserId(user.id));
      if (result.kind === "err") {
        const e = handleError(result.error);
        return c.json(e.body, e.status);
      }
      return c.json({ recipe: result.value }, 201);
    })
    .put("/:id", async (c) => {
      const id = tryParseRecipeId(c.req.param("id"));
      if (id === null) return c.json(invalidInput("Invalid recipe id"), 400);
      const parsed = await parseBody(c.req.raw, CreateRecipeInputSchema);
      if (!parsed.ok) return c.json(invalidInput(), 400);
      const result = await deps.service.update(id, parsed.value);
      if (result.kind === "err") {
        const e = handleError(result.error);
        return c.json(e.body, e.status);
      }
      return c.json({ recipe: result.value });
    })
    .delete("/:id", async (c) => {
      const id = tryParseRecipeId(c.req.param("id"));
      if (id === null) return c.json(invalidInput("Invalid recipe id"), 400);
      const result = await deps.service.remove(id);
      if (result.kind === "err") {
        const e = handleError(result.error);
        return c.json(e.body, e.status);
      }
      return c.json({ id: result.value.id });
    });

export type RecipeRoutes = ReturnType<typeof createRecipeRoutes>;
