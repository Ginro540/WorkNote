# ワークノート（従業員用 iPhone アプリ）

勤怠（出勤・退勤の打刻）、日報、経費精算をひとつにまとめた iPhone アプリです。
仕様は「ワークノート仕様書 初版（2026-10-19）」に従っています。

- SwiftUI / iOS 18 以降 / iPhone
- Firebase（Authentication・Cloud Firestore・Cloud Storage）
- 領収書の文字読み取りは Apple Vision で端末内処理（外部の OCR サービスは使わない）
- オフライン対応：Firestore のオフライン保存と、画像の送信キュー（端末に保存し、つながったら送信）

## フォルダ構成

| パス | 中身 |
| --- | --- |
| `WorkNote/` | アプリ本体（画面・Firebase とのやりとり） |
| `WorkNoteCore/` | 端末に依存しない計算（休憩・実働、締め日、修正申請の期限、領収書の読み取り、区分の判定）とテスト |
| `firebase/` | セキュリティルール、初期データ（settings・休日カレンダー・勤務先のサンプル）、アカウント発行スクリプト |
| `project.yml` | Xcode プロジェクトの定義（[XcodeGen](https://github.com/yonaskolb/XcodeGen)） |
| `scripts/make-icon.swift` | アプリアイコンを描くスクリプト |

## はじめに

### 1. Firebase の準備

1. Firebase コンソールでプロジェクトを作る。料金プランは無料の Spark のままでも動く（下の「Blaze にするまで」を参照）
2. Authentication で「メール / パスワード」を有効にする
3. Cloud Firestore を作る（ロケーションは `asia-northeast1` など）。Cloud Storage は Blaze にしてから作る
4. iOS アプリを追加する。バンドル ID は `jp.co.home-search.worknote`（変える場合は `project.yml` も合わせる）
5. ダウンロードした `GoogleService-Info.plist` を `WorkNote/` フォルダに置く（Git には入れない）

### 2. ルールと初期データ

```sh
# セキュリティルールを反映（Firebase CLI）
cd firebase
firebase use --add            # プロジェクトを選ぶ
firebase deploy --only firestore:rules,storage

# settings（日報の項目・経費の区分・締め日・休日カレンダー）を登録
cd seed
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
npm install
npm run seed -- --with-sample-sites   # 勤務先のサンプルが不要なら --with-sample-sites を外す

# 従業員のアカウントを発行（アプリからは新規登録できない）
npm run create-user -- taro@example.com 'パスワード' '山田 太郎'
npm run create-user -- admin@example.com 'パスワード' '管理者' admin
```

会社の休業日（年末年始・夏季休暇など）は、`settings/calendar_{年}` の `holidays` に
`{ "date": "2026-12-29", "name": "年末年始休暇", "kind": "company" }` の形で追加します。

### 3. ビルド

Xcode 27 が必要です。

```sh
brew install xcodegen      # 未インストールなら
xcodegen generate          # GoogleService-Info.plist を置いたあとに実行
open WorkNote.xcodeproj
```

Signing & Capabilities で会社の Team を選び、実機またはシミュレーターで実行します。
`GoogleService-Info.plist` がないまま起動すると、設定が必要という画面が出ます。

### 計算ロジックのテスト

```sh
cd WorkNoteCore && swift test
```

仕様書の例（10/14 の2回勤務、休憩の境目 6:00 / 8:45、10月分の修正期限が 11/5 になることなど）を確認しています。

## Blaze にするまで（画像は端末に保存）

Cloud Storage は Blaze（従量課金）プランでないと使えません。それまでは次のように動きます。

- 勤怠・日報・経費のデータは Firestore に保存する（無料の Spark プランで使える）
- 日報の写真と領収書の画像は、撮った iPhone の中に保存する。アプリを終了しても、ログアウトしても消えない（アプリを削除すると消える）
- 経費の `receiptPath` などのパスは先に Firestore に記録する

Blaze にしたら次の順で切り替えます。アプリの更新は不要です。

1. Firebase コンソールで Storage を作る
2. `firebase deploy --only storage` で Storage のルールを反映する
3. Firestore の `settings/company` の `imageUploadEnabled` を `true` にする

切り替えると、各 iPhone にたまっている画像が自動で順番に送信されます。

## 管理者の操作（管理者アプリができるまでの暫定）

Firebase コンソールで行います。

- **修正申請の承認**：`attendanceCorrections/{id}` の `status` を `approved`（却下なら `rejected`）にし、`reviewedBy`（管理者の uid）と `reviewedAt` を入れる
  - 時刻の修正・打刻漏れ：対象の打刻 `attendancePunches/{id}` の `punchedAt` を正しい時刻にし、`corrected: true`、`originalPunchedAt`（元の時刻）、`correctionId` を入れる。打刻漏れは打刻を新しく追加する（`corrected: true`）
  - 休憩を取れなかった：承認するだけでアプリが `requestedBreakMinutes` を休憩として使う
- **日報の承認**：`dailyReports/{id}` の `status` を `approved`
- **経費の承認・差し戻し**：`expenses/{id}` の `status` を `approved`、差し戻しは `returned`（理由は `returnReason`）
- **勤務先の登録**：`sites/{id}` に `name`, `address`, `active`, `order`

## 仕様書の「案」や細部の決め方

仕様書で「案」となっている点や、書かれていない細部は次のように実装しました。設定で変えたい点があれば教えてください。

| 項目 | 実装 |
| --- | --- |
| 打刻の取り消し | 押してから **5秒間** 「取り消す」を表示。その間はまだ保存しない |
| 日付をまたぐ勤務 | 出勤から **16時間以内** なら翌日でも「勤務中」。超えたら「退勤漏れ」 |
| 位置の精度 | 誤差 100m 以内なら採用。打刻から30秒たったら 1km 以内でも採用。10分で「位置なし」 |
| 時間外 | 1日の実働が8時間を超えた分を表示 |
| 作業時間の初期値 | その日の最初の出勤と最後の退勤 |
| 音声入力 | 文章の欄は iPhone のキーボードの音声入力（マイク）が使える |
| 日報の写真のファイル名 | `reports/{uid}/{reportId}/1.jpg, 2.jpg …`（長辺 2000px） |
| 領収書の画像 | 長辺 3000px、`receipts/{uid}/{expenseId}.jpg`（撮り直しは上書き） |
| 経費の差し戻し | `status: returned`。本人が直して申請し直せる（下書きと同じ扱い） |
| 締め日が月末以外 | 例：20日締めなら「10月分」＝ 9/21〜10/20 |
