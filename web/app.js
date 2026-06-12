/* Synapse 调试页面 — 逻辑 */

// ========== STATE ==========
var messages = [];
var isStreaming = false;

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('apiBase').value = localStorage.getItem('tb_apiBase') || 'http://localhost:5890/v1';
  document.getElementById('apiKey').value = localStorage.getItem('tb_apiKey') || '';
  document.getElementById('systemPrompt').value = localStorage.getItem('tb_sysPrompt') || '你是一个有用的 AI 助手。';

  ['modelSelect'].forEach(function(id) { document.getElementById(id).addEventListener('change', saveSettings); });
  ['apiBase','apiKey','systemPrompt'].forEach(function(id) { document.getElementById(id).addEventListener('input', saveSettings); });

  document.getElementById('apiBase').addEventListener('input', function() { clearTimeout(window._ht); window._ht = setTimeout(window.checkHealth, 500); });
  document.getElementById('apiKey').addEventListener('input', function() { clearTimeout(window._ht); window._ht = setTimeout(window.checkHealth, 500); });

  window.checkHealth();
  loadModels();
  connectWs();
});

function saveSettings() {
  localStorage.setItem('tb_apiBase', document.getElementById('apiBase').value);
  localStorage.setItem('tb_apiKey', document.getElementById('apiKey').value);
  localStorage.setItem('tb_sysPrompt', document.getElementById('systemPrompt').value);
}

// ========== MODELS ==========
function loadModels() {
  var base = document.getElementById('apiBase').value;
  var key = document.getElementById('apiKey').value;
  var select = document.getElementById('modelSelect');
  var saved = localStorage.getItem('tb_model') || 'auto';
  fetch(base + '/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(5000) })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function(d) {
      select.innerHTML = '<option value="auto">auto (智能路由)</option>';
      (d.data||[]).forEach(function(m) { if (m.id!=='auto') select.innerHTML += '<option value="'+m.id+'">'+m.id+'</option>'; });
      if ([].some.call(select.options, function(o){return o.value===saved})) select.value = saved;
    }).catch(function(){});
}

// ========== HEALTH ==========
window.checkHealth = function() {
  var dot = document.getElementById('statusDot'), text = document.getElementById('statusText');
  if (!dot || !text) return;
  var base = document.getElementById('apiBase').value, key = document.getElementById('apiKey').value;
  dot.className = 'status-dot'; text.textContent = '检测中...';
  var h = key ? { Authorization: 'Bearer ' + key } : {};
  fetch(base.replace(/\/$/,'') + '/models', { headers: h, signal: AbortSignal.timeout(5000) })
    .then(function(r) { if (!r.ok) throw Error('HTTP '+r.status); return r.json(); })
    .then(function(d) { dot.className = 'status-dot online'; text.textContent = '已连接 (' + (d.data||[]).length + ' 模型)'; loadModels(); })
    .catch(function(e) { dot.className = 'status-dot offline'; text.textContent = '未连接'; });
};

// ========== THINKING INDICATOR ==========
var _thinkingDiv = null;
function showThinking() {
  removeThinking();
  var div = document.createElement('div');
  div.className = 'msg assistant thinking-msg';
  div.innerHTML = '<span style="color:var(--text3)">思考中</span> <span class="typing-dot">.</span><span class="typing-dot">.</span><span class="typing-dot">.</span>';
  document.getElementById('chatArea').appendChild(div);
  scrollDown();
  _thinkingDiv = div;
}
function removeThinking() {
  if (_thinkingDiv) { _thinkingDiv.remove(); _thinkingDiv = null; }
}

// ========== MESSAGES ==========
function addMsg(role, content) {
  var div = document.createElement('div'); div.className = 'msg ' + role; div.textContent = content;
  document.getElementById('chatArea').appendChild(div); scrollDown(); return div;
}
function addSysMsg(content) {
  var div = document.createElement('div'); div.className = 'msg system'; div.textContent = content;
  document.getElementById('chatArea').appendChild(div); scrollDown();
}

// ========== TOOL CARD ==========
function addToolCard(name, status, preview, rawCall) {
  var fullText = (preview||'').replace(/\\n/g, '\n');
  var shortText = fullText.slice(0, 200);
  var isLong = fullText.length > 200;
  var ok = status === 'ok';
  var card = document.createElement('div');
  card.className = 'tool-card ' + (ok ? 'success' : 'fail');
  var icon = ok ? '✅' : '❌';
  var label = ok ? 'success' : 'fail';

  var header = document.createElement('div');
  header.className = 'tool-card-header';
  header.innerHTML =
    '<span class="icon">' + icon + '</span>' +
    '<span class="name">TOOL: ' + name + '</span>' +
    '<span class="status ' + status + '">' + label + '</span>' +
    (isLong ? '<span class="expand-hint">展开▼</span>' : '') +
    '<span class="chevron">▶</span>';

  var body = document.createElement('div');
  body.className = 'tool-card-body';
  var rawHtml = rawCall ? '<pre style=\"color:var(--text3);font-size:11px;margin-bottom:6px\">' + rawCall.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre>' : '';
  body.innerHTML = rawHtml + '<pre>' + (isLong ? shortText : fullText) + '</pre>';

  card.appendChild(header);
  card.appendChild(body);
  card._full = fullText;
  card._short = shortText;
  card._isLong = isLong;

  // 默认展开
  card.classList.add('open');
  var chev = header.querySelector('.chevron');
  if (chev) chev.textContent = '▼';
  if (isLong) {
    var hint = header.querySelector('.expand-hint');
    if (hint) hint.textContent = '收起▲';
  }

  header.addEventListener('click', function() {
    var open = card.classList.toggle('open');
    var pre = body.querySelector('pre');
    var hint = header.querySelector('.expand-hint');
    var ch = header.querySelector('.chevron');
    if (isLong) {
      pre.textContent = open ? fullText : shortText;
      if (hint) hint.textContent = open ? '收起▲' : '展开▼';
    }
    if (ch) ch.textContent = open ? '▼' : '▶';
  });

  // 5 秒后自动折叠
  setTimeout(function() {
    if (card.classList.contains('open')) header.click();
  }, 5000);

  document.getElementById('chatArea').appendChild(card);
  scrollDown();
  return card;
}

function scrollDown() {
  var ca = document.getElementById('chatArea');
  var atBottom = ca.scrollHeight - ca.scrollTop - ca.clientHeight < 80;
  if (atBottom) ca.scrollTop = ca.scrollHeight;
}

// ========== SEND ==========
async function sendMessage() {
  if (isStreaming) return;
  var input = document.getElementById('userInput');
  var content = input.value.trim(); if (!content) return;
  input.value = ''; input.style.height = 'auto';
  addMsg('user', content); messages.push({role:'user',content:content});

  isStreaming = true;
  document.getElementById('sendBtn').disabled = true;
  try { await streamChat(content); } catch(e) { addSysMsg('错误: ' + e.message); }
  isStreaming = false;
  document.getElementById('sendBtn').disabled = false;
  document.getElementById('userInput').focus();
}

async function streamChat(userContent) {
  var apiBase = document.getElementById('apiBase').value, apiKey = document.getElementById('apiKey').value;
  var model = document.getElementById('modelSelect').value, sysPrompt = document.getElementById('systemPrompt').value;
  var body = { model: model, messages: [{role:'system',content:sysPrompt},...messages.slice(-20)], stream: true };
  var resp = await fetch(apiBase + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(body)
  });
  if (!resp.ok) { var e = await resp.text(); throw Error('HTTP '+resp.status+': '+e.slice(0,200)); }

  showThinking();
  var reader = resp.body.getReader(), decoder = new TextDecoder('utf-8');
  var buf = '', aiDiv = null, fullContent = '', firstToken = true;
  var toolBuf = '';

  while (true) {
    var done_read = await reader.read();
    if (done_read.done) break;
    buf += decoder.decode(done_read.value, {stream:true});
    var lines = buf.split('\n'); buf = lines.pop()||'';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.startsWith('data: ')) continue;
      var data = line.slice(6); if (data === '[DONE]') continue;
      try {
        var chunk = JSON.parse(data), delta = chunk.choices[0].delta.content || '';
        if (!delta) continue;

        // Tool card: 🔧TOOL{json}
        var MARKER = '🔧TOOL';
        if (delta.indexOf(MARKER) !== -1 || toolBuf) {
          var src = toolBuf + delta;
          var idx = src.indexOf(MARKER);
          if (idx !== -1) {
            var prefix = src.slice(0, idx);
            var jsonStr = src.slice(idx + MARKER.length);
            try {
              var card = JSON.parse(jsonStr);
              if (card && card.t) {
                addToolCard(card.t, card.s, card.p || '', card.r || '');
              }
              delta = prefix;
              toolBuf = '';
            } catch(_) {
              toolBuf = src.slice(idx);
              delta = prefix;
            }
          }
          if (!delta || !delta.trim()) continue;
        }

        if (firstToken) { removeThinking(); firstToken = false; }
        if (!aiDiv) aiDiv = addMsg('assistant', '');
        fullContent += delta; aiDiv.textContent = fullContent; scrollDown();
      } catch(_){}
    }
  }
  removeThinking();
  if (fullContent) messages.push({role:'assistant',content:fullContent});
}

function newSession() { messages=[]; document.getElementById('chatArea').innerHTML=''; addSysMsg('新对话'); }
function clearAll() { if (confirm('确定清空？')) { messages=[]; document.getElementById('chatArea').innerHTML=''; addSysMsg('已清空'); }}

// ========== WebSocket ==========
var _ws = null;
function connectWs() {
  var key = document.getElementById('apiKey').value;
  if (!key) { setTimeout(connectWs, 3000); return; }
  var base = document.getElementById('apiBase').value.replace(/\/$/,'').replace('/v1','');
  var wsUrl = base.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws?token=' + encodeURIComponent(key);
  try {
    _ws = new WebSocket(wsUrl);
    _ws.onopen = function() { updateWsStatus(true); };
    _ws.onclose = function() { updateWsStatus(false); setTimeout(connectWs, 5000); };
    _ws.onerror = function() { _ws.close(); };
    _ws.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'tool_result') {
          addToolCard(msg.name, msg.status, msg.content, msg.raw || '');
        }
      } catch(_) {}
    };
  } catch(_) { setTimeout(connectWs, 5000); }
}

function updateWsStatus(connected) {
  var dot = document.getElementById('wsDot');
  if (dot) dot.className = 'status-dot ' + (connected ? 'online' : 'offline');
  var text = document.getElementById('wsText');
  if (text) text.textContent = connected ? 'WS 已连接' : 'WS 断开';
}
