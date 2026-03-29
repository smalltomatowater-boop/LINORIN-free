[日本語](README.md) | **English**

# LINORIN Free

**LINORIN** — A lightweight AI chatbot framework running entirely on Google Apps Script.
Connect Telegram, LINE, or Slack to the Gemini API, with built-in lonely-push: the bot proactively messages you when you've been quiet for a while.

> **Free version notice:**
> Character settings and push parameters are hardcoded. To configure everything from a spreadsheet UI, check out the full version →
> **[note.com/nou_yakareta/m/mb0c5401f132f](https://note.com/nou_yakareta/m/mb0c5401f132f)**

---

## Files

| File | Platform |
|------|----------|
| `LINORIN_free_telegram.gs` | Telegram Bot |
| `LINORIN_free_LINE.gs` | LINE Messaging API |
| `LINORIN_free_slack.gs` | Slack Bot |

---

## Features

- **Conversation history** — Last 5 messages passed as context on every request
- **Lonely push** — Probability-curve based proactive messaging when silence exceeds a threshold
- **Duplicate & throttle guard** — CacheService prevents double-sends and spam
- **Self-maintenance** — Daily log trimming and push count reset via time-based triggers
- **Telegram**: polling via `getUpdates` (no webhook needed)
- **LINE**: Webhook with Channel Secret signature verification
- **Slack**: URL verification + bot_message filtering

---

## Free vs Full Version

| Feature | Free (this repo) | Full version |
|---------|:---:|:---:|
| Telegram bot | ✅ | ✅ |
| LINE bot | ✅ | ✅ |
| Slack bot | ✅ | ✅ |
| Gemini API | ✅ | ✅ |
| Lonely push | ✅ (fixed params) | ✅ (configurable via UI) |
| Character / persona | Fixed (robot style) | Free (edit from spreadsheet) |
| WebUI browser chat | ❌ | ✅ |
| Multiple LLM engines | Gemini only | Gemini / GPT / Claude / Grok etc. |
| Browser config UI | ❌ | ✅ |
| Pomodoro timer | ❌ | ✅ |
| RSS integration | ❌ | ✅ |
| Diary & long-term memory | ❌ | ✅ |
| RAG (knowledge injection) | ❌ | ✅ |
| Time-of-day instructions | ❌ | ✅ |

---

## Setup

### Prerequisites

- Google account
- [Google AI Studio](https://aistudio.google.com/) API key (free tier available)
- Platform-specific credentials (see below)

### Common steps

1. Create a new Google Spreadsheet
2. Open **Extensions → Apps Script**
3. Paste the contents of your chosen `.gs` file

---

### Telegram

> GAS Web Apps cannot receive Telegram Webhooks reliably (302 redirect issue),
> so this version uses **polling** (`getUpdates`) via a 1-minute time trigger.

**You need:** A bot token from [@BotFather](https://t.me/botfather)

```javascript
const USER_NAME          = "Master";
const PARTNER_NAME       = "Robo";
const GEMINI_API_KEY     = "AIza...";
const TELEGRAM_BOT_TOKEN = "123456789:AAF...";
const TELEGRAM_CHAT_ID   = "123456789";  // your chat ID for lonely push
const MODEL_NAME         = "gemini-2.0-flash";
```

**Steps:**
1. Set `TELEGRAM_BOT_TOKEN`, then send any message to your bot
2. Run `getTelegramChatId()` — your chat ID appears in the logs
3. Set `TELEGRAM_CHAT_ID`
4. Run `setup()` — no web app deployment needed

---

### LINE

**You need:** A [LINE Messaging API](https://developers.line.biz/) channel

```javascript
const USER_NAME           = "Master";
const PARTNER_NAME        = "Robo";
const GEMINI_API_KEY      = "AIza...";
const LINE_ACCESS_TOKEN   = "xxx...";
const LINE_CHANNEL_SECRET = "yyy...";
const MODEL_NAME          = "gemini-2.0-flash";
```

1. Run `setup()`
2. Deploy as **Web App** (access: Anyone)
3. Paste the URL into LINE Developers → Webhook URL

---

### Slack

**You need:** A [Slack App](https://api.slack.com/apps) with `chat:write` scope

```javascript
const USER_NAME        = "Master";
const PARTNER_NAME     = "Robo";
const GEMINI_API_KEY   = "AIza...";
const SLACK_BOT_TOKEN  = "xoxb-...";
const SLACK_CHANNEL_ID = "C...";
const MODEL_NAME       = "gemini-2.0-flash";
```

1. Run `setup()`
2. Deploy as **Web App** (access: Anyone)
3. Set the URL in Slack App → **Event Subscriptions → Request URL**
4. Subscribe to `message.channels`

---

## Architecture

```
[Telegram]
1-min trigger → scheduledEveryMinute()
                  ├─ pollTelegramUpdates()   ← getUpdates polling
                  └─ scheduledCheck()        ← lonely push

[LINE / Slack]
Webhook → doPost() → handleMessage()
30-min trigger → scheduledCheck()           ← lonely push

[Shared pipeline]
handleMessage()
  ├─ pushConversationLog()
  ├─ getRecentConversation()   ← last 5 messages as context
  ├─ callGemini()
  └─ send to platform

dailyReset()  (daily at 17:00 JST) → reset push count + trim logs
```

---

## How Lonely Push Works

A probability curve fires a proactive message based on elapsed silence time:

```javascript
// Lottery starts after 60 min silence, reaches 100% at 480 min (ceiling)
// curvePower = 1.3 → gradual rise (standard curve)
const ratio       = Math.min(1, (elapsedMin - silenceMin) / (ceilingMin - silenceMin));
const probability = Math.pow(ratio, curvePower) * timeWeight;
```

Time-of-day weights let you suppress pushes at night (`weightNight = 0.0`).
Edit the values directly in the code to tune the behavior.

---

## License

Personal and educational use with modification is allowed.
Redistribution, resale, and commercial use are prohibited.
See [LICENSE](LICENSE) for details.

---

## Author

**@yasaihouse**

Full version & support:
👉 **[https://note.com/nou_yakareta/m/mb0c5401f132f](https://note.com/nou_yakareta/m/mb0c5401f132f)**
