import {
  getMarkdownTheme,
  keyHint,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { stateGlyph, type ActivityState } from "./glyphs.ts";

const PREVIEW_LINES = 8;

export interface ResultCardOptions {
  state: ActivityState;
  title: string;
  subtitle?: string;
  body: string;
  expanded: boolean;
}

export function renderResultCard(theme: Theme, card: ResultCardOptions) {
  const header =
    `${stateGlyph(theme, card.state)} ` +
    theme.fg("accent", theme.bold(card.title)) +
    (card.subtitle ? theme.fg("muted", ` · ${card.subtitle}`) : "");

  if (card.expanded) {
    const headerText = new Text(header, 0, 0);
    const markdown = new Markdown(card.body, 0, 0, getMarkdownTheme());
    return {
      render: (width: number) => [
        ...headerText.render(width),
        ...markdown.render(width),
      ],
      invalidate: () => {
        headerText.invalidate();
        markdown.invalidate();
      },
    };
  }

  const lines = card.body.split("\n");
  let text = header;
  for (const line of lines.slice(0, PREVIEW_LINES)) {
    text += `\n${theme.fg("toolOutput", line)}`;
  }
  if (lines.length > PREVIEW_LINES) {
    text += `\n${theme.fg("dim", `... (${keyHint("app.tools.expand", "to expand")})`)}`;
  }
  return new Text(text, 0, 0);
}
