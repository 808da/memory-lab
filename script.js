let response = Array(36).fill(-1);   // what the participant has built so far
let tool = 0;                        // 0 = blue, 1 = orange, -1 = eraser
let onChange = null;                 // runs after every click during recall

const grid = document.getElementById('grid');
const colors = ['#2563eb', '#f97316'];   // 0 = blue, 1 = orange

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

// Show the REAL pattern with marks that show where the participant went wrong
function drawReview(target, answer) {
  grid.innerHTML = '';
  for (let i = 0; i < 36; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (target[i] >= 0) {
      cell.style.background = colors[target[i]];
      if (answer[i] === target[i]) {
        cell.classList.add('hit');
        cell.textContent = '✓';
      } else {
        cell.classList.add('wrong');
        cell.textContent = '✗';
      }
    } else if (answer[i] >= 0) {
      cell.classList.add('wrong', 'extra');   // an extra square that should be empty
      cell.textContent = '✗';
    }
    grid.appendChild(cell);
  }
}

// Seeded random: the same seed always gives the same numbers
function seededRandom(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a pattern with n coloured squares
function makePattern(n, seed) {
  const rand = seededRandom(seed);
  const spots = [...Array(36).keys()];
  for (let i = 35; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const pattern = Array(36).fill(-1);
  spots.slice(0, n).forEach((spot, i) => {
    pattern[spot] = i % 2;
  });
  return pattern;
}

// The complexity levels: name and number of coloured squares
const levels = { Simple: 4, Medium: 8, Complex: 12 };

const patterns = [];
Object.keys(levels).forEach((name, levelNumber) => {
  for (let k = 1; k <= 3; k++) {
    patterns.push({
      id: name + '-' + k,
      level: name,
      n: levels[name],
      grid: makePattern(levels[name], 100 * (levelNumber + 1) + k)
    });
  }
});

// Compare the participant's answer to the real pattern
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
  const accuracy = Math.max(0, (hits - extras) / total * 100);
  return { hits, colorErrors, extras, accuracy };
}

// ----- Settings (the experiment rules live here) -----
const VIEW_SECONDS = 10;              // how long the pattern is shown
const RECALL_SECONDS = 30;            // maximum time to rebuild it
const PAUSE_SECONDS = 3;              // pause between patterns when feedback is off
const SHOW_FEEDBACK = true;           // true = show scores and mistakes. Set to false for the real experiment
const AUTO_FINISH_ON_PERFECT = true;  // set to false during the real experiment
const ALLOW_PLAY_AGAIN = true;        // set to false during the real experiment
const STORE = 'vcm_results';          // the name of the saved data in your browser
let participantId = '';

// ----- Page elements -----
const timerBox = document.getElementById('timer');
const startBtn = document.getElementById('beginBtn');
const tools = document.getElementById('tools');
const submitBtn = document.getElementById('submitBtn');
const nextBtn = document.getElementById('nextBtn');
const review = document.getElementById('review');
const endBox = document.getElementById('endBox');
const againBtn = document.getElementById('againBtn');
const exitBtn = document.getElementById('exitBtn');

// ----- Palette buttons -----
document.querySelectorAll('.tool').forEach(btn => {
  btn.onclick = () => {
    tool = Number(btn.dataset.tool);
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  };
});

// ----- The experiment flow -----
let current = 0;
let recallTimer = null;
let recallTimeLeft = 0;

drawGrid(Array(36).fill(-1), false);

function beginRun() {
  startBtn.hidden = true;
  endBox.hidden = true;
  const count = Number(localStorage.getItem('vcm_count') || 0) + 1;
  localStorage.setItem('vcm_count', count);
  participantId = 'P' + String(count).padStart(3, '0');
  current = 0;
  startPattern();
}
startBtn.onclick = beginRun;
againBtn.onclick = beginRun;      // "Play again" starts a brand new run

function startPattern() {
  review.textContent = '';
  drawGrid(patterns[current].grid, false);
  let timeLeft = VIEW_SECONDS;
  timerBox.textContent = 'Pattern ' + (current + 1) + ' of ' + patterns.length + ' - Memorize: ' + timeLeft;

  const countdown = setInterval(() => {
    timeLeft--;
    timerBox.textContent = 'Pattern ' + (current + 1) + ' of ' + patterns.length + ' - Memorize: ' + timeLeft;
    if (timeLeft === 0) {
      clearInterval(countdown);
      startRecall();
    }
  }, 1000);
}

function startRecall() {
  const target = patterns[current].grid;
  response = Array(36).fill(-1);
  drawGrid(response, true);
  tools.hidden = false;
  submitBtn.hidden = false;
  recallTimeLeft = RECALL_SECONDS;
  timerBox.textContent = 'Rebuild it: ' + recallTimeLeft;

  onChange = () => {
    if (AUTO_FINISH_ON_PERFECT && scoreAnswer(target, response).accuracy === 100) {
      finishRecall();
    }
  };

  recallTimer = setInterval(() => {
    recallTimeLeft--;
    timerBox.textContent = 'Rebuild it: ' + recallTimeLeft;
    if (recallTimeLeft === 0) finishRecall();
  }, 1000);
}

submitBtn.onclick = () => finishRecall();

// Runs when recall ends for any reason: perfect answer, Done button, or time up
function finishRecall() {
  clearInterval(recallTimer);
  onChange = null;
  tools.hidden = true;
  submitBtn.hidden = true;

  const target = patterns[current].grid;
  const result = scoreAnswer(target, response);
  const secondsUsed = RECALL_SECONDS - recallTimeLeft;
  console.log(patterns[current].id, result, 'seconds used:', secondsUsed);
  saveResult(result, secondsUsed);

  if (SHOW_FEEDBACK) {
    drawReview(target, response);
    timerBox.textContent = (result.accuracy === 100 ? 'Perfect! ' : '') +
      'Accuracy: ' + result.accuracy.toFixed(1) + '%  (' + result.hits + ' correct, ' +
      result.colorErrors + ' wrong colour, ' + result.extras + ' extra)';
    review.textContent = 'This is the real pattern. ✓ = correct. ✗ on a coloured square = missed or wrong colour. ✗ on a white square = an extra square.';
    nextBtn.textContent = current + 1 < patterns.length ? 'Next pattern' : 'See final results';
    nextBtn.hidden = false;                 // the participant decides when to move on
  } else {
    drawGrid(response, false);
    timerBox.textContent = 'Saved!';
    setTimeout(goNext, PAUSE_SECONDS * 1000);
  }
}

nextBtn.onclick = () => {
  nextBtn.hidden = true;
  goNext();
};

function goNext() {
  current++;
  if (current < patterns.length) startPattern();
  else endGame();
}

function endGame() {
  drawGrid(Array(36).fill(-1), false);
  timerBox.textContent = 'All patterns finished! Thank you.';
  review.innerHTML = SHOW_FEEDBACK ? summaryHTML() : '';
  againBtn.hidden = !ALLOW_PLAY_AGAIN;
  endBox.hidden = false;
}

// Average accuracy per level for this participant's run
function summaryHTML() {
  const rows = JSON.parse(localStorage.getItem(STORE) || '[]')
    .filter(r => r.participant_id === participantId);
  let html = '<b>Your average accuracy</b><br>';
  Object.keys(levels).forEach(name => {
    const scores = rows.filter(r => r.complexity === name).map(r => r.accuracy_percent);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    html += name + ': ' + avg.toFixed(1) + '%<br>';
  });
  return html;
}

// Exit goes back to the start screen (a web page can't reliably close its own tab)
exitBtn.onclick = () => {
  endBox.hidden = true;
  review.textContent = '';
  timerBox.textContent = '';
  drawGrid(Array(36).fill(-1), false);
  startBtn.textContent = 'Start';
  startBtn.hidden = false;
  startBtn.disabled = false;
};

// ----- Saving and exporting data -----
function saveResult(result, secondsUsed) {
  const rows = JSON.parse(localStorage.getItem(STORE) || '[]');
  rows.push({
    participant_id: participantId,
    trial_number: current + 1,
    complexity: patterns[current].level,
    pattern_id: patterns[current].id,
    num_elements: patterns[current].n,
    hits: result.hits,
    color_errors: result.colorErrors,
    extra_squares: result.extras,
    accuracy_percent: Number(result.accuracy.toFixed(1)),
    recall_seconds_used: secondsUsed,
    view_seconds: VIEW_SECONDS,
    recall_limit_seconds: RECALL_SECONDS,
    date: new Date().toISOString().slice(0, 10)
  });
  localStorage.setItem(STORE, JSON.stringify(rows));
}

document.getElementById('csvBtn').onclick = () => {
  const rows = JSON.parse(localStorage.getItem(STORE) || '[]');
  if (rows.length === 0) return alert('No data saved yet.');
  const keys = Object.keys(rows[0]);
  const lines = [keys.join(',')];
  rows.forEach(r => lines.push(keys.map(k => JSON.stringify(r[k])).join(',')));
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  link.download = 'memory_results.csv';
  link.click();
};

document.getElementById('clearBtn').onclick = () => {
  if (confirm('Delete ALL saved data on this device? Export the CSV first!')) {
    localStorage.removeItem(STORE);
    localStorage.removeItem('vcm_count');
  }
};