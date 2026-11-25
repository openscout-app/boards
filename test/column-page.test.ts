import { test } from "node:test";
import assert from "node:assert/strict";
import { cardsWithColumnPage } from "../src/board.ts";
import { fixtures } from "./fake-runtime.mjs";

test("a moved card appears in its live column while an older page refreshes", () => {
  const [card, older] = fixtures().board.cards;
  const head = [{ ...card, column: "doing" }];
  const page = [{ ...card, column: "ready" }, { ...older, column: "ready" }];
  assert.deepEqual(cardsWithColumnPage(head, "ready", page), [head[0], page[1]]);
  assert.deepEqual(cardsWithColumnPage(head, "ready", []), head);
});
