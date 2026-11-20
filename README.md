# Daichoo

Discordでおごりを記録すると、Botがこのリポジトリの台帳(`ledger/`)にコミットします。毎月1日には、前の月の分をまとめた「だれがだれにいくら支払うか」の一覧が、Discordのチャンネルに届きます。

## まず覚えること

1. おごったら、おごった人がDiscordで `/ogori` を実行する(相手と金額を入れる)。割り勘で立て替えたら、払った人が `/warikan` を実行する(金額と、一緒に割る相手を入れる)
2. 記録は、`ledger/2026-11.tsv` のような月ごとのファイルにコミットされる。おごられた人1人が1行になる
3. 毎月1日の9時過ぎ(日本時間)に、前の月の支払いの一覧が、`/channel` で決めたチャンネルに届く
4. このリポジトリは公開なので、台帳もだれでも読める(非公開にする方法は「台帳を非公開にする」)

Discordで使うだけなら「使い方」だけを読めば足ります。Botを動かす人は、「準備」を上から順に進めてください。

## 使い方

### おごりを記録する(/ogori)

| オプション | 中身                                    |
| ---------- | --------------------------------------- |
| `user`     | おごった相手                            |
| `amount`   | 金額(円)。1円から1,000,000円までの整数  |
| `memo`     | 何をおごったか(省略できる。100文字まで) |

- おごった人が実行する
- 返事はチャンネルの全員に見える。相手への通知はしない
- 自分とBotへのおごりは記録できない
- 記録した時刻の日本時間で、どの月の分かが決まる(10月31日の23時59分なら10月)

### 割り勘を記録する(/warikan)

| オプション       | 中身                                                 |
| ---------------- | ---------------------------------------------------- |
| `amount`         | 払った金額(円)。割る前の合計。1円から1,000,000円まで |
| `user1`〜`user9` | 一緒に割る相手。`user1` だけが必須で、9人まで選べる  |
| `memo`           | 何の割り勘か(省略できる。100文字まで)                |

- 全員の分を払った人が実行する
- 実行した人も人数に入る。たとえば、AさんがBさんとCさんを選んで3,000円と入れると、3人で割って、BさんとCさんがAさんに1,000円ずつ払うことになる
- 自分を選んだり、同じ人を2回選んだりしても、1人として数える。Botは選べない
- 1人分が割り切れなくても、丸めずに、割る前の金額と人数を記録する。1円未満の端数は月末の精算で足し合わせてから丸める(「毎月の精算」)
- 返事はチャンネルの全員に見える。相手への通知はしない
- 記録した時刻の日本時間で、どの月の分かが決まる(`/ogori` と同じ)

### 精算の結果の送り先を決める(/channel)

- サーバー管理の権限を持つ人だけが使える(サーバー設定の「連携サービス」で、使える人を変えられる)
- 選んだチャンネルに、Botがお知らせを1通送ってから、設定を保存する
- Botがそのチャンネルに送れないときは保存せず、Botに必要な権限を返事で伝える

### 今の精算の結果を見る(/seisan)

| オプション | 中身                                 |
| ---------- | ------------------------------------ |
| `month`    | 見る月(例 `2026-10`)。省略すると今月 |

- 返事は、実行した本人にだけ見える
- 毎月1日に届くものと同じ形で、その時点の台帳から精算した結果を出す
- 今月の結果には、タイトルに「(途中)」が付く。月末までの記録で変わる

### 毎月の精算

- 毎月1日の9時17分(日本時間)に、GitHub Actionsが前の月の台帳を精算する
- 人ごとに「おごった額 − おごられた額」を出し、支払いの回数が少なくなるようにまとめる。割り勘は、払った人が、ほかの人に1人分ずつおごったものとして数える
- そのため、直接おごってもらっていない人に支払うこともある。たとえば、AさんがBさんに1,000円、BさんがCさんに1,000円おごった月は、Bさんの差し引きが0円になるので、CさんがAさんに1,000円を支払う
- 割り勘の1人分の1円未満の端数は、切り捨てずに分数のまま足していき、最後に支払い1回ずつの額を偶数丸め(銀行丸め)で円にする。偶数丸めでは、ちょうど0.5円のときは偶数になるほうに丸め(500.5円なら500円、501.5円なら502円)、それ以外は近いほうにする
- たとえば、AさんがBさんとCさんとの割り勘で1,000円を2回払った月は、BさんとCさんの分は 1,000 ÷ 3 × 2 = 666.66…円になり、それぞれAさんに667円を支払う。1回ごとに丸める(333円 × 2 = 666円)のとは結果が違う
- 丸めるのは支払いの額なので、払う額の合計と受け取る額の合計は必ず一致する。その代わり、受け取る人が、分数で計算した額より1円未満ずれた額を受け取ることがある。丸めて0円になった支払いは載せない
- 結果は、その月の記録に出てくる人ごとに、誰にいくら支払うかを並べる(例:「Aさん へ 1,000円」)。支払いのない人には「支払いなし」と出る
- 記録のない月も、記録がないことを送る
- 実際の支払いは、各自で済ませる(Botは送金しない)

### 記録を直す・消す

1. GitHubで、その月の `ledger/年-月.tsv` を開く
2. 鉛筆のアイコンで編集し、その行を直すか消す
3. コミットする

精算の前に直せば、精算に反映されます。手で行を追加するときは、値と値のあいだをタブで区切ります。スペースでは区切りになりません。

割り勘は相手ごとに1行で、同じ割り勘の行には同じ `id` が入っています。1回の割り勘を消すときは、その `id` の行をすべて消します。相手を1人外すときは、その人の行を消すだけでなく、残りの行の `split` を1つ減らします。

台帳の書き方が正しくないと、`/ogori` と `/warikan` は記録せず、直す行の番号を返事で伝えます。

## 台帳の形式

### ledger/年-月.tsv

タブ区切りのテキスト(TSV)です。1行目が見出しで、2行目から、おごられた人1人の記録が1行です。`/ogori` は1回が1行、`/warikan` は払った人以外の相手ごとに1行になります。GitHubで開くと表として読めます。値にタブと改行は入れられないので、Botが書くときは空白に置き換えます。

| 列                          | 中身                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | `/ogori` や `/warikan` を実行したときのDiscordのID。同じ記録を二重に書かないために使う。1回の割り勘の行には、同じIDが入る |
| `recorded_at`               | 記録した時刻(日本時間)                                                                                                    |
| `payer_id` / `payer_name`   | おごった人(割り勘では払った人)のユーザーIDと、記録した時点の表示名                                                        |
| `debtor_id` / `debtor_name` | おごられた人(割り勘では一緒に割った相手)のユーザーIDと、記録した時点の表示名                                              |
| `amount`                    | 金額(円)。割り勘では、割る前の金額                                                                                        |
| `split`                     | 割った人数(払った人を含む)。おごられた人の分は `amount` ÷ `split` 円になる。`/ogori` の行は1                              |
| `memo`                      | 何をおごったか                                                                                                            |

精算に使うのは `id`、`payer_id`、`debtor_id`、`amount`、`split` だけです。表示名は、GitHubで台帳を読む人のために書いています。

`split` の列は、割り勘を記録できるようにしたときに追加しました。列がない台帳や、値が空の行は、`split` を1として読みます。列がない台帳に `/warikan` で記録するときは、Botが `amount` の後ろに `split` の列を追加し、今ある行の値は空にします。

AさんがBさんとCさんとの割り勘で3,000円を払った記録は、次の2行になります(列の一部だけを示す)。

| `id`  | `payer_name` | `debtor_name` | `amount` | `split` | `memo` |
| ----- | ------------ | ------------- | -------- | ------- | ------ |
| 15711 | A            | B             | 3000     | 3       | 焼肉   |
| 15711 | A            | C             | 3000     | 3       | 焼肉   |

### ledger/settings.json

`/channel` で決めた、精算の結果の送り先です。

```json
{
	"settlementChannel": {
		"id": "123456789012345678",
		"name": "精算"
	}
}
```

## 構成

| 部分                      | 動くところ                                     | 役割                                                                                |
| ------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| Bot(`src/`)               | Cloudflare Workers                             | DiscordのInteractions(スラッシュコマンド)を受け、GitHub Appとして台帳にコミットする |
| 精算(`scripts/settle.ts`) | GitHub Actions(`.github/workflows/settle.yml`) | 前の月の台帳から支払いの一覧を作り、Botのトークンでチャンネルに送る                 |
| 台帳(`ledger/`)           | このリポジトリのmainブランチ                   | 記録と設定。Botと人が書き込み、精算のスクリプトが読む                               |

| ファイル                       | 役割                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                 | Workerのエントリポイント(`/interactions` だけを受け付ける)                                                         |
| `src/interactions/`            | 署名を確かめた後のコマンドの振り分けと、`/ogori`・`/warikan`・`/channel`・`/seisan` の処理、登録するコマンドの一覧 |
| `src/ledger/`                  | 台帳のTSVと設定の読み書き、精算の計算(端数の足し合わせと偶数丸め)、精算の結果のメッセージ                          |
| `src/github/contents.ts`       | GitHubのContents APIでのファイルの読み書き(書き込みが競合したら読み直してやり直す)                                 |
| `src/github/app-auth.ts`       | GitHub Appの秘密鍵から、台帳のリポジトリを読み書きするトークンを発行してもらう                                     |
| `src/discord/`                 | DiscordのAPIの呼び出しと、署名の確認                                                                               |
| `src/texts.ts`                 | Discordに表示する文言                                                                                              |
| `scripts/register-commands.ts` | スラッシュコマンドの登録                                                                                           |

精算のスクリプトは、依存パッケージを使わずに、Node.js 24で `node scripts/settle.ts` としてそのまま動きます。そのため、GitHub Actionsでは `pnpm install` をしません。

## 準備

必要なもの:

- Node.js 24以上と、pnpm(`package.json` の `packageManager` のバージョン)
- Cloudflareのアカウント(3の手順1で作る)
- このリポジトリの管理者の権限(シークレットを入れるため)

### 1. Discordのアプリを作る

[Discord Developer Portal](https://discord.com/developers/applications) で、上から順に操作します。

1. 「New Application」で、アプリを作る(名前は Daichoo など)
2. 「General Information」の Application ID と Public Key を控える
3. 「Installation」の Installation Contexts で、User Install のチェックを外し、Guild Install だけにする
4. 同じ画面の Install Link を「None」にして保存する
5. 「Bot」の「Reset Token」でトークンを発行して控える(トークンは一度しか表示されない)
6. 同じ画面の Public Bot をオフにして保存する(ほかの人がBotをサーバーに入れられないようにする)
7. 「OAuth2」の OAuth2 URL Generator で、Scopes の `bot` と `applications.commands` にチェックを入れる
8. 出てきた Bot Permissions で、View Channels、Send Messages、Embed Links にチェックを入れ、Integration Type を Guild Install にする
9. いちばん下に出たURLをブラウザで開き、Botを入れるサーバーを選んで認証する
10. Discordのアプリの「ユーザー設定 → 詳細設定」で開発者モードをオンにし、サーバーのアイコンを右クリックして、「サーバーIDをコピー」でIDを控える

- Install Link が「None」でないと、6で Public Bot をオフにするときにエラーになる
- Privileged Gateway Intents は、どれもオフのままでよい(BotはGatewayにつながないため)
- Interactions Endpoint URL は、Workerをデプロイしてから入れる(3の手順7)

### 2. GitHub Appを作る

Botは、GitHub Appとして台帳にコミットします。コミットは、人のアカウントではなく、Appの名前に `[bot]` が付いた名前(例 `daichoo[bot]`)で記録されます。Appを作って組織に入れるには、4rtoflのOwnerの権限が要ります。

1. GitHubの組織 4rtofl の「Settings → Developer settings → GitHub Apps」で、「New GitHub App」を押す
2. GitHub App name に名前(例 `Daichoo`)を、Homepage URL にこのリポジトリのURLを入れる
3. Webhook の Active のチェックを外す
4. Repository permissions の Contents を「Read and write」にする
5. 「Where can this GitHub App be installed?」を「Only on this account」にして、「Create GitHub App」を押す
6. 作ったAppの画面で Client ID を控え、「Generate a private key」で秘密鍵(`.pem` のファイル)をダウンロードする
7. 左の「Install App」から 4rtofl に入れ、「Only select repositories」でこのリポジトリだけを選ぶ

- Appの名前は、GitHub全体で重ならないものにする
- 秘密鍵があれば、Appとして台帳を書き換えられる。人に渡したり、リポジトリに入れたりしない
- 秘密鍵に期限はない。作り直すときは、Appの画面で新しい鍵を作ってWorkerのシークレットを入れ替えてから、古い鍵を消す

### 3. Cloudflareにデプロイする

1. [Cloudflare](https://dash.cloudflare.com/sign-up) のアカウントを作る(Workersの無料プランで足りる)
2. `pnpm install`
3. `cp .env.example .env` で `.env` を作り、1で控えた値と、2でダウンロードした秘密鍵の中身を入れる(`.env` はGitに入らない)
4. `wrangler.jsonc` の `DISCORD_GUILD_ID` に1で控えたサーバーのIDを、`GITHUB_APP_CLIENT_ID` に2で控えた Client ID を書いて、コミットする
5. `pnpm exec wrangler login` を実行し、開いたブラウザで許可する
6. `pnpm exec wrangler deploy --secrets-file .env` を実行する
7. 表示されたURLの後ろに `/interactions` を付けて、Developer Portalの「General Information」の Interactions Endpoint URL に入れ、保存する(例 `https://daichoo.example.workers.dev/interactions`)

- アカウントに workers.dev のサブドメインがまだないと、6で「Would you like to register a workers.dev subdomain now?」と聞かれる。yes と答えて、サブドメインの名前を決める
- 初めてのデプロイでは、シークレットを `--secrets-file` で一緒に渡す。Workerがまだないうちは、`wrangler secret put` で入れられないため
- `.env` の値は、すべてWorkerのシークレットになる。`DISCORD_APPLICATION_ID` はWorkerでは使わないが、入っていても動きは変わらない
- 秘密鍵は複数行なので、`.env` では全体をダブルクォートで囲む(書き方は `.env.example` にある)
- 2回目からは `pnpm exec wrangler deploy` だけでよい。シークレットは消えずに残る
- あとから秘密鍵を入れ替えるときは、`pnpm exec wrangler secret put GITHUB_APP_PRIVATE_KEY < 秘密鍵のファイル` を実行する
- 7で保存するとき、DiscordがWorkerに確認のリクエストを送る。Public Key が違うと、保存できない
- Workerのログは、`pnpm exec wrangler tail` で見られる

### 4. コマンドを登録する

```sh
pnpm register-commands
```

`wrangler.jsonc` の `DISCORD_GUILD_ID` のサーバーに、`/ogori`・`/warikan`・`/channel`・`/seisan` を登録します。コマンドの名前やオプションを変えたときも、もう一度実行します。

### 5. GitHub Actionsにシークレットを入れる

精算の結果を送るために、Botのトークンを入れます。

```sh
gh secret set DISCORD_BOT_TOKEN
```

リポジトリの「Settings → Secrets and variables → Actions」から入れてもかまいません。

### 6. 送り先を決めて、試しに精算する

1. Discordで `/channel` を実行し、精算の結果を送るチャンネルを選ぶ
2. GitHubの「Actions → Settle → Run workflow」で、`dry_run` にチェックを入れて実行し、送る内容をログで確かめる
3. チェックを外して実行すると、実際にチャンネルに送られる(`month` で月を選べる。空欄なら前の月)

## 台帳を非公開にする

このリポジトリは公開なので、台帳の表示名、金額、メモもだれでも読めます。読ませたくないときは、リポジトリの「Settings → General → Danger Zone」で非公開にします。コードや設定を変える必要はありません。

## 開発

```sh
pnpm install
pnpm test        # テスト
pnpm lint        # リント(pnpm format で直す)
pnpm typecheck   # 型チェック
pnpm settle --dry-run --month 2026-10   # 手元の台帳で精算を試す(送らない)
```

- WorkerのコードもWeb標準のAPIだけを使うので、テストはNode.jsで動かす。GitHubとDiscordのAPIは、`test/helpers.ts` の偽物に差し替える
- 精算のスクリプトはビルドせずに動かす。そのため、`src/` のコードでは、import のパスに `.ts` を付ける
- enumのように、型を取り除くだけでは動かない書き方も使わない(`tsconfig.json` の `erasableSyntaxOnly` で確かめている)
- Discordに表示する文言は `src/texts.ts` にまとめている

## 困ったとき

| 症状                                              | 直し方                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Botがオフラインに見える                           | DiscordのInteractionsだけで動くBotなので、いつもオフラインに見える。コマンドは使える                                                                   |
| `/ogori` や `/warikan` などのコマンドが出てこない | `pnpm register-commands` を実行する。`/channel` は、サーバー管理の権限がない人には出ない                                                               |
| 「このサーバーでは使えません」と出る              | `wrangler.jsonc` の `DISCORD_GUILD_ID` が、そのサーバーのIDか確かめてから、デプロイし直す                                                              |
| 「台帳に記録できませんでした」と出る              | Cloudflareのダッシュボードで、Workerのログを見る。GitHub Appがこのリポジトリに入っているか、`GITHUB_APP_CLIENT_ID` と秘密鍵が同じAppのものかを確かめる |
| 「台帳のファイル … の書き方が正しくない」と出る   | 返事に出た行番号の行を、GitHubで直す                                                                                                                   |
| 1日になっても精算の結果が届かない                 | 「Actions → Settle」の実行結果を見る。送り先が未設定なら `/channel` を実行し、失敗していたら手で実行する                                               |
| Settle が「disabled」になっている                 | 公開リポジトリでは、60日間アクティビティがないと、GitHubが定期実行を止める。「Actions → Settle」で有効に戻す                                           |

GitHubの定期実行は、混み合うと遅れることがあります。届かない月は、手で実行してください。
