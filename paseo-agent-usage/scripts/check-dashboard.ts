import assert from "node:assert/strict";
import {
  addCard,
  addPage,
  defaultDashboard,
  deletePage,
  moveCard,
  movePage,
  removeCard,
  renamePage,
  resetAll,
  resetPage,
  sanitizeDashboard,
  splitRows,
  toggleCardHidden,
  toggleCardSpan,
  visiblePageCards,
} from "../client/dashboard-model";

let config = defaultDashboard();
assert.equal(config.pages.length, 6, "six preset pages");
assert.equal(config.pages[0]?.id, "overview");
assert.equal(config.pages.find((page) => page.id === "compare")?.cards.length, 5);
assert.equal(visiblePageCards(config.pages.find((page) => page.id === "compare")!, "agent").length, 2);

config = addCard(config, "overview", "cost");
const overview = config.pages.find((page) => page.id === "overview");
assert.equal(overview?.cards.length, 7);
assert.equal(overview?.customized, true);
const added = overview?.cards.at(-1);
assert.ok(added);
assert.equal(added.card, "cost");

config = moveCard(config, "overview", added.iid, -1);
assert.equal(config.pages.find((page) => page.id === "overview")?.cards.at(-2)?.iid, added.iid);
config = toggleCardSpan(config, "overview", added.iid);
assert.equal(config.pages.find((page) => page.id === "overview")?.cards.find((card) => card.iid === added.iid)?.span, "full");
config = toggleCardHidden(config, "overview", added.iid);
assert.equal(config.pages.find((page) => page.id === "overview")?.cards.find((card) => card.iid === added.iid)?.hidden, true);
assert.equal(visiblePageCards(config.pages[0]!, "aggregate").some((card) => card.iid === added.iid), false);

config = addPage(config, "成本审计", "overview");
const custom = config.pages.at(-1);
assert.ok(custom);
assert.equal(custom.builtin, false);
assert.equal(custom.cards.length, 6);
assert.notEqual(custom.cards[0]?.iid, added.iid, "duplicated cards get new ids");
config = renamePage(config, custom.id, "成本复盘");
assert.equal(config.pages.at(-1)?.name, "成本复盘");
config = movePage(config, custom.id, -1);
assert.equal(config.pages.at(-2)?.id, custom.id);
assert.equal(deletePage(config, "overview").pages.some((page) => page.id === "overview"), true, "preset pages cannot be deleted");
config = deletePage(config, custom.id);
assert.equal(config.pages.some((page) => page.id === custom.id), false);

config = resetPage(config, "overview");
assert.equal(config.pages.find((page) => page.id === "overview")?.cards.length, 6);
assert.equal(config.pages.find((page) => page.id === "overview")?.customized, false);

const sanitized = sanitizeDashboard(JSON.parse(JSON.stringify(config)));
assert.equal(sanitized.pages.length, 6);
assert.deepEqual(splitRows(sanitized.pages[0]!.cards.slice(0, 5), false).map((row) => row.length), [1, 1, 2, 1]);
assert.equal(visiblePageCards(sanitized.pages[0]!, "agent").length, 4);
assert.equal(resetAll(sanitized).pages.length, 6);
assert.equal(splitRows(sanitized.pages[0]!.cards, true).every((row) => row.length === 1), true);

console.log("dashboard checks passed");
