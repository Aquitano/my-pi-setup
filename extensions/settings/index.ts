import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { chooseSummaryModel } from "../summaries/src/ui.ts";
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
        await openSetup(ctx.ui, (current) => chooseSummaryModel(ctx, current));
      } finally {
        editing = false;
      }
    },
  });
}
