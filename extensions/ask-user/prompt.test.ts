import assert from "node:assert/strict";
import test from "node:test";
import { buildAskUserResultMessage } from "./prompt.ts";

test("answered questions report selections and free-form text per question", () => {
  const text = buildAskUserResultMessage({
    kind: "answered",
    answers: [
      {
        question: "Which database?",
        header: "Database",
        selected: [{ number: 2, label: "Postgres" }],
      },
      {
        question: "Which features?",
        selected: [
          { number: 1, label: "Auth" },
          { number: 3, label: "Billing" },
        ],
        custom: "needs SSO",
      },
      { question: "Anything else?", selected: [], custom: "no" },
      { question: "Optional extras?", selected: [] },
    ],
  });
  assert.equal(
    text,
    [
      'Q1 Database: "Which database?" - selected option 2: Postgres',
      'Q2 "Which features?" - selected options 1, 3: Auth, Billing; wrote: needs SSO',
      'Q3 "Anything else?" - wrote: no',
      'Q4 "Optional extras?" - no answer (skipped)',
    ].join("\n"),
  );
});
