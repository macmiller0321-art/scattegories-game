/* ─────────────────────────────────────────────────────────────
   State
───────────────────────────────────────────────────────────── */
const state = {
  socket: null,
  playerId: null,
  roomCode: null,
  playerName: null,
  myAnimal: null,

  // Current room snapshot
  players: [],
  host: null,
  categories: [],

  // Gameplay
  roundInfo: null,   // { round, letter, categories, timeLimit }
  timerMax: 75,
  answers: {},       // my answers: { [category]: string }
  submitted: false,

  // Voting
  allAnswers: {},    // { [playerId]: { [category]: string } }
  allVotes: {},      // { [targetPid]: { [category]: [rejectorId, …] } }
  voteTimerMax: 40,

  // Results
  answerStatus: {},  // { [playerId]: { [category]: status-string } }
};

const DEFAULT_CATEGORIES = [
  'Animals', 'Countries', 'Foods & Drinks', 'Movies', 'Famous People',
  'Cities', 'Things in a Kitchen', 'Clothing & Accessories', 'Occupations / Jobs', 'Sports',
];

/* ─────────────────────────────────────────────────────────────
   Socket
───────────────────────────────────────────────────────────── */
function connectSocket() {
  state.socket = io({ transports: ['websocket', 'polling'] });

  state.socket.on('room-created', ({ roomCode, playerId, animal }) => {
    state.roomCode = roomCode;
    state.playerId = playerId;
    state.myAnimal = animal;
  });

  state.socket.on('room-joined', ({ roomCode, playerId, animal }) => {
    state.roomCode = roomCode;
    state.playerId = playerId;
    state.myAnimal = animal;
  });

  state.socket.on('room-updated', (room) => {
    state.players  = room.players;
    state.host     = room.host;
    state.categories = room.categories;

    if (room.state === 'lobby') {
      showView('lobby');
      renderLobby(room);
    }
  });

  state.socket.on('join-error', ({ message }) => showToast(message, true));
  state.socket.on('player-left', ({ name, animal }) =>
    showToast(`${animal?.emoji ?? ''} ${name} left.`));
  state.socket.on('host-changed', ({ name, animal }) =>
    showToast(`${animal?.emoji ?? ''} ${name} is now the host.`));

  // ── Countdown ──────────────────────────────────────────────
  state.socket.on('countdown', ({ count, letter }) => {
    showView('countdown');
    const el = document.getElementById('countdown-number');
    el.textContent = count;
    // Restart CSS animation
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = '';

    const preview = document.getElementById('countdown-letter-preview');
    const sublabel = document.getElementById('countdown-sublabel');
    if (letter) {
      preview.style.display = 'block';
      preview.textContent = `Letter this round: ${letter}`;
      sublabel.textContent = 'Round starting…';
    } else {
      preview.style.display = 'none';
      sublabel.textContent = 'Get ready…';
    }
  });

  // ── Round start ────────────────────────────────────────────
  state.socket.on('round-start', (info) => {
    state.roundInfo  = info;
    state.answers    = {};
    state.submitted  = false;
    state.allAnswers = {};
    state.allVotes   = {};
    state.answerStatus = {};
    // Sync players list from event so scores are current going into the round
    if (info.players) state.players = info.players;

    renderPlaying(info);
    showView('playing');
    startClientTimer(info.timeLimit);
  });

  state.socket.on('timer', ({ timeLeft }) => updateTimer(timeLeft, state.timerMax));

  state.socket.on('submission-update', ({ count, total }) => {
    const el = document.getElementById('submission-waiting');
    if (el) el.innerHTML = `Waiting for other players… <strong>${count}/${total}</strong> submitted`;
  });

  // ── Voting start ───────────────────────────────────────────
  state.socket.on('voting-start', (data) => {
    state.allAnswers = data.answers;
    state.allVotes   = data.votes || {};
    if (data.players) state.players = data.players;

    renderVoting(data);
    showView('voting');
    startVoteTimer(data.voteTime);
  });

  state.socket.on('vote-timer', ({ timeLeft }) => updateVoteTimer(timeLeft));

  state.socket.on('votes-updated', ({ votes }) => {
    state.allVotes = votes;
    refreshVoteGrid();
  });

  // ── Round results ──────────────────────────────────────────
  state.socket.on('round-results', (data) => {
    state.answerStatus = data.answerStatus;
    state.allAnswers   = data.answers;
    state.players      = data.players;

    renderResults(data);
    showView('results');
  });

  // ── Game over ──────────────────────────────────────────────
  state.socket.on('game-over', (data) => {
    renderGameOver(data);
    showView('gameover');
  });
}

/* ─────────────────────────────────────────────────────────────
   View helpers
───────────────────────────────────────────────────────────── */
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
}

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3200);
}

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─────────────────────────────────────────────────────────────
   Lobby
───────────────────────────────────────────────────────────── */
function renderLobby(room) {
  document.getElementById('lobby-room-code').textContent = room.code || state.roomCode;

  const count = room.players.filter(p => p.connected).length;
  document.getElementById('lobby-player-count').textContent = `(${count}/${room.maxPlayers})`;

  // Player list
  const list = document.getElementById('lobby-player-list');
  list.innerHTML = room.players.map(p => `
    <div class="player-item ${p.connected ? '' : 'disconnected'}">
      <div class="animal-avatar">
        <span class="animal-emoji">${p.animal.emoji}</span>
        <span class="animal-name-label">${esc(p.animal.name)}</span>
      </div>
      <span class="player-item-name">${esc(p.name)}</span>
      ${p.id === room.host ? '<span class="badge-host">Host</span>' : ''}
      ${p.id === state.playerId ? '<span class="badge-you">You</span>' : ''}
    </div>
  `).join('');

  const isHost = room.host === state.playerId;
  document.getElementById('lobby-host-panel').style.display = isHost ? 'block' : 'none';
  document.getElementById('lobby-waiting-panel').style.display = isHost ? 'none' : 'block';
  document.getElementById('btn-start').style.display = isHost ? 'block' : 'none';

  if (isHost) {
    document.getElementById('setting-max-players').value = room.maxPlayers;
    renderCategoryEditor(room.categories);
  } else {
    // Show category preview for non-host players
    const previewSection = document.getElementById('lobby-category-preview');
    const previewList = document.getElementById('lobby-category-list');
    if (room.categories && room.categories.length) {
      previewSection.style.display = 'block';
      previewList.innerHTML = room.categories.map(c =>
        `<span class="category-chip">${esc(c)}</span>`
      ).join('');
    }
  }
}

function renderCategoryEditor(categories) {
  const grid = document.getElementById('category-editor-grid');
  grid.innerHTML = (categories || DEFAULT_CATEGORIES).map((cat, i) => `
    <div class="cat-editor-item">
      <span class="cat-number">${i + 1}</span>
      <input class="cat-editor-input" data-index="${i}"
        type="text" maxlength="60" value="${esc(cat)}"
        placeholder="Category ${i + 1}" autocomplete="off" />
    </div>
  `).join('');
}

function getEditorCategories() {
  return Array.from(document.querySelectorAll('.cat-editor-input'))
    .map(el => el.value.trim() || `Category ${parseInt(el.dataset.index) + 1}`);
}

/* ─────────────────────────────────────────────────────────────
   Scoreboard strip
───────────────────────────────────────────────────────────── */
function renderScoreboardStrip(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  el.innerHTML = sorted.map(p => `
    <div class="scoreboard-strip-item ${p.connected ? '' : 'disconnected'}">
      <span class="strip-emoji">${p.animal.emoji}</span>
      <span class="strip-name">${esc(p.name)}${p.id === state.playerId ? ' (you)' : ''}</span>
      <span class="strip-score">${p.score}</span>
    </div>
  `).join('');
}

/* ─────────────────────────────────────────────────────────────
   Playing view
───────────────────────────────────────────────────────────── */
function renderPlaying({ round, letter, categories, timeLimit }) {
  state.timerMax = timeLimit;

  document.getElementById('playing-round-label').textContent = `Round ${round}`;
  const badge = document.getElementById('playing-letter-badge');
  badge.textContent = letter;
  badge.className   = `letter-badge ${letterColorClass(round)}`;

  updateTimer(timeLimit, timeLimit);
  renderScoreboardStrip('playing-scoreboard');

  const grid = document.getElementById('category-inputs-grid');
  grid.innerHTML = categories.map(cat => `
    <div class="category-item">
      <div class="category-name">${esc(cat)}</div>
      <input class="category-input" type="text"
        placeholder="${letter}…" autocomplete="off" autocorrect="off" spellcheck="false"
        data-category="${esc(cat)}" />
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

let _clientTimerInterval = null;
function startClientTimer(seconds) {
  clearInterval(_clientTimerInterval);
  let t = seconds;
  _clientTimerInterval = setInterval(() => {
    t = Math.max(0, t - 1);
    updateTimer(t, seconds);
    if (t <= 0) clearInterval(_clientTimerInterval);
  }, 1000);
}

function updateTimer(timeLeft, max) {
  const bar  = document.getElementById('playing-timer-bar');
  const text = document.getElementById('playing-timer-text');
  if (!bar || !text) return;

  const pct = max > 0 ? (timeLeft / max) * 100 : 0;
  bar.style.width = `${pct}%`;

  const cls = timeLeft > max * 0.5 ? 'timer-green'
            : timeLeft > max * 0.25 ? 'timer-yellow' : 'timer-red';
  bar.className = `timer-bar-inner ${cls}`;
  text.className = `timer-text ${cls}`;
  text.textContent = timeLeft;
}

/* ─────────────────────────────────────────────────────────────
   Voting view
───────────────────────────────────────────────────────────── */
function renderVoting({ answers, votes, letter, categories, voteTime, players }) {
  state.voteTimerMax = voteTime;
  document.getElementById('voting-letter').textContent = letter;

  const isHost = state.host === state.playerId;
  document.getElementById('btn-finalize-voting').style.display = isHost ? 'inline-flex' : 'none';
  document.getElementById('voting-waiting-msg').style.display  = isHost ? 'none' : 'block';

  renderScoreboardStrip('voting-scoreboard');
  updateVoteTimer(voteTime);

  const wrap = document.getElementById('voting-grid-wrap');
  wrap.innerHTML = '';
  wrap.appendChild(buildAnswerGrid(categories, answers, votes, false));
}

function refreshVoteGrid() {
  if (!state.roundInfo) return;
  const wrap = document.getElementById('voting-grid-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  wrap.appendChild(buildAnswerGrid(
    state.roundInfo.categories,
    state.allAnswers,
    state.allVotes,
    false
  ));
}

let _voteTimerInterval = null;
function startVoteTimer(seconds) {
  clearInterval(_voteTimerInterval);
  let t = seconds;
  _voteTimerInterval = setInterval(() => {
    t = Math.max(0, t - 1);
    updateVoteTimer(t);
    if (t <= 0) clearInterval(_voteTimerInterval);
  }, 1000);
}

function updateVoteTimer(timeLeft) {
  const bar  = document.getElementById('vote-timer-bar');
  const text = document.getElementById('vote-timer-text');
  if (!bar || !text) return;
  const pct = (timeLeft / state.voteTimerMax) * 100;
  bar.style.width  = `${Math.max(0, pct)}%`;
  text.textContent = Math.max(0, timeLeft);
}

/* ─────────────────────────────────────────────────────────────
   Answer grid builder  (shared by voting + results)
───────────────────────────────────────────────────────────── */
function buildAnswerGrid(categories, answers, votes, showResults) {
  // Only show connected players (or players who answered)
  const players = state.players.filter(p => p.connected || answers[p.id]);

  const table = document.createElement('table');
  table.className = 'answers-grid';

  // ── Header row ──────────────────────────────────────────────
  const thead = table.createTHead();
  const hrow  = thead.insertRow();

  const catTh = document.createElement('th');
  catTh.textContent = 'Category';
  hrow.appendChild(catTh);

  players.forEach(p => {
    const th = document.createElement('th');
    th.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:1.4rem">${p.animal.emoji}</span>
        <span style="font-weight:700">${esc(p.name)}</span>
        ${p.id === state.playerId ? '<span class="badge-you" style="font-size:0.6rem">You</span>' : ''}
      </div>`;
    hrow.appendChild(th);
  });

  // ── Data rows ───────────────────────────────────────────────
  const tbody = table.createTBody();

  for (const cat of categories) {
    const tr = tbody.insertRow();

    const catTd = tr.insertCell();
    catTd.textContent = cat;

    for (const p of players) {
      const td = tr.insertCell();
      const raw = (answers[p.id]?.[cat] || '').trim();

      if (showResults) {
        // Results: show coloured status chip
        const status = state.answerStatus[p.id]?.[cat] || 'empty';
        const ptLabel = status === 'unique' ? '2 pts'
                      : status === 'duplicate' ? '1 pt' : null;
        td.innerHTML = `
          <div class="answer-cell">
            <span class="answer-text">${raw ? esc(raw) : '<span class="answer-empty">—</span>'}</span>
            <span class="status-chip status-${status}">
              ${statusIcon(status)} ${statusLabel(status, ptLabel)}
            </span>
          </div>`;
      } else {
        // Voting: show answer + reject button (for other players only)
        const rejectors = votes[p.id]?.[cat] || [];
        const others = state.players.filter(x => x.connected && x.id !== p.id);
        const rejected = others.length > 0 && rejectors.length > others.length / 2;
        const iRejected = rejectors.includes(state.playerId);

        let voteHtml = '';
        if (raw && p.id !== state.playerId) {
          voteHtml = `
            <button class="vote-reject-btn ${iRejected ? 'active' : ''}"
              data-pid="${p.id}" data-cat="${esc(cat)}">
              👎 ${iRejected ? 'Rejected' : 'Reject'}
            </button>
            ${rejectors.length > 0
              ? `<span class="vote-count-label">${rejectors.length} rejection${rejectors.length !== 1 ? 's' : ''}</span>`
              : ''}`;
        }

        td.innerHTML = `
          <div class="answer-cell ${rejected ? 'answer-rejected' : ''}">
            <span class="answer-text ${rejected ? 'status-voted-invalid' : ''}">
              ${raw ? esc(raw) : '<span class="answer-empty">—</span>'}
            </span>
            ${voteHtml}
          </div>`;
      }
    }
  }

  // Attach vote button listeners
  if (!showResults) {
    table.querySelectorAll('.vote-reject-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.socket.emit('cast-vote', {
          targetPlayerId: btn.dataset.pid,
          category: btn.dataset.cat,
        });
      });
    });
  }

  return table;
}

function statusIcon(status) {
  return { unique: '✓', duplicate: '⟳', 'voted-invalid': '✗', 'wrong-letter': '✗', empty: '—' }[status] || '';
}
function statusLabel(status, ptLabel) {
  if (ptLabel) return ptLabel;
  return { 'voted-invalid': 'rejected', 'wrong-letter': 'wrong letter', empty: 'no answer' }[status] || status;
}

/* ─────────────────────────────────────────────────────────────
   Results view
───────────────────────────────────────────────────────────── */
function renderResults({ pointsThisRound, answerStatus, answers, letter, categories, players }) {
  state.answerStatus = answerStatus;
  state.allAnswers   = answers;
  state.players      = players;

  document.getElementById('results-heading').textContent = `Round ${state.roundInfo?.round ?? ''} Complete!`;
  document.getElementById('results-letter').textContent  = letter;

  // Scoreboard
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const medals = ['🥇','🥈','🥉'];
  const sb = document.getElementById('results-scoreboard');
  sb.innerHTML = sorted.map((p, i) => `
    <div class="score-item">
      <span class="score-rank">${medals[i] || i + 1}</span>
      <span style="font-size:1.5rem">${p.animal.emoji}</span>
      <span class="score-name">${esc(p.name)} ${p.id === state.playerId ? '<span class="badge-you">You</span>' : ''}</span>
      <span class="score-delta">+${pointsThisRound[p.id] || 0} pts</span>
      <span class="score-total">${p.score}</span>
    </div>
  `).join('');

  // Answer breakdown
  const wrap = document.getElementById('results-grid-wrap');
  wrap.innerHTML = '';
  wrap.appendChild(buildAnswerGrid(categories, answers, {}, true));

  // Host controls
  const isHost = state.host === state.playerId;
  document.getElementById('results-host-controls').style.display = isHost ? 'flex' : 'none';
  document.getElementById('results-waiting-msg').style.display   = isHost ? 'none' : 'block';
}

/* ─────────────────────────────────────────────────────────────
   Game over view
───────────────────────────────────────────────────────────── */
function renderGameOver({ players }) {
  const medals = ['🥇','🥈','🥉'];
  document.getElementById('gameover-rounds-played').textContent =
    `${state.roundInfo?.round ?? '?'} round${(state.roundInfo?.round ?? 1) !== 1 ? 's' : ''} played`;

  const podium = document.getElementById('gameover-podium');
  podium.innerHTML = players.map((p, i) => `
    <div class="podium-item">
      <span class="podium-medal">${medals[i] ?? `#${i+1}`}</span>
      <span class="podium-emoji">${p.animal.emoji}</span>
      <span class="podium-name">${esc(p.name)} ${p.id === state.playerId ? '<span class="badge-you">You</span>' : ''}</span>
      <span class="podium-score">${p.score} pts</span>
    </div>
  `).join('');

  const isHost = state.host === state.playerId;
  document.getElementById('btn-play-again').style.display   = isHost ? 'inline-flex' : 'none';
  document.getElementById('gameover-waiting-msg').style.display = isHost ? 'none' : 'block';
}

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
function letterColorClass(round) {
  return `letter-colors-${(round - 1) % 5}`;
}

/* ─────────────────────────────────────────────────────────────
   DOM event listeners
───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  connectSocket();

  // Home — Create
  document.getElementById('btn-create').addEventListener('click', () => {
    const name = document.getElementById('home-name').value.trim();
    if (!name) { showToast('Enter your name first!', true); return; }
    state.playerName = name;
    state.socket.emit('create-room', { playerName: name });
  });

  // Home — Join
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

  // Lobby — Copy code
  document.getElementById('btn-copy-code').addEventListener('click', () => {
    const code = document.getElementById('lobby-room-code').textContent;
    navigator.clipboard.writeText(code)
      .then(() => showToast('Room code copied!'))
      .catch(() => showToast(code));  // fallback: just show it
  });

  // Lobby — Settings
  document.getElementById('setting-max-players').addEventListener('change', () => {
    state.socket.emit('update-settings', {
      maxPlayers: parseInt(document.getElementById('setting-max-players').value),
      categories: getEditorCategories(),
    });
  });

  // Lobby — Reset categories
  document.getElementById('btn-reset-categories').addEventListener('click', () => {
    renderCategoryEditor(DEFAULT_CATEGORIES);
    state.socket.emit('update-settings', {
      maxPlayers: parseInt(document.getElementById('setting-max-players').value),
      categories: [...DEFAULT_CATEGORIES],
    });
  });

  // Lobby — Start game
  document.getElementById('btn-start').addEventListener('click', () => {
    const categories = getEditorCategories();
    state.socket.emit('start-game', { categories });
  });

  // Playing — Submit answers
  document.getElementById('btn-submit-answers').addEventListener('click', submitAnswers);

  function submitAnswers() {
    if (state.submitted) return;
    state.submitted = true;
    clearInterval(_clientTimerInterval);

    document.querySelectorAll('.category-input').forEach(input => {
      state.answers[input.dataset.category] = input.value.trim();
      input.disabled = true;
    });

    document.getElementById('playing-form').style.display = 'none';
    document.getElementById('playing-submitted').style.display = 'block';

    state.socket.emit('submit-answers', { answers: state.answers });
  }

  // Voting — Finalize
  document.getElementById('btn-finalize-voting').addEventListener('click', () => {
    state.socket.emit('finalize-voting');
  });

  // Results — Next round
  document.getElementById('btn-next-round').addEventListener('click', () => {
    state.socket.emit('next-round');
  });

  // Results — End game
  document.getElementById('btn-end-game').addEventListener('click', () => {
    state.socket.emit('end-game');
  });

  // Game over — Play again
  document.getElementById('btn-play-again').addEventListener('click', () => {
    state.socket.emit('play-again');
  });
});
