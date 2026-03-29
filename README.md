# LINORIN Free

**LINORIN** — Google Apps Script で動く AI チャットボット。LINE / Slack と Gemini API を繋ぎ、沈黙検知による自発的なプッシュ通知まで対応した軽量ボット基盤です。

> **無料版の制限について:**
> このリポジトリは機能限定の無料版です。キャラクター設定・各種パラメータはコードに直書きされています。
> スプレッドシートから全設定を変更できる完全版・有料版はこちら → **[note.com/nou_yakareta](https://note.com/nou_yakareta/m/mb0c5401f132f)**

---

## ファイル構成

| ファイル | 対応プラットフォーム |
|---------|-----------------|
| `LINORIN_free_LINE.gs` | LINE Messaging API |
| `LINORIN_free_slack.gs` | Slack Bot |
| `LINORIN_free_telegram.gs` | Telegram Bot |

---

## 特徴

- **会話履歴** — 直近5件の発言をコンテキストとして毎回渡す
- **孤独プッシュ** — 沈黙時間に応じた確率カーブで自発的にメッセージを送信
- **重複・スロットル制御** — CacheService で連打・二重送信を防止
- **セルフメンテナンス** — 毎日のログトリム・push カウントリセットを自動実行
- **LINE版**: Channel Secret による Webhook 署名検証に対応
- **Slack版**: URL verification・bot_message フィルタリングに対応

---

## 無料版 vs 完全版

| 機能 | 無料版（このリポジトリ） | 完全版 |
|------|:---:|:---:|
| LINE ボット | ✅ | ✅ |
| Slack ボット | ✅ | ✅ |
| Telegram ボット | ✅ | ✅ |
| Gemini API 連携 | ✅ | ✅ |
| 孤独プッシュ | ✅（パラメータ固定） | ✅（UIから調整可） |
| キャラクター設定 | 固定（ロボ口調） | 自由（スプシから変更） |
| Telegram / WebUI | ❌ | ✅ |
| 複数 LLM エンジン | Gemini のみ | Gemini / GPT / Claude / Grok 等 |
| ブラウザ設定 UI | ❌ | ✅ |
| ポモドーロタイマー | ❌ | ✅ |
| RSS 連携 | ❌ | ✅ |
| 日記・長期記憶生成 | ❌ | ✅ |
| RAG（知識注入） | ❌ | ✅ |
| 時間帯別インストラクション | ❌ | ✅ |

---

## セットアップ手順

### 共通: GAS プロジェクトを作成

1. [Google スプレッドシート](https://sheets.google.com)で新規スプシを作成
2. **拡張機能 → Apps Script** を開く
3. 使いたいバージョンのコードをコピーして貼り付け

### LINE版

**必要なもの:** [Google AI Studio](https://aistudio.google.com/) API キー + [LINE Developers](https://developers.line.biz/) Messaging API チャネル

```javascript
const USER_NAME           = "マスター";
const PARTNER_NAME        = "ロボ";
const GEMINI_API_KEY      = "AIza...";
const LINE_ACCESS_TOKEN   = "xxx...";
const LINE_CHANNEL_SECRET = "yyy...";   // 推奨
const MODEL_NAME          = "gemini-2.0-flash";
```

1. `setup()` を実行（シート・トリガー初期化）
2. **デプロイ → 新しいデプロイ → ウェブアプリ（全員アクセス可）**
3. 発行された URL を LINE Developers の Webhook URL に設定

### Slack版

**必要なもの:** [Google AI Studio](https://aistudio.google.com/) API キー + [Slack App](https://api.slack.com/apps)（`chat:write` スコープ）

```javascript
const USER_NAME        = "マスター";
const PARTNER_NAME     = "ロボ";
const GEMINI_API_KEY   = "AIza...";
const SLACK_BOT_TOKEN  = "xoxb-...";
const SLACK_CHANNEL_ID = "C...";
const MODEL_NAME       = "gemini-2.0-flash";
```

1. `setup()` を実行
2. **デプロイ → 新しいデプロイ → ウェブアプリ（全員アクセス可）**
3. 発行された URL を Slack App の **Event Subscriptions → Request URL** に設定
4. Subscribe to bot events: `message.channels` を追加

### Telegram版

> **注意:** GAS の Web App は Telegram Webhook に非対応のため、**ポーリング方式**（1分トリガーで `getUpdates`）を使用しています。

**必要なもの:** [Google AI Studio](https://aistudio.google.com/) API キー + [BotFather](https://t.me/botfather) で作成した Bot Token

```javascript
const USER_NAME           = "マスター";
const PARTNER_NAME        = "ロボ";
const GEMINI_API_KEY      = "AIza...";
const TELEGRAM_BOT_TOKEN  = "123456789:AAF...";
const TELEGRAM_CHAT_ID    = "123456789";  // 孤独プッシュ先
const MODEL_NAME          = "gemini-2.0-flash";
```

1. Bot Token を設定後、Bot にメッセージを送信
2. `getTelegramChatId()` を実行 → ログにチャットIDが表示される
3. `TELEGRAM_CHAT_ID` に設定
4. `setup()` を実行（Webhook は不要。Web アプリデプロイも不要）

---

## アーキテクチャ

```
【LINE / Slack】
LINE/Slack ──Webhook──▶ doPost()
                            │
                            ├─ 署名/URL検証
                            ├─ 重複チェック（isDuplicate）
                            └─ handleMessage()
                                     │
                                     ├─ 会話ログ記録（pushConversationLog）
                                     ├─ 履歴取得（getRecentConversation）
                                     ├─ Gemini API 呼び出し（callGemini）
                                     └─ 返信（sendLine / sendSlack）

scheduledCheck()  ─30分トリガー─▶ 孤独プッシュ判定（shouldPush）
dailyReset()      ─毎日17時    ─▶ カウントリセット + ログトリム

【Telegram】
scheduledEveryMinute() ─1分トリガー─▶ pollTelegramUpdates()  ← getUpdates でポーリング
                                    └─ scheduledCheck()      ← 孤独プッシュ判定
dailyReset()           ─毎日17時   ─▶ カウントリセット + ログトリム
```

---

## 孤独プッシュの仕組み

沈黙時間に応じた確率カーブで自発メッセージを送信します。

```javascript
// 沈黙 60分から抽選開始、480分で確率100%（天井）
// curvePower = 1.3 → じわじわ上昇する標準曲線
const ratio = Math.min(1, (elapsedMin - silenceMin) / (ceilingMin - silenceMin));
const probability = Math.pow(ratio, curvePower) * timeWeight;
```

時間帯ごとに係数を変えることで、深夜は完全オフ（`weightNight = 0.0`）などの設定ができます（コードを直接書き換え）。

---

## ライセンス

個人利用・学習目的での使用および改変は自由です。
再配布・転載・販売・商用利用は禁止します。詳細は [LICENSE](LICENSE) を参照してください。

---

## 作者

**@yasaihouse**

完全版・有料版の購入・サポートはこちら:
👉 **[https://note.com/nou_yakareta/m/mb0c5401f132f](https://note.com/nou_yakareta/m/mb0c5401f132f)**
