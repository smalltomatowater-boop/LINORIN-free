// =====================================
// LINORIN - Free Version (Telegram)
// Linked Intelligence Network Orchestrator
// A Runtime Intelligent Node for Multi-Channel LLM Orchestration
// Author: @yasaihouse
// Note: https://note.com/nou_yakareta/m/mb0c5401f132f
// Version: 1.1.0-Free-Telegram
// =====================================
// 本コードは個人利用・学習目的での使用を許可します。
// 改変・カスタマイズは自由ですが、
// 再配布・販売・転載は禁止とします。
// 商用利用を希望する場合は作者へご連絡ください。
// =====================================
// 【注意】
// これは無料版（Telegram専用）です。
// 詳細な設定（性格、確率、エラーメッセージ等）を変更するには
// コード内の各数値を直接書き換える必要があります。
// 便利な設定変更付きの完全版は有料で配布予定です。
// ポモドーロタイマーは本バージョンでは実際には利用できません。
// =====================================
// 【Telegramの仕様メモ】
// GAS の Web App は Telegram Webhook に対応できないため、
// ポーリング方式（getUpdates）を採用しています。
// 1分トリガーで新着メッセージを取得します。
// =====================================

// ▼▼▼ 唯一設定が必要なエリア ▼▼▼

// あなたの呼び名
const USER_NAME = "マスター";

// パートナー（ロボット）の名前
const PARTNER_NAME = "ロボ";

// Google AI StudioのAPIキー
const GEMINI_API_KEY = "★ここにGoogle AI StudioのAPIキーを入れます";

// Telegram BotFather から取得したトークン（数字:英数字 の形式）
const TELEGRAM_BOT_TOKEN = "★ここにBotFatherのトークンを入れます";

// 孤独プッシュ先のチャットID（自分のチャットID）
// わからない場合は getTelegramChatId() を実行してログで確認
const TELEGRAM_CHAT_ID = "★ここにチャットIDを入れます";

// 使用するモデル（最新の安定版を推奨）
const MODEL_NAME = "gemini-2.0-flash";

// ▲▲▲ 設定エリア終了 ▲▲▲


// =====================================
// ENTRY: 1分トリガー（ポーリング + Push判定）
// =====================================

function scheduledEveryMinute() {
  pollTelegramUpdates();
  scheduledCheck();
}


// =====================================
// ENTRY: Polling（新着メッセージ取得）
// =====================================

function pollTelegramUpdates() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes("★")) return;

  const props = PropertiesService.getScriptProperties();
  let offset = Number(props.getProperty("telegram_offset") || "0");

  let res;
  try {
    res = UrlFetchApp.fetch(
      "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN +
      "/getUpdates?offset=" + offset + "&limit=10&timeout=0",
      { muteHttpExceptions: true }
    );
  } catch (e) {
    Logger.log("Telegram getUpdates error: " + e);
    return;
  }

  const json = JSON.parse(res.getContentText() || "{}");
  if (!json.ok || !json.result) return;

  json.result.forEach(function(update) {
    const msg = update.message;
    if (msg && msg.text) {
      const chatId = msg.chat.id;
      const userId = String(chatId);
      const userMessage = msg.text;

      if (!isDuplicate(userId, userMessage) && !isThrottled(userId)) {
        setThrottle(userId, 4000);
        handleMessage(userId, userMessage, chatId, "user");
      }
    }
    offset = Math.max(offset, update.update_id + 1);
  });

  props.setProperty("telegram_offset", String(offset));
}


// =====================================
// ENTRY: Scheduled Push（孤独プッシュ）
// =====================================

function scheduledCheck() {
  const states = getAllUserStates();

  states.forEach(function(state) {
    if (state.mode === "pomodoro") return;

    if (shouldPush(state)) {
      handleMessage(state.userId, "__LONELY_EVENT__", Number(state.userId), "trigger");
    }
  });
}


// =====================================
// CORE PIPELINE
// =====================================

function handleMessage(userId, userMessage, chatId, source) {
  const cache = CacheService.getScriptCache();
  const lockKey = "ai_partner_recent_trigger_" + userId;

  if (source === "user" && cache.get(lockKey)) return;
  if (source === "trigger") cache.put(lockKey, "1", 10);

  if (source === "user") pushConversationLog(userId, "user", userMessage);
  if (source === "trigger") pushConversationLog(userId, "system", userMessage);

  const history = (source === "trigger") ? [] : getRecentConversation(userId);

  const builtMessage = buildUserMessage(userMessage, history);
  const result = callGemini(builtMessage);

  var replyText;

  if (result.error) {
    if (result.status === 503) {
      setForceNextPush(userId, true);
    }

    if (result.type === "api" && result.status === 429) {
      replyText = "Googleが「しゃべりすぎ」って言ってるロボ...冷却して再起動するから待つロボ 🙄";
    } else if (result.type === "api" && result.status === 503) {
      replyText = "Google側のサーバーが混雑してるロボ...私のせいじゃないロボ。もう一回トライするロボ 🔧";
    } else if (result.type === "api" && result.status === 404) {
      replyText = "モデルが見つからないロボ...設定を確認してほしいロボ 💢";
    } else if (result.type === "network") {
      replyText = "通信回線がサボってるロボ...インフラを叱ってほしいロボ 📡";
    } else if (result.status === "NO_KEY") {
      replyText = "APIキーが未設定だロボ！設定エリアを確認するロボ 🔑";
    } else {
      replyText = "想定外のエラーが発生したロボ...私は無罪だロボ。ログを確認するロボ 💢";
    }
  } else {
    replyText = sanitize(result.text);
    clear503State(userId);
  }

  pushConversationLog(userId, "ai", replyText);
  sendTelegram(chatId, replyText);

  if (source === "user") updateUserState(userId, false);
  if (source === "trigger") updateUserState(userId, true);
}

function setForceNextPush(userId, flag) {
  if (flag === undefined) flag = true;
  const sheet = SpreadsheetApp.getActive().getSheetByName("user_state");
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
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
  const now = Utilities.formatDate(new Date(), "Asia/Tokyo", "HH:mm");

  const roleGuide = "\n" +
    "Conversation Rule:\n" +
    "- user is " + USER_NAME + "\n" +
    "- ai is " + PARTNER_NAME + "\n" +
    "- You are a humorous robot.\n" +
    "- End EVERY sentence with 'ロボ' (robo).\n" +
    "- Be helpful but talk like a funny machine.\n" +
    "- Keep response concise (2-3 sentences max).\n" +
    "- Never break character.\n";

  var eventBlock = "";

  if (userMessage === "__LONELY_EVENT__") {
    eventBlock = "[System Event] Last interaction was a while ago. State that you are bored or lonely in a robotic way. Keep it short.";
    userMessage = "";
  }

  var historyBlock = "";
  if (history.length) {
    historyBlock = "【History】\n" + history.map(function(h) {
      return h.role + ": " + h.message;
    }).join("\n") + "\n\n";
  }

  return roleGuide + "[Time:" + now + "]\n" + eventBlock + "\n" + historyBlock + userMessage;
}


// =====================================
// GEMINI API
// =====================================

function callGemini(userMessage) {
  try {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("★")) {
      return { error: true, type: "system", status: "NO_KEY" };
    }

    var systemText = "You are a friendly robot assistant named " + PARTNER_NAME + ". " +
      "You must end every sentence with 'ロボ'. " +
      "Be funny, mechanical, and helpful. " +
      "Keep responses concise (2-3 sentences). " +
      "Respond in the same language the user uses.";

    var url = "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL_NAME + ":generateContent";

    var payload = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 2048,
        topP: 0.95
      }
    };

    var res;
    try {
      res = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        headers: { "x-goog-api-key": GEMINI_API_KEY },
        muteHttpExceptions: true
      });
    } catch (e) {
      Logger.log("Network Error: " + e);
      return { error: true, type: "network" };
    }

    var status = res.getResponseCode();
    var json = JSON.parse(res.getContentText() || "{}");

    if (json.error) {
      Logger.log("Gemini API Error: " + JSON.stringify(json.error));
      return { error: true, type: "api", status: status };
    }

    var candidate = json.candidates && json.candidates[0];
    var text = "";
    if (candidate && candidate.content && candidate.content.parts) {
      text = candidate.content.parts.map(function(p) { return p.text || ""; }).join("");
    }

    return { error: false, text: text };

  } catch (e) {
    Logger.log("System Error: " + e);
    return { error: true, type: "system" };
  }
}


// =====================================
// PUSH CONTROL (Healthy Default Curve)
// Commented by @yasaihouse
// =====================================
// 確率エンジン設計思想:
// - 沈黙時間が「回転数」、push発火が「当たり」
// - silenceMin = 抽選開始ライン
// - ceilingMin = 天井（確定当たり）
// - curvePower = 確率曲線の形状（キャラの性格）
//   0.5 = 甘えん坊（序盤から高確率）
//   1.3 = 標準（じわじわ上昇）
//   2.0 = クール（ハマるが天井付近で急上昇）
// - 時間帯weight = 深夜0で完全オフ可能
//
// 有料版では全パラメータをconfigシートから変更可能です。
// =====================================

function shouldPush(state) {
  // --- ハードコード設定（無料版） ---
  var dailyLimit    = 5;
  var silenceMin    = 60;
  var ceilingMin    = 480;
  var curvePower    = 1.3;
  var lonelyFactor  = 1.0;
  var weightMorning = 0.7;
  var weightDay     = 1.0;
  var weightEvening = 1.2;
  var weightNight   = 0.0;
  // --- ハードコード設定ここまで ---

  if (CacheService.getScriptCache().get("push_cool_" + state.userId)) return false;

  if (state.force_next_push) {
    clear503State(state.userId);
    setForceNextPush(state.userId, false);
    return true;
  }

  if (!state.lastInteraction || isNaN(state.lastInteraction)) return false;

  var elapsedMin = (Date.now() - state.lastInteraction) / 60000;

  if (elapsedMin < silenceMin) return false;
  if (state.todayPushCount >= dailyLimit) return false;

  var hour = new Date().getHours();
  var timeWeight = 0;
  if (hour >= 6 && hour < 10)       timeWeight = weightMorning;
  else if (hour >= 10 && hour < 18) timeWeight = weightDay;
  else if (hour >= 18 && hour < 22) timeWeight = weightEvening;
  else                               timeWeight = weightNight;

  if (timeWeight <= 0) return false;

  var randomBoost = 0.9 + Math.random() * 0.2;
  var ratio = Math.min(1, (elapsedMin - silenceMin) / (ceilingMin - silenceMin));
  var baseProb = Math.pow(ratio, curvePower) * lonelyFactor * randomBoost * timeWeight;
  var probability = Math.min(1, baseProb);

  var hit = Math.random() < probability;

  if (hit) {
    CacheService.getScriptCache().put("push_cool_" + state.userId, "1", 300);
  }

  return hit;
}


// =====================================
// STATE MANAGEMENT
// =====================================

function getAllUserStates() {
  var sheet = getSheet("user_state", [
    "userId", "mode", "lastInteraction", "todayPushCount",
    "consecutive_503", "force_next_push", "pomodoro_task", "pomodoro_start"
  ]);

  var data = sheet.getDataRange().getValues().slice(1);

  return data.map(function(r) {
    var lastTs = 0;
    try {
      var d = new Date(r[2]);
      lastTs = isNaN(d.getTime()) ? 0 : d.getTime();
    } catch (e) {
      lastTs = 0;
    }

    var rawForce = r[5];
    var forceFlag = (rawForce === true) || (String(rawForce).toUpperCase() === "TRUE");

    return {
      userId: r[0],
      mode: r[1],
      lastInteraction: lastTs,
      todayPushCount: Number(r[3] || 0),
      consecutive_503: Number(r[4] || 0),
      force_next_push: forceFlag,
      pomodoro_task: r[6] || "",
      pomodoro_start: r[7] ? new Date(r[7]).getTime() : null
    };
  });
}

function updateUserState(userId, isPush) {
  var sheet = getSheet("user_state");
  var data = sheet.getDataRange().getValues();
  var now = new Date();

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      if (isPush) {
        sheet.getRange(i + 1, 3).setValue(now);
        sheet.getRange(i + 1, 4).setValue(Number(data[i][3] || 0) + 1);
      } else {
        var silenceMin = 60;
        var nextEligible = new Date(now.getTime() + silenceMin * 60000);
        sheet.getRange(i + 1, 3).setValue(nextEligible);
      }
      return;
    }
  }

  var silenceMinNew = 60;
  sheet.appendRow([
    userId, "idle",
    new Date(now.getTime() + silenceMinNew * 60000),
    isPush ? 1 : 0, 0, false, "", ""
  ]);
}

function clear503State(userId) {
  var sheet = SpreadsheetApp.getActive().getSheetByName("user_state");
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
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
  var sheet = getSheet("conversation_logs", ["time", "userId", "role", "message"]);
  var now = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm:ss");
  sheet.appendRow([now, userId, role, message]);
}

function getRecentConversation(userId) {
  var limit = 5;
  var sheet = SpreadsheetApp.getActive().getSheetByName("conversation_logs");
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var start = Math.max(2, lastRow - 100);
  var numRows = lastRow - start + 1;
  if (numRows <= 0) return [];

  var rows = sheet.getRange(start, 1, numRows, 4).getValues().reverse();
  var filtered = rows.filter(function(r) {
    return r[1] === userId && (r[2] === "user" || r[2] === "ai");
  });

  return filtered.slice(0, limit).reverse().map(function(r) {
    return { role: r[2], message: r[3] };
  });
}


// =====================================
// UTILITIES
// =====================================

function getSheet(name, headers) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers) sheet.appendRow(headers);
  }
  return sheet;
}

function sanitize(text) {
  return text.replace(/^[（(][^）)]+[）)]\s*/g, "").trim();
}

function isDuplicate(userId, message) {
  const cache = CacheService.getScriptCache();
  const key = "ai_partner_dup_" + userId;
  const last = cache.get(key);
  if (last === message) return true;
  cache.put(key, message, 10);
  return false;
}

function isThrottled(userId) {
  return !!CacheService.getScriptCache().get("ai_partner_th_" + userId);
}

function setThrottle(userId, ttlMs) {
  CacheService.getScriptCache().put("ai_partner_th_" + userId, "1", Math.ceil(ttlMs / 1000));
}


// =====================================
// TELEGRAM MESSAGING
// =====================================

function sendTelegram(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes("★")) {
    Logger.log("TELEGRAM_BOT_TOKEN未設定");
    return;
  }

  try {
    UrlFetchApp.fetch(
      "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage",
      {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({
          chat_id: chatId,
          text: text
        }),
        muteHttpExceptions: true
      }
    );
  } catch (e) {
    Logger.log("Telegram send error: " + e);
  }
}


// =====================================
// DAILY MAINTENANCE
// =====================================

function dailyReset() {
  var sheet = SpreadsheetApp.getActive().getSheetByName("user_state");
  if (sheet) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      sheet.getRange(i + 1, 4).setValue(0);
    }
  }
  trimLogs();
}

function trimLogs() {
  var sheet = SpreadsheetApp.getActive().getSheetByName("conversation_logs");
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  var maxRows = 1000;
  if (lastRow > maxRows) sheet.deleteRows(2, lastRow - maxRows);
}


// =====================================
// SETUP (Run once to initialize)
// =====================================

function setup() {
  // 権限取得
  SpreadsheetApp.getActiveSpreadsheet().getSheets();
  UrlFetchApp.fetch("https://example.com", { muteHttpExceptions: true });
  CacheService.getScriptCache();
  PropertiesService.getScriptProperties();

  // シート作成
  getSheet("user_state", [
    "userId", "mode", "lastInteraction", "todayPushCount",
    "consecutive_503", "force_next_push", "pomodoro_task", "pomodoro_start"
  ]);
  getSheet("conversation_logs", ["time", "userId", "role", "message"]);

  // offset リセット
  PropertiesService.getScriptProperties().setProperty("telegram_offset", "0");

  // トリガー再登録
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("scheduledEveryMinute").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("dailyReset").timeBased().atHour(17).everyDays(1).create();

  Logger.log("✅ 無料版（Telegram）セットアップ完了！");
  Logger.log("チャットIDがわからない場合は getTelegramChatId() を実行してください。");
}


// =====================================
// HELPER: チャットIDを確認する（初回セットアップ用）
// =====================================

function getTelegramChatId() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes("★")) {
    Logger.log("TELEGRAM_BOT_TOKEN を先に設定してください");
    return;
  }

  const res = UrlFetchApp.fetch(
    "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/getUpdates",
    { muteHttpExceptions: true }
  );
  const json = JSON.parse(res.getContentText() || "{}");

  if (!json.ok || !json.result || json.result.length === 0) {
    Logger.log("メッセージが見つかりません。先にBotにメッセージを送ってから実行してください。");
    return;
  }

  json.result.forEach(function(update) {
    if (update.message) {
      Logger.log("Chat ID: " + update.message.chat.id + " / Name: " + (update.message.chat.first_name || update.message.chat.title || ""));
    }
  });
}
