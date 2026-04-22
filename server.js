const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const CATEGORIES = [
  'Animals', 'Countries', 'Cities', 'Foods & Drinks', 'Movies',
  'TV Shows', 'Songs / Artists', 'Famous People', 'Sports',
  'Things in a Kitchen', 'Things at a Beach', 'Colors',
  'Clothing & Accessories', 'Vehicles', 'Occupations / Jobs',
  'Board Games', 'Fruits & Vegetables', 'Brands / Companies',
  'Things That Are Round', 'Fictional Characters',
  'School Subjects', 'Body Parts', 'Things in a Bedroom',
  'Musical Instruments', 'Things in a Park', 'Superheroes',
  'Types of Weather', 'Hobbies', 'Things That Are Cold',
  'Desserts & Sweets', 'Things Found in Nature', 'Dances',
  'Things in a Hospital', 'Card or Dice Games', 'Insects'
];

const LETTERS = [
  'A','B','C','D','E','F','G','H','I','J','K','L','M',
  'N','O','P','R','S','T','W'
];

const CATEGORIES_PER_ROUND = 12;
const REVIEW_TIME = 45;

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function pickLetter(usedLetters) {
  const available = LETTERS.filter(l => !usedLetters.includes(l));
  const pool = available.length > 0 ? available : LETTERS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickCategories() {
  return [...CATEGORIES].sort(() => Math.random() - 0.5).slice(0, CATEGORIES_PER_ROUND);
}

function publicRoom(room) {
  return {
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected })),
    host: room.host,
    state: room.state,
    settings: room.settings,
    currentRound: room.currentRound,
  };
}

function scoreRound(room) {
  const { letter, categories, answers = {}, disputes = {} } = room.round;
  const pointsThisRound = {};
  const answerStatus = {};

  for (const p of room.players) {
    pointsThisRound[p.id] = 0;
    answerStatus[p.id] = {};
  }

  for (const category of categories) {
    // Normalize all answers for this category
    const normalized = {};
    for (const p of room.players) {
      const raw = (answers[p.id]?.[category] || '').trim();
      normalized[p.id] = raw;
    }

    // Count how many players gave each normalized value (case-insensitive)
    const valueCounts = {};
    for (const [pid, raw] of Object.entries(normalized)) {
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (!valueCounts[key]) valueCounts[key] = [];
      valueCounts[key].push(pid);
    }

    for (const p of room.players) {
      const raw = normalized[p.id];

      if (!raw) {
        answerStatus[p.id][category] = 'empty';
        continue;
      }

      if (raw.toUpperCase()[0] !== letter) {
        answerStatus[p.id][category] = 'wrong-letter';
        continue;
      }

      const key = raw.toLowerCase();
      if (valueCounts[key].length > 1) {
        answerStatus[p.id][category] = 'duplicate';
        continue;
      }

      // Check disputes: disputed if more than half of other connected players flagged it
      const disputerList = disputes[p.id]?.[category] || [];
      const otherConnected = room.players.filter(x => x.connected && x.id !== p.id);
      const isDisputed = otherConnected.length > 0 && disputerList.length > otherConnected.length / 2;

      if (isDisputed) {
        answerStatus[p.id][category] = 'disputed';
        continue;
      }

      answerStatus[p.id][category] = 'valid';
      pointsThisRound[p.id]++;
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

  const letter = pickLetter(room.usedLetters);
  room.usedLetters.push(letter);

  room.round = {
    number: room.currentRound,
    letter,
    categories: pickCategories(),
    answers: {},
    disputes: {},
    submitted: new Set(),
    timeLeft: room.settings.timeLimit,
  };

  room.state = 'countdown';
  io.to(room.code).emit('room-updated', publicRoom(room));

  let count = 3;
  io.to(room.code).emit('countdown', { count });

  room.timers.countdown = setInterval(() => {
    count--;
    if (count > 0) {
      io.to(room.code).emit('countdown', { count });
    } else {
      clearInterval(room.timers.countdown);
      room.state = 'playing';
      io.to(room.code).emit('round-start', {
        round: room.currentRound,
        totalRounds: room.settings.rounds,
        letter,
        categories: room.round.categories,
        timeLimit: room.settings.timeLimit,
      });
      startRoundTimer(room);
    }
  }, 1000);
}

function startRoundTimer(room) {
  room.round.timeLeft = room.settings.timeLimit;
  room.timers.round = setInterval(() => {
    room.round.timeLeft--;
    io.to(room.code).emit('timer', { timeLeft: room.round.timeLeft });
    if (room.round.timeLeft <= 0) {
      clearInterval(room.timers.round);
      endRound(room);
    }
  }, 1000);
}

function endRound(room) {
  if (room.state !== 'playing') return;
  clearTimers(room);

  room.state = 'reviewing';
  io.to(room.code).emit('round-ended', {
    answers: room.round.answers,
    disputes: room.round.disputes,
    letter: room.round.letter,
    categories: room.round.categories,
  });

  let reviewTimeLeft = REVIEW_TIME;
  io.to(room.code).emit('review-timer', { timeLeft: reviewTimeLeft });

  room.timers.reviewInterval = setInterval(() => {
    reviewTimeLeft--;
    io.to(room.code).emit('review-timer', { timeLeft: reviewTimeLeft });
    if (reviewTimeLeft <= 0) clearInterval(room.timers.reviewInterval);
  }, 1000);

  room.timers.reviewTimeout = setTimeout(() => {
    if (room.state === 'reviewing') finalizeRound(room);
  }, REVIEW_TIME * 1000);
}

function finalizeRound(room) {
  if (room.state !== 'reviewing') return;
  clearTimers(room);

  const { pointsThisRound, answerStatus } = scoreRound(room);
  for (const p of room.players) {
    p.score += pointsThisRound[p.id] || 0;
  }

  const isLastRound = room.currentRound >= room.settings.rounds;
  room.state = isLastRound ? 'ended' : 'results';

  const payload = {
    pointsThisRound,
    answerStatus,
    answers: room.round.answers,
    letter: room.round.letter,
    categories: room.round.categories,
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    isLastRound,
  };

  if (isLastRound) {
    io.to(room.code).emit('game-over', payload);
  } else {
    io.to(room.code).emit('round-results', payload);
  }
}

io.on('connection', (socket) => {
  socket.on('create-room', ({ playerName }) => {
    const name = playerName.trim().slice(0, 20);
    if (!name) return;

    const code = generateRoomCode();
    const player = { id: socket.id, name, score: 0, connected: true };
    const room = {
      code,
      host: socket.id,
      players: [player],
      state: 'lobby',
      settings: { rounds: 3, timeLimit: 120 },
      currentRound: 0,
      usedLetters: [],
      round: null,
      timers: {},
    };

    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;

    socket.emit('room-created', { roomCode: code, playerId: socket.id });
    socket.emit('room-updated', publicRoom(room));
  });

  socket.on('join-room', ({ roomCode, playerName }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const name = (playerName || '').trim().slice(0, 20);
    if (!code || !name) return;

    const room = rooms.get(code);
    if (!room) { socket.emit('join-error', { message: 'Room not found. Check the code and try again.' }); return; }
    if (room.state !== 'lobby') { socket.emit('join-error', { message: 'Game already in progress.' }); return; }
    if (room.players.filter(p => p.connected).length >= 8) { socket.emit('join-error', { message: 'Room is full (max 8 players).' }); return; }

    // Allow rejoin by same name if disconnected slot exists
    const existing = room.players.find(p => !p.connected && p.name === name);
    if (existing) {
      existing.id = socket.id;
      existing.connected = true;
      if (room.host === existing.id) room.host = socket.id;
    } else {
      room.players.push({ id: socket.id, name, score: 0, connected: true });
    }

    socket.join(code);
    socket.roomCode = code;
    socket.emit('room-joined', { roomCode: code, playerId: socket.id });
    io.to(code).emit('room-updated', publicRoom(room));
  });

  socket.on('update-settings', ({ rounds, timeLimit }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    if ([2,3,4,5].includes(rounds)) room.settings.rounds = rounds;
    if ([60,90,120,180].includes(timeLimit)) room.settings.timeLimit = timeLimit;
    io.to(room.code).emit('room-updated', publicRoom(room));
  });

  socket.on('start-game', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    const connected = room.players.filter(p => p.connected);
    if (connected.length < 2) { socket.emit('join-error', { message: 'Need at least 2 players to start.' }); return; }
    startRound(room);
  });

  socket.on('submit-answers', ({ answers }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'playing') return;
    room.round.answers[socket.id] = answers;
    room.round.submitted.add(socket.id);

    const connectedCount = room.players.filter(p => p.connected).length;
    io.to(room.code).emit('submission-update', {
      count: room.round.submitted.size,
      total: connectedCount,
    });

    if (room.round.submitted.size >= connectedCount) {
      clearInterval(room.timers.round);
      endRound(room);
    }
  });

  socket.on('dispute-answer', ({ targetPlayerId, category }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'reviewing' || socket.id === targetPlayerId) return;

    const d = room.round.disputes;
    if (!d[targetPlayerId]) d[targetPlayerId] = {};
    if (!d[targetPlayerId][category]) d[targetPlayerId][category] = [];

    const list = d[targetPlayerId][category];
    const idx = list.indexOf(socket.id);
    if (idx === -1) list.push(socket.id); else list.splice(idx, 1);

    io.to(room.code).emit('disputes-updated', { disputes: room.round.disputes });
  });

  socket.on('finalize-round', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== 'reviewing') return;
    finalizeRound(room);
  });

  socket.on('next-round', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== 'results') return;
    startRound(room);
  });

  socket.on('play-again', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== 'ended') return;
    for (const p of room.players) p.score = 0;
    room.currentRound = 0;
    room.usedLetters = [];
    room.round = null;
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
      io.to(code).emit('player-left', { name: player.name });
    }

    if (room.host === socket.id) {
      const next = room.players.find(p => p.connected);
      if (next) room.host = next.id;
    }

    if (room.players.every(p => !p.connected)) {
      clearTimers(room);
      rooms.delete(code);
      return;
    }

    io.to(code).emit('room-updated', publicRoom(room));

    // If during playing and all submitted now
    if (room.state === 'playing' && room.round) {
      const connectedCount = room.players.filter(p => p.connected).length;
      if (room.round.submitted.size >= connectedCount) {
        clearInterval(room.timers.round);
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
  console.log(`\nShare the Network URL with other players on your WiFi.\n`);
});
