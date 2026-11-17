// =====================================================
// PART 1: SHARED TOOLS (grid drawing, patterns, scoring)
// =====================================================

let response = Array(36).fill(-1);
let tool = 0;
let onChange = null, tickId = null, pauseId = null, elapsed = 0, recallStart = 0;

const $ = id => document.getElementById(id);
const grid = $('grid');
const colors = ['#2563eb', '#f97316'];
const blank = () => Array(36).fill(-1);

const esc = s => s.replace(/[&<>"]/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;'
}[c]));

function drawGrid(pattern, clickable) {
  grid.innerHTML = '';

  for (let i = 0; i < 36; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';

    if (pattern[i] >= 0) {
      cell.style.background = colors[pattern[i]];
    }

    if (clickable) {
      cell.onclick = () => {
        response[i] = tool;
        cell.style.background = tool >= 0 ? colors[tool] : '';
        if (onChange) onChange();
      };
    }

    grid.appendChild(cell);
  }
}

function drawReview(target, answer) {
  grid.innerHTML = '';

  for (let i = 0; i < 36; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';

    if (target[i] >= 0) {
      cell.style.background = colors[target[i]];
      cell.classList.add(answer[i] === target[i] ? 'hit' : 'wrong');
      cell.textContent = answer[i] === target[i] ? '✓' : '✗';
    } else if (answer[i] >= 0) {
      cell.classList.add('wrong', 'extra');
      cell.textContent = '✗';
    }

    grid.appendChild(cell);
  }
}

function seededRandom(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;

    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePattern(n, seed) {
  const rand = seededRandom(seed);
  const spots = [...Array(36).keys()];

  for (let i = 35; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }

  const pattern = blank();

  spots.slice(0, n).forEach((spot, i) => {
    pattern[spot] = i % 2;
  });

  return pattern;
}

const randomPattern = n =>
  makePattern(n, Math.floor(Math.random() * 1e9));

function scoreAnswer(target, answer) {
  let hits = 0, colorErrors = 0, extras = 0, total = 0;

  for (let i = 0; i < 36; i++) {
    if (target[i] >= 0) {
      total++;

      if (answer[i] === target[i]) hits++;
      else if (answer[i] >= 0) colorErrors++;

    } else if (answer[i] >= 0) {
      extras++;
    }
  }

  return {
    hits,
    colorErrors,
    extras,
    accuracy: Math.max(0, (hits - extras) / total * 100)
  };
}

function shuffle(a) {
  a = a.slice();

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

// =====================================================
// PART 2: SETTINGS (change the rules here)
// =====================================================

const LEVELS = {
  Simple: 4,
  Medium: 8,
  Complex: 12
};

const DIFFICULTY = {
  Easy:   { n: 4, view: 15, recall: 30 },
  Normal: { n: 8, view: 10, recall: 30 },
  Hard:   { n: 12, view: 5, recall: 30 }
};

const GAME_ROUNDS = 5;

// All three experiment viewing times are equal.
const EXP = {
  viewByLevel: {
    Simple: 20,
    Medium: 20,
    Complex: 20
  },
  recall: 30,
  pause: 3,
  autoFinish: true,
  feedback: true
};

// false = everyone gets the same patterns in the same order.
const COUNTERBALANCE = false;

// Researcher PIN.
const ADMIN_PIN = '198003';

const askPin = () =>
  prompt('Researcher PIN:') === ADMIN_PIN ||
  (alert('Wrong PIN.'), false);

// Google Sheets connection.
const SHEET_URL =
  'https://script.google.com/macros/s/AKfycbzAExKqNH9UC88SAuBasZdSt_u3qtu-sSmXeWAMiZ8SIikmQ45QtoibCF9Acxil5tZ0cA/exec';

const SHEET_KEY = 'passionfruit';

let sendFailed = false;

const PENDING = 'vcm_pending';
let sendChain = Promise.resolve();

const wait = ms => new Promise(r => setTimeout(r, ms));

async function serverRequest(payload) {
  const res = await fetch(SHEET_URL, {
    method: 'POST',
    body: JSON.stringify({
      key: SHEET_KEY,
      ...payload
    })
  });

  return (await res.text()).trim();
}

async function deliver(row) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await serverRequest({
        action: 'save',
        row
      });

      if (result === 'ok') return;

      throw new Error(result || 'The server did not confirm the save.');

    } catch (e) {
      if (attempt === 3) {
        console.warn('Could not save trial online:', e);
      }
    }

    await wait(1500 * attempt);
  }

  sendFailed = true;

  const q = JSON.parse(localStorage.getItem(PENDING) || '[]');
  q.push(row);

  localStorage.setItem(PENDING, JSON.stringify(q));
}

function sendRow(row) {
  if (!SHEET_URL) return sendChain;

  sendChain = sendChain.then(() => deliver(row));

  return sendChain;
}

// Generate a random participant session ID.
const uniqueId = () =>
  'P' + Array.from({ length: 4 }, () =>
    'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[
      Math.floor(Math.random() * 31)
    ]
  ).join('');

const STORE = 'vcm_results';
const BOARD = 'vcm_leaderboard';

// The nine fixed experiment patterns.
const PATTERNS = [];

Object.keys(LEVELS).forEach((name, li) => {
  for (let k = 1; k <= 3; k++) {
    PATTERNS.push({
      id: name + '-' + k,
      level: name,
      li,
      n: LEVELS[name],
      grid: makePattern(LEVELS[name], 100 * (li + 1) + k)
    });
  }
});

// All six possible complexity orders.
const ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0]
];

// =====================================================
// PART 3: THE ROUND ENGINE
// =====================================================

// A round = memorize → rebuild → finish.

function runRound(o) {
  $('review').textContent = '';

  drawGrid(o.pattern, false);

  let t = o.view;

  $('timer').textContent =
    o.label + ' - Memorize: ' + t;

  tickId = setInterval(() => {
    t--;

    $('timer').textContent =
      o.label + ' - Memorize: ' + t;

    if (t === 0) {
      clearInterval(tickId);
      recall(o);
    }
  }, 1000);
}

function recall(o) {
  response = blank();

  drawGrid(response, true);

  $('tools').hidden = false;
  $('submitBtn').hidden = false;

  elapsed = 0;
  recallStart = Date.now();

  $('timer').textContent =
    'Rebuild it: ' + elapsed + ' / ' + o.recall;

  onChange = () => {
    if (
      o.autoFinish &&
      scoreAnswer(o.pattern, response).accuracy === 100
    ) {
      finish(o);
    }
  };

  $('submitBtn').onclick = () => finish(o);

  tickId = setInterval(() => {
    elapsed++;

    $('timer').textContent =
      'Rebuild it: ' + elapsed + ' / ' + o.recall;

    if (elapsed >= o.recall) {
      finish(o);
    }
  }, 1000);
}

function finish(o) {
  clearInterval(tickId);

  onChange = null;

  $('tools').hidden = true;
  $('submitBtn').hidden = true;

  const result = scoreAnswer(o.pattern, response);

  const ms = Math.min(
    Date.now() - recallStart,
    o.recall * 1000
  );

  o.done(result, ms, elapsed >= o.recall);

  if (o.feedback) {
    drawReview(o.pattern, response);

    $('timer').textContent =
      (result.accuracy === 100 ? 'Perfect! ' : '') +
      'Accuracy: ' + result.accuracy.toFixed(1) +
      '%  (' + result.hits + ' correct, ' +
      result.colorErrors + ' wrong colour, ' +
      result.extras + ' extra)';

    $('review').textContent =
      'Real pattern shown. ✓ = correct. ✗ on a colour = missed or wrong colour. ✗ on white = extra square.';

    $('nextBtn').textContent = o.nextLabel;
    $('nextBtn').hidden = false;

    $('nextBtn').onclick = () => {
      $('nextBtn').hidden = true;
      o.next();
    };

  } else {
    drawGrid(response, false);

    $('timer').textContent =
      (EXP.autoFinish && result.accuracy === 100)
        ? 'Perfect! Saved!'
        : 'Saved!';

    pauseId = setTimeout(o.next, EXP.pause * 1000);
  }
}


// =====================================================
// PART 4: MENU AND SCREENS
// =====================================================
function resetPlay() {
  clearInterval(tickId);
  clearTimeout(pauseId);
  onChange = null;
  ['tools', 'submitBtn', 'nextBtn', 'againBtn'].forEach(id => $(id).hidden = true);
  $('review').textContent = '';
  $('timer').textContent = '';
  drawGrid(blank(), false);
}

function showScreen(name) {
  $('menu').hidden = name !== 'menu';
  $('play').hidden = name !== 'play';
  if (name === 'menu') $('board').innerHTML = boardHTML($('difficulty').value);
}

$('quitBtn').onclick = () => {
  resetPlay();
  showScreen('menu');
};

document.querySelectorAll('.tool').forEach(btn => {
  btn.onclick = () => {
    tool = Number(btn.dataset.tool);
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  };
});

// =====================================================
// PART 5: PRACTICE MODE (nothing is saved)
// =====================================================
function practiceRound(level) {
  runRound({
    pattern: randomPattern(LEVELS[level]),
    view: EXP.viewByLevel[level],
    recall: 30,
    feedback: true,
    autoFinish: true,
    label: 'Practice (' + level + ')',
    nextLabel: 'Another round',
    done: () => {},
    next: () => practiceRound(level)
  });
}

$('practiceBtn').onclick = () => {
  resetPlay();
  showScreen('play');
  practiceRound($('practiceLevel').value);
};

// =====================================================
// PART 6: GAME MODE + LEADERBOARD (saved separately)
// =====================================================
let game = {};

function startGame() {
  resetPlay();
  showScreen('play');

  game = {
    diff: $('difficulty').value,
    nick: $('nickname').value.trim() || 'Player',
    round: 0,
    scores: []
  };

  gameRound();
}

function gameRound() {
  if (game.round >= GAME_ROUNDS) return endGame();

  const d = DIFFICULTY[game.diff];

  runRound({
    pattern: randomPattern(d.n),
    view: d.view,
    recall: d.recall,
    feedback: true,
    autoFinish: true,
    label: game.diff + ' - Round ' + (game.round + 1) + ' of ' + GAME_ROUNDS,
    nextLabel: game.round + 1 < GAME_ROUNDS ? 'Next round' : 'See final score',
    done: r => game.scores.push(r.accuracy),
    next: () => {
      game.round++;
      gameRound();
    }
  });
}

function endGame() {
  const avg = game.scores.reduce((a, b) => a + b, 0) / game.scores.length;

  const rows = JSON.parse(localStorage.getItem(BOARD) || '[]');
  rows.push({
    nick: game.nick,
    diff: game.diff,
    score: Number(avg.toFixed(1))
  });

  localStorage.setItem(BOARD, JSON.stringify(rows));

  drawGrid(blank(), false);
  $('timer').textContent = 'Game over! Score: ' + avg.toFixed(1) + '%';
  $('review').innerHTML = boardHTML(game.diff);
  $('againBtn').hidden = false;
}

function boardHTML(diff) {
  const rows = JSON.parse(localStorage.getItem(BOARD) || '[]')
    .filter(r => r.diff === diff)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return '<b>Top 5 - ' + diff + '</b>' + (rows.length
    ? '<ol>' + rows.map(r =>
        '<li>' + esc(r.nick) + ' - ' + r.score.toFixed(1) + '%</li>'
      ).join('') + '</ol>'
    : '<p>No scores yet.</p>');
}

$('gameBtn').onclick = startGame;
$('againBtn').onclick = startGame;
$('difficulty').onchange = () => $('board').innerHTML = boardHTML($('difficulty').value);

$('clearBoardBtn').onclick = () => {
  if (confirm('Clear the leaderboard?')) {
    localStorage.removeItem(BOARD);
    showScreen('menu');
  }
};

// =====================================================
// PART 7: EXPERIMENT MODE
// =====================================================
let participantId = '';
let participantName = '';
let order = [];
let trials = [];
let idx = 0;

async function startExperiment() {
  const enteredCode = $('expName').value.trim().replace(/^[=+\-\@\s]+/, '');

  if (!enteredCode) {
    alert('Please enter your participant code to begin or resume the experiment.');
    $('expName').focus();
    return;
  }

  if (!SHEET_URL) {
    alert('Online participant tracking is not configured. Please contact the researcher.');
    return;
  }

  $('expBtn').disabled = true;

  try {
    sendFailed = false;

    // Finish sending any previously queued trial rows before checking progress.
    await sendChain;

    // Check the central Participants sheet.
    const checkText = await serverRequest({
      action: 'check',
      participant_code: enteredCode
    });

    const check = JSON.parse(checkText);

    if (!check.ok) {
      throw new Error(check.message || 'Could not check participant status.');
    }

    if (check.status === 'completed') {
      alert("You've already participated!\n\nOnly one experiment attempt is allowed per participant. Thank you for taking part in our study!");
      return;
    }

    participantName = enteredCode;

    if (check.status === 'in_progress') {
      // Restore the same participant session and pattern order.
      participantId = check.participant_id;

      const plan = JSON.parse(check.trial_plan_json || '[]');
      trials = plan
        .map(id => PATTERNS.find(p => p.id === id))
        .filter(Boolean);

      if (!participantId || trials.length !== 9) {
        throw new Error('The saved experiment session could not be restored. Please contact the researcher.');
      }

      order = (check.block_order || 'Simple>Medium>Complex')
        .split('>')
        .map(level => Object.keys(LEVELS).indexOf(level))
        .filter(i => i >= 0);

      idx = Math.max(0, Math.min(Number(check.next_trial || 1) - 1, trials.length));

      // Bring the server's saved results onto this device too.
      const localRows = JSON.parse(localStorage.getItem(STORE) || '[]');
      const existingKeys = new Set(
        localRows.map(r => r.participant_id + ':' + r.trial_number)
      );

      (check.saved_rows || []).forEach(row => {
        const key = row.participant_id + ':' + row.trial_number;

        if (!existingKeys.has(key)) {
          localRows.push(row);
          existingKeys.add(key);
        }
      });

      localStorage.setItem(STORE, JSON.stringify(localRows));

    } else if (check.status === 'new') {
      const count = Number(localStorage.getItem('vcm_count') || 0) + 1;
      localStorage.setItem('vcm_count', count);

      participantId = uniqueId();

      order = COUNTERBALANCE
        ? ORDERS[Math.floor(Math.random() * 6)]
        : [0, 1, 2];

      trials = [];

      order.forEach(li => {
        const set = PATTERNS.filter(p => p.li === li);
        (COUNTERBALANCE ? shuffle(set) : set).forEach(p => trials.push(p));
      });

      idx = 0;

      const blockOrder = order
        .map(i => Object.keys(LEVELS)[i])
        .join('>');

      const plan = trials.map(p => p.id);

      const startText = await serverRequest({
        action: 'start',
        participant_code: enteredCode,
        participant_id: participantId,
        block_order: blockOrder,
        trial_plan: plan,
        expected_trials: trials.length
      });

      const started = JSON.parse(startText);

      if (!started.ok) {
        throw new Error(started.message || 'Could not create the participant session.');
      }

      if (started.status === 'completed') {
        alert("You've already participated!\n\nOnly one experiment attempt is allowed per participant. Thank you for taking part in our study!");
        return;
      }

      if (started.status === 'in_progress') {
        // Another browser may have created the session between check and start.
        participantId = started.participant_id;

        const savedPlan = JSON.parse(started.trial_plan_json || '[]');

        trials = savedPlan
          .map(id => PATTERNS.find(p => p.id === id))
          .filter(Boolean);

        idx = Math.max(0, Number(started.next_trial || 1) - 1);

        const localRows = JSON.parse(localStorage.getItem(STORE) || '[]');
        const existingKeys = new Set(
          localRows.map(r => r.participant_id + ':' + r.trial_number)
        );

        (started.saved_rows || []).forEach(row => {
          const key = row.participant_id + ':' + row.trial_number;

          if (!existingKeys.has(key)) {
            localRows.push(row);
            existingKeys.add(key);
          }
        });

        localStorage.setItem(STORE, JSON.stringify(localRows));
      }

    } else {
      throw new Error('The server returned an unknown participant status.');
    }

    resetPlay();
    showScreen('play');
    expRound();

  } catch (error) {
    console.error(error);

    alert(
      'We could not load your experiment progress. Please check your internet connection and try again.\n\n' +
      error.message
    );

  } finally {
    $('expBtn').disabled = false;
  }
}

function expRound() {
  if (idx >= trials.length) {
    drawGrid(blank(), false);

    const mine = JSON.parse(localStorage.getItem(STORE) || '[]')
      .filter(r => r.participant_id === participantId);

    const mean = list =>
      list.reduce((a, b) => a + b, 0) / (list.length || 1);

    $('timer').textContent =
      (participantName ? 'Thanks, ' + participantName + '! ' : '') +
      'All patterns finished! Average accuracy: ' +
      mean(mine.map(r => Number(r.accuracy_percent))).toFixed(1) + '%';

    $('review').textContent = Object.keys(LEVELS).map(level => {
      const r = mine.filter(x => x.complexity === level);

      return level + ': ' +
        mean(r.map(x => Number(x.accuracy_percent))).toFixed(1) +
        '% in ' +
        mean(r.map(x => Number(x.recall_time_seconds))).toFixed(1) +
        ' s on average';
    }).join('  |  ');

    if (SHEET_URL) {
      const me = participantId;
      const base = $('review').textContent;

      $('review').textContent = base + '   Saving online... keep this page open.';

      sendChain.then(() => {
        if (participantId !== me || idx < trials.length) return;

        $('review').textContent = base + (sendFailed
          ? '   (Warning: some results could not be sent online. Tell the researcher. They are saved on this device.)'
          : '   All results saved online.');
      });
    }

    return;
  }

  const p = trials[idx];

  runRound({
    pattern: p.grid,
    view: EXP.viewByLevel[p.level],
    recall: EXP.recall,
    feedback: EXP.feedback,
    autoFinish: EXP.autoFinish,
    label: 'Pattern ' + (idx + 1) + ' of ' + trials.length,
    nextLabel: idx + 1 < trials.length ? 'Next pattern' : 'See final score',
    done: (r, ms, timedOut) => saveResult(p, r, ms, timedOut),
    next: () => {
      idx++;
      expRound();
    }
  });
}

function saveResult(p, r, ms, timedOut) {
  const rows = JSON.parse(localStorage.getItem(STORE) || '[]');

  const row = {
    participant_id: participantId,
    block_order: order.map(i => Object.keys(LEVELS)[i]).join('>'),
    trial_number: idx + 1,
    complexity: p.level,
    pattern_id: p.id,
    num_elements: p.n,
    hits: r.hits,
    color_errors: r.colorErrors,
    extra_squares: r.extras,
    accuracy_percent: Number(r.accuracy.toFixed(1)),
    recall_time_seconds: Number((ms / 1000).toFixed(2)),
    timed_out: timedOut,
    view_seconds: EXP.viewByLevel[p.level],
    recall_limit_seconds: EXP.recall,
    date: new Date().toISOString().slice(0, 10),
    participant_name: participantName,
    timestamp: new Date().toISOString()
  };

  rows.push(row);
  localStorage.setItem(STORE, JSON.stringify(rows));

  sendRow(row);
}

$('expBtn').onclick = () => startExperiment();

$('csvBtn').onclick = () => {
  if (!askPin()) return;

  const rows = JSON.parse(localStorage.getItem(STORE) || '[]');

  if (!rows.length) {
    return alert('No experiment data saved yet.');
  }

  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];

  const lines = [
    keys.join(','),
    ...rows.map(r => keys.map(k => JSON.stringify(r[k])).join(','))
  ];

  const a = document.createElement('a');

  a.href = URL.createObjectURL(
    new Blob([lines.join('\n')], { type: 'text/csv' })
  );

  a.download = 'memory_results.csv';
  a.click();
};

$('clearBtn').onclick = () => {
  if (!askPin()) return;

  if (confirm('Delete ALL experiment data on this device? Export the CSV first!')) {
    localStorage.removeItem(STORE);
    localStorage.removeItem('vcm_count');
  }
};

// Resend any rows that failed to send earlier on this device.
(function () {
  const q = JSON.parse(localStorage.getItem(PENDING) || '[]');

  if (!q.length) return;

  localStorage.removeItem(PENDING);
  q.forEach(sendRow);
})();

// Start on the menu.
showScreen('menu');
drawGrid(blank(), false);