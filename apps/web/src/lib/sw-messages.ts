import { PushMessageSchema } from "@hejmly/core/shared";
import * as v from "valibot";

export const OpenUrlMessageSchema = v.object({
  kind: v.literal("open_url"),
  url: PushMessageSchema.entries.url,
});
export type OpenUrlMessage = v.InferOutput<typeof OpenUrlMessageSchema>;
