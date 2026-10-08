# よかった。

今日あった、小さな「よかった」を残す場所。名前・メールアドレス・ログインなしで投稿する、静かな匿名投稿サイトです。

このフォルダーだけが独立したプロジェクトです。「複素解析 Note」のファイル・設定・URLは使っていません。

専用のGitHubリポジトリは [koukano/good-thing](https://github.com/koukano/good-thing) です。リポジトリ名は `good-thing`、ローカルフォルダー名は `good-things` です。

## 現在の状態

画面・SQL・Edge Function・管理手順を実装しています。Supabaseプロジェクトを作成し、Project URLと公開用publishableキーを設定、DBの初期SQLを実行しました。実環境でも公開キーからの投稿・通報テーブル、一覧RPC、管理RPCへの直接アクセスが拒否されることを確認しています。メンテナンスSQL・Edge Function・Turnstileの設定はまだ完了していないため、現在の画面は「準備中」です。接続前に保存できない投稿を成功扱いにはしません。

専用リポジトリへのソース反映は完了しています。GitHub Actionsでも秘密値検査・19件の自動テストが成功しました。設定不足のためPages公開は保留中です。

**Supabase実環境での保存とGitHub Pagesでの稼働は未確認です。** ローカル確認の結果と残っている確認項目は [TEST-RESULTS.md](./TEST-RESULTS.md) に記載します。

## 作成した機能

- 白と淡い青のレスポンシブ画面。PCは2列、スマートフォンは1列の投稿カード
- 匿名投稿、300文字制限、文字数表示、空白だけの投稿の禁止、成功・通信エラー表示
- 新着順20件、もっと見る、空の一覧、読み込み・エラー・再試行
- DBで管理するいいねと、理由を選ぶ通報
- サーバー側の入力検証・必須のボット対策・連投制限・同一リクエストの重複投稿防止
- Supabase管理画面での非公開・再公開、管理履歴、対応済み通報の整理
- 利用規約・プライバシーポリシー、運営者表示・お問い合わせリンク
- title・description・OGP画像・sitemap・robots・canonicalの公開用ビルド

文字数はUnicodeコードポイント単位で数えます。通常の絵文字は1文字ですが、複数の絵文字を組み合わせた記号は複数文字になる場合があります。前後の空白を除去し、UnicodeをNFCに正規化して保存します。

## フォルダー構成

```text
good-things/
├─ public/                    ← 配信するHTML・CSS・JavaScript・画像
│  ├─ index.html / styles.css / app.js
│  ├─ config.js / validation.js / legal.js
│  ├─ terms.html / privacy.html
│  └─ favicon.svg / og-image.svg / og-image.png / robots.txt / sitemap.xml
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/202610080001_initial.sql
│  ├─ functions/good-things/index.ts
│  └─ maintenance.sql
├─ scripts/                   ← プレビュー・ビルド・秘密値検査
├─ tests/                     ← ローカルの画面・SQL・APIテスト
├─ .github/workflows/pages.yml ← 専用リポジトリのGitHub Pages公開
├─ package.json / pnpm-lock.yaml
├─ TEST-RESULTS.md
└─ README.md
```

ReactやNext.jsは使いません。開発用のライブラリはテスト用だけで、訪問者が読み込むのは素のHTML・CSS・JavaScriptです。`dist` は公開用に生成するフォルダーで、Gitには入れません。

## 最初に必要なご自身の操作

アカウント作成・認証・秘密値の管理はご自身で行ってください。有料プランの契約は不要です。

### 1. GitHubに専用リポジトリを作る

1. [GitHubの新規作成画面](https://github.com/new) を開きます。
2. Repository nameを **good-things**、公開範囲を **Public** にします。
3. README・.gitignore・ライセンスの自動追加は選ばず、Create repositoryを押します。
4. 作成したリポジトリのURLをCodexに伝えてください。既存の数学サイトのリポジトリは選ばないでください。

公開URLは、リポジトリとPages設定が確定してから設定します。現時点で仮のドメインは登録していません。

### 2. Supabaseの無料プロジェクトを作る

1. [Supabase Dashboard](https://supabase.com/dashboard) にサインインします。
2. Freeの組織でNew projectを選び、名前を **good-things** にします。数学サイトと同じDBは使いません。
3. Database passwordはパスワード管理アプリなどに保存し、チャット・GitHubには載せません。
4. 作成完了後、ConnectまたはSettingsのAPI画面から **Project URL** と **publishable key**（従来の **anon key** でも可）を控えます。
5. プロジェクトのURLに表示されるProject refも控えます。Project URLのホスト名の先頭部分に相当する識別子です。
6. SQL Editor → New queryを開き、`supabase/migrations/202610080001_initial.sql` の全文を貼り付けてRunします。専用プロジェクトで一度だけ実行します。
7. 同様に `supabase/maintenance.sql` を実行します。

**公開してよいもの**：Project URL、publishable/anonキー、Turnstile site key。

**公開してはいけないもの**：Supabase secret/service_roleキー、Turnstile secret key、DBパスワード、ABUSE_HASH_SECRET、GitHubトークン。これらをチャットへ貼る必要はありません。

RLSを有効にするだけでなく、anon・authenticatedロールのテーブル権限と関数実行権限を取り消しています。データはEdge Functionからのみ取得・変更します。公開キーを知っていても、直接テーブルの内容や通報を取得できない設計です。

### 3. Cloudflare Turnstileを作る

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) で無料アカウントを用意します。
2. Turnstile → Add widgetを選び、名前を **good-things** にします。
3. 対象のhostnameに、確定したGitHub Pages URLのホスト名を登録します。`https://` や `/good-things/` のパスは入れません。
4. Widget modeを **Managed** にします。
5. **Site key** を控えます。これは公開してよいキーです。
6. **Secret key** はSupabaseのSecretsにだけ保存します。

投稿・いいね・通報の操作時に安全確認を行います。[Turnstileはサーバー検証が必須で、トークンは1回限り・有効期間5分](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)です。この実装は検証成功に加え、hostnameとactionも確認します。

### 4. Supabaseの秘密設定を登録する

Supabaseの **Edge Functions → Secrets** で、次の名前と値を登録します。

| 名前 | 設定する内容 |
|---|---|
| `ALLOWED_ORIGINS` | 確定したサイトのorigin。HTTPSとホスト名だけで、パス・末尾のスラッシュは入れません |
| `TURNSTILE_HOSTNAMES` | Turnstileに登録したホスト名だけ |
| `TURNSTILE_SECRET_KEY` | Turnstileの秘密キー |
| `ABUSE_HASH_SECRET` | このサイト専用のランダムな64文字以上の秘密値 |
| `GOOD_THINGS_SERVER_KEY` | Supabaseのsecretキー。新しいキーを使う場合に設定 |

`ABUSE_HASH_SECRET` はパスワード管理アプリで作るか、PowerShellで次を実行して作れます。出てきた値はSecrets画面だけに貼り、公開しないでください。

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

`GOOD_THINGS_SERVER_KEY` が未設定の場合は、SupabaseがEdge Functionsに用意する従来の `SUPABASE_SERVICE_ROLE_KEY` をサーバー内だけで使います。`SUPABASE_URL` などの組み込み環境変数を手で上書きする必要はありません。[秘密設定の公式説明](https://supabase.com/docs/guides/functions/secrets)。

ローカルで実DBへの接続を試す場合だけ、`ALLOWED_ORIGINS` に `http://127.0.0.1:4173` をカンマ区切りで追加します。Turnstile側・`TURNSTILE_HOSTNAMES` 側も開発用ホストを合わせます。開発用許可は公開前に取り除きます。本番でCloudflareのテスト用キーは使わないでください。

### 5. Edge Functionを公開する

[Node.jsのLTS版](https://nodejs.org/)（22以降）をインストールします。エクスプローラーで `good-things` を開き、アドレス欄に `powershell` と入力してEnterを押すと、このフォルダーでPowerShellが開きます。

以下を**1行ずつ**実行します。認証画面はご自身で完了します。

```powershell
npx supabase login
npx supabase functions deploy good-things --project-ref あなたのProject_ref --no-verify-jwt
```

2行目の「あなたのProject_ref」は実際のProject refに置き換えます。SQLは手順2で実行済みなので、ここで `db reset` を実行する必要はありません。

JWTチェックを無効にするのは、ログイン不要の公開APIにするためです。書き込みのボット検証・入力検証・DBの操作制限は無効にしません。公開用キーは秘密の認証情報ではありません。[Supabaseのキー区分](https://supabase.com/docs/guides/getting-started/api-keys)と[関数公開の説明](https://supabase.com/docs/guides/functions/deploy)も参照してください。

### 6. 公開用設定と連絡窓口を決める

`public/config.js` の空欄を埋めます。文字列は引用符の内側に入力します。

| 項目 | 内容 |
|---|---|
| `supabaseUrl` | SupabaseのProject URL |
| `publishableKey` | 公開用publishableキーまたはanonキー |
| `turnstileSiteKey` | TurnstileのSite key |
| `siteUrl` | 実際のGitHub PagesのURL。未確定なら空欄のまま |
| `contactUrl` | 運営への相談・削除依頼を受け付けるHTTPSの窓口URL |
| `operatorName` | 運営者として表示する名前 |

連絡窓口は、ご自身が確認できるフォームなどを用意してください。利用規約とポリシーはこの運営方式に合わせた文案です。公開前に運営者情報・問い合わせ先・保存期間が実際の運用と一致していることを確認してください。取得目的の明示と管理については[個人情報保護委員会のガイドライン](https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/)を参照しています。

実際のURLが確定するまで、canonicalやOGP URL、sitemapに仮ドメインを入れません。GitHub ActionsではPagesの実URLを自動で取得して生成します。お問い合わせ先と運営者表示名、接続設定が空の場合は公開ビルドを止めます。

### 7. GitHubへ反映し、Pagesを公開する

Codexへ専用リポジトリURLを伝えれば、利用できる接続で反映を進められます。ご自身でGitを使う場合、必ず **good-thingsフォルダー内** で操作します。初回のGit認証画面はご自身で対応してください。

```powershell
git remote add origin 作成した専用リポジトリのURL
git push -u origin main
```

上記はこのフォルダーにGitの初期コミットがある場合の手順です。まだ初期化されていない場合はCodexに依頼してください。親フォルダーや数学サイトでGitの設定を変えないでください。

今回のローカルフォルダーは初期化・origin設定済みなので、上記の `remote add` を繰り返す必要はありません。追加設定の反映はCodexに依頼するか、設定変更後に `git add public/config.js`、`git commit -m "Configure public connection"`、`git push` を1行ずつ実行します。GitHubへの認証が求められた場合はご自身で対応してください。

GitHubの専用リポジトリで **Settings → Pages → Build and deployment → Source → GitHub Actions** を選びます。**Actions → Publish good-things to GitHub Pages → Run workflow** から実行できます。以降はmainへの反映時に自動で検査・ビルド・公開します。[GitHubの公式手順](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

初期設定が空の間は、Actionsはテストだけを行い、公開を保留します。設定がそろうと公開へ進みます。公開を保留した状態を「公開完了」とは扱いません。

ビルド成果物には `public` の内容だけを含めます。SQL・サーバー処理・秘密設定・テストファイルはPagesの配信対象に入りません。

## 画面の確認とテスト

Node.jsがあれば、画面のプレビューは外部接続なしで起動できます。

```powershell
node scripts/serve.mjs
```

表示された `http://127.0.0.1:4173` をブラウザーで開きます。停止はCtrl+Cです。HTMLをダブルクリックする方法では、JavaScriptのモジュールが読み込めないため使わないでください。

開発用のテストを再実行する場合：

```powershell
npx pnpm@11.25.0 install --frozen-lockfile
npx pnpm@11.25.0 test
node scripts/check-secrets.mjs
```

画面テストにはChromeなどのブラウザーが必要です。WindowsでChromeが標準の位置にある場合：

```powershell
$env:BROWSER_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
node tests/ui.mjs
```

画面テストは模擬APIを使います。SQLテストにはPGliteのPostgreSQLエンジンを使い、Supabase環境の役割を再現します。Edge Functionテストは外部のTurnstileとRESTを模擬します。これらは実際のクラウド接続・実機のスマートフォン・多数のDB接続の同時処理を保証するものではありません。

## 管理者が行うこと

管理用ページを公開サイト内に設けません。Supabaseの管理者アカウントにログインして操作します。GitHub・Supabase・Cloudflareの管理アカウントには二段階認証を設定してください。

### 通報を確認する

SQL Editorで次を実行します。これはログインした管理者の画面だけで確認します。

```sql
select r.id as report_id, r.post_id, r.reason, r.created_at, p.body, p.status
from public.reports r
join public.posts p on p.id = r.post_id
where r.resolved_at is null
order by r.created_at;
```

通報は毎日確認し、個人情報や中傷が見つかった場合は早めに非公開にします。すべての内容を自動判定できる前提にはしていません。通報がなくても投稿一覧を定期的に見てください。

### 不適切な投稿を非公開にする

次のSQLの「対象の投稿ID」を実際の `post_id` に置き換えます。理由には個人情報を転記せず、短い管理理由を記入します。

```sql
select public.good_things_moderate('対象の投稿ID'::uuid, 'hidden', '個人情報が含まれるため');
```

これで通常の一覧から除外され、いいね・通報の追加も拒否されます。管理履歴を残し、未対応の通報を対応済みにします。既に開いている画面の文章は、ページ更新まで残ることがあります。第三者の保存や転載は消せません。

誤って非公開にした場合は、同じ関数の第2引数を `visible` に変え、理由を添えて再公開できます。Table Editorでstatusだけを書き換える方法は、管理履歴を残せないため使わないでください。

適切な投稿への通報だった場合は、非公開にせず次を実行します。

```sql
update public.reports set resolved_at = now() where id = '対象の通報ID'::uuid;
```

### データ整理とバックアップ

`supabase/maintenance.sql` は90日経過した非公開投稿・対応済み通報、1年経過した管理履歴を削除する関数を用意します。Cronを有効化して毎日実行する手順を同じファイルに記載しています。Cronを使わない場合は、毎月SQL Editorで `select public.good_things_cleanup();` を実行します。ポリシーの保存期間を実運用と合わせてください。

無料枠に自動バックアップの保証はないため、定期的にDBをバックアップしてください。エクスポートには投稿本文などが含まれるので、公開リポジトリへ保存せず、非公開の保管先で管理します。操作制限用のバケットは次回アクセス時に古いものを削除します。`ABUSE_HASH_SECRET` を変更すると過去の識別情報と照合できなくなり、いいねの重複抑止などがリセットされます。

## 安全対策と限界

- 入力本文はDOMの `textContent` で表示し、HTMLとして解釈しません。CSPを設定し、外部スクリプトはTurnstileに限定します。
- サーバーで300文字・空白・制御文字・UUID・通報理由・規約同意を検査し、送信サイズも8KBまでに制限します。
- ローカルのランダムな利用者IDから、秘密値を使ったHMACを作ってDBに保存します。UUIDそのものを公開データに含めません。
- 投稿は同じ利用者IDで60秒以上の間隔、1時間5件まで。IP由来の制限は1分5件・1時間30件。サイト全体は1分30件・UTCの1日300件までです。
- いいねと通報にも利用者・IP由来・サイト全体のDB制限があります。詳細はSQLの `good_things_limit` で設定しています。
- 同じ利用者IDからの同じ投稿へのいいねはDBの一意制約で重複せず、原子的な加算を使います。小規模運用向けにDBロックで操作順序も管理します。
- Origin制限はブラウザーの別サイトからの利用を抑える補助対策です。ブラウザー以外のクライアントはOriginを偽装できるため、認証には使いません。
- IP由来の制限はSupabaseゲートウェイの転送ヘッダーに依存する補助対策です。偽装耐性は実際の入口設定に依存します。これだけを信用せず、すべての書き込みにTurnstile検証とサイト全体の上限を適用します。
- ブラウザーのデータ消去、別ブラウザー、別端末、新しいIDの送信などで、同一人物の判定を回避できます。ログイン不要のため厳密な1人1回は保証しません。
- URL・メール・電話番号らしい文字列は簡易的に禁止しますが、漢字の名前・住所・中傷などをすべて自動で見つけられません。誤判定もありえます。人による通報確認と非公開対応が必要です。
- 大量アクセスによるEdge Functionの呼び出し自体はDB制限だけでは止められません。全体上限は書き込みを止める仕組みであり、DDoSの完全な防御ではありません。障害や濫用時は受付停止・許可originの削除・関数の停止などで対応します。
- 投稿APIには `noindex, nofollow, nosnippet`、画面の投稿欄には `data-nosnippet` を付けています。個別投稿ページや投稿本文入りのsitemapは作りません。ただし、匿名の文章も公開されるため、検索や転載を完全に防ぐことはできません。

将来の人気順・ランダム表示は、一覧RPCとAPIに別の読み取り方式を追加して拡張できます。現在は新着順だけを公開しています。

## 無料枠について

2026年10月8日の公式情報では、Supabase FreeはDB 500MB、非キャッシュ転送5GB/月、キャッシュ転送5GB/月、Edge Functions 50万呼び出し/月などの枠があります。1週間使われないプロジェクトは停止する場合があり、無料のアクティブプロジェクトは2つまでです。[Supabase料金](https://supabase.com/pricing)、[関数の料金](https://supabase.com/docs/guides/functions/pricing)。

Turnstileは無料プランで利用できます。[Cloudflareのプラン](https://developers.cloudflare.com/turnstile/plans/)。GitHub Pagesも公開リポジトリで無料利用できますが、サイト1GB、月100GBのソフト帯域上限などがあります。[GitHub Pagesの制限](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。

無料枠の超過・休止・障害で使えなくなる可能性があります。有料プランは導入していません。アップグレードが必要になったら、理由と費用を確認してから判断してください。

## 公開後に必ず行う確認

1. 公開URLをPCとスマートフォンで開き、準備中表示が消えることを確認。
2. 個人情報を含まないテスト投稿を1件送り、Supabaseのpostsに保存されることを確認。
3. 別ブラウザーで投稿を読み、ページ更新後も残ることを確認。
4. いいねを押して、ページ更新後も数が残ることと、同じブラウザーで連打できないことを確認。
5. テスト投稿を通報し、Supabaseのreportsで理由を確認。
6. 管理者がその投稿を非公開にし、公開画面を更新すると消えることを確認。
7. 空白・301文字・連投の拒否と、通信断・読み込み失敗時の表示を確認。
8. 未認証のキーでテーブルや管理RPCに直接アクセスできないこと、管理用秘密キーが配信ファイル・Gitの履歴にないことを確認。
9. 本番Turnstileのhostname・actionが正しく検証されること、上限のバケットが増えることを確認。
10. PagesのActionsが成功し、canonical・OGP・sitemapが実際の公開URLを指していることを確認。

実環境を接続した後、これらをCodexと確認してから一般向けの案内を始めてください。
