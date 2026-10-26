# ワークノート（従業員用 Web アプリ）

勤怠（出勤・退勤の打刻）、日報、経費精算をひとつにまとめた、スマホ向けの Web アプリ（PWA）です。
仕様は「ワークノート仕様書 初版（2026-10-19）」に従っています。

- iPhone（Safari）と Android（Chrome）で使う。ストアへの申請は不要で、URL を開いて「ホーム画面に追加」するだけで導入できる
- React・TypeScript（Vite）、Firebase JS SDK、Mantine。管理者アプリ（`Ginro540/WorkNoteAdmin`）と同じ構成
- Firebase（Authentication・Cloud Firestore・Cloud Storage）。プロジェクトは `worknote-6dc51`
- オフライン対応：画面のファイルは Service Worker、データは Firestore のオフライン保存、画像は IndexedDB（つながったら送信）
- 領収書の文字読み取りは Tesseract.js でスマホの中で処理する（画像を外部に送らない）
- 最初は iPhone アプリ（SwiftUI）で作ったが、Android にも対応し、導入を楽にするため Web に切り替えた。iPhone アプリのコードは Git の履歴（`50b1539`）に残っている

## フォルダ構成

| パス | 中身 |
| --- | --- |
| `web/src/core/` | 計算（休憩・実働、締め日、修正申請の期限、領収書の読み取り、区分の判定、作業時間）とテスト |
| `web/src/data/` | Firestore のデータの形（`models.ts`、管理者アプリと同じもの）、打刻・日報・経費の読み書き、画像の保存と送信、位置情報、OCR |
| `web/src/pages/` | 画面（勤怠・日報・経費・設定・ログイン） |
| `web/src/ui/` | 共通の部品と色 |
| `web/public/` | アイコン、`manifest.webmanifest`、Service Worker（`sw.js`） |
| `firebase/firebase.json` | Firebase Hosting の設定（公開先のサイト `worknote-6dc51-staff`） |
| `firebase/seed/` | 管理用スクリプト（初期データの登録、アカウントの発行、パスワードの再設定、データの確認） |
| `scripts/make-icon.swift` | アプリアイコンを描くスクリプト |

**セキュリティルール（Firestore・Storage）は管理者アプリのリポジトリ `WorkNoteAdmin/firebase/` が正本です。** このリポジトリには置かず、反映もしません。

## はじめに

### 1. 必要なもの

```sh
brew install node
brew install --cask google-cloud-sdk
npm install -g firebase-tools
```

### 2. ログイン（ターミナル.app で）

```sh
firebase login                                   # 公開（Hosting）に使う
gcloud auth application-default login            # 管理用スクリプトに使う（許可画面ではすべてにチェック）
gcloud auth application-default set-quota-project worknote-6dc51
```

ブラウザが開かない環境（Claude Code のプロンプトなど）ではログインできないことがあるので、ターミナル.app で実行します。

### 3. 手元で動かす

```sh
cd web
npm install
npm run dev        # http://localhost:5173（同じ Wi-Fi のスマホからは表示される Network の URL）
npm test           # 計算ロジックのテスト
```

- 位置情報とカメラは、`localhost` か HTTPS でないと使えない。スマホで試すときは公開した URL を使う
- テスト用アカウント：`test@example.com`（従業員。試作版から使っているデータがある）
- 手元のサーバーも本番の Firestore につながる。打刻を試すと本番のデータになるので、押したら5秒以内に「取り消す」

### 4. 公開（Firebase Hosting）

管理者アプリは `https://worknote-6dc51.web.app` を使っているので、従業員アプリは別のサイトにします。最初の1回だけサイトを作ります。

```sh
firebase hosting:sites:create worknote-6dc51-staff --project worknote-6dc51
```

公開するとき：

```sh
cd web && npm run build                                            # firebase/hosting/ に出力
cd ../firebase && firebase deploy --only hosting --project worknote-6dc51
```

公開先は `https://worknote-6dc51-staff.web.app` です。社員にはこの URL を送り、「ホーム画面に追加」してもらいます（設定画面に手順があります）。

### 5. 初期データとアカウント

```sh
cd firebase/seed
npm install
npm run inspect                         # 今のデータを確認（読み取りだけ）
npm run seed                            # settings を登録（すでにあるものは上書きしない）
npm run seed -- --with-sample-sites     # 勤務先が1件もなければサンプルも登録
npm run seed -- --force                 # settings を settings.json の内容で上書き

# アカウント（アプリからは新規登録できない。管理者アプリからも発行できる）
npm run create-user -- taro@example.com 'パスワード' '山田 太郎'          # 従業員
npm run create-user -- admin@example.com 'パスワード' '管理者' admin      # 管理者
npm run set-password -- taro@example.com '新しいパスワード'               # パスワードを設定し直す
```

会社の休業日（年末年始・夏季休暇など）は、`settings/calendar_{年}` の `holidays` に
`{ "date": "2026-12-29", "name": "年末年始休暇", "kind": "company" }` の形で追加します（管理者アプリからも登録できます）。
祝日は `firebase/seed/settings.json` に 2026・2027 年分があります。毎年、内閣府の「国民の祝日」を追加してください。

## データの形（Firestore）

試作版・iPhone アプリで入れたデータと同じ形で読み書きします。読み方は管理者アプリの `models.ts` と同じです。

| コレクション | 主なフィールド |
| --- | --- |
| `users/{uid}` | `displayName`, `email`, `role`（`employee` / `admin`）, `createdAt`, `retiredAt`（退職にした人は使えない） |
| `attendancePunches/{id}` | `userId`, `workDate`（`yyyy-MM-dd`）, `month`（`yyyy-MM`、締め日で決まる）, `kind`（`in` / `out`）, `punchedAt`（端末の時刻）, `receivedAt`（サーバーの時刻）, `location{lat, lng, accuracy, address, locatedAt}`, `locationStatus`（`pending` / `acquired` / `unavailable` / `denied`）, `corrected`, `originalPunchedAt`, `correctionId` |
| `attendanceCorrections/{id}` | `userId`, `workDate`, `month`, `targetPunchIds[]`, `kind`（`missingClockIn` / `missingClockOut` / `wrongTime` / `noBreak`）, `requestedClockIn`, `requestedClockOut`, `requestedBreakMinutes`, `reason`, `status`（`pending` / `approved` / `rejected` / `cancelled`）, `reviewedBy`, `reviewedAt`, `rejectReason`, `createdAt`, `cancelledAt` |
| `dailyReports/{uid}_{yyyy-MM-dd}` | `userId`, `date`, `month`, `status`（`draft` / `submitted` / `approved`）, `values{…}`, `siteIds[]`, `photoPaths[]`, `createdAt`, `updatedAt`, `submittedAt`, `returnReason` |
| `dailyReports/{id}/revisions/{revId}` | `values`（修正前）, `photoPaths`, `editedAt`, `editedBy` |
| `expenses/{id}` | `userId`, `usedOn`, `month`, `amount`（円・整数）, `vendor`, `categoryId`, `invoiceNumber`, `memo`, `receiptPath`, `ocrText`, `status`（`draft` / `submitted` / `approved` / `returned`）, `createdAt`, `updatedAt`, `submittedAt`, `returnReason` |
| `sites/{id}` | `name`, `address`, `active`, `order` |
| `settings/company` | `closingDay`（0 = 月末）, `correctionDeadlineBusinessDays`, `breakRules[{overMinutes, breakMinutes}]`, `imageUploadEnabled` |
| `settings/reportTemplate` | `fields[{key, label, type, required, order}]` |
| `settings/expenseCategories` | `categories[{id, name, keywords[], order}]` |
| `settings/calendar_{yyyy}` | `holidays[{date, name, kind}]`（`kind` は `national` / `company`） |

日報について：

- ID は `{uid}_{日付}`。1日1件にするため、一度保存した日報は日付を変えられない
- `values` は項目キー → 値。作業時間 `workTime` だけは `{start: "08:52", end: "18:05"}` の形で、ほかは文字列
- 管理者の差し戻しは `status` を `draft` に戻し、`returnReason` を入れる。アプリでは「差し戻し」と表示する

Cloud Storage のパス：日報の写真 `reports/{uid}/{reportId}/{n}.jpg`、領収書 `receipts/{uid}/{expenseId}.jpg`

## Blaze にするまで（画像はスマホに保存）

Cloud Storage は Blaze（従量課金）プランでないと使えません。それまでは次のように動きます。

- 勤怠・日報・経費のデータは Firestore に保存する（無料の Spark プランで使える）
- 日報の写真と領収書の画像は、撮ったスマホのブラウザ（IndexedDB）に保存する。ログアウトしても消えないが、ブラウザのデータを消すと消える。**管理者アプリからは見られない**
- 経費の `receiptPath` などのパスは先に Firestore に記録する

Blaze にしたら次の順で切り替えます。アプリの更新は不要です。

1. Firebase コンソールで Storage を作る
2. 管理者アプリのリポジトリから `firebase deploy --only storage` で Storage のルールを反映する
3. Firestore の `settings/company` の `imageUploadEnabled` を `true` にする

切り替えると、各スマホにたまっている画像が、次にアプリを開いたときに自動で順番に送信されます。

## Web にしたことで変わった点

| 項目 | iPhone アプリ | Web アプリ |
| --- | --- | --- |
| 配布 | App Store / TestFlight | URL を送って「ホーム画面に追加」 |
| 住所 | iPhone の機能（CLGeocoder） | OpenStreetMap の Nominatim（無料、1秒に1回までの決まりがある。打刻のときだけ使う） |
| 領収書の読み取り | Apple Vision | Tesseract.js（初めて使うときに数MB を読み込む。精度は Vision より低いので、読み取った内容を確認してから申請） |
| 領収書の撮影 | 書類スキャン（自動で切り抜き） | カメラで撮影（切り抜きはしない） |
| 地図 | Apple のマップ | OpenStreetMap（Leaflet） |
| 打刻の保存 | 押してから5秒後。アプリが裏に回るときはすぐ保存 | 同じ。画面を閉じる・切り替えるときにすぐ保存 |

## 計算が管理者アプリとずれていないかの確認

`web/src/core/` は管理者アプリと同じファイルです。`golden.json` は iPhone アプリの Swift の計算（WorkNoteCore）に勤怠のパターン 3000件などを通した結果で、`npm test` で同じ結果になることを確かめています。計算を変えるときは、両方のリポジトリの `web/src/core/` を同じにしてください。

## アイコン

```sh
swift scripts/make-icon.swift web/icon/icon-1024.png
cd web/public
for s in 512 192; do sips -z $s $s ../icon/icon-1024.png --out icon-$s.png; done
sips -z 180 180 ../icon/icon-1024.png --out apple-touch-icon.png
sips -z 64 64 ../icon/icon-1024.png --out favicon.png
```

## GitHub

- リポジトリ：`Ginro540/WorkNote`
- この Mac では GitHub のアカウントを SSH の Host 名で使い分けている。このリポジトリは `github-work`（Ginro540 の鍵）を使う

  ```sh
  git remote set-url origin git@github-work:Ginro540/WorkNote.git
  ```

  `github.com` のままだと別のアカウント（takayukikoga）で接続され、push が拒否される

## 仕様書の「案」や細部の決め方

| 項目 | 実装 |
| --- | --- |
| 打刻の取り消し | 押してから **5秒間** 「取り消す」を表示。その間はまだ保存しない |
| 日付をまたぐ勤務 | 出勤から **16時間以内** なら翌日でも「勤務中」。超えたら「退勤漏れ」 |
| 位置の精度 | 誤差 100m 以内なら採用。打刻から30秒たったら 1km 以内でも採用。10分で「位置なし」 |
| 時間外 | 1日の実働が8時間を超えた分を表示 |
| 作業時間の初期値 | その日の最初の出勤と最後の退勤 |
| 音声入力 | 文章の欄はスマホのキーボードの音声入力（マイク）が使える |
| 日報の ID | `{uid}_{日付}`（試作版と同じ）。保存後は日付を変えられない |
| 日報の写真のファイル名 | `reports/{uid}/{reportId}/1.jpg, 2.jpg …`（長辺 2000px） |
| 領収書の画像 | 長辺 3000px、`receipts/{uid}/{expenseId}.jpg`（撮り直しは上書き） |
| 経費の差し戻し | `status: returned`。本人が直して申請し直せる（下書きと同じ扱い） |
| 締め日が月末以外 | 例：20日締めなら「10月分」＝ 9/21〜10/20 |
| 画像の送信 | `settings/company.imageUploadEnabled` が `true` のときだけ Cloud Storage に送る |
