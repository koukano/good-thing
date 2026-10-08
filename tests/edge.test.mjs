import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

let db, handler;
const originalFetch = globalThis.fetch;
let verification = { success: true, hostname: "localhost", action: "write" };
let calledVerification = 0;
const origin = "http://localhost:4173";
before(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(await readFile(new URL("../supabase/migrations/202610080001_initial.sql", import.meta.url), "utf8"));
  const env = { SUPABASE_URL: "https://test.supabase.co", GOOD_THINGS_SERVER_KEY: "server-test-placeholder", ALLOWED_ORIGINS: origin, TURNSTILE_HOSTNAMES: "localhost", TURNSTILE_SECRET_KEY: "test-placeholder", ABUSE_HASH_SECRET: "test-placeholder-".repeat(4) };
  globalThis.Deno = { env: { get: key => env[key] }, serve: fn => { handler = fn; } };
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("turnstile/v0/siteverify")) {
      calledVerification++;
      assert.ok(opts.body.get("secret"));
      return Response.json(verification);
    }
    if (String(url).includes("/rest/v1/rpc/")) {
      assert.equal(opts.headers.apikey, "server-test-placeholder");
      const data = JSON.parse(opts.body);
      const list = String(url).endsWith("good_things_list");
      const sql = list ? "select public.good_things_list($1,$2,$3) result" : "select public.good_things_write($1,$2,$3,$4,$5,$6,$7) result";
      const args = list ? [data.p_ip, data.p_before_time, data.p_before_id] : [data.p_action, data.p_actor, data.p_ip, data.p_body ?? null, data.p_request ?? null, data.p_post ?? null, data.p_reason ?? null];
      try { return Response.json((await db.query(sql, args)).rows[0].result); }
      catch (error) { return Response.json({ message: error.message, code: error.code }, { status: 400 }); }
    }
    throw new Error("unexpected network request");
  };
  let source = await readFile(new URL("../supabase/dashboard-good-things.ts", import.meta.url), "utf8");
  source = source.replace('"../../../public/validation.js"', JSON.stringify(new URL("../public/validation.js", import.meta.url).href));
  const js = stripTypeScriptTypes(source, { mode: "transform" });
  await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
});
after(async () => { globalThis.fetch = originalFetch; delete globalThis.Deno; await db?.close(); });
function request(data, extra = {}) {
  return new Request("https://test.supabase.co/functions/v1/good-things", { method: "POST", headers: { origin, "Content-Type": "application/json", "x-forwarded-for": "192.0.2.1", ...extra }, body: JSON.stringify(data) });
}
const payload = () => ({ action: "post", visitorId: randomUUID(), requestId: randomUUID(), token: "test-placeholder", website: "", consent: true, body: "散歩が気持ちよかった。" });
test("API：未許可Origin、CAPTCHA失敗、別hostname・actionのトークンを拒否", async () => {
  assert.equal((await handler(request(payload(), { origin: "https://invalid.example" }))).status, 403);
  for (const invalid of [{ success: false }, { success: true, hostname: "evil.example", action: "write" }, { success: true, hostname: "localhost", action: "other" }]) {
    verification = invalid;
    assert.equal((await handler(request(payload()))).status, 403);
  }
  verification = { success: true, hostname: "localhost", action: "write" };
  assert.equal((await db.query("select count(*)::int n from public.posts")).rows[0].n, 0);
});
test("API：空白・301文字・honeypot・明白な連絡先・未同意を拒否", async () => {
  const beforeCount = calledVerification;
  for (const change of [{ body: "　\n" }, { body: "あ".repeat(301) }, { website: "spam" }, { body: "連絡先 test@example.com" }, { consent: false }]) {
    assert.equal((await handler(request({ ...payload(), ...change }))).status, 400);
  }
  assert.equal(calledVerification, beforeCount);
});
test("API：8KB超のリクエストを拒否", async () => {
  assert.equal((await handler(request({ ...payload(), token: "a".repeat(9000) }))).status, 413);
});
test("API→SQL：投稿・再送・一覧・いいね保存・通報保存まで動作し、内部情報を公開しない", async () => {
  const data = payload();
  const first = await handler(request(data));
  assert.equal(first.status, 200);
  const post = (await first.json()).post;
  const retry = await handler(request(data));
  assert.equal((await retry.json()).post.id, post.id);
  const list = await handler(new Request("https://test.supabase.co/functions/v1/good-things", { headers: { origin } }));
  assert.equal(list.headers.get("x-robots-tag"), "noindex, nofollow, nosnippet");
  const listed = await list.json();
  assert.equal(listed.posts.length, 1);
  assert.deepEqual(Object.keys(listed.posts[0]).sort(), ["body", "created_at", "id", "likes_count"]);
  const likePayload = { ...data, action: "like", postId: post.id };
  const like = await handler(request(likePayload));
  assert.equal((await like.json()).likes_count, 1);
  assert.equal((await (await handler(request(likePayload))).json()).likes_count, 1);
  assert.equal((await handler(request({ ...data, action: "report", postId: post.id, reason: "personal" }))).status, 200);
  assert.equal((await db.query("select count(*)::int n from public.reports")).rows[0].n, 1);
  const stored = (await db.query("select actor_hash from public.posts")).rows[0];
  assert.match(stored.actor_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(stored.actor_hash, data.visitorId);
});
test("API：SQLの連投制限を429へ変換。内部エラーを漏らさない", async () => {
  const data = payload();
  assert.equal((await handler(request(data))).status, 200);
  const second = await handler(request({ ...data, requestId: randomUUID(), body: "もう一件" }));
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("retry-after"), "60");
  assert.ok(!(await second.text()).includes("rate_limited"));
});
