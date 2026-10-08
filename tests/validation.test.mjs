import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBody, validateBody, countCharacters, publicConfigReady } from "../public/validation.js";
test("空白・改行・ゼロ幅文字だけを拒否する", () => {
  for (const value of ["", " \n\t　", "\u200B\uFEFF", "\u2060"]) assert.ok(validateBody(value));
});
test("300文字まで、301文字は拒否。絵文字はUnicodeコードポイントで数える", () => {
  assert.equal(validateBody("あ".repeat(300)), "");
  assert.ok(validateBody("あ".repeat(301)));
  assert.equal(countCharacters("😊"), 1);
  assert.equal(validateBody("😊".repeat(300)), "");
});
test("正規化と制御文字の検査", () => {
  assert.equal(normalizeBody(" か\u3099\r\nありがとう \t"), "が\nありがとう");
  assert.ok(validateBody("hello\u0001"));
  assert.equal(validateBody("ごはんがおいしかった。\nありがとう"), "");
});
test("秘密キーと未設定の接続情報を公開設定として扱わない", () => {
  assert.equal(publicConfigReady({ supabaseUrl: "", publishableKey: "", turnstileSiteKey: "" }), false);
  assert.equal(publicConfigReady({ supabaseUrl: "https://project.supabase.co", publishableKey: "sb_secret_invalid", turnstileSiteKey: "site" }), false);
  assert.equal(publicConfigReady({ supabaseUrl: "https://project.supabase.co", publishableKey: "sb_publishable_public", turnstileSiteKey: "site" }), true);
  const privilegedJwt = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  assert.equal(publicConfigReady({ supabaseUrl: "https://project.supabase.co", publishableKey: privilegedJwt, turnstileSiteKey: "site" }), false);
});
