import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

let db;
const hash = n => n.toString(16).padStart(64, "0");
let post;
before(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(await readFile(new URL("../supabase/migrations/202610080001_initial.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/202610090001_read_counts.sql", import.meta.url), "utf8"));
});
after(async () => { await db?.close(); });
async function write(action, actor, ip, body = null, request = null, id = null, reason = null) {
  return (await db.query("select public.good_things_write($1,$2,$3,$4,$5,$6,$7) result", [action, actor, ip, body, request, id, reason])).rows[0].result;
}
test("DB：全テーブルのRLSが有効、一般利用者は直接読み書き・RPC・管理ができない", async () => {
  const rows = (await db.query("select relname, relrowsecurity from pg_class where relname in ('posts','likes','reports','rate_buckets','moderation_log','post_views')")).rows;
  assert.equal(rows.length, 6);
  assert.ok(rows.every(x => x.relrowsecurity));
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role};`);
    try {
      for (const query of ["select * from public.posts", "insert into public.posts(body) values('bad')", "update public.posts set status='visible'", "delete from public.posts", "select * from public.reports", "select * from public.post_views", "select public.good_things_list(repeat('0',64))", "select public.good_things_moderate(gen_random_uuid(),'hidden','reason')"]) {
        await assert.rejects(db.query(query), error => error.code === "42501");
      }
    } finally { await db.exec("reset role;"); }
  }
});
test("DB：サービス用RPCで投稿できる。同じリクエスト再送は1件だけ", async () => {
  const request = randomUUID();
  await db.exec("set role service_role;");
  try {
    post = (await write("post", hash(1), hash(99), "お茶がおいしかった。", request)).post;
    const retry = await write("post", hash(1), hash(99), "お茶がおいしかった。", request);
    assert.equal(retry.post.id, post.id);
    assert.deepEqual(Object.keys(post).sort(), ["body", "created_at", "id", "likes_count", "views_count"]);
  } finally { await db.exec("reset role;"); }
  assert.equal((await db.query("select count(*)::int n from public.posts")).rows[0].n, 1);
});
test("DB：空白・ゼロ幅だけ・301文字の投稿をサーバーDBが拒否", async () => {
  for (const body of [" ", "\u200B\uFEFF", "あ".repeat(301)]) {
    await assert.rejects(write("post", hash(2), hash(99), body, randomUUID()), /invalid_input/);
  }
});
test("DB：新しいリクエストIDによる連投でも制限される", async () => {
  await assert.rejects(write("post", hash(1), hash(99), "続けて投稿", randomUUID()), /rate_limited/);
});
test("DB：いいねの再送で加算しない。複数の操作でも件数が一致", async () => {
  await write("like", hash(11), hash(99), null, null, post.id);
  const repeated = await write("like", hash(11), hash(99), null, null, post.id);
  assert.equal(repeated.likes_count, 1);
  assert.equal(repeated.alreadyLiked, true);
  await Promise.all(Array.from({ length: 10 }, (_, i) => write("like", hash(i + 12), hash(99), null, null, post.id)));
  const rows = (await db.query("select likes_count, (select count(*)::int from public.likes where post_id=$1) n from public.posts where id=$1", [post.id])).rows;
  assert.equal(rows[0].likes_count, 11);
  assert.equal(rows[0].likes_count, rows[0].n);
});
test("DB：通報は重複しない。不正理由は拒否", async () => {
  await write("report", hash(30), hash(99), null, null, post.id, "personal");
  await write("report", hash(30), hash(99), null, null, post.id, "abuse");
  await assert.rejects(write("report", hash(31), hash(99), null, null, post.id, "invalid"), /invalid_input/);
  assert.equal((await db.query("select count(*)::int n from public.reports")).rows[0].n, 1);
});
test("DB：管理者の非公開操作で一覧から消え、操作も拒否。履歴と通報対応を保存", async () => {
  await db.query("select public.good_things_moderate($1,'hidden','個人情報を含むため')", [post.id]);
  assert.deepEqual((await db.query("select public.good_things_list($1) result", [hash(99)])).rows[0].result, []);
  await assert.rejects(write("like", hash(32), hash(99), null, null, post.id), /post_unavailable/);
  const log = (await db.query("select * from public.moderation_log")).rows;
  assert.equal(log.length, 1);
  assert.equal(log[0].new_status, "hidden");
  assert.ok((await db.query("select resolved_at from public.reports")).rows[0].resolved_at);
  await db.exec("set role service_role;");
  try { await assert.rejects(db.query("select public.good_things_moderate($1,'visible','reason')", [post.id]), error => error.code === "42501"); }
  finally { await db.exec("reset role;"); }
});
test("DB：同時刻の投稿を含む21件取得とキーページングで重複しない", async () => {
  await db.query("insert into public.posts(body,actor_hash,request_id,created_at) select 'テスト'||n,repeat('f',64),gen_random_uuid(),'2026-10-08T12:00:00Z'::timestamptz from generate_series(1,41) n");
  const first = (await db.query("select public.good_things_list($1) result", [hash(99)])).rows[0].result;
  assert.equal(first.length, 21);
  const last = first[19];
  const second = (await db.query("select public.good_things_list($1,$2,$3) result", [hash(99), last.created_at, last.id])).rows[0].result;
  assert.equal(second.length, 21);
  assert.equal(new Set([...first.slice(0,20), ...second.slice(0,20)].map(x => x.id)).size, 40);
});
test("DB：保存期間の整理で古い非公開投稿だけを削除。一般ロールは整理できない", async () => {
  await db.exec(await readFile(new URL("../supabase/maintenance.sql", import.meta.url), "utf8"));
  await db.query("update public.posts set moderated_at=now()-interval '91 days' where id=$1", [post.id]);
  await db.query("select public.good_things_cleanup()");
  assert.equal((await db.query("select count(*)::int n from public.posts where id=$1", [post.id])).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from public.posts where status='visible'")).rows[0].n, 41);
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set role ${role};`);
    try { await assert.rejects(db.query("select public.good_things_cleanup()"), error => error.code === "42501"); }
    finally { await db.exec("reset role;"); }
  }
});
