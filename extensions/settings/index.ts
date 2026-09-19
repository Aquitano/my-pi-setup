import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openModelPicker, openReasoningPicker } from "../summaries/src/ui.ts";
import { openSetup } from "./menu.ts";

export default function (pi: ExtensionAPI) {
  let editing = false;
  pi.registerCommand("setup", {
    description: "Configure agent permissions, concurrency, and run recaps",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || editing) {
        ctx.ui.notify(
          editing ? "Setup is already open." : "Open /setup in the Pi TUI.",
          "info",
        );
        return;
      }
      editing = true;
      try {
        await openSetup(ctx.ui, async (current) => {
          const model = await openModelPicker(ctx, current);
          if (!model) return undefined;
          const reasoning = await openReasoningPicker(
            ctx,
            model,
            current.reasoning,
          );
          if (!reasoning) return undefined;
          return {
            ...current,
            provider: model.provider,
            model: model.id,
            reasoning,
          };
        });
      } finally {
        editing = false;
      }
    },
  });
}
