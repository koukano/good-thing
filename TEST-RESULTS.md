# 検証結果

## 実施した確認

ローカルでの確認と、作成したSupabase実環境での確認を以下に分けて記載します。実環境の投稿保存・公開サイトの稼働確認はまだ完了していません。

| 確認 | 環境 | 結果 |
|---|---|---|
| 入力・DB・API・公開ビルドの自動テスト | Node.js、PGliteのPostgreSQLエンジン | 19件成功、失敗0件 |
| PCのブラウザー操作 | Chrome、1440×1100 | 6項目成功 |
| スマートフォン幅の操作 | Chrome、390×844 | 6項目成功 |
| PC・スマートフォンの画面 | 実際のスクリーンショットを目視確認 | 崩れ・横はみ出しなし |
| JavaScriptの構文 | node --check | app.js、build.mjs成功 |
| 秘密値のパターン検査 | check-secrets.mjs | 実値のsecret/service_role・GitHubトークン・秘密鍵を検出せず |
| 公開用OGP画像 | ChromeでSVGを1200×630のPNGに変換 | 生成成功 |
| GitHubへの反映 | koukano/good-thingのmain | 34ファイル反映、ローカルとの差分なし |
| GitHub Actions | Ubuntu・Node.js 22 | 依存導入・秘密値検査・19件のテスト成功、公開処理は設定不足で保留 |
| Supabase公開用キー | 実プロジェクトのAuth settings API | HTTP 200、キーの有効性を確認 |
| 公開キーでの直接テーブル取得 | 実プロジェクトのposts・reports | HTTP 401 / PostgreSQL 42501で権限拒否 |
| 公開キーでの直接関数実行 | 実プロジェクトのgood_things_list・good_things_moderate | HTTP 401 / PostgreSQL 42501で権限拒否 |

2026年10月9日、利用者から初期SQL実行時の「Success. No rows returned」の報告を受け、その後に上記4つの実環境での拒否を確認しました。管理RPCの検証には架空の投稿IDを使用し、変更が行われる前に関数実行権限で拒否されたことを確認しています。投稿本文や通報データは取得していません。

19件の内訳は、入力4件、DB9件、Edge API5件、公開ビルド1件です。

[確認したGitHub Actions実行](https://github.com/koukano/good-thing/actions/runs/37798271823)は成功しました。`configure-pages`、公開ビルド、アップロード、deployは意図どおりスキップされており、GitHub Pagesの公開完了を意味しません。

### DB・APIで確認した内容

- 全テーブルのRLS有効化と、anon・authenticatedによる直接SELECT・INSERT・UPDATE・DELETE・RPC・管理操作の拒否
- サービス用RPCからの投稿、同じリクエスト再送時に投稿が1件に保たれること
- 300文字を超える入力、空白・ゼロ幅だけの入力の拒否
- リクエストIDを変えても連投を拒否すること
- 同じ利用者IDの重複いいねが増えないこと、複数の加算結果と保存された件数が一致すること
- 通報の保存・重複防止・不正理由の拒否
- 管理者の非公開操作による一覧除外、非公開投稿のいいね拒否、管理履歴と対応済み通報の保存
- 同じ投稿日時が並ぶ場合も、日時とIDのカーソルで20件ずつ重複なく取得できること
- 古い非公開投稿を整理し、表示中の投稿を削除しないこと。一般ロール・service_roleから整理関数を呼べないこと
- 未許可Origin、失敗したボット検証、異なるhostname・actionのトークンを拒否すること
- 8KBを超える送信、明白な連絡先、honeypot、未同意を拒否すること
- API応答に投稿本文・ID・日時・いいね数以外の内部情報を含めないこと
- DBの連投制限をHTTP 429に変換し、DBの内部エラーを表示しないこと
- 公開ビルドは未設定なら停止すること。テスト用の一時コピーにURLを設定するとcanonical・OGP・3つの静的ページのsitemapを作り、publicだけを配信対象とすること

### ブラウザーで確認した内容

PC・スマートフォン幅のそれぞれで、準備中表示、空白・301文字の拒否、文字数表示、投稿成功・一覧への反映、再読み込み後の表示、重複いいねボタンの停止、理由選択から通報の完了、通信エラー・再試行、もっと見る・末尾処理を確認しました。HTMLタグを含む本文が文字として表示され、画像やイベント処理として実行されないことも確認しました。

ブラウザー試験はAPIとTurnstileを模擬しています。画面の再読み込み後の確認は、模擬APIが保持したデータを再取得する確認です。Supabaseの永続保存を証明するものではありません。実機スマートフォンでの確認もまだです。

SQL試験はPostgreSQLのローカルエンジンで行いました。PGliteは1接続なので、複数リクエストを送る試験でも、複数DB接続での競合・負荷・デッドロック検証の代わりにはなりません。DBの一意制約・原子的な加算・ロックを実装していますが、実際のSupabaseでの並行操作試験は残っています。

秘密値検査は代表的な形式のパターン検査であり、あらゆる秘密情報の形式を網羅する保証ではありません。秘密値自体は取得・設定していません。

## 未確認の項目

- SupabaseのメンテナンスSQL適用、Edge Functionのデプロイ
- 実際のTurnstile widgetと、実hostnameを用いた検証
- Supabaseへの投稿保存・ページ更新や別利用者からの再取得
- Supabaseへのいいね・通報保存、同時アクセス時の整合性
- Supabase管理画面から実際の投稿を非公開にできること
- 本番の管理者権限・API権限・実際のゲートウェイ転送ヘッダー
- GitHub Pagesでの公開、実URLのSEO設定、実機スマートフォンでの操作
- Cronの設定、データ整理とバックアップの実運用

これらはサービスの初期作成・設定後に確認します。公開URLはまだありません。GitHubリポジトリのURLは公開サイトのURLとは別です。

## 再実行

```powershell
npx pnpm@11.25.0 install --frozen-lockfile
npx pnpm@11.25.0 test
$env:BROWSER_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
node tests/ui.mjs
node scripts/check-secrets.mjs
```

画面テストの結果・画像は `test-results` に生成します。このフォルダーとテスト用の一時設定はGitHubやPagesへ公開しません。
