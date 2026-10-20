// =====================================================
// PART 1: SHARED TOOLS (grid drawing, patterns, scoring)
// =====================================================
let response = Array(36).fill(-1);   // what the participant has built
let tool = 0;                        // 0 = blue, 1 = orange, -1 = eraser
let onChange = null, tickId = null, pauseId = null, left = 0, recallStart = 0;

const $ = id => document.getElementById(id);
const grid = $('grid');
const colors = ['#2563eb', '#f97316'];
const blank = () => Array(36).fill(-1);
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function drawGrid(pattern, clickable) {
  grid.innerHTML = '';
  for (let i = 0; i < 36; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (pattern[i] >= 0) cell.style.background = colors[pattern[i]];
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
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
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
  spots.slice(0, n).forEach((spot, i) => pattern[spot] = i % 2);
  return pattern;
}
const randomPattern = n => makePattern(n, Math.floor(Math.random() * 1e9));  // new every time

function scoreAnswer(target, answer) {
  let hits = 0, colorErrors = 0, extras = 0, total = 0;
  for (let i = 0; i < 36; i++) {
    if (target[i] >= 0) {
      total++;
      if (answer[i] === target[i]) hits++;
      else if (answer[i] >= 0) colorErrors++;
    } else if (answer[i] >= 0) extras++;
  }
  return { hits, colorErrors, extras, accuracy: Math.max(0, (hits - extras) / total * 100) };
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
const LEVELS = { Simple: 4, Medium: 8, Complex: 12 };      // used by the experiment and practice
const DIFFICULTY = {                                       // used by game mode only
  Easy:   { n: 4,  view: 15, recall: 30 },
  Normal: { n: 8,  view: 10, recall: 30 },
  Hard:   { n: 12, view: 5,  recall: 30 }
};
const GAME_ROUNDS = 5;
// Experiment timing. Keep all three viewing times EQUAL so complexity is the only thing that changes.
const EXP = { viewByLevel: { Simple: 10, Medium: 10, Complex: 10 }, recall: 30, pause: 3 };
const STORE = 'vcm_results';                               // experiment data
const BOARD = 'vcm_leaderboard';                           // game scores (kept separate!)

// The 9 fixed experiment patterns (same for every participant)
const PATTERNS = [];
Object.keys(LEVELS).forEach((name, li) => {
  for (let k = 1; k <= 3; k++)
    PATTERNS.push({ id: name + '-' + k, level: name, li, n: LEVELS[name], grid: makePattern(LEVELS[name], 100 * (li + 1) + k) });
});
// All 6 orders of the 3 levels, rotated across participants (counterbalancing)
const ORDERS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];

// =====================================================
// PART 3: THE ROUND ENGINE (used by every mode)
// =====================================================
// A round = memorize -> rebuild -> finish. Each mode passes in its own settings (o).
function runRound(o) {
  $('review').textContent = '';
  drawGrid(o.pattern, false);
  let t = o.view;
  $('timer').textContent = o.label + ' - Memorize: ' + t;
  tickId = setInterval(() => {
    t--;
    $('timer').textContent = o.label + ' - Memorize: ' + t;
    if (t === 0) { clearInterval(tickId); recall(o); }
  }, 1000);
}

function recall(o) {
  response = blank();
  drawGrid(response, true);
  $('tools').hidden = false;
  $('submitBtn').hidden = false;
  left = o.recall;
  recallStart = Date.now();                          // start the stopwatch when recall begins
  $('timer').textContent = 'Rebuild it: ' + left;
  onChange = () => { if (o.autoFinish && scoreAnswer(o.pattern, response).accuracy === 100) finish(o); };
  $('submitBtn').onclick = () => finish(o);
  tickId = setInterval(() => {
    left--;
    $('timer').textContent = 'Rebuild it: ' + left;
    if (left === 0) finish(o);
  }, 1000);
}

function finish(o) {
  clearInterval(tickId);
  onChange = null;
  $('tools').hidden = true;
  $('submitBtn').hidden = true;
  const result = scoreAnswer(o.pattern, response);
  const ms = Math.min(Date.now() - recallStart, o.recall * 1000);   // time taken, in milliseconds
  o.done(result, ms, left === 0);                                    // left === 0 means time ran out

  if (o.feedback) {
    drawReview(o.pattern, response);
    $('timer').textContent = (result.accuracy === 100 ? 'Perfect! ' : '') + 'Accuracy: ' +
      result.accuracy.toFixed(1) + '%  (' + result.hits + ' correct, ' + result.colorErrors +
      ' wrong colour, ' + result.extras + ' extra)';
    $('review').textContent = 'Real pattern shown. ✓ = correct. ✗ on a colour = missed or wrong colour. ✗ on white = extra square.';
    $('nextBtn').textContent = o.nextLabel;
    $('nextBtn').hidden = false;
    $('nextBtn').onclick = () => { $('nextBtn').hidden = true; o.next(); };
  } else {
    drawGrid(response, false);
    $('timer').textContent = 'Saved!';
    pauseId = setTimeout(o.next, EXP.pause * 1000);
  }
}

// =====================================================
// PART 4: MENU AND SCREENS
// =====================================================
function resetPlay() {                               // stop everything and clear the play screen
  clearInterval(tickId); clearTimeout(pauseId); onChange = null;
  ['tools', 'submitBtn', 'nextBtn', 'againBtn'].forEach(id => $(id).hidden = true);
  $('review').textContent = ''; $('timer').textContent = '';
  drawGrid(blank(), false);
}
function showScreen(name) {
  $('menu').hidden = name !== 'menu';
  $('play').hidden = name !== 'play';
  if (name === 'menu') $('board').innerHTML = boardHTML($('difficulty').value);
}
$('quitBtn').onclick = () => { resetPlay(); showScreen('menu'); };

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
    pattern: randomPattern(LEVELS[level]), view: 10, recall: 30,
    feedback: true, autoFinish: true, label: 'Practice (' + level + ')',
    nextLabel: 'Another round', done: () => {}, next: () => practiceRound(level)
  });
}
$('practiceBtn').onclick = () => { resetPlay(); showScreen('play'); practiceRound($('practiceLevel').value); };

// =====================================================
// PART 6: GAME MODE + LEADERBOARD (saved separately)
// =====================================================
let game = {};
function startGame() {
  resetPlay(); showScreen('play');
  game = { diff: $('difficulty').value, nick: $('nickname').value.trim() || 'Player', round: 0, scores: [] };
  gameRound();
}
function gameRound() {
  if (game.round >= GAME_ROUNDS) return endGame();
  const d = DIFFICULTY[game.diff];
  runRound({
    pattern: randomPattern(d.n), view: d.view, recall: d.recall,
    feedback: true, autoFinish: true,
    label: game.diff + ' - Round ' + (game.round + 1) + ' of ' + GAME_ROUNDS,
    nextLabel: game.round + 1 < GAME_ROUNDS ? 'Next round' : 'See final score',
    done: r => game.scores.push(r.accuracy),
    next: () => { game.round++; gameRound(); }
  });
}
function endGame() {
  const avg = game.scores.reduce((a, b) => a + b, 0) / game.scores.length;
  const rows = JSON.parse(localStorage.getItem(BOARD) || '[]');
  rows.push({ nick: game.nick, diff: game.diff, score: Number(avg.toFixed(1)) });
  localStorage.setItem(BOARD, JSON.stringify(rows));
  drawGrid(blank(), false);
  $('timer').textContent = 'Game over! Score: ' + avg.toFixed(1) + '%';
  $('review').innerHTML = boardHTML(game.diff);
  $('againBtn').hidden = false;
}
function boardHTML(diff) {                            // top 5 scores for one difficulty
  const rows = JSON.parse(localStorage.getItem(BOARD) || '[]')
    .filter(r => r.diff === diff).sort((a, b) => b.score - a.score).slice(0, 5);
  return '<b>Top 5 - ' + diff + '</b>' + (rows.length
    ? '<ol>' + rows.map(r => '<li>' + esc(r.nick) + ' - ' + r.score.toFixed(1) + '%</li>').join('') + '</ol>'
    : '<p>No scores yet.</p>');
}
$('gameBtn').onclick = startGame;
$('againBtn').onclick = startGame;
$('difficulty').onchange = () => $('board').innerHTML = boardHTML($('difficulty').value);
$('clearBoardBtn').onclick = () => {
  if (confirm('Clear the leaderboard?')) { localStorage.removeItem(BOARD); showScreen('menu'); }
};

// =====================================================
// PART 7: EXPERIMENT MODE (locked rules, saved to CSV)
// =====================================================
let participantId = '', order = [], trials = [], idx = 0;

function startExperiment() {
  resetPlay(); showScreen('play');
  const count = Number(localStorage.getItem('vcm_count') || 0) + 1;
  localStorage.setItem('vcm_count', count);
  participantId = 'P' + String(count).padStart(3, '0');       // anonymous ID
  order = ORDERS[(count - 1) % 6];                             // rotate the 6 orders
  trials = [];
  order.forEach(li => shuffle(PATTERNS.filter(p => p.li === li)).forEach(p => trials.push(p)));
  idx = 0;
  expRound();
}
function expRound() {
  if (idx >= trials.length) {
    drawGrid(blank(), false);
    $('timer').textContent = 'All patterns finished! Thank you.';
    return;
  }
  const p = trials[idx];
  runRound({
    pattern: p.grid, view: EXP.viewByLevel[p.level], recall: EXP.recall,
    feedback: false, autoFinish: false,                        // no hints: same experience for all
    label: 'Pattern ' + (idx + 1) + ' of ' + trials.length,
    done: (r, ms, timedOut) => saveResult(p, r, ms, timedOut),
    next: () => { idx++; expRound(); }
  });
}
function saveResult(p, r, ms, timedOut) {
  const rows = JSON.parse(localStorage.getItem(STORE) || '[]');
  rows.push({
    participant_id: participantId, block_order: order.map(i => Object.keys(LEVELS)[i]).join('>'),
    trial_number: idx + 1, complexity: p.level, pattern_id: p.id, num_elements: p.n,
    hits: r.hits, color_errors: r.colorErrors, extra_squares: r.extras,
    accuracy_percent: Number(r.accuracy.toFixed(1)),
    recall_time_seconds: Number((ms / 1000).toFixed(2)),       // how long the rebuild took
    timed_out: timedOut,                                       // true = the 30 seconds ran out
    view_seconds: EXP.viewByLevel[p.level], recall_limit_seconds: EXP.recall,
    date: new Date().toISOString().slice(0, 10)
  });
  localStorage.setItem(STORE, JSON.stringify(rows));
}
$('expBtn').onclick = startExperiment;

$('csvBtn').onclick = () => {
  const rows = JSON.parse(localStorage.getItem(STORE) || '[]');
  if (!rows.length) return alert('No experiment data saved yet.');
  const keys = Object.keys(rows[0]);
  const lines = [keys.join(','), ...rows.map(r => keys.map(k => JSON.stringify(r[k])).join(','))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = 'memory_results.csv';
  a.click();
};
$('clearBtn').onclick = () => {
  if (confirm('Delete ALL experiment data on this device? Export the CSV first!')) {
    localStorage.removeItem(STORE); localStorage.removeItem('vcm_count');
  }
};

// Start on the menu
showScreen('menu');
drawGrid(blank(), false);