import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const exec = promisify(execFile);
test("公開ビルド：未設定では停止。実URLを指定するとSEOを生成し、配信対象をpublicだけにする", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "good-things-build-test-"));
  try {
    await mkdir(path.join(temp, "scripts"));
    await cp(new URL("../public/", import.meta.url), path.join(temp, "public"), { recursive: true });
    await cp(new URL("../scripts/build.mjs", import.meta.url), path.join(temp, "scripts/build.mjs"));
    await writeFile(path.join(temp, "package.json"), '{"type":"module"}');
    const run = () => exec(process.execPath, ["scripts/build.mjs"], { cwd: temp, env: { ...process.env, SITE_URL: "" } });
    await assert.rejects(run(), error => /公開URLが未設定/.test(error.stderr));
    const fixture = { supabaseUrl: "https://fixture.supabase.co", publishableKey: "sb_publishable_test-placeholder", turnstileSiteKey: "test-placeholder", siteUrl: "https://site.example.invalid/good-things/", contactUrl: "https://contact.example.invalid/", operatorName: "テスト運営" };
    await writeFile(path.join(temp, "public/config.js"), `export const CONFIG=${JSON.stringify(fixture)};`);
    await run();
    const html = await readFile(path.join(temp, "dist/index.html"), "utf8");
    assert.ok(html.includes('rel="canonical" href="https://site.example.invalid/good-things/"'));
    assert.ok(html.includes('property="og:image" content="https://site.example.invalid/good-things/og-image.png"'));
    const sitemap = await readFile(path.join(temp, "dist/sitemap.xml"), "utf8");
    assert.equal((sitemap.match(/<loc>/g) || []).length, 3);
    assert.ok(!sitemap.includes("/posts/"));
    assert.ok((await readFile(path.join(temp, "dist/robots.txt"), "utf8")).includes("Sitemap: https://site.example.invalid/good-things/sitemap.xml"));
    const names = await readdir(path.join(temp, "dist"));
    assert.ok(names.includes("og-image.png"));
    assert.ok(!names.includes("supabase") && !names.includes("tests") && !names.includes(".env"));
    // ソースに仮ドメインを登録したり、元の設定を書き換えたりしません。
  } finally { await rm(temp, { recursive: true, force: true }); }
});
