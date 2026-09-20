/**
 * ask_user - Lets the model ask one to four multiple-choice questions in one
 * dialog.
 *
 * - Each question has 2 to 5 model-provided options plus an always-present
 *   "Write my own answer" option, and may allow multiple selections
 * - Arrow keys or number keys move/pick, Space toggles in multi-select,
 *   Enter confirms a question (an empty multi-select answer counts as
 *   skipped) and moves to the next one
 * - "Write my own answer" opens an inline editor (Esc returns to the options)
 * - Left/right arrows move between answered questions; Esc dismisses the
 *   dialog (the model is told the user declined)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { Cause, Effect, Exit } from "effect";
import { Type, type Static } from "typebox";
import { POINTER, stateGlyph } from "../shared/glyphs.ts";
import {
  ASK_USER_PARAMETER_DESCRIPTIONS,
  ASK_USER_PROMPT_GUIDELINES,
  ASK_USER_PROMPT_SNIPPET,
  ASK_USER_TOOL_DESCRIPTION,
  buildAskUserResultMessage,
  type QuestionAnswer,
} from "./prompt.ts";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;
const MAX_QUESTIONS = 4;
const HEADER_WIDTH = 12;
const OTHER_LABEL = "Write my own answer…";

function headerTag(header: string | undefined) {
  return header?.slice(0, HEADER_WIDTH);
}

const OptionSchema = Type.Object({
  label: Type.String({
    description: ASK_USER_PARAMETER_DESCRIPTIONS.optionLabel,
  }),
  description: Type.Optional(
    Type.String({
      description: ASK_USER_PARAMETER_DESCRIPTIONS.optionDescription,
    }),
  ),
});

const QuestionSchema = Type.Object({
  question: Type.String({
    description: ASK_USER_PARAMETER_DESCRIPTIONS.question,
  }),
  header: Type.Optional(
    Type.String({
      description: ASK_USER_PARAMETER_DESCRIPTIONS.header,
    }),
  ),
  options: Type.Array(OptionSchema, {
    minItems: MIN_OPTIONS,
    maxItems: MAX_OPTIONS,
    description: ASK_USER_PARAMETER_DESCRIPTIONS.options,
  }),
  multi_select: Type.Optional(
    Type.Boolean({
      description: ASK_USER_PARAMETER_DESCRIPTIONS.multiSelect,
    }),
  ),
});

const AskUserParams = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    maxItems: MAX_QUESTIONS,
    description: ASK_USER_PARAMETER_DESCRIPTIONS.questions,
  }),
});

export type AskUserInput = Static<typeof AskUserParams>;
type Question = AskUserInput["questions"][number];

interface AskUserDetails {
  answers: QuestionAnswer[] | null;
  cancelled: boolean;
}

interface QuestionState {
  cursor: number;
  selected: Set<number>;
  custom?: string;
}

interface WizardAnswer {
  selected: number[];
  custom?: string;
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > width && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function toAnswers(questions: Question[], wizard: WizardAnswer[]) {
  return questions.map((question, index) => {
    const answer = wizard[index];
    return {
      question: question.question,
      header: headerTag(question.header),
      selected: answer.selected.map((i) => ({
        number: i + 1,
        label: question.options[i].label,
      })),
      custom: answer.custom,
    } satisfies QuestionAnswer;
  });
}

export default function askUser(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description: ASK_USER_TOOL_DESCRIPTION,
    promptSnippet: ASK_USER_PROMPT_SNIPPET,
    promptGuidelines: ASK_USER_PROMPT_GUIDELINES,
    parameters: AskUserParams,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const reply = (text: string, answers: QuestionAnswer[] | null) => ({
        content: [{ type: "text" as const, text }],
        details: {
          answers,
          cancelled: answers === null,
        } satisfies AskUserDetails,
      });

      const questions = params.questions;
      if (questions.length < 1 || questions.length > MAX_QUESTIONS) {
        throw new Error(
          `ask_user requires between 1 and ${MAX_QUESTIONS} questions (got ${questions.length}).`,
        );
      }
      for (const question of questions) {
        if (
          question.options.length < MIN_OPTIONS ||
          question.options.length > MAX_OPTIONS
        ) {
          throw new Error(
            `ask_user requires between ${MIN_OPTIONS} and ${MAX_OPTIONS} options per question (got ${question.options.length} for "${question.question}").`,
          );
        }
      }

      if (ctx.mode !== "tui") {
        return reply(buildAskUserResultMessage({ kind: "no-ui" }), null);
      }
      if (signal?.aborted) {
        return reply(buildAskUserResultMessage({ kind: "cancelled" }), null);
      }

      const showWizard = (uiSignal: AbortSignal) =>
        ctx.ui.custom<WizardAnswer[] | null>((tui, theme, _kb, done) => {
          let questionIndex = 0;
          let editMode = false;
          let cachedLines: string[] | undefined;
          let settled = false;
          const states: QuestionState[] = questions.map(() => ({
            cursor: 0,
            selected: new Set(),
          }));

          function finish(result: WizardAnswer[] | null) {
            if (settled) return;
            settled = true;
            uiSignal.removeEventListener("abort", cancel);
            done(result);
          }

          function cancel() {
            finish(null);
          }

          uiSignal.addEventListener("abort", cancel, { once: true });
          if (uiSignal.aborted) queueMicrotask(cancel);

          const editorTheme: EditorTheme = {
            borderColor: (s) => theme.fg("accent", s),
            selectList: {
              selectedPrefix: (t) => theme.fg("accent", t),
              selectedText: (t) => theme.fg("accent", t),
              description: (t) => theme.fg("muted", t),
              scrollInfo: (t) => theme.fg("dim", t),
              noMatch: (t) => theme.fg("warning", t),
            },
          };
          const editor = new Editor(tui, editorTheme);

          const current = () => ({
            question: questions[questionIndex],
            state: states[questionIndex],
            otherIndex: questions[questionIndex].options.length,
            multi: questions[questionIndex].multi_select === true,
          });

          function refresh() {
            cachedLines = undefined;
            tui.requestRender();
          }

          function advance() {
            if (questionIndex + 1 < questions.length) {
              questionIndex += 1;
              refresh();
              return;
            }
            finish(
              states.map((state) => ({
                selected: [...state.selected].sort((a, b) => a - b),
                custom: state.custom,
              })),
            );
          }

          function choose(index: number) {
            const { state, otherIndex, multi } = current();
            state.cursor = index;
            if (index === otherIndex) {
              editMode = true;
              editor.setText(state.custom ?? "");
              refresh();
              return;
            }
            if (multi) {
              if (state.selected.has(index)) state.selected.delete(index);
              else state.selected.add(index);
              refresh();
              return;
            }
            state.selected = new Set([index]);
            state.custom = undefined;
            advance();
          }

          editor.onSubmit = (value) => {
            const { state, multi } = current();
            const trimmed = value.trim();
            editMode = false;
            editor.setText("");
            if (!trimmed) {
              state.custom = undefined;
              refresh();
              return;
            }
            state.custom = trimmed;
            if (multi) {
              refresh();
              return;
            }
            state.selected = new Set();
            advance();
          };

          function handleInput(data: string) {
            const { state, otherIndex, multi } = current();
            const optionCount = otherIndex + 1;

            if (editMode) {
              if (matchesKey(data, Key.escape)) {
                editMode = false;
                editor.setText("");
                refresh();
                return;
              }
              editor.handleInput(data);
              refresh();
              return;
            }

            if (matchesKey(data, Key.up)) {
              state.cursor = (state.cursor - 1 + optionCount) % optionCount;
              refresh();
              return;
            }
            if (matchesKey(data, Key.down)) {
              state.cursor = (state.cursor + 1) % optionCount;
              refresh();
              return;
            }
            if (matchesKey(data, Key.left) && questionIndex > 0) {
              questionIndex -= 1;
              refresh();
              return;
            }
            const answered =
              state.selected.size > 0 || state.custom !== undefined;
            if (
              matchesKey(data, Key.right) &&
              answered &&
              questionIndex + 1 < questions.length
            ) {
              questionIndex += 1;
              refresh();
              return;
            }
            if (
              data.length === 1 &&
              data >= "1" &&
              data <= String(optionCount)
            ) {
              choose(Number(data) - 1);
              return;
            }
            if (multi && data === " ") {
              choose(state.cursor);
              return;
            }
            if (matchesKey(data, Key.enter)) {
              // In multi-select Enter confirms the question, including from
              // the free-text row once something was written there. An empty
              // confirmation is reported to the model as "no answer".
              const editsCustom =
                state.cursor === otherIndex && state.custom === undefined;
              if (multi && !editsCustom) advance();
              else choose(state.cursor);
              return;
            }
            if (matchesKey(data, Key.escape)) finish(null);
          }

          function render(width: number): string[] {
            if (cachedLines) return cachedLines;
            const { question, state, otherIndex, multi } = current();
            const lines: string[] = [];
            const add = (s: string) => lines.push(truncateToWidth(s, width));

            const progress =
              questions.length > 1
                ? ` Question ${questionIndex + 1} of ${questions.length} `
                : " Question ";
            const header = headerTag(question.header);
            const tag = header ? theme.fg("muted", `${header} `) : "";
            const tagWidth = header ? header.length + 1 : 0;
            add(
              theme.fg(
                "accent",
                `─${progress}${"─".repeat(Math.max(0, width - progress.length - 1))}`,
              ),
            );
            wrapText(
              question.question,
              Math.max(10, width - 2 - tagWidth),
            ).forEach((line, i) =>
              add(
                ` ${i === 0 ? tag : ""}${theme.fg("text", theme.bold(line))}`,
              ),
            );
            lines.push("");

            for (let i = 0; i <= otherIndex; i++) {
              const isOther = i === otherIndex;
              const label = isOther ? OTHER_LABEL : question.options[i].label;
              const focused = i === state.cursor;
              const picked = isOther
                ? state.custom !== undefined
                : state.selected.has(i);
              const prefix = focused
                ? theme.fg("accent", ` ${POINTER} `)
                : "   ";
              const box = multi
                ? `${picked ? stateGlyph(theme, "done") : stateGlyph(theme, "pending")} `
                : "";
              const text = `${i + 1}. ${label}`;
              add(
                prefix +
                  box +
                  (focused || picked
                    ? theme.fg("accent", text)
                    : theme.fg(isOther ? "muted" : "text", text)),
              );
              const description = isOther
                ? state.custom
                : question.options[i].description;
              if (description) add(`      ${theme.fg("muted", description)}`);
            }

            if (editMode) {
              lines.push("");
              add(theme.fg("muted", " Your answer:"));
              for (const line of editor.render(width - 2)) add(` ${line}`);
            }

            lines.push("");
            const back = questionIndex > 0 ? " • ← back" : "";
            if (editMode) {
              add(theme.fg("dim", " Enter submit • Esc back to options"));
            } else if (multi) {
              const nothing =
                state.selected.size === 0 && state.custom === undefined;
              add(
                theme.fg(
                  "dim",
                  ` Space or 1-${otherIndex} toggle • ${otherIndex + 1} write • Enter ${nothing ? "skip" : "confirm"}${back} • Esc dismiss`,
                ),
              );
            } else {
              add(
                theme.fg(
                  "dim",
                  ` ↑↓ or 1-${otherIndex + 1} select • Enter confirm${back} • Esc dismiss`,
                ),
              );
            }
            add(theme.fg("accent", "─".repeat(width)));

            cachedLines = lines;
            return lines;
          }

          return {
            render,
            invalidate: () => {
              cachedLines = undefined;
            },
            handleInput,
            dispose: () => {
              uiSignal.removeEventListener("abort", cancel);
            },
          };
        });

      const uiExit = await Effect.runPromiseExit(
        Effect.tryPromise(showWizard),
        signal ? { signal } : undefined,
      );

      if (Exit.isFailure(uiExit)) {
        if (Cause.hasInterruptsOnly(uiExit.cause)) {
          return reply(buildAskUserResultMessage({ kind: "cancelled" }), null);
        }
        const [first] = Cause.prettyErrors(uiExit.cause);
        throw new Error(first?.message ?? Cause.pretty(uiExit.cause));
      }

      if (!uiExit.value) {
        return reply(buildAskUserResultMessage({ kind: "dismissed" }), null);
      }

      const answers = toAnswers(questions, uiExit.value);
      return reply(
        buildAskUserResultMessage({ kind: "answered", answers }),
        answers,
      );
    },

    renderCall(args, theme) {
      const questions = Array.isArray(args.questions)
        ? (args.questions as Partial<Question>[])
        : [];
      let text = theme.fg("toolTitle", theme.bold("ask_user"));
      for (const question of questions) {
        const header = headerTag(question.header);
        const tag = header ? theme.fg("accent", `[${header}] `) : "";
        text += `\n  ${tag}${theme.fg("muted", question.question ?? "")}`;
        const options = Array.isArray(question.options) ? question.options : [];
        if (options.length > 0) {
          const numbered = options.map((o, i) => `${i + 1}. ${o.label}`);
          text += `\n    ${theme.fg("dim", numbered.join("  "))}`;
        }
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as AskUserDetails | undefined;
      if (!details) {
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }
      if (details.cancelled || !details.answers) {
        return new Text(
          `${stateGlyph(theme, "failed")} ${theme.fg("warning", "dismissed")}`,
          0,
          0,
        );
      }
      const lines = details.answers.map((answer) => {
        const tag = answer.header
          ? theme.fg("muted", `${answer.header}: `)
          : "";
        const parts = answer.selected.map(
          (option) => `${option.number}. ${option.label}`,
        );
        if (answer.custom) parts.push(`(wrote) ${answer.custom}`);
        const state = parts.length > 0 ? "done" : "pending";
        return `${stateGlyph(theme, state)} ${tag}${theme.fg("accent", parts.join(", ") || "no answer")}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
