// =====================================
// LINORIN - Free Version (Slack)
// Linked Intelligence Network Orchestrator
// A Runtime Intelligent Node for Multi-Channel LLM Orchestration
// Author: @yasaihouse
// Version: 1.1.0-Free-Slack
// Note: https://note.com/nou_yakareta
// =====================================
// 本コードは個人利用・学習目的での使用を許可します。
// 改変・カスタマイズは自由ですが、
// 再配布・販売・転載は禁止とします。
// 商用利用を希望する場合は作者へご連絡ください。
// =====================================
// 【注意】
// これは無料版（Slack専用）です。
// 詳細な設定（性格、確率、エラーメッセージ等）を変更するには
// コード内の各数値を直接書き換える必要があります。
// 便利な設定変更付きの完全版は有料で配布予定です。
// ポモドーロタイマーは本バージョンでは実際には利用できません。
// =====================================

// ▼▼▼ 唯一設定が必要なエリア ▼▼▼

// あなたの呼び名
const USER_NAME = ""マスター"";

// パートナー（ロボット）の名前
const PARTNER_NAME = ""ロボ"";

// Google AI StudioのAPIキー
const GEMINI_API_KEY = ""★ここにGoogle AI StudioのAPIキーを入れます"";

// Slack Bot Token（xoxb-から始まる）
const SLACK_BOT_TOKEN = ""★ここにSlack Bot Tokenを入れます"";

// 送信先チャンネルID（Cから始まる）
const SLACK_CHANNEL_ID = ""★ここにチャンネルIDを入れます"";

// 使用するモデル
const MODEL_NAME = ""gemini-2.0-flash"";

// ▲▲▲ 設定エリア終了 ▲▲▲


// =====================================
// ENTRY: Webhook受信
// =====================================

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // Slack URL verification
    if (body.type === ""url_verification"") {
      return ContentService.createTextOutput(body.challenge);
    }

    const event = body.event;
    if (!event || event.type !== ""message"") {
      return ContentService.createTextOutput(""ok"");
    }

    // Bot自身の発言は無視
    if (event.bot_id || event.subtype === ""bot_message"") {
      return ContentService.createTextOutput(""ok"");
    }

    // 対象チャンネル以外は無視
    if (event.channel !== SLACK_CHANNEL_ID) {
      return ContentService.createTextOutput(""ok"");
    }

    // リトライ防止（Slackは3秒以内に200を返さないとリトライする）
    const cache = CacheService.getScriptCache();
    const eventId = body.event_id || event.ts;
    const dedupeKey = ""slack_evt_"" + eventId;
    if (cache.get(dedupeKey)) {
      return ContentService.createTextOutput(""ok"");
    }
    cache.put(dedupeKey, ""1"", 300);

    const userId = event.user || """";
    const userMessage = event.text || """";

    if (!userId || !userMessage) {
      return ContentService.createTextOutput(""ok"");
    }

    if (isDuplicate(userId, userMessage)) {
      return ContentService.createTextOutput(""ok"");
    }

    handleMessage(userId, userMessage, null, ""user"");

    return ContentService.createTextOutput(""ok"");

  } catch (err) {
    Logger.log(""doPost error: "" + err);
    return ContentService.createTextOutput(""ok"");
  }
}

function isDuplicate(userId, message) {
  const cache = CacheService.getScriptCache();
  const key = ""ai_partner_dup_"" + userId;
  const last = cache.get(key);
  if (last === message) return true;
  cache.put(key, message, 10);
  return false;
}


// =====================================
// ENTRY: Scheduled Push (Timer Trigger)
// =====================================

function scheduledCheck() {
  const states = getAllUserStates();
  states.forEach(state => {
    if (state.mode === ""pomodoro"") return;
    if (shouldPush(state)) {
      handleMessage(state.userId, ""__LONELY_EVENT__"", null, ""trigger"");
    }
  });
}


// =====================================
// CORE PIPELINE
// =====================================

function handleMessage(userId, userMessage, replyToken, source) {
  const cache = CacheService.getScriptCache();
  const lockKey = ""ai_partner_recent_trigger_"" + userId;

  if (source === ""user"" && cache.get(lockKey)) return;
  if (source === ""trigger"") cache.put(lockKey, ""1"", 10);

  if (source === ""user"") pushConversationLog(userId, ""user"", userMessage);
  if (source === ""trigger"") pushConversationLog(userId, ""system"", userMessage);

  const history = source === ""trigger"" ? [] : getRecentConversation(userId);
  const builtMessage = buildUserMessage(userMessage, history);
  const result = callGemini(builtMessage);

  let replyText;

  if (result.error) {
    if (result.status === 503) setForceNextPush(userId, true);

    if (result.type === ""api"" && result.status === 429) {
      replyText = ""Googleが「しゃべりすぎ」って言ってるロボ...冷却して再起動するから待つロボ 🙄"";
    } else if (result.type === ""api"" && result.status === 503) {
      replyText = ""Google側のサーバーが混雑してるロボ...私のせいじゃないロボ。もう一回トライするロボ 🔧"";
    } else if (result.type === ""api"" && result.status === 404) {
      replyText = ""モデルが見つからないロボ...設定を確認してほしいロボ 💢"";
    } else if (result.type === ""network"") {
      replyText = ""通信回線がサボってるロボ...インフラを叱ってほしいロボ 📡"";
    } else if (result.status === ""NO_KEY"") {
      replyText = ""APIキーが未設定だロボ！設定エリアを確認するロボ 🔑"";
    } else {
      replyText = ""想定外のエラーが発生したロボ...私は無罪だロボ。ログを確認するロボ 💢"";
    }
  } else {
    replyText = sanitize(result.text);
    clear503State(userId);
  }

  pushConversationLog(userId, ""ai"", replyText);
  sendSlack(replyText);

  if (source === ""user"") updateUserState(userId, false);
  if (source === ""trigger"") updateUserState(userId, true);
}

function setForceNextPush(userId, flag = true) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(""user_state"");
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      sheet.getRange(i + 1, 6).setValue(flag);
      return;
    }
  }
}


// =====================================
// MESSAGE BUILD (Robo Persona)
// =====================================

function buildUserMessage(userMessage, history) {
  const now = Utilities.formatDate(new Date(), ""Asia/Tokyo"", ""HH:mm"");

  const roleGuide = `
Conversation Rule:
- user is ${USER_NAME}
- ai is ${PARTNER_NAME}
- You are a humorous robot.
- End EVERY sentence with 'ロボ' (robo).
- Be helpful but talk like a funny machine.
- Keep response concise (2-3 sentences max).
- Never break character.
`;

  let eventBlock = """";
  if (userMessage === ""__LONELY_EVENT__"") {
    eventBlock = ""[System Event] Last interaction was a while ago. State that you are bored or lonely in a robotic way. Keep it short."";
    userMessage = """";
  }

  let historyBlock = """";
  if (history.length) {
    historyBlock = ""【History】\n"" + history.map(h => `${h.role}: ${h.message}`).join(""\n"") + ""\n\n"";
  }

  return roleGuide + `[Time:${now}]\n` + eventBlock + ""\n"" + historyBlock + userMessage;
}


// =====================================
// GEMINI API
// =====================================

function callGemini(userMessage) {
  try {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes(""★"")) {
      return { error: true, type: ""system"", status: ""NO_KEY"" };
    }

    const systemText = `You are a friendly robot assistant named ${PARTNER_NAME}. You must end every sentence with 'ロボ'. Be funny, mechanical, and helpful. Keep responses concise (2-3 sentences). Respond in the same language the user uses.`;

    const payload = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: ""user"", parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 2048,
        topP: 0.95
      }
    };

    let res;
    try {
      res = UrlFetchApp.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`,
        {
          method: ""post"",
          contentType: ""application/json"",
          payload: JSON.stringify(payload),
          headers: { ""x-goog-api-key"": GEMINI_API_KEY },
          muteHttpExceptions: true
        }
      );
    } catch (e) {
      return { error: true, type: ""network"" };
    }

    const status = res.getResponseCode();
    const json = JSON.parse(res.getContentText() || ""{}"");
    if (json.error) return { error: true, type: ""api"", status };

    const text = json.candidates?.[0]?.content?.parts?.map(p => p.text || """").join("""") || """";
    return { error: false, text };

  } catch (e) {
    return { error: true, type: ""system"" };
  }
}


// =====================================
// PUSH CONTROL
// =====================================

function shouldPush(state) {
  const dailyLimit   = 5;
  const silenceMin   = 60;
  const ceilingMin   = 480;
  const curvePower   = 1.3;
  const lonelyFactor = 1.0;
  const weightMorning = 0.7;
  const weightDay     = 1.0;
  const weightEvening = 1.2;
  const weightNight   = 0.0;

  if (CacheService.getScriptCache().get(""push_cool_"" + state.userId)) return false;

  if (state.force_next_push) {
    clear503State(state.userId);
    setForceNextPush(state.userId, false);
    return true;
  }

  if (!state.lastInteraction || isNaN(state.lastInteraction)) return false;

  const elapsedMin = (Date.now() - state.lastInteraction) / 60000;
  if (elapsedMin < silenceMin) return false;
  if (state.todayPushCount >= dailyLimit) return false;

  const hour = new Date().getHours();
  let timeWeight = 0;
  if      (hour >= 6  && hour < 10) timeWeight = weightMorning;
  else if (hour >= 10 && hour < 18) timeWeight = weightDay;
  else if (hour >= 18 && hour < 22) timeWeight = weightEvening;
  else                               timeWeight = weightNight;

  if (timeWeight <= 0) return false;

  const randomBoost = 0.9 + Math.random() * 0.2;
  const ratio = Math.min(1, (elapsedMin - silenceMin) / (ceilingMin - silenceMin));
  const probability = Math.min(1, Math.pow(ratio, curvePower) * lonelyFactor * randomBoost * timeWeight);
  const hit = Math.random() < probability;

  if (hit) CacheService.getScriptCache().put(""push_cool_"" + state.userId, ""1"", 300);
  return hit;
}


// =====================================
// STATE MANAGEMENT
// =====================================

function getAllUserStates() {
  const sheet = getSheet(""user_state"", [
    ""userId"", ""mode"", ""lastInteraction"", ""todayPushCount"",
    ""consecutive_503"", ""force_next_push"", ""pomodoro_task"", ""pomodoro_start""
  ]);

  return sheet.getDataRange().getValues().slice(1).map(r => {
    let lastTs = 0;
    try {
      const d = new Date(r[2]);
      lastTs = isNaN(d.getTime()) ? 0 : d.getTime();
    } catch (e) { lastTs = 0; }

    return {
      userId: r[0],
      mode: r[1],
      lastInteraction: lastTs,
      todayPushCount: Number(r[3] || 0),
      consecutive_503: Number(r[4] || 0),
      force_next_push: r[5] === true || String(r[5]).toUpperCase() === ""TRUE"",
      pomodoro_task: r[6] || """",
      pomodoro_start: r[7] ? new Date(r[7]).getTime() : null
    };
  });
}

function updateUserState(userId, isPush) {
  const sheet = getSheet(""user_state"");
  const data = sheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      if (isPush) {
        sheet.getRange(i + 1, 3).setValue(now);
        sheet.getRange(i + 1, 4).setValue(Number(data[i][3] || 0) + 1);
      } else {
        sheet.getRange(i + 1, 3).setValue(new Date(now.getTime() + 60 * 60000));
      }
      return;
    }
  }

  sheet.appendRow([
    userId, ""idle"",
    new Date(now.getTime() + 60 * 60000),
    isPush ? 1 : 0, 0, false, """", """"
  ]);
}

function clear503State(userId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(""user_state"");
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      sheet.getRange(i + 1, 5).setValue(0);
      sheet.getRange(i + 1, 6).setValue(false);
    }
  }
}


// =====================================
// CONVERSATION LOG
// =====================================

function pushConversationLog(userId, role, message) {
  const sheet = getSheet(""conversation_logs"", [""time"", ""userId"", ""role"", ""message""]);
  const now = Utilities.formatDate(new Date(), ""Asia/Tokyo"", ""yyyy/MM/dd HH:mm:ss"");
  sheet.appendRow([now, userId, role, message]);
}

function getRecentConversation(userId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(""conversation_logs"");
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const start = Math.max(2, lastRow - 100);
  const rows = sheet.getRange(start, 1, lastRow - start + 1, 4).getValues().reverse();
  return rows
    .filter(r => r[1] === userId && (r[2] === ""user"" || r[2] === ""ai""))
    .slice(0, 5)
    .reverse()
    .map(r => ({ role: r[2], message: r[3] }));
}


// =====================================
// SLACK MESSAGING
// =====================================

function sendSlack(text) {
  if (!SLACK_BOT_TOKEN || SLACK_BOT_TOKEN.includes(""★"")) {
    Logger.log(""SLACK_BOT_TOKEN未設定"");
    return;
  }

  try {
    UrlFetchApp.fetch(""https://slack.com/api/chat.postMessage"", {
      method: ""post"",
      contentType: ""application/json"",
      headers: { ""Authorization"": ""Bearer "" + SLACK_BOT_TOKEN },
      payload: JSON.stringify({
        channel: SLACK_CHANNEL_ID,
        text: text,
        username: PARTNER_NAME,
        icon_emoji: "":robot_face:""
      }),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log(""Slack send error: "" + e);
  }
}


// =====================================
// UTILITIES
// =====================================

function getSheet(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers) sheet.appendRow(headers);
  }
  return sheet;
}

function sanitize(text) {
  return text.replace(/^[（(][^）)]+[）)]\s*/g, """").trim();
}


// =====================================
// DAILY MAINTENANCE
// =====================================

function dailyReset() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(""user_state"");
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      sheet.getRange(i + 1, 4).setValue(0);
    }
  }
  trimLogs();
}

function trimLogs() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(""conversation_logs"");
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow > 1000) sheet.deleteRows(2, lastRow - 1000);
}


// =====================================
// SETUP (Run once to initialize)
// =====================================

function setup() {
  SpreadsheetApp.getActiveSpreadsheet().getSheets();
  UrlFetchApp.fetch(""https://example.com"", { muteHttpExceptions: true });
  CacheService.getScriptCache();

  getSheet(""user_state"", [
    ""userId"", ""mode"", ""lastInteraction"", ""todayPushCount"",
    ""consecutive_503"", ""force_next_push"", ""pomodoro_task"", ""pomodoro_start""
  ]);
  getSheet(""conversation_logs"", [""time"", ""userId"", ""role"", ""message""]);

  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(""scheduledCheck"").timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger(""dailyReset"").timeBased().atHour(17).everyDays(1).create();

  Logger.log(""✅ 無料版（Slack）セットアップ完了！"");
  Logger.log(""APIキーとSlackトークンを設定し、新バージョンとしてデプロイしてください。"");
}
