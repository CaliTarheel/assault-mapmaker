import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BOARD_H_M, BOARD_W_M, COLS, ROWS, Placement, boardGeometry } from "../public/mapmaker/lib/board.js";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Assault Map Maker shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Assault Map Maker/);
  assert.match(html, /\/mapmaker\/index\.html/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("the interactive map credits its creator and public source", async () => {
  const html = await readFile(new URL("../public/mapmaker/index.html", import.meta.url), "utf8");
  assert.match(html, /Stephen G\. Rider/);
  assert.match(html, /mailto:rider\.sg@gmail\.com/);
  assert.match(html, /github\.com\/CaliTarheel\/assault-mapmaker/);
  assert.match(html, /MIT licensed/);
});

test("multi-board mosaics scale the playable field and geographic footprint", async () => {
  const geometry = boardGeometry(78.6, 4, 3);
  assert.equal(geometry.boardCols, 4);
  assert.equal(geometry.boardRows, 3);
  assert.equal(geometry.cols, COLS * 4);
  assert.equal(geometry.rows, ROWS * 3);
  assert.equal(geometry.w, geometry.boardWidthPx * 4);
  assert.equal(geometry.h, geometry.boardHeightPx * 3);

  const placement = new Placement(50.62, 9.62, 0, 78.6, 4, 3);
  assert.ok(Math.abs(placement.g.w * placement.g.mPerPx - BOARD_W_M * 4) < 8);
  assert.ok(Math.abs(placement.g.h * placement.g.mPerPx - BOARD_H_M * 3) < 8);

  const html = await readFile(new URL("../public/mapmaker/index.html", import.meta.url), "utf8");
  assert.match(html, /id="boardCols"/);
  assert.match(html, /id="boardRows"/);
});
