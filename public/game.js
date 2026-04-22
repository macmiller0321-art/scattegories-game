/* ── State ──────────────────────────────────────────────────── */
const state = {
  socket: null,
  playerId: null,
  roomCode: null,
  playerName: null,
  players: [],
  host: null,
  settings: { rounds: 3, timeLimit: 120 },
  currentRound: 0,
  roundInfo: null,  // { round, totalRounds, letter, categories, timeLimit }
  timerMax: 120,
  answers: {},      // my current answers keyed by category
  submitted: false,
  allAnswers: {},   // { [playerId]: { [category]: answer } } during review/results
  allDisputes: {},  // { [playerId]: { [category]: [disputerIds] } }
  answerStatus: {}, // { [playerId]: { [category]: 'valid'|'duplicate'|... } }
  reviewTimerMax: 45,
};

/* ── Socket setup ───────────────────────────────────────────── */
function connectSocket() {
  state.socket = io();

  state.socket.on('room-created', ({ roomCode, playerId }) => {
    state.roomCode = roomCode;
    state.playerId = playerId;
  });

  state.socket.on('room-joined', ({ roomCode, playerId }) => {
    state.roomCode = roomCode;
    state.playerId = playerId;
  });

  state.socket.on('room-updated', (room) => {
    state.players = room.players;
    state.host = room.host;
    state.settings = room.settings;
    state.currentRound = room.currentRound;

    if (room.state === 'lobby') {
      showView('lobby');
      renderLobby(room);
    }
  });

  state.socket.on('join-error', ({ message }) => {
    showToast(message, true);
  });

  state.socket.on('player-left', ({ name }) => {
    showToast(`${name} left the game.`);
  });

  state.socket.on('countdown', ({ count }) => {
    showView('countdown');
    const el = document.getElementById('countdown-number');
    el.textContent = count;
    el.style.animation = 'none';
    el.offsetHeight; // reflow to restart animation
    el.style.animation = '';
    const meta = document.getElementById('countdown-meta');
    meta.textContent = state.roundInfo
      ? `Round ${state.roundInfo.round} of ${state.roundInfo.totalRounds} — Letter: ${state.roundInfo.letter}`
      : 'Get ready…';
  });

  state.socket.on('round-start', (info) => {
    state.roundInfo = info;
    state.answers = {};
    state.submitted = false;
    state.allAnswers = {};
    state.allDisputes = {};
    state.answerStatus = {};

    // update countdown meta in case it fires after countdown view
    const meta = document.getElementById('countdown-meta');
    meta.textContent = `Round ${info.round} of ${info.totalRounds} — Letter: ${info.letter}`;

    renderPlaying(info);
    showView('playing');
    startClientTimer(info.timeLimit);
  });

  state.socket.on('timer', ({ timeLeft }) => {
    updateTimer(timeLeft, state.timerMax);
  });

  state.socket.on('submission-update', ({ count, total }) => {
    const el = document.getElementById('submission-waiting');
    if (el) el.textContent = `Waiting for players… ${count}/${total} submitted`;
  });

  state.socket.on('round-ended', ({ answers, disputes, letter, categories }) => {
    state.allAnswers = answers;
    state.allDisputes = disputes || {};
    renderReview({ answers, disputes: state.allDisputes, letter, categories });
    showView('reviewing');
    startReviewTimer(state.reviewTimerMax);
  });

  state.socket.on('review-timer', ({ timeLeft }) => {
    updateReviewTimer(timeLeft);
  });

  state.socket.on('disputes-updated', ({ disputes }) => {
    state.allDisputes = disputes;
    refreshDisputeButtons();
  });

  state.socket.on('round-results', (data) => {
    state.answerStatus = data.answerStatus;
    state.allAnswers = data.answers;
    renderResults(data);
    showView('results');
  });

  state.socket.on('game-over', (data) => {
    state.answerStatus = data.answerStatus;
    state.allAnswers = data.answers;
    renderGameOver(data);
    showView('gameover');
  });
}

/* ── View management ────────────────────────────────────────── */
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
}

/* ── Toast ──────────────────────────────────────────────────── */
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.remove('show'), 3000);
}

/* ── Avatar helpers ─────────────────────────────────────────── */
function avatarInitial(name) { return (name || '?')[0].toUpperCase(); }
function avatarColor(idx) { return `avatar-colors-${idx % 8}`; }
function letterColor(round) { return `letter-colors-${(round - 1) % 5}`; }
function playerIndex(playerId) { return state.players.findIndex(p => p.id === playerId); }

/* ── Lobby rendering ────────────────────────────────────────── */
function renderLobby(room) {
  document.getElementById('lobby-room-code').textContent = room.code || state.roomCode;
  renderPlayerList('lobby-player-list', room.players, room.host);

  const isHost = room.host === state.playerId;
  document.getElementById('lobby-settings').style.display = isHost ? 'flex' : 'none';
  document.getElementById('lobby-waiting-msg').style.display = isHost ? 'none' : 'flex';
  document.getElementById('btn-start').style.display = isHost ? 'block' : 'none';

  if (isHost) {
    document.getElementById('setting-rounds').value = room.settings.rounds;
    document.getElementById('setting-time').value = room.settings.timeLimit;
  }
}

function renderPlayerList(containerId, players, hostId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = players.map((p, i) => `
    <div class="player-item ${p.connected ? '' : 'disconnected'}">
      <div class="player-avatar ${avatarColor(i)}">${avatarInitial(p.name)}</div>
      <span class="player-name">${esc(p.name)}</span>
      ${p.id === hostId ? '<span class="badge-host">Host</span>' : ''}
      ${p.id === state.playerId ? '<span class="badge-you">You</span>' : ''}
      ${containerId !== 'lobby-player-list' ? `<span class="player-score">${p.score}</span>` : ''}
    </div>
  `).join('');
}

/* ── Playing view ───────────────────────────────────────────── */
function renderPlaying({ round, totalRounds, letter, categories, timeLimit }) {
  state.timerMax = timeLimit;

  document.getElementById('playing-round-label').textContent = `Round ${round} of ${totalRounds}`;
  const badge = document.getElementById('letter-badge');
  badge.textContent = letter;
  badge.className = `letter-badge ${letterColor(round)}`;

  updateTimer(timeLimit, timeLimit);

  const grid = document.getElementById('category-grid');
  grid.innerHTML = categories.map(cat => `
    <div class="category-item">
      <div class="category-name">${esc(cat)}</div>
      <input
        class="category-input"
        type="text"
        placeholder="${letter}…"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        data-category="${esc(cat)}"
      />
    </div>
  `).join('');

  grid.querySelectorAll('.category-input').forEach(input => {
    input.addEventListener('input', e => {
      state.answers[e.target.dataset.category] = e.target.value;
    });
  });

  document.getElementById('playing-form').style.display = 'block';
  document.getElementById('playing-submitted').style.display = 'none';
}

let clientTimerInterval = null;
function startClientTimer(seconds) {
  clearInterval(clientTimerInterval);
  let t = seconds;
  updateTimer(t, seconds);
  clientTimerInterval = setInterval(() => {
    t--;
    if (t <= 0) { clearInterval(clientTimerInterval); t = 0; }
    updateTimer(t, seconds);
  }, 1000);
}

function updateTimer(timeLeft, max) {
  const bar = document.getElementById('timer-bar');
  const text = document.getElementById('timer-text');
  if (!bar || !text) return;

  const pct = max > 0 ? (timeLeft / max) * 100 : 0;
  bar.style.width = `${pct}%`;

  const cls = timeLeft > max * 0.5 ? 'timer-green' : timeLeft > max * 0.25 ? 'timer-yellow' : 'timer-red';
  bar.className = `timer-bar-inner ${cls}`;
  text.className = `timer-text ${cls}`;
  text.textContent = timeLeft;
}

/* ── Review view ────────────────────────────────────────────── */
function renderReview({ answers, disputes, letter, categories }) {
  const isHost = state.host === state.playerId;
  document.getElementById('review-finalize-btn').style.display = isHost ? 'inline-flex' : 'none';
  document.getElementById('review-waiting-msg').style.display = isHost ? 'none' : 'block';
  document.getElementById('review-letter').textContent = letter;
  updateReviewTimer(state.reviewTimerMax);

  const table = buildAnswerTable(categories, answers, disputes, false);
  const wrap = document.getElementById('review-table-wrap');
  wrap.innerHTML = '';
  wrap.appendChild(table);
}

function buildAnswerTable(categories, answers, disputes, showStatus) {
  const players = state.players.filter(p => p.connected || answers[p.id]);

  const table = document.createElement('table');
  table.className = 'answers-table';

  // Header
  const thead = table.createTHead();
  const hr = thead.insertRow();
  const catTh = document.createElement('th');
  catTh.textContent = 'Category';
  hr.appendChild(catTh);
  players.forEach((p, i) => {
    const th = document.createElement('th');
    th.innerHTML = `<span class="player-avatar ${avatarColor(playerIndex(p.id))}" style="display:inline-flex;width:22px;height:22px;font-size:0.7rem;border-radius:50%;align-items:center;justify-content:center;margin-right:6px">${avatarInitial(p.name)}</span>${esc(p.name)}${p.id === state.playerId ? ' <span class="badge-you">You</span>' : ''}`;
    hr.appendChild(th);
  });

  // Rows
  const tbody = table.createTBody();
  categories.forEach(cat => {
    const tr = tbody.insertRow();
    const catTd = tr.insertCell();
    catTd.textContent = cat;
    catTd.style.fontWeight = '600';

    players.forEach(p => {
      const td = tr.insertCell();
      const raw = (answers[p.id]?.[cat] || '').trim();
      const status = showStatus ? (state.answerStatus[p.id]?.[cat] || 'empty') : null;
      const disputeList = disputes?.[p.id]?.[cat] || [];
      const iDisputedThis = disputeList.includes(state.playerId);

      let statusClass = '';
      let statusLabel = '';
      if (showStatus && status) {
        statusClass = `status-${status}`;
        const labels = { valid: '✓ valid', duplicate: '⟳ duplicate', disputed: '✗ disputed', 'wrong-letter': '✗ wrong letter', empty: '—' };
        statusLabel = `<div class="${statusClass}" style="font-size:0.75rem">${labels[status] || ''}</div>`;
      }

      let disputeBtn = '';
      if (!showStatus && raw && p.id !== state.playerId) {
        const active = iDisputedThis ? 'active' : '';
        const count = disputeList.length;
        disputeBtn = `
          <button class="dispute-btn ${active}" data-pid="${p.id}" data-cat="${esc(cat)}">
            ${iDisputedThis ? '✗ challenged' : '? challenge'}
          </button>
          ${count > 0 ? `<span class="dispute-count">${count} challenge${count !== 1 ? 's' : ''}</span>` : ''}
        `;
      }

      td.innerHTML = `
        <div class="answer-cell">
          <span class="answer-text ${statusClass}">${raw ? esc(raw) : '<span class="muted">—</span>'}</span>
          ${statusLabel}
          ${disputeBtn}
        </div>
      `;
    });
  });

  // Attach dispute listeners
  if (!showStatus) {
    table.querySelectorAll('.dispute-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.pid;
        const cat = btn.dataset.cat;
        state.socket.emit('dispute-answer', { targetPlayerId: pid, category: cat });
      });
    });
  }

  return table;
}

function refreshDisputeButtons() {
  // Re-render the review table with updated dispute state
  if (state.roundInfo) {
    const wrap = document.getElementById('review-table-wrap');
    if (!wrap) return;
    const table = buildAnswerTable(
      state.roundInfo.categories,
      state.allAnswers,
      state.allDisputes,
      false
    );
    wrap.innerHTML = '';
    wrap.appendChild(table);
  }
}

let reviewTimerInterval = null;
function startReviewTimer(seconds) {
  clearInterval(reviewTimerInterval);
  let t = seconds;
  reviewTimerInterval = setInterval(() => {
    t--;
    updateReviewTimer(t);
    if (t <= 0) clearInterval(reviewTimerInterval);
  }, 1000);
}

function updateReviewTimer(timeLeft) {
  const bar = document.getElementById('review-timer-bar');
  if (!bar) return;
  const pct = (timeLeft / state.reviewTimerMax) * 100;
  bar.style.width = `${Math.max(0, pct)}%`;
  const label = document.getElementById('review-timer-label');
  if (label) label.textContent = Math.max(0, timeLeft);
}

/* ── Results view ───────────────────────────────────────────── */
function renderResults({ pointsThisRound, answerStatus, answers, letter, categories, players, isLastRound }) {
  state.answerStatus = answerStatus;
  state.allAnswers = answers;

  const sorted = [...players].sort((a, b) => b.score - a.score);
  const list = document.getElementById('results-score-list');
  const medals = ['🥇','🥈','🥉'];
  list.innerHTML = sorted.map((p, i) => `
    <div class="score-row">
      <div class="score-rank">${medals[i] || (i + 1)}</div>
      <div class="player-avatar ${avatarColor(playerIndex(p.id))}" style="width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:0.85rem;flex-shrink:0">
        ${avatarInitial(p.name)}
      </div>
      <div class="score-name">${esc(p.name)} ${p.id === state.playerId ? '<span class="badge-you">You</span>' : ''}</div>
      <div class="score-pts-this-round">+${pointsThisRound[p.id] || 0} pts</div>
      <div class="score-total">${p.score}</div>
    </div>
  `).join('');

  const isHost = state.host === state.playerId;
  document.getElementById('btn-next-round').style.display = isHost ? 'inline-flex' : 'none';
  document.getElementById('results-waiting-msg').style.display = isHost ? 'none' : 'block';

  document.getElementById('results-round-label').textContent =
    isLastRound ? 'Final Round Complete!' : `Round ${state.currentRound} Complete!`;

  // Show answers breakdown below
  const wrap = document.getElementById('results-answers-wrap');
  wrap.innerHTML = '<h3 style="margin-bottom:12px">Answer Review</h3>';
  wrap.appendChild(buildAnswerTable(categories, answers, {}, true));
}

/* ── Game over view ─────────────────────────────────────────── */
function renderGameOver({ players, answerStatus, answers, letter, categories }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const medals = ['🥇','🥈','🥉'];

  const podium = document.getElementById('gameover-podium');
  podium.innerHTML = sorted.map((p, i) => `
    <div class="podium-item">
      <div class="podium-medal">${medals[i] || `#${i + 1}`}</div>
      <div class="player-avatar ${avatarColor(playerIndex(p.id))}" style="width:40px;height:40px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:1rem;flex-shrink:0">
        ${avatarInitial(p.name)}
      </div>
      <div class="podium-name">${esc(p.name)} ${p.id === state.playerId ? '<span class="badge-you">You</span>' : ''}</div>
      <div class="podium-score">${p.score} pts</div>
    </div>
  `).join('');

  const isHost = state.host === state.playerId;
  document.getElementById('btn-play-again').style.display = isHost ? 'inline-flex' : 'none';
  document.getElementById('gameover-waiting-msg').style.display = isHost ? 'none' : 'block';

  if (answerStatus && answers && categories) {
    state.answerStatus = answerStatus;
    state.allAnswers = answers;
    const wrap = document.getElementById('gameover-answers-wrap');
    wrap.innerHTML = '<h3 style="margin:16px 0 12px">Final Round Answers</h3>';
    wrap.appendChild(buildAnswerTable(categories, answers, {}, true));
  }
}

/* ── HTML escape ────────────────────────────────────────────── */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── DOM event listeners ────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  connectSocket();

  /* Home — Create */
  document.getElementById('btn-create').addEventListener('click', () => {
    const name = document.getElementById('home-name').value.trim();
    if (!name) { showToast('Enter your name first!', true); return; }
    state.playerName = name;
    state.socket.emit('create-room', { playerName: name });
  });

  /* Home — Join */
  document.getElementById('btn-join').addEventListener('click', joinRoom);
  document.getElementById('home-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
  document.getElementById('home-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-create').click();
  });

  function joinRoom() {
    const name = document.getElementById('home-name').value.trim();
    const code = document.getElementById('home-code').value.trim().toUpperCase();
    if (!name) { showToast('Enter your name first!', true); return; }
    if (!code) { showToast('Enter a room code!', true); return; }
    state.playerName = name;
    state.socket.emit('join-room', { playerName: name, roomCode: code });
  }

  /* Lobby — Copy code */
  document.getElementById('btn-copy-code').addEventListener('click', () => {
    const code = document.getElementById('lobby-room-code').textContent;
    navigator.clipboard.writeText(code).then(() => showToast('Room code copied!')).catch(() => {});
  });

  /* Lobby — Settings */
  document.getElementById('setting-rounds').addEventListener('change', sendSettings);
  document.getElementById('setting-time').addEventListener('change', sendSettings);
  function sendSettings() {
    state.socket.emit('update-settings', {
      rounds: parseInt(document.getElementById('setting-rounds').value),
      timeLimit: parseInt(document.getElementById('setting-time').value),
    });
  }

  /* Lobby — Start */
  document.getElementById('btn-start').addEventListener('click', () => {
    state.socket.emit('start-game');
  });

  /* Playing — Submit */
  document.getElementById('btn-submit-answers').addEventListener('click', submitAnswers);

  function submitAnswers() {
    if (state.submitted) return;
    state.submitted = true;
    clearInterval(clientTimerInterval);

    // Collect from inputs
    document.querySelectorAll('.category-input').forEach(input => {
      state.answers[input.dataset.category] = input.value.trim();
      input.disabled = true;
    });

    document.getElementById('playing-form').style.display = 'none';
    const sub = document.getElementById('playing-submitted');
    sub.style.display = 'block';
    document.getElementById('submission-waiting').textContent = 'Waiting for other players…';

    state.socket.emit('submit-answers', { answers: state.answers });
  }

  /* Review — Finalize */
  document.getElementById('review-finalize-btn').addEventListener('click', () => {
    state.socket.emit('finalize-round');
  });

  /* Results — Next Round */
  document.getElementById('btn-next-round').addEventListener('click', () => {
    state.socket.emit('next-round');
  });

  /* Game Over — Play Again */
  document.getElementById('btn-play-again').addEventListener('click', () => {
    state.socket.emit('play-again');
  });

  /* Game Over / Results — Back to lobby (go home) via play-again flow */
});
