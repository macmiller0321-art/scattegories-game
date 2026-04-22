/* ─────────────────────────────────────────────────────────────
   State
───────────────────────────────────────────────────────────── */
const ANIMALS = [
  { name: 'Fox',       emoji: '🦊' },
  { name: 'Panda',     emoji: '🐼' },
  { name: 'Lion',      emoji: '🦁' },
  { name: 'Owl',       emoji: '🦉' },
  { name: 'Penguin',   emoji: '🐧' },
  { name: 'Tiger',     emoji: '🐯' },
  { name: 'Bear',      emoji: '🐻' },
  { name: 'Wolf',      emoji: '🐺' },
  { name: 'Rabbit',    emoji: '🐰' },
  { name: 'Koala',     emoji: '🐨' },
  { name: 'Cat',       emoji: '🐱' },
  { name: 'Dog',       emoji: '🐶' },
  { name: 'Frog',      emoji: '🐸' },
  { name: 'Turtle',    emoji: '🐢' },
  { name: 'Shark',     emoji: '🦈' },
  { name: 'Dragon',    emoji: '🐲' },
  { name: 'Unicorn',   emoji: '🦄' },
  { name: 'Raccoon',   emoji: '🦝' },
  { name: 'Hedgehog',  emoji: '🦔' },
  { name: 'Butterfly', emoji: '🦋' },
];

const state = {
  socket: null,
  playerId: null,
  roomCode: null,
  playerName: null,
  myAnimal: null,
  selectedAnimal: ANIMALS[0].name,

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

const CATEGORY_POOL = [
  // Classic
  'Animals', 'Countries', 'Cities', 'Foods & Drinks', 'Movies',
  'Famous People', 'Sports', 'TV Shows', 'Books', 'Colors',
  // Nature & science
  'Flowers', 'Trees & Plants', 'Things in the Ocean', 'Things in Space',
  'Types of Weather', 'Things in a Jungle', 'Insects & Bugs',
  'Scientists & Inventors',
  // Around the house
  'Things in a Kitchen', 'Things in a Bedroom', 'Things in a Bathroom',
  'Things in a Garage', 'Things you find in a Junk Drawer',
  'Things in a Backpack',
  // Food & drink
  'Breakfast Foods', 'Desserts', 'Pizza Toppings', 'Cocktails & Drinks',
  'Fast Food Items', 'Ice Cream Flavors', 'Snacks', 'Types of Pasta',
  'Things on a BBQ',
  // Pop culture
  'Superheroes', 'Disney Movies', 'Disney Characters', 'Video Games',
  'Board Games', 'Cartoon Characters', 'Song Titles', 'Band & Artist Names',
  'Reality TV Shows', 'Game Shows', 'Villains',
  // Fashion
  'Clothing & Accessories', 'Types of Shoes', 'Types of Hats', 'Jewelry',
  // Work & school
  'Occupations / Jobs', 'Things in an Office', 'School Subjects',
  'Things in a Hospital',
  // Fun & silly
  'Things that are Sticky', 'Things that Fly', 'Things that are Round',
  'Things that are Loud', 'Things that Glow', 'Things that are Freezing Cold',
  'Things you do when Bored', 'Excuses for Being Late',
  'Things at a Party', 'Things at the Beach', 'Things at a Wedding',
  'Things in a Haunted House', 'Things in a Fairy Tale',
  // Imagination
  'Mythical Creatures', 'Superpowers', 'Magic Spells', 'Phobias',
  'Nicknames', 'Things from the Future', 'Things a Pirate would say',
  // Misc
  'Car Brands', 'Musical Instruments', 'Olympic Sports',
  'Historical Figures', 'US States', 'Things in a Museum',
  'Dance Styles', 'Things that are Expensive',
];

function shuffleCategories() {
  const pool = [...CATEGORY_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 10);
}

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

  // ── Collect answers (server timer just hit 0) ──────────────
  // Flush whatever the player has typed, whether or not they hit Submit Early.
  state.socket.on('collect-answers', () => {
    clearInterval(_clientTimerInterval);
    updateTimer(0, state.timerMax);

    // Read any values that haven't been synced to state yet
    document.querySelectorAll('.category-input').forEach(input => {
      const val = input.value.trim();
      if (val) state.answers[input.dataset.category] = val;
      input.disabled = true;
    });

    if (!state.submitted) {
      state.submitted = true;
      document.getElementById('playing-form').style.display = 'none';
      document.getElementById('playing-submitted').style.display = 'block';
      document.getElementById('submission-waiting').textContent = "Time's up! Locking in answers…";
    }

    // Always re-send so the server has the latest values
    state.socket.emit('submit-answers', { answers: state.answers });
  });

  state.socket.on('submission-update', ({ count, total }) => {
    const el = document.getElementById('submission-waiting');
    if (el) el.innerHTML = `Waiting for other players… <strong>${count}/${total}</strong> submitted`;
  });

  // ── Voting start ───────────────────────────────────────────
  state.socket.on('voting-start', (data) => {
    state.allAnswers = data.answers;
    state.allVotes   = data.votes || {};
    if (data.players) state.players = data.players;

    showView('voting');
    try { renderVoting(data); } catch(e) { console.error('renderVoting error:', e); }
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

    showView('results');
    try { renderResults(data); } catch(e) { console.error('renderResults error:', e); }
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

function renderAnimalPicker() {
  const grid = document.getElementById('animal-picker');
  grid.innerHTML = ANIMALS.map(a => `
    <button class="animal-pick-btn ${a.name === state.selectedAnimal ? 'selected' : ''}"
      data-name="${a.name}" type="button" title="${a.name}">
      <span class="animal-pick-emoji">${a.emoji}</span>
      <span class="animal-pick-name">${a.name}</span>
    </button>
  `).join('');
  grid.querySelectorAll('.animal-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedAnimal = btn.dataset.name;
      grid.querySelectorAll('.animal-pick-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
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
    document.getElementById('setting-round-time').value = room.roundTime || 75;
    renderCategoryEditor(room.categories);
  } else {
    // Show round time and category preview for non-host players
    const rtEl = document.getElementById('lobby-round-time-preview');
    if (rtEl && room.roundTime) {
      rtEl.textContent = `Round duration: ${room.roundTime} seconds`;
      rtEl.style.display = 'block';
    }
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
function renderPlaying({ round, totalRounds, letter, categories, timeLimit }) {
  state.timerMax = timeLimit;

  document.getElementById('playing-round-label').textContent = `Round ${round} of ${totalRounds}`;
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
  wrap.appendChild(buildVotingCards(categories, answers, votes));
}

function refreshVoteGrid() {
  if (!state.roundInfo) return;
  const wrap = document.getElementById('voting-grid-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  wrap.appendChild(buildVotingCards(
    state.roundInfo.categories,
    state.allAnswers,
    state.allVotes,
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
   Voting cards  — category sections with side-by-side answer cards
───────────────────────────────────────────────────────────── */
function buildVotingCards(categories, answers, votes) {
  // Include every connected player plus anyone whose answers arrived
  const players = state.players.filter(p => p.connected || answers[p.id]);

  const frag = document.createDocumentFragment();

  for (const cat of categories) {
    const section = document.createElement('div');
    section.className = 'vote-section';

    section.innerHTML = `
      <div class="vote-section-header">
        <span class="vote-section-name">${esc(cat)}</span>
        <span class="vote-section-letter">Letter: ${esc(state.roundInfo?.letter ?? '')}</span>
      </div>`;

    const row = document.createElement('div');
    row.className = 'vote-answers-row';

    for (const p of players) {
      const raw      = (answers[p.id]?.[cat] || '').trim();
      const isOwn    = p.id === state.playerId;
      const rejectors = votes[p.id]?.[cat] || [];
      const others   = players.filter(x => x.id !== p.id);
      const majorityRejected = others.length > 0 && rejectors.length > others.length / 2;
      const iChallenged = rejectors.includes(state.playerId);

      const card = document.createElement('div');
      card.className = [
        'vote-answer-card',
        isOwn ? 'is-own' : '',
        majorityRejected ? 'is-challenged-majority' : '',
      ].filter(Boolean).join(' ');

      let actionHtml = '';
      if (isOwn) {
        actionHtml = `<span class="vote-own-label">Your answer</span>`;
      } else if (raw) {
        actionHtml = `
          <button class="vote-toggle-btn ${iChallenged ? 'vote-challenged' : 'vote-accepted'}"
            data-pid="${p.id}" data-cat="${esc(cat)}">
            ${iChallenged ? '❌ Challenged' : '✅ Looks good'}
          </button>
          ${rejectors.length > 0
            ? `<div class="vote-challenge-count">${rejectors.length} player${rejectors.length !== 1 ? 's' : ''} challenged</div>`
            : ''}`;
      } else {
        actionHtml = `<span class="vote-own-label">No answer</span>`;
      }

      card.innerHTML = `
        <div class="vote-player-tag">
          <span class="vote-player-emoji">${p.animal.emoji}</span>
          <span>${esc(p.name)}${isOwn ? ' (you)' : ''}</span>
        </div>
        <div class="vote-answer-text ${!raw ? 'is-empty' : ''} ${majorityRejected && raw ? 'is-strikethrough' : ''}">
          ${raw ? esc(raw) : '—'}
        </div>
        ${actionHtml}
      `;

      row.appendChild(card);
    }

    section.appendChild(row);
    frag.appendChild(section);
  }

  // Attach toggle listeners after building the fragment
  frag.querySelectorAll('.vote-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.socket.emit('cast-vote', {
        targetPlayerId: btn.dataset.pid,
        category: btn.dataset.cat,
      });
    });
  });

  return frag;
}

/* ─────────────────────────────────────────────────────────────
   Results cards  — same layout, vote buttons replaced by status badges
───────────────────────────────────────────────────────────── */
function buildResultsCards(categories, answers, answerStatus) {
  const players = state.players.filter(p => p.connected || answers[p.id]);

  const BADGE = {
    unique:        { cls: 'badge-unique',        icon: '✓', text: 'Unique — 2 pts' },
    duplicate:     { cls: 'badge-duplicate',      icon: '⟳', text: 'Duplicate — 1 pt' },
    'voted-invalid':{ cls: 'badge-voted-invalid', icon: '✗', text: 'Challenged — 0 pts' },
    'wrong-letter':{ cls: 'badge-wrong-letter',   icon: '✗', text: 'Wrong letter — 0 pts' },
    empty:         { cls: 'badge-empty',          icon: '—', text: 'No answer' },
  };

  const frag = document.createDocumentFragment();

  for (const cat of categories) {
    const section = document.createElement('div');
    section.className = 'vote-section';
    section.innerHTML = `
      <div class="vote-section-header">
        <span class="vote-section-name">${esc(cat)}</span>
      </div>`;

    const row = document.createElement('div');
    row.className = 'vote-answers-row';

    for (const p of players) {
      const raw    = (answers[p.id]?.[cat] || '').trim();
      const status = answerStatus[p.id]?.[cat] || 'empty';
      const badge  = BADGE[status] || BADGE.empty;
      const isOwn  = p.id === state.playerId;

      const card = document.createElement('div');
      card.className = `vote-answer-card result-${status}`;

      card.innerHTML = `
        <div class="vote-player-tag">
          <span class="vote-player-emoji">${p.animal.emoji}</span>
          <span>${esc(p.name)}${isOwn ? ' (you)' : ''}</span>
        </div>
        <div class="vote-answer-text ${!raw ? 'is-empty' : ''} ${status === 'voted-invalid' || status === 'wrong-letter' ? 'is-strikethrough' : ''}">
          ${raw ? esc(raw) : '—'}
        </div>
        <div class="result-status-badge ${badge.cls}">${badge.icon} ${badge.text}</div>
      `;

      row.appendChild(card);
    }

    section.appendChild(row);
    frag.appendChild(section);
  }

  return frag;
}

/* ─────────────────────────────────────────────────────────────
   Results view
───────────────────────────────────────────────────────────── */
function renderResults({ pointsThisRound, answerStatus, answers, letter, categories, players, currentRound, totalRounds, isLastRound }) {
  state.answerStatus = answerStatus;
  state.allAnswers   = answers;
  state.players      = players;

  document.getElementById('results-heading').textContent = `Round ${currentRound} of ${totalRounds} Complete!`;
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
  wrap.appendChild(buildResultsCards(categories, answers, answerStatus));

  // Host controls — button label/action changes on the final round
  const isHost = state.host === state.playerId;
  const btn = document.getElementById('btn-next-round');
  if (isLastRound) {
    btn.textContent = 'See Final Scores 🏆';
    btn.dataset.lastRound = 'true';
  } else {
    btn.textContent = 'Next Round →';
    btn.dataset.lastRound = '';
  }
  document.getElementById('results-host-controls').style.display = isHost ? 'flex' : 'none';
  document.getElementById('results-waiting-msg').style.display   = isHost ? 'none' : 'block';
  const waitingText = document.getElementById('results-waiting-text');
  if (waitingText) {
    waitingText.innerHTML = isLastRound
      ? 'Waiting for the host to reveal final scores<span class="waiting-dots"></span>'
      : 'Waiting for the host to start the next round<span class="waiting-dots"></span>';
  }
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
  renderAnimalPicker();

  // Home — Create
  document.getElementById('btn-create').addEventListener('click', () => {
    const name = document.getElementById('home-name').value.trim();
    if (!name) { showToast('Enter your name first!', true); return; }
    state.playerName = name;
    state.socket.emit('create-room', { playerName: name, preferredAnimal: state.selectedAnimal });
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
    state.socket.emit('join-room', { playerName: name, roomCode: code, preferredAnimal: state.selectedAnimal });
  }

  // Lobby — Copy code
  document.getElementById('btn-copy-code').addEventListener('click', () => {
    const code = document.getElementById('lobby-room-code').textContent;
    navigator.clipboard.writeText(code)
      .then(() => showToast('Room code copied!'))
      .catch(() => showToast(code));
  });

  // Lobby — Copy link
  document.getElementById('btn-copy-link').addEventListener('click', () => {
    const code = document.getElementById('lobby-room-code').textContent;
    const link = `${location.origin}/?code=${code}`;
    navigator.clipboard.writeText(link)
      .then(() => showToast('Join link copied!'))
      .catch(() => showToast(link));
  });

  // Auto-fill room code if arriving via a share link (?code=XXXXX)
  const codeParam = new URLSearchParams(location.search).get('code');
  if (codeParam) {
    document.getElementById('home-code').value = codeParam.toUpperCase();
    document.getElementById('home-name').focus();
  }

  // Lobby — Settings
  function emitSettings() {
    state.socket.emit('update-settings', {
      maxPlayers: parseInt(document.getElementById('setting-max-players').value),
      roundTime: parseInt(document.getElementById('setting-round-time').value),
      categories: getEditorCategories(),
    });
  }
  document.getElementById('setting-max-players').addEventListener('change', emitSettings);
  document.getElementById('setting-round-time').addEventListener('change', emitSettings);

  // Lobby — Shuffle categories
  document.getElementById('btn-shuffle-categories').addEventListener('click', () => {
    renderCategoryEditor(shuffleCategories());
    emitSettings();
  });

  // Lobby — Reset categories
  document.getElementById('btn-reset-categories').addEventListener('click', () => {
    renderCategoryEditor(DEFAULT_CATEGORIES);
    emitSettings();
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

  // Results — Next round (or final scores on round 3)
  document.getElementById('btn-next-round').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.lastRound) {
      state.socket.emit('show-final-scores');
    } else {
      state.socket.emit('next-round');
    }
  });

  // Game over — Play again
  document.getElementById('btn-play-again').addEventListener('click', () => {
    state.socket.emit('play-again');
  });
});
