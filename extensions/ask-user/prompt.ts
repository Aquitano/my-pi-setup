/** Model-facing schema descriptions for ask_user questions and answer options. */
export const ASK_USER_PARAMETER_DESCRIPTIONS = {
  optionLabel: "Short display label for this option",
  optionDescription: "Optional one-line description shown below the label",
  question: "The full question to ask the user",
  header:
    "Very short label shown as the question's tag, e.g. 'Database' or 'Auth method'. Longer than 12 characters is cut off.",
  options:
    "Between 2 and 5 answer options. A free-form 'write my own answer' option is always appended automatically - never include one yourself.",
  multiSelect:
    "Allow the user to pick several options for this question. Default false (exactly one).",
  questions:
    "1 to 4 questions shown one after another in a single dialog. Ask everything you need in one call instead of several round trips.",
};

/** Describes the ask_user tool's question shape and dismissible free-form fallback. */
export const ASK_USER_TOOL_DESCRIPTION =
  "Ask the user one to four multiple-choice questions in a single dialog. Each question has 2-5 options and may allow multiple selections. A free-form 'write my own answer' option is always added automatically, and the user may dismiss the whole dialog without answering.";

/** Adds ask_user's multiple-choice capability to the model's available-tools prompt. */
export const ASK_USER_PROMPT_SNIPPET =
  "Ask the user up to four multiple-choice questions at once (2-5 options each, optional multi-select, plus a free-form answer)";

/** Guides the model to use ask_user for enumerable answers and to batch related questions. */
export const ASK_USER_PROMPT_GUIDELINES = [
  "When asking the user a question whose likely answers can be enumerated, use the ask_user tool instead of asking in plain text.",
  "Batch related decisions into one ask_user call (up to four questions); set multi_select on questions where several answers can apply.",
];

export interface SelectedOption {
  /** 1-based option number as shown to the user. */
  readonly number: number;
  readonly label: string;
}

export interface QuestionAnswer {
  readonly question: string;
  readonly header?: string;
  /** Options the user picked, in option order. */
  readonly selected: readonly SelectedOption[];
  /** Free-form text from the 'write my own answer' option. */
  readonly custom?: string;
}

function describeAnswer(answer: QuestionAnswer, index: number) {
  const label = answer.header ? `${answer.header}: ` : "";
  const parts: string[] = [];
  if (answer.selected.length > 0) {
    const numbers = answer.selected.map((option) => option.number).join(", ");
    const labels = answer.selected.map((option) => option.label).join(", ");
    parts.push(
      `selected ${answer.selected.length === 1 ? "option" : "options"} ${numbers}: ${labels}`,
    );
  }
  if (answer.custom) parts.push(`wrote: ${answer.custom}`);
  if (parts.length === 0) parts.push("no answer (skipped)");
  return `Q${index + 1} ${label}"${answer.question}" - ${parts.join("; ")}`;
}

/** Builds the behavioral tool-result message returned to the parent model for an ask_user outcome. */
export function buildAskUserResultMessage(
  outcome:
    | { kind: "no-ui" }
    | { kind: "cancelled" }
    | { kind: "dismissed" }
    | { kind: "answered"; answers: readonly QuestionAnswer[] },
) {
  switch (outcome.kind) {
    case "no-ui":
      return "No interactive UI is available, so the questions could not be shown. Ask the user in plain text instead.";
    case "cancelled":
      return "Cancelled";
    case "dismissed":
      return "User dismissed the questions without answering. Do not assume any answer; proceed accordingly or ask differently.";
    case "answered":
      return outcome.answers.map(describeAnswer).join("\n");
  }
}
