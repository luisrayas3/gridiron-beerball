// Gridiron Beerball - Game Tracker

const STORAGE_KEY = 'gridiron-beerball-game';
const CUPS_TO_FIRST_DOWN = 3;
const TOTAL_CUPS = 20;
const POSSESSIONS_PER_QUARTER = 4;
const TOTAL_QUARTERS = 4;

// Game phases
const Phase = {
  COIN_TOSS: 'coin_toss',
  KICKOFF: 'kickoff',
  KICKOFF_RETURN: 'kickoff_return',
  NORMAL_PLAY: 'normal_play',
  PLAY_RESULT: 'play_result',
  FOURTH_DOWN_DECISION: 'fourth_down_decision',
  PUNT: 'punt',
  PUNT_RETURN: 'punt_return',
  FIELD_GOAL_ATTEMPT: 'field_goal_attempt',
  TOUCHDOWN_CONVERSION: 'touchdown_conversion',
  EXTRA_POINT: 'extra_point',
  TWO_POINT_CONVERSION: 'two_point_conversion',
  GAME_OVER: 'game_over',
  OVERTIME_START: 'overtime_start',
  OVERTIME_FIELD_GOAL: 'overtime_field_goal'
};

// Default game state
function createInitialState(team1Name, team1Color, team2Name, team2Color) {
  return {
    team1: { name: team1Name, color: team1Color, score: 0 },
    team2: { name: team2Name, color: team2Color, score: 0 },
    quarter: 1,
    possession: 1,
    offenseTeam: 1,
    ballPosition: 10,
    firstDownMarker: 13,
    down: 1,
    phase: Phase.COIN_TOSS,
    pendingPlay: null,
    kickResult: null,
    puntResult: null,
    openingKickoffReceiver: null,
    history: [],
    isOvertime: false,
    overtimeRound: 0,
    overtimeFieldGoalPosition: 10
  };
}

let gameState = null;

// ============ Helpers ============

// Direction multiplier for ball movement
// Team 1 moves toward cup 20 (+1), Team 2 moves toward cup 1 (-1)
function direction() {
  return gameState.offenseTeam === 1 ? 1 : -1;
}

// Get team object by number
function getTeam(num) {
  return num === 1 ? gameState.team1 : gameState.team2;
}

// Get current offense/defense teams
function offenseTeam() {
  return getTeam(gameState.offenseTeam);
}

function defenseTeam() {
  return getTeam(gameState.offenseTeam === 1 ? 2 : 1);
}

// Clamp ball position to valid field range
function clampToField(position) {
  return Math.max(1, Math.min(TOTAL_CUPS, position));
}

// Get display label for a cup
// Both halves show 1-10, with 10 at midfield and 1 near endzones
function cupDisplayLabel(cup) {
  return cup <= 10 ? cup : (21 - cup);
}

// Get CSS class for cup based on which team's territory
// Left half (cups 1-10): Team 1's territory (their endzone is at cup 1)
// Right half (cups 11-20): Team 2's territory (their endzone is at cup 20)
function cupColorClass(cup) {
  return cup <= 10 ? 'team1-half' : 'team2-half';
}

// Convert cup position to display string with team abbreviation
function cupToLabel(cup) {
  if (!gameState) return `${cup}`;
  const team = cup <= 10 ? gameState.team1 : gameState.team2;
  const abbrev = team.name.substring(0, 3).toUpperCase();
  return `${abbrev} ${cupDisplayLabel(cup)}`;
}

// Render a grid of cup selection buttons
function renderCupSelectGrid(action) {
  return Array.from({length: TOTAL_CUPS}, (_, i) => i + 1).map(cup =>
    `<button class="btn cup-select-btn ${cupColorClass(cup)}" data-action="${action}" data-cup="${cup}">${cupDisplayLabel(cup)}</button>`
  ).join('');
}

// ============ DOM Elements ============

const elements = {};

function initElements() {
  const ids = [
    'setup-screen', 'game-screen', 'team1-name', 'team1-color', 'team2-name', 'team2-color',
    'start-game', 'resume-game', 'score-team1-name', 'score-team2-name', 'score-team1', 'score-team2',
    'quarter-display', 'possession-display', 'down-text', 'situation-text', 'field',
    'endzone-left', 'endzone-right', 'controls', 'new-game', 'undo'
  ];
  ids.forEach(id => {
    const camelId = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    elements[camelId] = document.getElementById(id);
  });
}

// ============ Save/Load ============

function saveGame() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
}

function loadGame() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.team1 && parsed.team2 && parsed.phase) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load saved game:', e);
  }
  return null;
}

function clearSavedGame() {
  localStorage.removeItem(STORAGE_KEY);
}

// ============ History/Undo ============

// Push current state to history for undo (keeps last 20 states)
function pushHistory() {
  if (!gameState) return;
  const stateCopy = JSON.parse(JSON.stringify(gameState));
  delete stateCopy.history;
  gameState.history.push(stateCopy);
  if (gameState.history.length > 20) {
    gameState.history.shift();
  }
}

function undo() {
  if (gameState.history.length > 0) {
    const previous = gameState.history.pop();
    previous.history = gameState.history;
    gameState = previous;
    saveGame();
    render();
  }
}

// ============ Rendering ============

function applyTeamColors() {
  if (!gameState) return;
  document.documentElement.style.setProperty('--team1-color', gameState.team1.color);
  document.documentElement.style.setProperty('--team2-color', gameState.team2.color);
}

function render() {
  renderScoreboard();
  renderDownDistance();
  renderField();
  renderControls();
}

function renderScoreboard() {
  elements.scoreTeam1Name.textContent = gameState.team1.name;
  elements.scoreTeam2Name.textContent = gameState.team2.name;
  elements.scoreTeam1.textContent = gameState.team1.score;
  elements.scoreTeam2.textContent = gameState.team2.score;

  if (gameState.phase === Phase.GAME_OVER) {
    elements.quarterDisplay.textContent = 'Final';
    elements.possessionDisplay.textContent = '';
  } else if (gameState.isOvertime) {
    elements.quarterDisplay.textContent = 'OT';
    elements.possessionDisplay.textContent = `Round ${gameState.overtimeRound}`;
  } else {
    elements.quarterDisplay.textContent = `Q${gameState.quarter}`;
    elements.possessionDisplay.textContent = `Poss ${gameState.possession}/${POSSESSIONS_PER_QUARTER}`;
  }
}

function renderDownDistance() {
  const phase = gameState.phase;

  // Phases that don't show down/distance
  if ([Phase.COIN_TOSS, Phase.KICKOFF, Phase.KICKOFF_RETURN, Phase.PUNT, Phase.PUNT_RETURN,
       Phase.GAME_OVER, Phase.OVERTIME_START, Phase.OVERTIME_FIELD_GOAL].includes(phase)) {
    elements.downText.textContent = '';
    elements.situationText.textContent = '';
    return;
  }

  // Touchdown phases
  if ([Phase.TOUCHDOWN_CONVERSION, Phase.EXTRA_POINT, Phase.TWO_POINT_CONVERSION].includes(phase)) {
    elements.downText.textContent = 'Touchdown!';
    elements.situationText.textContent = `${offenseTeam().name} scored`;
    return;
  }

  const downNames = ['1st', '2nd', '3rd', '4th'];
  const cupsToGo = gameState.offenseTeam === 1
    ? Math.max(0, gameState.firstDownMarker - gameState.ballPosition)
    : Math.max(0, gameState.ballPosition - gameState.firstDownMarker);
  const isGoalRange = gameState.offenseTeam === 1
    ? gameState.ballPosition > TOTAL_CUPS - CUPS_TO_FIRST_DOWN
    : gameState.ballPosition <= CUPS_TO_FIRST_DOWN;

  elements.downText.textContent = (isGoalRange || cupsToGo <= 0)
    ? `${downNames[gameState.down - 1]} & Goal`
    : `${downNames[gameState.down - 1]} & ${cupsToGo}`;
  elements.situationText.textContent = `${offenseTeam().name} ball at ${cupToLabel(gameState.ballPosition)}`;
}

function renderField() {
  elements.field.innerHTML = '';

  // Create cups
  for (let i = 1; i <= TOTAL_CUPS; i++) {
    const cup = document.createElement('div');
    cup.className = `cup ${cupColorClass(i)}`;

    if (i === gameState.ballPosition) {
      cup.classList.add('has-ball');
      const football = document.createElement('span');
      football.className = 'football';
      football.textContent = '🏈';
      cup.appendChild(football);
    }

    const label = document.createElement('span');
    label.textContent = cupDisplayLabel(i);
    cup.appendChild(label);
    elements.field.appendChild(cup);
  }

  // First down marker (only during play phases)
  const playPhases = [Phase.NORMAL_PLAY, Phase.PLAY_RESULT, Phase.FOURTH_DOWN_DECISION, Phase.FIELD_GOAL_ATTEMPT];
  if (playPhases.includes(gameState.phase) &&
      gameState.firstDownMarker >= 1 && gameState.firstDownMarker <= TOTAL_CUPS) {
    const marker = document.createElement('div');
    marker.className = 'first-down-marker';
    // Position marker to align with cup centers
    // Field has 10px padding on each side, cups use space-around layout
    const fraction = (gameState.firstDownMarker - 0.5) / TOTAL_CUPS;
    marker.style.left = `calc(${fraction * 100}% + ${10 - fraction * 20}px)`;
    elements.field.appendChild(marker);
  }

  // Endzone labels
  elements.endzoneLeft.querySelector('.endzone-label').textContent = gameState.team1.name.toUpperCase();
  elements.endzoneRight.querySelector('.endzone-label').textContent = gameState.team2.name.toUpperCase();

  // Endzone football
  elements.endzoneLeft.querySelectorAll('.football').forEach(f => f.remove());
  elements.endzoneRight.querySelectorAll('.football').forEach(f => f.remove());

  if (gameState.ballPosition === 0 || gameState.ballPosition === 21) {
    const football = document.createElement('span');
    football.className = 'football endzone-football';
    football.textContent = '🏈';
    (gameState.ballPosition === 0 ? elements.endzoneLeft : elements.endzoneRight).appendChild(football);
  }
}

// Control renderers
const controlRenderers = {
  [Phase.COIN_TOSS]: () => `
    <div class="control-section">
      <h3>Coin toss - who receives the opening kickoff?</h3>
      <div class="button-row">
        <button class="btn btn-team1" data-action="coin-toss" data-team="1">${gameState.team1.name}</button>
        <button class="btn btn-team2" data-action="coin-toss" data-team="2">${gameState.team2.name}</button>
      </div>
    </div>`,

  [Phase.KICKOFF]: () => {
    const kickingTeam = defenseTeam();
    return `
      <div class="control-section">
        <h3>${kickingTeam.name} kicks off - where did the ball land?</h3>
        <div class="cup-select-grid">${renderCupSelectGrid('kickoff-land')}</div>
        <div class="button-row" style="margin-top: 1rem;">
          <button class="btn btn-warning" data-action="kickoff-miss">Missed all cups (start at 7)</button>
        </div>
      </div>`;
  },

  [Phase.KICKOFF_RETURN]: () => `
    <div class="control-section">
      <h3>${offenseTeam().name} returns from ${cupToLabel(gameState.kickResult)} - which cup did the return hit?</h3>
      <div class="cup-select-grid">${renderCupSelectGrid('return-hit')}</div>
      <div class="button-row" style="margin-top: 1rem;">
        <button class="btn btn-warning" data-action="return-miss">Missed (no change)</button>
      </div>
    </div>`,

  [Phase.NORMAL_PLAY]: () => `
    <div class="control-section">
      <span class="offense-indicator offense-team${gameState.offenseTeam}">${offenseTeam().name} offense</span>
      <h3>How many players is the offense sending?</h3>
      <div class="button-row">
        <button class="btn btn-neutral" data-action="spike">Spike</button>
        <button class="btn btn-primary" data-action="select-players" data-count="1">1 (vs 2)</button>
        <button class="btn btn-primary" data-action="select-players" data-count="2">2 (vs 3)</button>
        <button class="btn btn-primary" data-action="select-players" data-count="3">3 (vs 4)</button>
        <button class="btn btn-primary" data-action="select-players" data-count="4">4 (vs 5)</button>
      </div>
    </div>`,

  [Phase.PLAY_RESULT]: () => {
    const { offensePlayers } = gameState.pendingPlay;
    const defensePlayers = offensePlayers + 1;
    const buttons = [];

    // Loss buttons
    for (let i = offensePlayers; i >= 1; i--) {
      const isInt = i === offensePlayers && offensePlayers > 1;
      buttons.push(`<button class="btn ${isInt ? 'btn-danger' : 'btn-warning'}" data-action="result" data-yards="${-i}">${isInt ? `-${i} INT` : `-${i}`}</button>`);
    }
    buttons.push(`<button class="btn btn-neutral" data-action="result" data-yards="0">Tie</button>`);
    for (let i = 1; i <= defensePlayers; i++) {
      buttons.push(`<button class="btn btn-success" data-action="result" data-yards="${i}">+${i}</button>`);
    }

    return `
      <div class="control-section">
        <h3>Flip cup result (${offensePlayers} vs ${defensePlayers})</h3>
        <div class="button-row">${buttons.join('')}</div>
      </div>`;
  },

  [Phase.FOURTH_DOWN_DECISION]: () => `
    <div class="control-section">
      <h3>4th down - ${offenseTeam().name}, what's the call?</h3>
      <div class="button-row">
        <button class="btn btn-danger" data-action="fourth-down" data-choice="go">Go for it</button>
        <button class="btn btn-warning" data-action="fourth-down" data-choice="punt">Punt</button>
        <button class="btn btn-primary" data-action="fourth-down" data-choice="fg">Field goal attempt</button>
      </div>
    </div>`,

  [Phase.PUNT]: () => `
    <div class="control-section">
      <h3>${offenseTeam().name} punts from ${cupToLabel(gameState.ballPosition)} - which cup did the punter hit?</h3>
      <div class="cup-select-grid">${renderCupSelectGrid('punt-hit')}</div>
      <div class="button-row" style="margin-top: 1rem;">
        <button class="btn btn-warning" data-action="punt-miss">Missed (base punt of 10)</button>
      </div>
    </div>`,

  [Phase.PUNT_RETURN]: () => `
    <div class="control-section">
      <h3>${defenseTeam().name} returns punt from ${cupToLabel(gameState.puntResult)} - which cup did the returner hit?</h3>
      <div class="cup-select-grid">${renderCupSelectGrid('punt-return-hit')}</div>
      <div class="button-row" style="margin-top: 1rem;">
        <button class="btn btn-warning" data-action="punt-return-miss">Missed (no change)</button>
      </div>
    </div>`,

  [Phase.FIELD_GOAL_ATTEMPT]: () => `
    <div class="control-section">
      <h3>${offenseTeam().name} attempts field goal from ${cupToLabel(gameState.ballPosition)}</h3>
      <div class="button-row">
        <button class="btn btn-success" data-action="field-goal" data-result="make">Made it! (+3 points)</button>
        <button class="btn btn-danger" data-action="field-goal" data-result="miss">Missed (turnover)</button>
      </div>
    </div>`,

  [Phase.TOUCHDOWN_CONVERSION]: () => `
    <div class="control-section">
      <h3>Touchdown ${offenseTeam().name}! Choose conversion:</h3>
      <div class="button-row">
        <button class="btn btn-primary" data-action="conversion-choice" data-choice="xp">Extra point (1 pt - pong shot)</button>
        <button class="btn btn-warning" data-action="conversion-choice" data-choice="2pt">Two-point conversion (1v1 flip cup)</button>
      </div>
    </div>`,

  [Phase.EXTRA_POINT]: () => `
    <div class="control-section">
      <h3>Extra point attempt</h3>
      <div class="button-row">
        <button class="btn btn-success" data-action="extra-point" data-result="make">Made it! (+1 point)</button>
        <button class="btn btn-danger" data-action="extra-point" data-result="miss">Missed</button>
      </div>
    </div>`,

  [Phase.TWO_POINT_CONVERSION]: () => `
    <div class="control-section">
      <h3>Two-point conversion - 1v1 flip cup</h3>
      <div class="button-row">
        <button class="btn btn-success" data-action="two-point" data-result="make">${offenseTeam().name} wins (+2 points)</button>
        <button class="btn btn-danger" data-action="two-point" data-result="miss">Defense wins (no points)</button>
      </div>
    </div>`,

  [Phase.GAME_OVER]: () => {
    const winner = gameState.team1.score > gameState.team2.score ? gameState.team1 :
                   gameState.team2.score > gameState.team1.score ? gameState.team2 : null;
    if (!winner) {
      return `
        <div class="control-section">
          <h3>Game tied! Going to overtime.</h3>
          <div class="button-row">
            <button class="btn btn-primary" data-action="start-overtime">Start overtime</button>
          </div>
        </div>`;
    }
    return `
      <div class="control-section">
        <h3>Game over! ${winner.name} wins ${gameState.team1.score} - ${gameState.team2.score}</h3>
        <div class="button-row">
          <button class="btn btn-primary" data-action="new-game">New game</button>
        </div>
      </div>`;
  },

  [Phase.OVERTIME_START]: () => `
    <div class="control-section">
      <h3>Overtime! Each team gets one possession from cup 10.</h3>
      <div class="button-row">
        <button class="btn btn-team1" data-action="ot-first" data-team="1">${gameState.team1.name} has ball first</button>
        <button class="btn btn-team2" data-action="ot-first" data-team="2">${gameState.team2.name} has ball first</button>
      </div>
    </div>`,

  [Phase.OVERTIME_FIELD_GOAL]: () => `
    <div class="control-section">
      <h3>OT field goal shootout - ${offenseTeam().name} from ${cupToLabel(gameState.overtimeFieldGoalPosition)}</h3>
      <div class="button-row">
        <button class="btn btn-success" data-action="ot-fg" data-result="make">Made it!</button>
        <button class="btn btn-danger" data-action="ot-fg" data-result="miss">Missed</button>
      </div>
    </div>`
};

function renderControls() {
  const renderer = controlRenderers[gameState.phase];
  elements.controls.innerHTML = renderer ? renderer() : '';
  elements.controls.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleAction);
  });
}

// ============ Action Handling ============

const actionHandlers = {
  'coin-toss': e => handleCoinToss(parseInt(e.target.dataset.team)),
  'kickoff-land': e => handleKickoffLand(parseInt(e.target.dataset.cup)),
  'kickoff-miss': () => handleKickoffLand(gameState.offenseTeam === 1 ? 7 : 14),
  'return-hit': e => handleReturn(parseInt(e.target.dataset.cup)),
  'return-miss': () => handleReturn(null),
  'punt-hit': e => handlePuntKick(parseInt(e.target.dataset.cup)),
  'punt-miss': () => handlePuntKick(null),
  'punt-return-hit': e => handlePuntReturn(parseInt(e.target.dataset.cup)),
  'punt-return-miss': () => handlePuntReturn(null),
  'select-players': e => handleSelectPlayers(parseInt(e.target.dataset.count)),
  'spike': handleSpike,
  'result': e => handlePlayResult(parseInt(e.target.dataset.yards)),
  'fourth-down': e => handleFourthDown(e.target.dataset.choice),
  'field-goal': e => handleFieldGoal(e.target.dataset.result),
  'conversion-choice': e => handleConversionChoice(e.target.dataset.choice),
  'extra-point': e => handleExtraPoint(e.target.dataset.result),
  'two-point': e => handleTwoPoint(e.target.dataset.result),
  'start-overtime': handleStartOvertime,
  'ot-first': e => handleOTFirst(parseInt(e.target.dataset.team)),
  'ot-fg': e => handleOTFieldGoal(e.target.dataset.result),
  'new-game': startNewGame
};

function handleAction(e) {
  const action = e.target.dataset.action;
  const handler = actionHandlers[action];
  if (handler) {
    pushHistory();
    handler(e);
    saveGame();
    render();
  }
}

// ============ Game Logic ============

function handleCoinToss(receivingTeam) {
  gameState.offenseTeam = receivingTeam;
  gameState.openingKickoffReceiver = receivingTeam;
  enterKickoffPhase();
}

function enterKickoffPhase() {
  // Ball in kicking team's endzone (opposite of receiver)
  gameState.ballPosition = gameState.offenseTeam === 1 ? 21 : 0;
  gameState.phase = Phase.KICKOFF;
}

function handleKickoffLand(cup) {
  gameState.kickResult = cup;
  gameState.phase = Phase.KICKOFF_RETURN;
}

function handleReturn(cup) {
  let startPosition = gameState.kickResult;
  if (cup !== null) {
    // Return modifier: hitting farther from your own endzone = better return
    // Team 1 throws toward cup 20, so cup - 10 (higher = better)
    // Team 2 throws toward cup 1, so (21 - cup) - 10 = 11 - cup (lower = better)
    const modifier = gameState.offenseTeam === 1 ? (cup - 10) : (11 - cup);
    startPosition = clampToField(startPosition + modifier * direction());
  }
  gameState.ballPosition = startPosition;
  startNewPossession();
}

function handleSelectPlayers(count) {
  gameState.pendingPlay = { offensePlayers: count };
  gameState.phase = Phase.PLAY_RESULT;
}

function handleSpike() {
  // Spike the ball - no flip cup played, just consume a down
  gameState.down++;
  checkDowns();
}

function handlePlayResult(yards) {
  const { offensePlayers } = gameState.pendingPlay;
  // Interception: max loss when offense sent > 1 player
  const isInterception = yards === -offensePlayers && offensePlayers > 1;
  gameState.pendingPlay = null;

  if (yards === 0) {
    // Tie - no gain, down consumed
    gameState.down++;
    checkDowns();
    return;
  }

  // Apply yardage in the direction the offense is moving
  gameState.ballPosition += yards * direction();

  // Check for touchdown (Team 1 scores at >20, Team 2 scores at <1)
  if ((gameState.offenseTeam === 1 && gameState.ballPosition > TOTAL_CUPS) ||
      (gameState.offenseTeam === 2 && gameState.ballPosition < 1)) {
    gameState.ballPosition = clampToField(gameState.ballPosition);
    scoreTouchdown();
    return;
  }

  // Check for safety (Team 1 safety at <1, Team 2 safety at >20)
  if ((gameState.offenseTeam === 1 && gameState.ballPosition < 1) ||
      (gameState.offenseTeam === 2 && gameState.ballPosition > TOTAL_CUPS)) {
    gameState.ballPosition = clampToField(gameState.ballPosition);
    scoreSafety();
    return;
  }

  // Interception: defense takes over at current spot
  if (isInterception) {
    if (flipPossession(false)) return; // Handled by OT transition
    startNewPossession();
    return;
  }

  // Check for first down
  const madeFirstDown = gameState.offenseTeam === 1
    ? gameState.ballPosition >= gameState.firstDownMarker
    : gameState.ballPosition <= gameState.firstDownMarker;

  if (madeFirstDown) {
    gameState.down = 1;
    setFirstDownMarker();
  } else {
    gameState.down++;
  }
  checkDowns();
}

function checkDowns() {
  if (gameState.down > 4) {
    // Turnover on downs
    if (flipPossession(true)) return; // Quarter transition handled (e.g., Q3 kickoff)
    startNewPossession();
  } else if (gameState.down === 4) {
    gameState.phase = Phase.FOURTH_DOWN_DECISION;
  } else {
    gameState.phase = Phase.NORMAL_PLAY;
  }
}

function handleFourthDown(choice) {
  if (choice === 'go') {
    gameState.phase = Phase.NORMAL_PLAY;
  } else if (choice === 'punt') {
    // Enter punt phase - punter shoots first
    gameState.phase = Phase.PUNT;
  } else if (choice === 'fg') {
    gameState.phase = Phase.FIELD_GOAL_ATTEMPT;
  }
}

function handlePuntKick(cup) {
  // Punter shot result - calculate punt landing position
  // Base punt = 10 cups, modifier = (cup - 10) for Team 1, (11 - cup) for Team 2
  let puntModifier = 0;
  if (cup !== null) {
    puntModifier = gameState.offenseTeam === 1 ? (cup - 10) : (11 - cup);
  }
  const puntDistance = 10 + puntModifier;
  const landingPosition = clampToField(gameState.ballPosition + puntDistance * direction());
  gameState.puntResult = landingPosition;
  gameState.phase = Phase.PUNT_RETURN;
}

function handlePuntReturn(cup) {
  let finalPosition = gameState.puntResult;
  if (cup !== null) {
    // Return modifier: receiving team wants to bring ball back toward their goal
    // Receiving team is the current defense (opposite of offense)
    // Team 2 receiving (offense=1): 11 - cup (hit cup 1 = +10 toward their endzone)
    // Team 1 receiving (offense=2): cup - 10 (hit cup 20 = +10 toward their endzone)
    const returnModifier = gameState.offenseTeam === 1 ? (11 - cup) : (cup - 10);
    // Return modifier moves ball toward the receiver's endzone (opposite of punt direction)
    finalPosition = clampToField(finalPosition - returnModifier * direction());
  }
  gameState.ballPosition = finalPosition;
  gameState.puntResult = null;
  if (flipPossession(true)) return; // Quarter transition handled
  startNewPossession();
}

function handleFieldGoal(result) {
  if (result === 'make') {
    addScore(gameState.offenseTeam, 3);
    startKickoff();
  } else {
    // Missed field goal: turnover at current spot
    if (flipPossession(true)) return; // Quarter transition handled
    startNewPossession();
  }
}

function scoreTouchdown() {
  addScore(gameState.offenseTeam, 6);
  // Put ball in the endzone they scored in
  // Team 1 scores in right endzone (position 21), Team 2 in left endzone (position 0)
  gameState.ballPosition = gameState.offenseTeam === 1 ? 21 : 0;
  gameState.phase = Phase.TOUCHDOWN_CONVERSION;
}

function scoreSafety() {
  // Defense scores 2 points, then offense kicks off to defense
  addScore(gameState.offenseTeam === 1 ? 2 : 1, 2);
  startKickoff(true); // true = safety kickoff (no possession flip before kick)
}

function handleConversionChoice(choice) {
  if (choice === 'xp') {
    // Extra point from the 7 yard line (7 cups from the endzone they scored in)
    // Team 1 scored in right endzone, kicks from cup 14; Team 2 from cup 7
    gameState.ballPosition = gameState.offenseTeam === 1 ? 14 : 7;
    gameState.phase = Phase.EXTRA_POINT;
  } else {
    gameState.phase = Phase.TWO_POINT_CONVERSION;
  }
}

function handleExtraPoint(result) {
  if (result === 'make') addScore(gameState.offenseTeam, 1);
  startKickoff();
}

function handleTwoPoint(result) {
  if (result === 'make') addScore(gameState.offenseTeam, 2);
  startKickoff();
}

function addScore(team, points) {
  getTeam(team).score += points;
}

// Start a fresh possession at current ball position
function startNewPossession() {
  gameState.down = 1;
  setFirstDownMarker();
  gameState.kickResult = null;
  gameState.phase = Phase.NORMAL_PLAY;
}

// Set first down marker in the direction the offense is moving
function setFirstDownMarker() {
  gameState.firstDownMarker = gameState.offenseTeam === 1
    ? Math.min(TOTAL_CUPS + 1, gameState.ballPosition + CUPS_TO_FIRST_DOWN)
    : Math.max(0, gameState.ballPosition - CUPS_TO_FIRST_DOWN);
}

function flipPossession(advancePossession = true) {
  // In overtime, any possession change triggers OT transition logic
  if (gameState.isOvertime) {
    return handleOTTransition();
  }
  gameState.offenseTeam = gameState.offenseTeam === 1 ? 2 : 1;
  // Ball stays at same absolute position - no coordinate flip needed
  return advancePossession ? advanceGameClock() : false;
}

function startKickoff(isSafetyKickoff = false) {
  // In overtime, no kickoffs - transition to next OT phase
  if (gameState.isOvertime) {
    handleOTTransition();
    return;
  }

  const handled = advanceGameClock();
  if (handled) return; // Quarter transition handled (game over or Q3 kickoff)

  if (!isSafetyKickoff) {
    // After score, scoring team kicks off - opponent receives
    gameState.offenseTeam = gameState.offenseTeam === 1 ? 2 : 1;
  }
  // After safety, current offense kicks (no flip needed)
  enterKickoffPhase();
}

function advanceGameClock() {
  if (gameState.isOvertime) return false;

  gameState.possession++;
  if (gameState.possession > POSSESSIONS_PER_QUARTER) {
    gameState.possession = 1;
    gameState.quarter++;

    if (gameState.quarter > TOTAL_QUARTERS) {
      gameState.phase = Phase.GAME_OVER;
      return true; // Handled specially
    }
    if (gameState.quarter === 3) {
      // Second half kickoff: team that didn't receive opening kickoff now receives
      gameState.offenseTeam = gameState.openingKickoffReceiver === 1 ? 2 : 1;
      enterKickoffPhase();
      return true; // Handled specially
    }
  }
  return false;
}

// ============ Overtime ============

function handleStartOvertime() {
  gameState.isOvertime = true;
  gameState.overtimeRound = 1;
  gameState.otFirstTeamDone = false;
  gameState.phase = Phase.OVERTIME_START;
}

function handleOTFirst(team) {
  gameState.offenseTeam = team;
  gameState.otFirstOffense = team;
  gameState.ballPosition = 10;
  gameState.otFirstTeamDone = false;
  startNewPossession();
}

// Handle OT possession transitions (after turnover, score, etc.)
function handleOTTransition() {
  if (!gameState.otFirstTeamDone) {
    // First team just finished - give second team ball at 10
    gameState.otFirstTeamDone = true;
    gameState.offenseTeam = gameState.otFirstOffense === 1 ? 2 : 1;
    gameState.ballPosition = 10;
    startNewPossession();
    return true;
  } else {
    // Both teams have had possessions - check for winner
    if (gameState.team1.score !== gameState.team2.score) {
      gameState.phase = Phase.GAME_OVER;
    } else {
      // Still tied - go to FG shootout
      gameState.phase = Phase.OVERTIME_FIELD_GOAL;
      gameState.overtimeFieldGoalPosition = 10;
      gameState.ballPosition = 10;
      gameState.offenseTeam = gameState.otFirstOffense;
      gameState.otFirstTeamMade = false;
      gameState.otFirstTeamMissed = false;
    }
    return true;
  }
}

function handleOTFieldGoal(result) {
  const currentTeam = gameState.offenseTeam;
  const otherTeam = currentTeam === 1 ? 2 : 1;

  if (result === 'make') {
    if (!gameState.otFirstTeamMade) {
      // First team made it, other team needs to match
      gameState.otFirstTeamMade = true;
      gameState.otFirstTeam = currentTeam;
      gameState.offenseTeam = otherTeam;
    } else {
      // Both teams made it - move back and continue
      gameState.overtimeFieldGoalPosition--;
      gameState.ballPosition = gameState.overtimeFieldGoalPosition;
      gameState.otFirstTeamMade = false;
      gameState.offenseTeam = gameState.otFirstTeam;
    }
  } else {
    if (gameState.otFirstTeamMade) {
      // First team made, second missed - first team wins
      gameState.phase = Phase.GAME_OVER;
      return;
    }
    // First team missed, second team tries
    gameState.otFirstTeamMissed = true;
    gameState.otFirstTeam = currentTeam;
    gameState.offenseTeam = otherTeam;
  }

  if (gameState.otFirstTeamMissed && result === 'make') {
    // Second team wins (first missed, second made)
    gameState.phase = Phase.GAME_OVER;
  }
}

// ============ Screen Management ============

function showSetup() {
  elements.setupScreen.style.display = 'block';
  elements.gameScreen.style.display = 'none';
  elements.resumeGame.style.display = loadGame() ? 'block' : 'none';
}

function showGame() {
  elements.setupScreen.style.display = 'none';
  elements.gameScreen.style.display = 'flex';
  applyTeamColors();
  render();
}

function startNewGame() {
  gameState = createInitialState(
    elements.team1Name.value || 'Home',
    elements.team1Color.value,
    elements.team2Name.value || 'Away',
    elements.team2Color.value
  );
  clearSavedGame();
  saveGame();
  showGame();
}

function resumeGame() {
  gameState = loadGame();
  if (!gameState) {
    clearSavedGame();
    elements.resumeGame.style.display = 'none';
    return;
  }
  showGame();
}

// ============ Init ============

function init() {
  initElements();

  elements.startGame.addEventListener('click', startNewGame);
  elements.resumeGame.addEventListener('click', resumeGame);
  elements.newGame.addEventListener('click', () => {
    if (confirm('Start a new game? Current progress will be lost.')) {
      clearSavedGame();
      showSetup();
    }
  });
  elements.undo.addEventListener('click', undo);

  showSetup();
}

document.addEventListener('DOMContentLoaded', init);
