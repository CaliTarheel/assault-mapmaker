import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
