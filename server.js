const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket', 'polling'],
  cors: { origin: '*' },
});

app.use(express.static(path.join(__dirname, 'public')));

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
  { name: 'Otter',     emoji: '🦦' },
  { name: 'Hedgehog',  emoji: '🦔' },
  { name: 'Butterfly', emoji: '🦋' },
];

const DEFAULT_CATEGORIES = [
  'Animals', 'Countries', 'Foods & Drinks', 'Movies', 'Famous People',
  'Cities', 'Things in a Kitchen', 'Clothing & Accessories', 'Occupations / Jobs', 'Sports',
];

// A–Z excluding Q, U, X, Y, Z
const LETTERS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','R','S','T','V','W'];
const ROUND_TIME = 75;
const VOTE_TIME  = 40;
const MAX_ROUNDS = 3;
const COLLECT_MS = 1500; // grace period after timer to flush typed answers

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickLetter(room) {
  if (!room.letterPool || room.letterPool.length === 0) {
    room.letterPool = shuffleArray(LETTERS);
  }
  return room.letterPool.shift();
}

function assignAnimal(room, preferredName) {
  const used = new Set(room.players.filter(p => p.connected).map(p => p.animal.name));
  if (preferredName) {
    const preferred = ANIMALS.find(a => a.name === preferredName && !used.has(a.name));
    if (preferred) return preferred;
  }
  return ANIMALS.find(a => !used.has(a.name)) || ANIMALS[room.players.length % ANIMALS.length];
}

function publicRoom(room) {
  return {
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      animal: p.animal,
      score: p.score,
      connected: p.connected,
    })),
    host: room.host,
    state: room.state,
    maxPlayers: room.maxPlayers,
    roundTime: room.roundTime,
    categories: room.categories,
    currentRound: room.currentRound,
  };
}

function scoreRound(room) {
  const { categories, answers = {}, votes = {} } = room.round;
  const pointsThisRound = {};
  const answerStatus = {};

  for (const p of room.players) {
    pointsThisRound[p.id] = 0;
    answerStatus[p.id] = {};
  }

  for (const category of categories) {
    const validAnswers = {}; // playerId → normalised answer

    for (const p of room.players) {
      const raw = (answers[p.id]?.[category] || '').trim();

      if (!raw) { answerStatus[p.id][category] = 'empty'; continue; }
      if (raw.toUpperCase()[0] !== room.round.letter) {
        answerStatus[p.id][category] = 'wrong-letter'; continue;
      }

      // Rejected by majority of other connected players?
      const rejectors = votes[p.id]?.[category] || [];
      const others = room.players.filter(x => x.connected && x.id !== p.id);
      if (others.length > 0 && rejectors.length > others.length / 2) {
        answerStatus[p.id][category] = 'voted-invalid'; continue;
      }

      validAnswers[p.id] = raw.toLowerCase();
    }

    // Unique vs duplicate among valid answers
    const valueCounts = {};
    for (const ans of Object.values(validAnswers)) {
      valueCounts[ans] = (valueCounts[ans] || 0) + 1;
    }

    for (const [pid, ans] of Object.entries(validAnswers)) {
      const unique = valueCounts[ans] === 1;
      answerStatus[pid][category] = unique ? 'unique' : 'duplicate';
      pointsThisRound[pid] += unique ? 2 : 1;
    }
  }

  return { pointsThisRound, answerStatus };
}

function clearTimers(room) {
  for (const t of Object.values(room.timers)) {
    clearInterval(t);
    clearTimeout(t);
  }
  room.timers = {};
}

function startRound(room) {
  clearTimers(room);
  room.currentRound++;

  const letter = pickLetter(room);
  room.usedLetters.push(letter);

  room.round = {
    number: room.currentRound,
    letter,
    categories: [...room.categories],
    answers: {},
    votes: {},
    submitted: new Set(),
    timeLeft: ROUND_TIME,
  };

  room.state = 'countdown';
  io.to(room.code).emit('room-updated', publicRoom(room));

  let count = 3;
  io.to(room.code).emit('countdown', { count, letter });

  room.timers.countdown = setInterval(() => {
    count--;
    if (count > 0) {
      io.to(room.code).emit('countdown', { count, letter });
    } else {
      clearInterval(room.timers.countdown);
      delete room.timers.countdown;
      room.state = 'playing';
      io.to(room.code).emit('round-start', {
        round: room.currentRound,
        totalRounds: MAX_ROUNDS,
        letter,
        categories: room.round.categories,
        timeLimit: room.roundTime,
        players: room.players.map(p => ({ id: p.id, name: p.name, animal: p.animal, score: p.score })),
      });
      startRoundTimer(room);
    }
  }, 1000);
}

function startRoundTimer(room) {
  room.round.timeLeft = room.roundTime;
  room.timers.round = setInterval(() => {
    room.round.timeLeft--;
    io.to(room.code).emit('timer', { timeLeft: room.round.timeLeft });
    if (room.round.timeLeft <= 0) {
      clearInterval(room.timers.round);
      delete room.timers.round;
      // Collecting phase: tell clients to flush whatever they've typed,
      // then wait briefly before locking in answers for voting.
      room.state = 'collecting';
      io.to(room.code).emit('collect-answers');
      room.timers.collect = setTimeout(() => endRound(room), COLLECT_MS);
    }
  }, 1000);
}

function endRound(room) {
  if (room.state !== 'playing' && room.state !== 'collecting') return;
  clearTimers(room);

  room.state = 'voting';
  io.to(room.code).emit('voting-start', {
    answers: room.round.answers,
    votes: room.round.votes,
    letter: room.round.letter,
    categories: room.round.categories,
    voteTime: VOTE_TIME,
    players: room.players.map(p => ({ id: p.id, name: p.name, animal: p.animal, score: p.score })),
  });

  let voteTimeLeft = VOTE_TIME;
  io.to(room.code).emit('vote-timer', { timeLeft: voteTimeLeft });

  room.timers.voteInterval = setInterval(() => {
    voteTimeLeft--;
    io.to(room.code).emit('vote-timer', { timeLeft: voteTimeLeft });
    if (voteTimeLeft <= 0) clearInterval(room.timers.voteInterval);
  }, 1000);

  room.timers.voteTimeout = setTimeout(() => {
    if (room.state === 'voting') finalizeVoting(room);
  }, VOTE_TIME * 1000);
}

function finalizeVoting(room) {
  if (room.state !== 'voting') return;
  clearTimers(room);

  const { pointsThisRound, answerStatus } = scoreRound(room);
  for (const p of room.players) {
    p.score += pointsThisRound[p.id] || 0;
  }

  // Always show results so players can see their scored answers,
  // even on the final round. isLastRound tells the client to show
  // "See Final Scores" instead of "Next Round".
  const isLastRound = room.currentRound >= MAX_ROUNDS;
  room.state = 'results';
  io.to(room.code).emit('round-results', {
    pointsThisRound,
    answerStatus,
    answers: room.round.answers,
    letter: room.round.letter,
    categories: room.round.categories,
    players: room.players.map(p => ({ id: p.id, name: p.name, animal: p.animal, score: p.score })),
    currentRound: room.currentRound,
    totalRounds: MAX_ROUNDS,
    isLastRound,
  });
}

function endGame(room) {
  clearTimers(room);
  room.state = 'ended';
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  io.to(room.code).emit('game-over', {
    players: sorted.map(p => ({ id: p.id, name: p.name, animal: p.animal, score: p.score })),
  });
}

// ── Socket handlers ───────────────────────────────────────────

io.on('connection', (socket) => {

  socket.on('create-room', ({ playerName, preferredAnimal }) => {
    const name = (playerName || '').trim().slice(0, 20);
    if (!name) return;

    const code = generateRoomCode();
    const animal = ANIMALS.find(a => a.name === preferredAnimal) || ANIMALS[0];
    const room = {
      code,
      host: socket.id,
      players: [{ id: socket.id, name, animal, score: 0, connected: true }],
      state: 'lobby',
      maxPlayers: 10,
      roundTime: 75,
      categories: [...DEFAULT_CATEGORIES],
      currentRound: 0,
      usedLetters: [],
      letterPool: shuffleArray(LETTERS),
      round: null,
      timers: {},
    };

    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;

    socket.emit('room-created', { roomCode: code, playerId: socket.id, animal });
    socket.emit('room-updated', publicRoom(room));
  });

  socket.on('join-room', ({ roomCode, playerName, preferredAnimal }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const name = (playerName || '').trim().slice(0, 20);
    if (!code || !name) return;

    const room = rooms.get(code);
    if (!room) { socket.emit('join-error', { message: 'Room not found. Check the code and try again.' }); return; }
    if (room.state !== 'lobby') { socket.emit('join-error', { message: 'This game is already in progress.' }); return; }
    if (room.players.filter(p => p.connected).length >= room.maxPlayers) {
      socket.emit('join-error', { message: `Room is full (max ${room.maxPlayers} players).` }); return;
    }

    const animal = assignAnimal(room, preferredAnimal);
    const existing = room.players.find(p => !p.connected && p.name === name);
    if (existing) {
      existing.id = socket.id;
      existing.connected = true;
      existing.animal = animal;
    } else {
      room.players.push({ id: socket.id, name, animal, score: 0, connected: true });
    }

    socket.join(code);
    socket.roomCode = code;
    socket.emit('room-joined', { roomCode: code, playerId: socket.id, animal });
    io.to(code).emit('room-updated', publicRoom(room));
  });

  socket.on('update-settings', ({ maxPlayers, roundTime, categories }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;

    if (Number.isInteger(maxPlayers) && maxPlayers >= 2 && maxPlayers <= 10) {
      room.maxPlayers = maxPlayers;
    }
    if ([60, 75, 90].includes(roundTime)) {
      room.roundTime = roundTime;
    }
    if (Array.isArray(categories) && categories.length === 10) {
      room.categories = categories.map(c => (c || '').trim().slice(0, 60) || 'Category');
    }
    io.to(room.code).emit('room-updated', publicRoom(room));
  });

  socket.on('start-game', ({ categories } = {}) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    if (room.players.filter(p => p.connected).length < 2) {
      socket.emit('join-error', { message: 'Need at least 2 players to start.' }); return;
    }
    if (Array.isArray(categories) && categories.length === 10) {
      room.categories = categories.map(c => (c || '').trim().slice(0, 60) || 'Category');
    }
    startRound(room);
  });

  socket.on('submit-answers', ({ answers }) => {
    const room = rooms.get(socket.roomCode);
    // Accept answers during playing, collecting, or even early voting (race-condition safety)
    if (!room || !['playing', 'collecting', 'voting'].includes(room.state)) return;

    room.round.answers[socket.id] = answers;
    room.round.submitted.add(socket.id);

    const connectedCount = room.players.filter(p => p.connected).length;
    io.to(room.code).emit('submission-update', {
      count: room.round.submitted.size,
      total: connectedCount,
    });

    // Trigger early-end when every connected player has submitted
    const allSubmitted = room.round.submitted.size >= connectedCount;
    if (allSubmitted) {
      if (room.state === 'playing') {
        clearInterval(room.timers.round);
        endRound(room);
      } else if (room.state === 'collecting') {
        clearTimeout(room.timers.collect);
        delete room.timers.collect;
        endRound(room);
      }
    }
  });

  // Toggle a rejection vote on another player's answer
  socket.on('cast-vote', ({ targetPlayerId, category }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'voting' || socket.id === targetPlayerId) return;

    const { votes } = room.round;
    if (!votes[targetPlayerId]) votes[targetPlayerId] = {};
    if (!votes[targetPlayerId][category]) votes[targetPlayerId][category] = [];

    const list = votes[targetPlayerId][category];
    const idx = list.indexOf(socket.id);
    if (idx === -1) list.push(socket.id);
    else list.splice(idx, 1);

    io.to(room.code).emit('votes-updated', { votes });
  });

  socket.on('finalize-voting', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== 'voting') return;
    finalizeVoting(room);
  });

  socket.on('next-round', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== 'results') return;
    startRound(room);
  });

  socket.on('show-final-scores', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== 'results') return;
    endGame(room);
  });

  socket.on('play-again', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== 'ended') return;
    for (const p of room.players) p.score = 0;
    room.currentRound = 0;
    room.usedLetters = [];
    room.letterPool = shuffleArray(LETTERS);
    room.round = null;
    room.roundTime = 75;
    room.categories = [...DEFAULT_CATEGORIES];
    room.state = 'lobby';
    io.to(room.code).emit('room-updated', publicRoom(room));
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.connected = false;
      io.to(code).emit('player-left', { name: player.name, animal: player.animal });
    }

    if (room.host === socket.id) {
      const next = room.players.find(p => p.connected);
      if (next) {
        room.host = next.id;
        io.to(code).emit('host-changed', { name: next.name, animal: next.animal });
      }
    }

    if (room.players.every(p => !p.connected)) {
      clearTimers(room);
      rooms.delete(code);
      return;
    }

    io.to(code).emit('room-updated', publicRoom(room));

    if (room.round && ['playing', 'collecting'].includes(room.state)) {
      const connectedCount = room.players.filter(p => p.connected).length;
      if (room.round.submitted.size >= connectedCount) {
        if (room.state === 'playing') clearInterval(room.timers.round);
        if (room.state === 'collecting') clearTimeout(room.timers.collect);
        endRound(room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎲 Scattergories server running!\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`  Network: http://${iface.address}:${PORT}`);
      }
    }
  }
  console.log(`\nShare that URL with players anywhere!\n`);
});
