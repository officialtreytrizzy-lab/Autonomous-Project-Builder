import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`Missing required worker argument: ${name}`);
  return value;
}

const validateOnly = process.argv.includes('--validate');
const workspace = validateOnly ? process.cwd() : requiredArgument('--workspace');
const promptPath = validateOnly ? '' : requiredArgument('--prompt');
const completionPath = validateOnly ? '' : requiredArgument('--completion');
const lastMessagePath = validateOnly ? '' : requiredArgument('--last-message');
const heartbeatPath = validateOnly ? '' : requiredArgument('--heartbeat');
const handoffPath = validateOnly ? '' : requiredArgument('--handoff');
const buildId = validateOnly ? 'validate' : requiredArgument('--build');
const workerLog = validateOnly ? '' : join(workspace, '.builder', 'worker.log');
let repairCount = 0;
let chatTabId = null;
let chatProfileId = '';
let chatThreadUrl = '';
let client = null;
let connecting = null;

function log(message) {
  if (!workerLog) return;
  appendFileSync(workerLog, `${new Date().toISOString()} ${message}\n`, 'utf8');
}

function readEnvValue(path, name) {
  if (!existsSync(path)) return '';
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*)$`);
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(pattern);
    if (!match) continue;
    let value = match[1].trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    return value;
  }
  return '';
}

async function resolveMcpToken() {
  const inherited = process.env.BUILDER_SERVICE_TOKEN?.trim() || process.env.MCP_AUTH_TOKEN?.trim();
  if (inherited) return inherited;
  let baseDirectory = '';
  try {
    const response = await fetch('http://127.0.0.1:3000/health/deep', { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    const payload = await response.json();
    if (typeof payload.baseDirectory === 'string') baseDirectory = payload.baseDirectory;
  } catch {}
  if (baseDirectory) {
    for (const filename of ['.env.local', '.env.mcp']) {
      const value = readEnvValue(join(baseDirectory, filename), 'MCP_AUTH_TOKEN');
      if (value) return value;
    }
  }
  throw new Error('Computer 2 MCP authentication is unavailable to the build worker.');
}

function parseLeadingJson(text) {
  const start = text.search(/[\[{]/);
  if (start < 0) return null;
  const opening = text[start];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === opening) depth += 1;
    if (character === closing) depth -= 1;
    if (depth === 0) {
      try { return JSON.parse(text.slice(start, index + 1)); } catch { return null; }
    }
  }
  return null;
}

function parseResult(result) {
  const text = result?.content?.find((item) => item?.type === 'text')?.text ?? '';
  if (result?.isError) throw new Error(text || 'Computer 2 MCP call failed');
  if (!text) return result;
  try { return JSON.parse(text); } catch { return parseLeadingJson(text) ?? { text }; }
}

function isExpiredSessionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:unknown|expired|invalid|no\s+valid)[^\r\n]{0,80}session\s*id|session\s*id[^\r\n]{0,80}(?:unknown|expired|invalid|no\s+valid)/i.test(message);
}

async function closeClient() {
  const current = client;
  client = null;
  connecting = null;
  if (current) await current.close().catch(() => undefined);
}

async function connectedClient() {
  if (client) return client;
  if (connecting) return connecting;
  const token = await resolveMcpToken();
  const url = process.env.COMPUTER2_MCP_URL?.trim() || process.env.MCP_MAIN_NODE_URL?.trim() || 'http://127.0.0.1:3000/mcp';
  const next = new Client({ name: 'autonomous-builder-chatgpt-worker', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  connecting = next.connect(transport).then(() => {
    client = next;
    connecting = null;
    log('Connected to Computer 2 MCP.');
    return next;
  }, async (error) => {
    connecting = null;
    await next.close().catch(() => undefined);
    throw error;
  });
  return connecting;
}

async function callTool(name, args = {}) {
  let retriedSession = false;
  while (true) {
    const current = await connectedClient();
    try {
      return parseResult(await current.callTool({ name, arguments: args }, undefined, { timeout: 30_000 }));
    } catch (error) {
      if (client === current) client = null;
      await current.close().catch(() => undefined);
      if (!retriedSession && isExpiredSessionError(error)) {
        retriedSession = true;
        continue;
      }
      throw error;
    }
  }
}

async function ensureBridge() {
  try {
    const status = await callTool('authenticated_chrome_status', {});
    if (status?.extensionConnected && status?.relayListening) return;
  } catch (error) {
    log(`Browser status warning: ${error instanceof Error ? error.message : String(error)}`);
  }
  repairCount += 1;
  try {
    await callTool('chatgpt_chrome_bridge_restart', {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/relay restarted before the command completed|connection|session|fetch failed/i.test(message)) throw error;
    await closeClient();
    log('Authenticated Chrome relay restart interrupted the old connection as expected.');
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const status = await callTool('authenticated_chrome_status', {});
      if (status?.extensionConnected && status?.relayListening) {
        log('Authenticated Chrome bridge reconnected.');
        return;
      }
    } catch {}
  }
  throw new Error('Authenticated Chrome bridge could not be recovered.');
}

function rememberTab(value) {
  if (!value || typeof value !== 'object') return;
  if (Number.isInteger(value.id)) chatTabId = value.id;
  else if (Number.isInteger(value.tabId)) chatTabId = value.tabId;
  if (typeof value.profileId === 'string') chatProfileId = value.profileId;
}

async function selectChatTab() {
  if (chatTabId) {
    try {
      const args = { id: chatTabId };
      if (chatProfileId) args.profile_id = chatProfileId;
      const selected = await callTool('authenticated_chrome_select_tab', args);
      rememberTab(selected);
      return selected;
    } catch (error) {
      log(`Stored ChatGPT tab id was unavailable; reselecting by URL: ${error instanceof Error ? error.message : String(error)}`);
      chatTabId = null;
    }
  }
  if (chatThreadUrl) {
    try {
      const selected = await callTool('authenticated_chrome_select_tab', { url_contains: chatThreadUrl });
      rememberTab(selected);
      return selected;
    } catch {}
  }
  return null;
}

async function navigateChat(url) {
  if (!String(url).startsWith('https://chatgpt.com/')) throw new Error('Refusing to navigate the autonomous build worker outside ChatGPT.');
  const nav = await callTool('authenticated_chrome_navigate', { url, new_tab: true, timeout_ms: 60_000 });
  rememberTab(nav);
  chatThreadUrl = url;
  return nav;
}

async function readChatPage(maxTextLength = 16_000) {
  await selectChatTab();
  let snapshot = await callTool('authenticated_chrome_snapshot', { max_text_length: maxTextLength });
  if (!String(snapshot?.url || '').startsWith('https://chatgpt.com/')) {
    if (chatThreadUrl.startsWith('https://chatgpt.com/')) {
      await navigateChat(chatThreadUrl);
      snapshot = await callTool('authenticated_chrome_snapshot', { max_text_length: maxTextLength });
    }
  }
  if (!String(snapshot?.url || '').startsWith('https://chatgpt.com/')) throw new Error('Selected browser tab drifted away from the ChatGPT build thread.');
  rememberTab(snapshot);
  return snapshot;
}

function composerFrom(snapshot) {
  const elements = Array.isArray(snapshot?.elements) ? snapshot.elements : [];
  const box = elements.find((element) => element?.role === 'textarea' || element?.tag === 'textarea' || /Chat with ChatGPT|Message ChatGPT/i.test(String(element?.name || '')));
  const send = elements.find((element) => /^(Send prompt|Send)$/i.test(String(element?.name || '')) && (element?.tag === 'button' || element?.role === 'submit' || element?.role === 'button'));
  return { box, send };
}

async function waitComposer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const snapshot = await readChatPage(14_000);
    const composer = composerFrom(snapshot);
    if (composer.box && composer.send) return { snapshot, composer };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Authenticated ChatGPT composer did not become available.');
}

async function sendChatMessage(message) {
  const ready = await waitComposer();
  await callTool('authenticated_chrome_type', { ref: String(ready.composer.box.ref), text: message, clear_first: true });
  await callTool('authenticated_chrome_press_key', { key: 'Enter' });
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const snapshot = await readChatPage(16_000);
  chatThreadUrl = String(snapshot.url || chatThreadUrl);
  return snapshot;
}

function writeHeartbeat(stage) {
  writeFileSync(heartbeatPath, JSON.stringify({ timestamp: new Date().toISOString(), buildId, stage, threadUrl: chatThreadUrl, tabId: chatTabId, repairAttempts: repairCount }), 'utf8');
}

function readCompletion() {
  if (!existsSync(completionPath)) return null;
  try { return JSON.parse(readFileSync(completionPath, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

async function main() {
  if (validateOnly) {
    process.stdout.write(JSON.stringify({ ok: true, worker: 'autonomous-builder-chatgpt' }));
    return;
  }
  process.chdir(workspace);
  const existing = readCompletion();
  if (existing?.status === 'complete') {
    log('Completion evidence already present; nothing to resume.');
    return;
  }
  await ensureBridge();
  let handoff = null;
  if (existsSync(handoffPath)) {
    try { handoff = JSON.parse(readFileSync(handoffPath, 'utf8').replace(/^\uFEFF/, '')); } catch {}
  }
  if (handoff?.url && String(handoff.url).startsWith('https://chatgpt.com/')) {
    chatThreadUrl = String(handoff.url);
    if (Number.isInteger(handoff.tabId)) chatTabId = handoff.tabId;
    if (typeof handoff.profileId === 'string') chatProfileId = handoff.profileId;
    try { await selectChatTab(); } catch {}
    if (!chatTabId) await navigateChat(chatThreadUrl);
    await sendChatMessage(`Resume Autonomous Project Builder build ${buildId}.\nThe approved implementation contract is at ${promptPath} and the workspace is ${workspace}.\nInspect current files and completion evidence, then continue autonomously through the connected Computer 2 MCP until the production gate passes.\nDo not restart from scratch, do not use Codex/Gemini/Claude coding CLIs, and do not stop for routine confirmation.`);
    log('Resumed existing authenticated ChatGPT build thread.');
  } else {
    await navigateChat('https://chatgpt.com/');
    await sendChatMessage(readFileSync(promptPath, 'utf8'));
    log('Submitted build contract to authenticated ChatGPT.');
  }
  const first = await readChatPage(16_000);
  chatThreadUrl = String(first.url || chatThreadUrl);
  if (!chatThreadUrl.startsWith('https://chatgpt.com/')) throw new Error('Authenticated ChatGPT handoff drifted to a non-ChatGPT tab.');
  writeFileSync(handoffPath, JSON.stringify({ buildId, url: chatThreadUrl, tabId: chatTabId, profileId: chatProfileId, submittedAt: new Date().toISOString() }), 'utf8');
  writeHeartbeat('chatgpt-running');
  const deadline = Date.now() + (110 * 60 * 1000);
  let loop = 0;
  while (Date.now() < deadline) {
    loop += 1;
    const evidence = readCompletion();
    if (evidence) {
      if (evidence.status === 'complete') {
        writeHeartbeat('complete');
        log('ChatGPT produced completion evidence.');
        return;
      }
      if (evidence.status === 'blocked') throw new Error('Build ended with a genuine user-only blocker.');
      if (evidence.status === 'failed') throw new Error('ChatGPT reported build failure.');
    }
    if (loop % 12 === 0) {
      try {
        const page = await readChatPage(18_000);
        chatThreadUrl = String(page.url || chatThreadUrl);
        const pageText = String(page.text || '');
        if (pageText) writeFileSync(lastMessagePath, pageText.slice(-12_000), 'utf8');
        if (/usage limit|message cap|try again after|reached .* limit/i.test(pageText)) throw new Error('ChatGPT rate limit prevented the autonomous build from continuing.');
        if (/something went wrong|there was an error generating|network error/i.test(pageText) && repairCount < 3) {
          repairCount += 1;
          await sendChatMessage(`Continue build ${buildId} from the existing workspace state. A recoverable ChatGPT/browser error occurred. Re-check the workspace and completion evidence, repair or retry the interrupted step through Computer 2 MCP, and continue autonomously.`);
          log('Retried ChatGPT after recoverable page error.');
        }
      } catch (error) {
        if (/rate limit/i.test(error instanceof Error ? error.message : String(error))) throw error;
        log(`ChatGPT status probe warning: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    writeHeartbeat('chatgpt-running');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('Authenticated ChatGPT worker timed out before producing completion evidence.');
}

try {
  await main();
} catch (error) {
  log(`Build worker failed: ${error instanceof Error ? error.message : String(error)}`);
  if (!validateOnly && heartbeatPath) writeHeartbeat('failed');
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closeClient();
}