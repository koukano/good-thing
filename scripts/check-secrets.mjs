import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
let failures = [];
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "test-results"].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { await scan(file); continue; }
    if (entry.name.startsWith(".env") && entry.name !== ".env.example") { failures.push(path.relative(root, file)); continue; }
    if (!/\.(?:js|mjs|ts|json|html|yml|yaml|md|toml|txt|sql)$/.test(file)) continue;
    const text = await readFile(file, "utf8");
    // 値は出力せず、検出されたファイル名だけを報告します。
    if (/sb_secret_[A-Za-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/.test(text)) failures.push(path.relative(root, file));
    for (const jwt of text.match(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g) || []) {
      try { if (JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).role === "service_role") failures.push(path.relative(root, file)); } catch { /* JWTでない文字列 */ }
    }
  }
}
await scan(root);
if (failures.length) { console.error("秘密値または.envファイルを検出:", [...new Set(failures)]); process.exitCode = 1; }
else console.log("秘密値のパターン検査: 問題は検出されませんでした（すべての形式を保証するものではありません）。");
