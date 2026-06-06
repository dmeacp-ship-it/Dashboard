/**
 * src/services/ai.service.js
 *
 * Faithful port of the GeminiService IIFE from Service.gs:
 *   - askTable(wrappedData, question)
 *   - askCopilot(contextName, contextData, question)
 *   - Gemini (system_instruction + contents history) with retry,
 *     Groq Llama-3 fallback.
 *
 * Returns the raw answer string (the front-end runs it through
 * formatAIResponse), matching the original contract exactly.
 */

const fetch = require('node-fetch');
const { GEMINI_CONFIG, GROQ_CONFIG } = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function _geminiKey() { return process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || ''; }
function _groqKey() { return process.env.GROQ_API_KEY || process.env.GROQ_KEY || ''; }

async function askTable(wrappedData, question) {
  let tableData = wrappedData;
  let history = [];
  try {
    const parsed = JSON.parse(wrappedData);
    if (parsed._history) {
      history = parsed._history;
      tableData = parsed.table;
    }
  } catch (e) { /* wrappedData was plain text */ }

  const prompt = `You are a BI data analyst AI assistant embedded directly inside a reporting dashboard.
Analyze the provided JSON table data. Answer the question directly, concisely, and accurately.
- Base your answer ONLY on the provided data. Do not make up information.
- Format the answer clearly, using bullet points or short paragraphs for readability.
- If the data needed to answer the question is not present in the provided table data, politely say so.
TABLE DATA (JSON):
${tableData}`;
  return _callAIWithFallback(prompt, history, question);
}

async function askCopilot(contextName, contextData, question) {
  let history = contextData._history || [];
  delete contextData._history;
  const prompt = `You are the Virgo ACP Copilot, a highly intelligent virtual assistant integrated into a sales intelligence dashboard.
The user is currently viewing the "${contextName}" page.
Here is the background data/KPIs for the current page to give you context:
${JSON.stringify(contextData)}
Provide a sharp, data-driven, and highly relevant answer.
- Keep it professional but conversational (like a helpful colleague).
- Use the provided context to give specific numbers where helpful.
- Use markdown for bolding and lists to make the answer easy to read.
- DO NOT wrap your entire response in a markdown code block (\`\`\`).`;
  return _callAIWithFallback(prompt, history, question);
}

async function _callAIWithFallback(systemPrompt, history, question) {
  const geminiKey = _geminiKey();
  const groqKey = _groqKey();

  const maxRetries = GEMINI_CONFIG.MAX_RETRIES || 2;
  const baseDelay = GEMINI_CONFIG.RETRY_DELAY || 3000;
  let lastError = null;

  if (geminiKey) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await _callGemini(systemPrompt, history, question, geminiKey);
      } catch (e) {
        lastError = e;
        const errMsg = e.message.toLowerCase();
        const isRetryable = errMsg.includes('429') || errMsg.includes('503') ||
          errMsg.includes('rate limit') || errMsg.includes('quota') ||
          errMsg.includes('unavailable') || errMsg.includes('overloaded');
        if (isRetryable && attempt < maxRetries) {
          await sleep(baseDelay * attempt);
          continue;
        }
        break;
      }
    }
  }

  if (groqKey) {
    try {
      return await _callGroq(systemPrompt, history, question, groqKey);
    } catch (e) {
      throw new Error('AI Error: Gemini failed (' + (lastError ? lastError.message : 'No Key') + ') AND Groq fallback failed (' + e.message + ').');
    }
  }

  if (lastError) {
    throw new Error('Virgo AI Error: Google Gemini is currently overloaded and no Groq fallback key was found. Please wait 1 minute and try again.');
  } else {
    throw new Error('No AI API keys configured. Please add GEMINI_API_KEY or GROQ_API_KEY to the environment.');
  }
}

async function _callGemini(systemPrompt, history, question, apiKey) {
  const url = GEMINI_CONFIG.API_BASE + GEMINI_CONFIG.MODEL + ':generateContent?key=' + apiKey;

  const contents = history.map(function (msg) {
    return { role: msg.role === 'ai' ? 'model' : 'user', parts: [{ text: msg.content }] };
  });
  contents.push({ role: 'user', parts: [{ text: question }] });

  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: contents,
    generationConfig: {
      temperature: GEMINI_CONFIG.TEMPERATURE,
      maxOutputTokens: GEMINI_CONFIG.MAX_TOKENS
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const code = res.status;
  if (code === 429) throw new Error('429 Quota/Rate Limit Exceeded.');
  if (code === 503) throw new Error('503 Service Unavailable.');
  if (code !== 200) throw new Error('API Error ' + code + ': ' + (await res.text()).slice(0, 200));

  const body = JSON.parse(await res.text());
  if (body.candidates && body.candidates[0] && body.candidates[0].content &&
    body.candidates[0].content.parts && body.candidates[0].content.parts[0]) {
    return body.candidates[0].content.parts[0].text;
  }
  return 'I could not generate an answer at this time.';
}

async function _callGroq(systemPrompt, history, question, apiKey) {
  const url = GROQ_CONFIG.API_BASE || 'https://api.groq.com/openai/v1/chat/completions';
  const messages = [{ role: 'system', content: systemPrompt }];

  history.forEach(function (msg) {
    messages.push({ role: msg.role === 'ai' ? 'assistant' : 'user', content: msg.content });
  });
  messages.push({ role: 'user', content: question });

  const payload = {
    model: GROQ_CONFIG.MODEL || 'llama3-70b-8192',
    messages: messages,
    temperature: GROQ_CONFIG.TEMPERATURE || 0.1,
    max_tokens: GROQ_CONFIG.MAX_TOKENS || 1500
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const code = res.status;
  if (code !== 200) throw new Error('Groq API Error ' + code + ': ' + (await res.text()).slice(0, 200));
  const body = JSON.parse(await res.text());
  if (body.choices && body.choices[0] && body.choices[0].message) {
    return body.choices[0].message.content;
  }
  return 'I could not generate an answer from Groq at this time.';
}

module.exports = { askTable, askCopilot };
