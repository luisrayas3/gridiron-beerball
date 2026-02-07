// Gridiron Beerball - Game Tracker

const STORAGE_KEY = 'gridiron-beerball-game';
const CUPS_TO_FIRST_DOWN = 3;
const TOTAL_CUPS = 19;
const POSSESSIONS_PER_QUARTER = 4;
const TOTAL_QUARTERS = 4;

// Flip cup yardage schedule: unflipped cups -> yards gained/lost
// 1→1, 2→2, 3→5, 4→9, 5→TD
const FLIP_CUP_YARDAGE = [0, 1, 2, 5, 9, 'TD']; // index = unflipped cups

// Game phases
const Phase = {
  COIN_TOSS: 'coin_toss',
  KICKOFF: 'kickoff',
  KICKOFF_KICK: 'kickoff_kick',
  ONSIDE_KICK: 'onside_kick',
  KICKOFF_RETURN: 'kickoff_return',
  NORMAL_PLAY: 'normal_play',
  PLAY_RESULT: 'play_result',
  THROW_PLAY: 'throw_play',
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

// Throwing zones and gains (relative to direction)
// Team 1 throws toward cup 19, Team 2 toward cup 1
// These are relative positions (1-19 from offense perspective)
const THROW_ZONES = {
  // Middle zone (no call needed): positions 7-13
  // Positions 10-13: gains 1, 2, 3, 4
  // Positions 7-9: losses -2, -1, 0 (3 spots behind midfield)
  MIDDLE_START: 7,   // own 35 yard line (loss of 2)
  MIDDLE_END: 13,    // opponent's 35 yard line (gain of 4)
  // Behind middle zone: positions 1-6 (own 30 to own 5) - immediate incomplete
  IMMEDIATE_INCOMPLETE_END: 6,  // own 30 yard line
  // Danger zone: positions 14-16
  INCOMPLETE_30: 14,    // opponent's 30 yard line - incomplete (ends throws)
  INTERCEPTION: 15,     // opponent's 25 yard line - INT
  INCOMPLETE_20: 16,    // opponent's 20 yard line - incomplete (ends throws)
  // Deep zone (must call): positions 17-19 (opponent's 15, 10, 5)
  DEEP_START: 17,       // opponent's 15 yard line, gain 6
  DEEP_END: 19          // opponent's 5 yard line, TD
};

// Gains for deep zone: position 17→6, 18→9, 19→TD
const DEEP_GAINS = { 17: 6, 18: 9, 19: 'TD' };


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
    lastPlayResult: null,  // { team: 1|2, type: 'gain'|'loss'|'neutral'|'turnover'|'td', text: '1'|'0'|etc }
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
// Team 1 moves toward cup 19 (+1), Team 2 moves toward cup 1 (-1)
function direction() {
  return gameState.offenseTeam === 1 ? 1 : -1;
}

// Convert a cup position to its zone position (1-19) relative to offense direction
// Team 1: cups map directly (cup 19 is farthest)
// Team 2: cups are mirrored (cup 1 is farthest)
function toRelativePosition(cup) {
  return gameState.offenseTeam === 1 ? cup : (20 - cup);
}

// Convert relative position back to actual cup
function fromRelativePosition(relPos) {
  return gameState.offenseTeam === 1 ? relPos : (20 - relPos);
}

// Get throw result for a cup hit
// Returns { type: 'gain'|'incomplete'|'incomplete_end'|'interception'|'touchdown', yards: number|null }
// 'incomplete_end' means incomplete AND ends all remaining throws
function getThrowResult(cup, calledCup) {
  const relPos = toRelativePosition(cup);
  const calledRelPos = calledCup ? toRelativePosition(calledCup) : null;

  // Middle zone (positions 7-13): gains or losses, no call needed
  if (relPos >= THROW_ZONES.MIDDLE_START && relPos <= THROW_ZONES.MIDDLE_END) {
    // If something was called, middle zone = incomplete (ends throws)
    if (calledRelPos !== null) {
      return { type: 'incomplete_end', yards: null };
    }
    // Gain/loss schedule: 7→-2, 8→-1, 9→0, 10→1, 11→2, 12→3, 13→4
    const yards = relPos - 9;
    return { type: 'gain', yards };
  }

  // Behind middle zone (positions 1-6): immediate incomplete (ends throws)
  if (relPos <= THROW_ZONES.IMMEDIATE_INCOMPLETE_END) {
    return { type: 'incomplete_end', yards: null };
  }

  // Danger zone: incomplete (ends throws) or interception
  if (relPos === THROW_ZONES.INCOMPLETE_30 || relPos === THROW_ZONES.INCOMPLETE_20) {
    return { type: 'incomplete_end', yards: null };
  }
  if (relPos === THROW_ZONES.INTERCEPTION) {
    return { type: 'interception', yards: null };
  }

  // Deep zone (positions 17-19): must have called, and hit at least as far
  if (relPos >= THROW_ZONES.DEEP_START && relPos <= THROW_ZONES.DEEP_END) {
    // If nothing was called, incomplete (ends throws)
    if (calledRelPos === null) {
      return { type: 'incomplete_end', yards: null };
    }
    // Must hit at least as far as called
    if (relPos < calledRelPos) {
      return { type: 'incomplete_end', yards: null };
    }
    // Get gain based on what was CALLED (not what was hit)
    const gain = DEEP_GAINS[calledRelPos];
    if (gain === 'TD') {
      return { type: 'touchdown', yards: null };
    }
    return { type: 'gain', yards: gain };
  }

  // Shouldn't reach here, but default to incomplete
  return { type: 'incomplete', yards: null };
}

// Get the callable deep zone cups (for UI display)
// Returns array of { cup: actual cup#, relPos: 17-19, gain: 6, 9, or 'TD' }
function getDeepZoneCups() {
  const cups = [];
  for (let relPos = THROW_ZONES.DEEP_START; relPos <= THROW_ZONES.DEEP_END; relPos++) {
    const actualCup = fromRelativePosition(relPos);
    const gain = DEEP_GAINS[relPos];
    cups.push({ cup: actualCup, relPos, gain });
  }
  return cups;
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

// Get display label for a cup (yard lines)
// Cup 10 = 50 yard line, cups 1-9 = 5-45, cups 11-19 = 45-5
function cupDisplayLabel(cup) {
  if (cup <= 10) return cup * 5;
  return (20 - cup) * 5;
}

// Get CSS class for cup based on which team's territory
// Left half (cups 1-9): Team 1's territory (their endzone is beyond cup 1)
// Midfield (cup 10): 50 yard line, neutral
// Right half (cups 11-19): Team 2's territory (their endzone is beyond cup 19)
function cupColorClass(cup) {
  if (cup < 10) return 'team1-half';
  if (cup > 10) return 'team2-half';
  return 'midfield';
}

// Convert cup position to display string with team abbreviation
function cupToLabel(cup) {
  if (!gameState) return `${cupDisplayLabel(cup)}`;
  if (cup === 10) return '50';
  const team = cup < 10 ? gameState.team1 : gameState.team2;
  const abbrev = team.name.substring(0, 3).toUpperCase();
  return `${abbrev} ${cupDisplayLabel(cup)}`;
}

// Render a grid of cup selection buttons
function renderCupSelectGrid(action, colorByPosition = false, goodDirectionRight = true) {
  return Array.from({length: TOTAL_CUPS}, (_, i) => i + 1).map(cup => {
    let btnClass = 'btn cup-select-btn';
    // Modifier: cup 10 = +1, range -8 to +10
    const modifier = goodDirectionRight ? (cup - 9) : (11 - cup);
    // Total ball movement = base 10 + modifier (range: +2 to +20)
    const totalMovement = 10 + modifier;
    
    if (colorByPosition) {
      // Color relative to miss value (+10)
      if (totalMovement > 10) {
        btnClass += ' btn-success'; // Better than miss
      } else if (totalMovement === 10) {
        btnClass += ' btn-neutral'; // Same as miss
      } else {
        btnClass += ' btn-warning'; // Worse than miss
      }
    }
    const label = `+${totalMovement}`;
    return `<button class="${btnClass}" data-action="${action}" data-cup="${cup}">${label}</button>`;
  }).join('');
}

function renderKickoffReturnGrid(action) {
  // kickResult is now actual landing position (can be < 1 or > 19)
  const kickLanding = gameState.kickResult;
  const isTeam1 = gameState.offenseTeam === 1;

  // Categorize cups into TD, normal, and recovery
  const tdCups = [];
  const normalCups = [];
  const recoveryCups = [];

  for (let cup = 1; cup <= TOTAL_CUPS; cup++) {
    // Return modifier: cup 10 = +1, range -8 to +10
    const returnModifier = isTeam1 ? (cup - 9) : (11 - cup);

    // Calculate what final position would be
    const finalPosition = isTeam1
      ? kickLanding + returnModifier
      : kickLanding - returnModifier;

    // Check for touchdown: return goes into opponent's endzone
    const isTD = isTeam1 ? (finalPosition > 19) : (finalPosition < 1);

    // Check for kick recovery: return negative AND final position in own endzone
    const finalInOwnEndzone = isTeam1 ? (finalPosition < 1) : (finalPosition > 19);
    const isRecovery = returnModifier < 0 && finalInOwnEndzone;

    if (isTD) {
      tdCups.push(cup);
    } else if (isRecovery) {
      recoveryCups.push(cup);
    } else {
      normalCups.push({ cup, returnModifier });
    }
  }

  const buttons = [];

  // Single TD button if any TD scenarios
  if (tdCups.length > 0) {
    buttons.push(`<button class="btn cup-select-btn btn-special btn-success" data-action="${action}" data-cup="${tdCups[0]}" data-td="true">Touchdown</button>`);
  }

  // Normal buttons
  normalCups.forEach(({ cup, returnModifier }) => {
    let btnClass = 'btn cup-select-btn';
    let label;

    if (returnModifier > 0) {
      btnClass += ' btn-success';
      label = `+${returnModifier}`;
    } else if (returnModifier === 0) {
      btnClass += ' btn-neutral';
      label = '0';
    } else {
      btnClass += ' btn-warning';
      label = returnModifier.toString();
    }

    buttons.push(`<button class="${btnClass}" data-action="${action}" data-cup="${cup}">${label}</button>`);
  });

  // Single Recovery button if any recovery scenarios
  if (recoveryCups.length > 0) {
    buttons.push(`<button class="btn cup-select-btn btn-special btn-danger" data-action="${action}" data-cup="${recoveryCups[0]}" data-recovery="true">Recovery</button>`);
  }

  return buttons.join('');
}

function renderPuntReturnGrid(action) {
  const puntResult = gameState.puntResult;
  const isTeam1 = gameState.offenseTeam === 1; // Offense is the PUNTING team
  const returnerIsTeam1 = !isTeam1; // Returner is the other team

  // Categorize cups into TD, normal, and recovery
  const tdCups = [];
  const normalCups = [];
  const recoveryCups = [];

  for (let cup = 1; cup <= TOTAL_CUPS; cup++) {
    // Calculate return effect with new +1 formula (-8 to +10)
    const returnModifier = returnerIsTeam1 ? (cup - 9) : (11 - cup);

    // Calculate what final position would be
    const dir = isTeam1 ? 1 : -1; // Punting direction
    const finalPosition = puntResult - returnModifier * dir;

    // Check for touchdown: return goes into opponent's endzone
    // Returner Team 1 scores in right endzone (> 19), Returner Team 2 scores in left endzone (< 1)
    const isTD = returnerIsTeam1 ? (finalPosition > 19) : (finalPosition < 1);

    // Check for punt recovery: return negative AND final position in own endzone
    const finalInOwnEndzone = returnerIsTeam1 ? (finalPosition < 1) : (finalPosition > 19);
    const isRecovery = returnModifier < 0 && finalInOwnEndzone;

    if (isTD) {
      tdCups.push(cup);
    } else if (isRecovery) {
      recoveryCups.push(cup);
    } else {
      normalCups.push({ cup, returnModifier });
    }
  }

  const buttons = [];

  // Single TD button if any TD scenarios
  if (tdCups.length > 0) {
    buttons.push(`<button class="btn cup-select-btn btn-special btn-success" data-action="${action}" data-cup="${tdCups[0]}" data-td="true">Touchdown</button>`);
  }

  // Normal buttons
  normalCups.forEach(({ cup, returnModifier }) => {
    let btnClass = 'btn cup-select-btn';
    let label;

    if (returnModifier > 0) {
      btnClass += ' btn-success';
      label = `+${returnModifier}`;
    } else if (returnModifier === 0) {
      btnClass += ' btn-neutral';
      label = '0';
    } else {
      btnClass += ' btn-warning';
      label = returnModifier.toString();
    }

    buttons.push(`<button class="${btnClass}" data-action="${action}" data-cup="${cup}">${label}</button>`);
  });

  // Single Recovery button if any recovery scenarios
  if (recoveryCups.length > 0) {
    buttons.push(`<button class="btn cup-select-btn btn-special btn-danger" data-action="${action}" data-cup="${recoveryCups[0]}" data-recovery="true">Recovery</button>`);
  }

  return buttons.join('');
}



// ============ DOM Elements ============

const elements = {};

function initElements() {
  const ids = [
    'setup-screen', 'game-screen', 'team1-name', 'team1-color', 'team2-name', 'team2-color',
    'start-game', 'resume-game', 'score-team1-name', 'score-team2-name', 'score-team1', 'score-team2',
    'quarter-display', 'possession-display', 'down-text', 'situation-text', 'field',
    'endzone-left', 'endzone-right', 'controls', 'new-game', 'undo',
    'result-indicators-top', 'result-indicators-bottom'
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
  const downNames = ['1st', '2nd', '3rd', '4th'];

  // Game not started or over
  if (phase === Phase.COIN_TOSS) {
    elements.downText.textContent = 'Coin Toss';
    elements.situationText.textContent = '';
    return;
  }

  if (phase === Phase.GAME_OVER) {
    elements.downText.textContent = 'Game Over';
    elements.situationText.textContent = '';
    return;
  }

  if (phase === Phase.OVERTIME_START) {
    elements.downText.textContent = 'Overtime';
    elements.situationText.textContent = '';
    return;
  }

  // Touchdown phases
  if ([Phase.TOUCHDOWN_CONVERSION, Phase.EXTRA_POINT, Phase.TWO_POINT_CONVERSION].includes(phase)) {
    elements.downText.textContent = 'Touchdown!';
    elements.situationText.textContent = `${offenseTeam().name} scored`;
    return;
  }

  // Overtime field goal
  if (phase === Phase.OVERTIME_FIELD_GOAL) {
    elements.downText.textContent = 'OT Field Goal';
    elements.situationText.textContent = `${offenseTeam().name}`;
    return;
  }

  // Calculate down & distance info (used for normal plays and special plays)
  const cupsToGo = gameState.offenseTeam === 1
    ? Math.max(0, gameState.firstDownMarker - gameState.ballPosition)
    : Math.max(0, gameState.ballPosition - gameState.firstDownMarker);
  const isGoalRange = gameState.offenseTeam === 1
    ? gameState.ballPosition > TOTAL_CUPS - CUPS_TO_FIRST_DOWN
    : gameState.ballPosition <= CUPS_TO_FIRST_DOWN;
  const downText = (isGoalRange || cupsToGo <= 0)
    ? `${downNames[gameState.down - 1]} & Goal`
    : `${downNames[gameState.down - 1]} & ${cupsToGo}`;

  // Kickoff phases - show kickoff situation
  if ([Phase.KICKOFF, Phase.KICKOFF_KICK, Phase.ONSIDE_KICK, Phase.KICKOFF_RETURN].includes(phase)) {
    const kickingTeam = defenseTeam();
    elements.downText.textContent = 'Kickoff';
    elements.situationText.textContent = `${kickingTeam.name} kicking`;
    return;
  }

  // Punt phases - show current down (usually 4th) and punt situation
  if ([Phase.PUNT, Phase.PUNT_RETURN].includes(phase)) {
    elements.downText.textContent = downText;
    if (phase === Phase.PUNT) {
      elements.situationText.textContent = `${offenseTeam().name} punting`;
    } else {
      elements.situationText.textContent = `${defenseTeam().name} returning`;
    }
    return;
  }

  // Normal play phases
  elements.downText.textContent = downText;
  elements.situationText.textContent = `${offenseTeam().name} ball at ${cupToLabel(gameState.ballPosition)}`;
}

function renderField() {
  elements.field.innerHTML = '';

  // Determine ball position based on phase
  let ballPos = gameState.ballPosition;
  const kickingPhases = [Phase.KICKOFF, Phase.KICKOFF_KICK, Phase.ONSIDE_KICK];
  const conversionPhases = [Phase.TOUCHDOWN_CONVERSION, Phase.EXTRA_POINT, Phase.TWO_POINT_CONVERSION];

  if (gameState.phase === Phase.COIN_TOSS) {
    ballPos = 10; // Midfield
  } else if (kickingPhases.includes(gameState.phase)) {
    // Ball at kicking team's 25 (kicking team is defense during kickoff)
    // Team 1 kicks from cup 5, Team 2 kicks from cup 15
    ballPos = gameState.offenseTeam === 1 ? 15 : 5;
  } else if (gameState.phase === Phase.TWO_POINT_CONVERSION) {
    // Ball at opponent's 5 yard line for 2-point conversion
    ballPos = gameState.offenseTeam === 1 ? 19 : 1;
  } else if (conversionPhases.includes(gameState.phase)) {
    // Ball in endzone where touchdown was scored (TD celebration, XP)
    ballPos = gameState.offenseTeam === 1 ? 20 : 0;
  } else if (gameState.phase === Phase.PUNT_RETURN && gameState.puntResult !== null) {
    // Ball at where punt landed (can be in endzone if < 1 or > 19)
    const puntLanding = gameState.puntResult;
    if (puntLanding < 1) {
      ballPos = 0; // Show in left endzone
    } else if (puntLanding > TOTAL_CUPS) {
      ballPos = 20; // Show in right endzone
    } else {
      ballPos = puntLanding;
    }
  } else if (gameState.phase === Phase.KICKOFF_RETURN && gameState.kickResult !== null) {
    // Ball at where kick landed (can be in endzone if < 1 or > 19)
    const kickLanding = gameState.kickResult;
    if (kickLanding < 1) {
      ballPos = 0; // Show in left endzone
    } else if (kickLanding > TOTAL_CUPS) {
      ballPos = 20; // Show in right endzone
    } else {
      ballPos = kickLanding;
    }
  }

  // Determine if we should show direction arrow and throwing indicator
  const showDirection = gameState.phase !== Phase.COIN_TOSS && gameState.phase !== Phase.GAME_OVER;
  const throwingPhases = [Phase.THROW_PLAY, Phase.KICKOFF_KICK, Phase.ONSIDE_KICK, Phase.KICKOFF_RETURN,
                          Phase.PUNT, Phase.PUNT_RETURN, Phase.FIELD_GOAL_ATTEMPT, Phase.EXTRA_POINT];
  const isThrowing = throwingPhases.includes(gameState.phase);

  // Offense direction: Team 1 goes right (toward cup 19), Team 2 goes left (toward cup 1)
  const offenseGoesRight = gameState.offenseTeam === 1;

  // === TOP ROW: Football position ===
  const ballRow = document.createElement('div');
  ballRow.className = 'field-row ball-row';

  // During return phases, show ball in first row even if in endzone
  const returnPhases = [Phase.KICKOFF_RETURN, Phase.PUNT_RETURN];
  const isReturnPhase = returnPhases.includes(gameState.phase);
  const showBallInRow = (ballPos >= 1 && ballPos <= TOTAL_CUPS) || (isReturnPhase && (ballPos === 0 || ballPos === 20));

  // Football
  if (showBallInRow) {
    const ball = document.createElement('span');
    ball.className = 'ball-position';
    // For endzone positions during returns, show in endzone area (negative/overflow)
    const displayPos = ballPos === 0 ? -3 : (ballPos === 20 ? 103 : ballPos * 5);
    ball.style.left = `${displayPos}%`;
    ball.textContent = '🏈';
    ballRow.appendChild(ball);
  }

  // Direction arrow next to ball (also show in endzone during returns)
  if (showDirection && (showBallInRow || (ballPos >= 1 && ballPos <= TOTAL_CUPS))) {
    // Determine arrow direction based on phase
    const isKickoff = kickingPhases.includes(gameState.phase);
    const isKickoffReturn = gameState.phase === Phase.KICKOFF_RETURN;
    const isPuntReturn = gameState.phase === Phase.PUNT_RETURN;
    
    let arrowRight;
    if (isKickoff) {
      // Kicking: arrow goes opposite to offense (kick goes toward receiver's endzone)
      arrowRight = !offenseGoesRight;
    } else if (isKickoffReturn) {
      // Kickoff return: returner IS offense, goes toward their scoring endzone
      arrowRight = offenseGoesRight;
    } else if (isPuntReturn) {
      // Punt return: returner is defense (opposite team), goes opposite to offense
      arrowRight = !offenseGoesRight;
    } else {
      // Normal play: offense direction
      arrowRight = offenseGoesRight;
    }
    const arrow = document.createElement('span');
    arrow.className = 'direction-arrow';
    // Calculate arrow position (handle endzone positions)
    const arrowBasePos = ballPos === 0 ? 0 : (ballPos === 20 ? 100 : ballPos * 5);
    arrow.style.left = `${arrowBasePos + (arrowRight ? 3 : -3)}%`;
    arrow.style.transform = 'translateX(-50%) translateY(-50%)';
    arrow.textContent = arrowRight ? '>>>' : '<<<';
    ballRow.appendChild(arrow);
  }

  elements.field.appendChild(ballRow);

  // === MIDDLE ROW: Cup effects ===
  const effectRow = document.createElement('div');
  effectRow.className = 'field-row effect-row';

  // Throwing indicator at thrower's end (in middle row)
  if (isThrowing) {
    // For kickoff kick, onside kick, punt return - defense throws (opposite direction)
    // For field goal, extra point - offense throws from opponent's endzone (opposite direction)
    const oppositeDirection = [Phase.KICKOFF_KICK, Phase.ONSIDE_KICK, Phase.PUNT_RETURN, 
                               Phase.FIELD_GOAL_ATTEMPT, Phase.EXTRA_POINT];
    const throwerGoesRight = oppositeDirection.includes(gameState.phase) ? !offenseGoesRight : offenseGoesRight;
    const throwArrow = document.createElement('span');
    throwArrow.className = `direction-arrow ${throwerGoesRight ? 'left' : 'right'}`;
    throwArrow.textContent = throwerGoesRight ? '>>>' : '<<<';
    effectRow.appendChild(throwArrow);
  }

  const result = gameState.lastPlayResult;
  const phase = gameState.phase;
  
  for (let i = 1; i <= TOTAL_CUPS; i++) {
    const effect = document.createElement('div');
    effect.className = 'cup-effect';
    effect.style.left = `${i * 5}%`;

    // During throwing/kicking phases, show potential effect for each cup
    if (phase === Phase.FIELD_GOAL_ATTEMPT) {
      // Field goal: cups at ball position or closer to kicker's home endzone are FG
      // Team 1's home endzone is left (low cups), Team 2's home is right (high cups)
      const ballPos = gameState.ballPosition;
      const isValidFG = gameState.offenseTeam === 1 ? (i <= ballPos) : (i >= ballPos);
      if (isValidFG) {
        effect.classList.add('effect-gain');
        effect.textContent = 'FG';
      } else {
        effect.classList.add('effect-turnover');
        effect.textContent = '0';
      }
    } else if (phase === Phase.EXTRA_POINT) {
      // Extra point: cups at endzone position or closer to kicker's home endzone are XP
      // Ball is in opponent's endzone, so all cups toward home are valid
      const isValidXP = gameState.offenseTeam === 1 ? true : true; // All cups valid from endzone
      if (isValidXP) {
        effect.classList.add('effect-gain');
        effect.textContent = 'XP';
      } else {
        effect.classList.add('effect-neutral');
        effect.textContent = '0';
      }
    } else if ([Phase.KICKOFF_KICK, Phase.ONSIDE_KICK, Phase.PUNT].includes(phase)) {
      // Kick/punt: show total ball movement (base 10 + modifier)
      const goodDirectionRight = phase === Phase.PUNT ? (gameState.offenseTeam === 1) : (gameState.offenseTeam !== 1);
      const modifier = goodDirectionRight ? (i - 9) : (11 - i);
      const totalMovement = 10 + modifier; // Range: +2 to +20
      
      // Color relative to miss value (+10)
      if (totalMovement > 10) {
        effect.classList.add('effect-gain'); // Better than miss
      } else if (totalMovement === 10) {
        effect.classList.add('effect-neutral'); // Same as miss
      } else {
        effect.classList.add('effect-loss'); // Worse than miss
      }
      effect.textContent = `+${totalMovement}`;
    } else if (phase === Phase.KICKOFF_RETURN && gameState.kickResult !== null) {
      // Kickoff return: show modifier with TD/REC handling
      const kickLanding = gameState.kickResult;
      const isTeam1 = gameState.offenseTeam === 1;
      const returnModifier = isTeam1 ? (i - 9) : (11 - i);
      const finalPosition = isTeam1 ? (kickLanding + returnModifier) : (kickLanding - returnModifier);
      const isTD = isTeam1 ? (finalPosition > 19) : (finalPosition < 1);
      const finalInOwnEndzone = isTeam1 ? (finalPosition < 1) : (finalPosition > 19);
      const isRecovery = returnModifier < 0 && finalInOwnEndzone;
      
      if (isTD) {
        effect.classList.add('effect-gain');
        effect.textContent = 'TD';
      } else if (isRecovery) {
        effect.classList.add('effect-turnover');
        effect.textContent = 'REC';
      } else if (returnModifier > 0) {
        effect.classList.add('effect-gain');
        effect.textContent = `+${returnModifier}`;
      } else if (returnModifier === 0) {
        effect.classList.add('effect-neutral');
        effect.textContent = '0';
      } else {
        effect.classList.add('effect-loss');
        effect.textContent = returnModifier;
      }
    } else if (phase === Phase.PUNT_RETURN && gameState.puntResult !== null) {
      // Punt return: show modifier with TD/REC handling
      const puntResult = gameState.puntResult;
      const isTeam1Punting = gameState.offenseTeam === 1;
      const returnerIsTeam1 = !isTeam1Punting;
      const returnModifier = returnerIsTeam1 ? (i - 9) : (11 - i);
      const dir = isTeam1Punting ? 1 : -1;
      const finalPosition = puntResult - returnModifier * dir;
      const isTD = returnerIsTeam1 ? (finalPosition > 19) : (finalPosition < 1);
      const finalInOwnEndzone = returnerIsTeam1 ? (finalPosition < 1) : (finalPosition > 19);
      const isRecovery = returnModifier < 0 && finalInOwnEndzone;
      
      if (isTD) {
        effect.classList.add('effect-gain');
        effect.textContent = 'TD';
      } else if (isRecovery) {
        effect.classList.add('effect-turnover');
        effect.textContent = 'REC';
      } else if (returnModifier > 0) {
        effect.classList.add('effect-gain');
        effect.textContent = `+${returnModifier}`;
      } else if (returnModifier === 0) {
        effect.classList.add('effect-neutral');
        effect.textContent = '0';
      } else {
        effect.classList.add('effect-loss');
        effect.textContent = returnModifier;
      }
    } else if (phase === Phase.THROW_PLAY) {
      // Pass play: show result based on throw zones
      const relPos = gameState.offenseTeam === 1 ? i : (20 - i);
      
      if (relPos <= 6) {
        // Behind zone: incomplete, treated as -2
        effect.classList.add('effect-loss');
        effect.textContent = '-2';
      } else if (relPos >= 7 && relPos <= 9) {
        // Middle zone losses: -2, -1, 0
        const yards = relPos - 9;
        if (yards < 0) {
          effect.classList.add('effect-loss');
          effect.textContent = yards;
        } else {
          effect.classList.add('effect-neutral');
          effect.textContent = '0';
        }
      } else if (relPos >= 10 && relPos <= 13) {
        // Middle zone gains: +1, +2, +3, +4
        const yards = relPos - 9;
        effect.classList.add('effect-gain');
        effect.textContent = `+${yards}`;
      } else if (relPos === 14 || relPos === 16) {
        // Danger zone flanking INT: incomplete, show 0
        effect.classList.add('effect-neutral');
        effect.textContent = '0';
      } else if (relPos === 15) {
        // Interception
        effect.classList.add('effect-turnover');
        effect.textContent = 'INT';
      } else if (relPos >= 17 && relPos <= 19) {
        // Deep zone: called shots (5+)
        effect.classList.add('effect-gain');
        effect.textContent = '5+';
      }
    }

    effectRow.appendChild(effect);
  }
  elements.field.appendChild(effectRow);

  // === BOTTOM ROW: Yard numbers ===
  const numberRow = document.createElement('div');
  numberRow.className = 'field-row number-row';

  for (let i = 1; i <= TOTAL_CUPS; i++) {
    const num = document.createElement('span');
    num.className = 'yard-number';
    // Make 50 (cup 10) and 25s (cups 5, 15) bigger
    if (i === 5 || i === 10 || i === 15) {
      num.classList.add('major');
    }
    num.style.left = `${i * 5}%`;
    num.textContent = cupDisplayLabel(i);
    numberRow.appendChild(num);
  }
  elements.field.appendChild(numberRow);

  // First down marker (only during play phases)
  const playPhases = [Phase.NORMAL_PLAY, Phase.PLAY_RESULT, Phase.THROW_PLAY, Phase.FIELD_GOAL_ATTEMPT, Phase.PUNT];
  if (playPhases.includes(gameState.phase) &&
      gameState.firstDownMarker >= 0 && gameState.firstDownMarker <= TOTAL_CUPS + 1) {
    const firstDownMarker = document.createElement('div');
    firstDownMarker.className = 'first-down-marker';
    firstDownMarker.style.left = `${gameState.firstDownMarker * 5}%`;
    elements.field.appendChild(firstDownMarker);
  }

  // Endzone labels
  elements.endzoneLeft.querySelector('.endzone-label').textContent = gameState.team1.name.toUpperCase();
  elements.endzoneRight.querySelector('.endzone-label').textContent = gameState.team2.name.toUpperCase();

  // Endzone football (for positions 0 or 20) - only during non-return phases
  elements.endzoneLeft.querySelectorAll('.ball-position').forEach(f => f.remove());
  elements.endzoneRight.querySelectorAll('.ball-position').forEach(f => f.remove());

  if ((ballPos === 0 || ballPos === 20) && !isReturnPhase) {
    const football = document.createElement('span');
    football.className = 'ball-position';
    football.style.position = 'absolute';
    football.style.top = '50%';
    football.style.left = '50%';
    football.style.transform = 'translate(-50%, -50%)';
    football.textContent = '🏈';
    (ballPos === 0 ? elements.endzoneLeft : elements.endzoneRight).appendChild(football);
  }
}

function renderResultIndicators() {
  elements.resultIndicatorsTop.innerHTML = '';
  elements.resultIndicatorsBottom.innerHTML = '';

  const result = gameState.lastPlayResult;
  if (!result) return;

  // Team 1 (home/left) shows below, Team 2 (away/right) shows above
  const container = result.team === 1 ? elements.resultIndicatorsBottom : elements.resultIndicatorsTop;

  // Create single positioned indicator at N * 5%
  const indicator = document.createElement('div');
  indicator.className = `result-indicator result-${result.type}`;
  indicator.style.left = `${result.position * 5}%`;
  indicator.textContent = result.text;
  container.appendChild(indicator);
}

// Control renderers
const controlRenderers = {
  [Phase.COIN_TOSS]: () => `
    <div class="control-section">
      <span class="offense-indicator" style="background: var(--text-muted);">Coin toss - receiving team</span>
      <div class="button-row">
        <button class="btn btn-team1" data-action="coin-toss" data-team="1">${gameState.team1.name}</button>
        <button class="btn btn-team2" data-action="coin-toss" data-team="2">${gameState.team2.name}</button>
      </div>
    </div>`,

  [Phase.KICKOFF]: () => {
    const kickingTeam = defenseTeam();
    const kickingTeamNum = gameState.offenseTeam === 1 ? 2 : 1;
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${kickingTeamNum}">${kickingTeam.name} - kickoff type</span>
        <div class="button-row">
          <button class="btn btn-primary" data-action="regular-kickoff">Regular</button>
          <button class="btn btn-neutral" data-action="onside-kick">Onside</button>
        </div>
      </div>`;
  },

  [Phase.KICKOFF_KICK]: () => {
    const kickingTeam = defenseTeam();
    const kickingTeamNum = gameState.offenseTeam === 1 ? 2 : 1;
    // Kicking team wants to kick deep into opponent territory
    const goodDirectionRight = gameState.offenseTeam === 2; // Team 1 kicks right, Team 2 kicks left
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${kickingTeamNum}">${kickingTeam.name} - kickoff (best of 2)</span>
        <div class="cup-select-grid">${renderCupSelectGrid('kickoff-land', true, goodDirectionRight)}</div>
        <div class="button-row" style="margin-top: 1rem;">
          <button class="btn btn-neutral" data-action="kickoff-miss">Missed (+10)</button>
        </div>
      </div>`;
  },

  [Phase.ONSIDE_KICK]: () => {
    const kickingTeam = defenseTeam();
    const kickingTeamNum = gameState.offenseTeam === 1 ? 2 : 1;
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${kickingTeamNum}">${kickingTeam.name} - onside kick</span>
        <div class="cup-select-grid">${renderCupSelectGrid('onside-hit')}</div>
        <div class="button-row" style="margin-top: 1rem;">
          <button class="btn btn-neutral" data-action="onside-miss">Missed</button>
        </div>
      </div>`;
  },

  [Phase.KICKOFF_RETURN]: () => {
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${gameState.offenseTeam}">${offenseTeam().name} - return (best of 2)</span>
        <div class="cup-select-grid">${renderKickoffReturnGrid('return-hit')}</div>
        <div class="button-row" style="margin-top: 1rem;">
          <button class="btn btn-neutral" data-action="return-miss">Missed (0)</button>
        </div>
      </div>`;
  },

  [Phase.NORMAL_PLAY]: () => {
    const downNames = ['1st', '2nd', '3rd', '4th'];
    const isFourthDown = gameState.down === 4;
    const primaryClass = isFourthDown ? 'btn-neutral' : 'btn-primary';
    const kickClass = isFourthDown ? 'btn-primary' : 'btn-neutral';
    return `
    <div class="control-section">
      <span class="offense-indicator offense-team${gameState.offenseTeam}">${offenseTeam().name} - ${downNames[gameState.down - 1]} down</span>
      <div class="button-row">
        <button class="btn ${kickClass}" data-action="fourth-down" data-choice="punt">Punt</button>
        <button class="btn ${kickClass}" data-action="fourth-down" data-choice="fg">Field goal</button>
        <button class="btn ${primaryClass}" data-action="start-throw">Pass</button>
      </div>
      <div class="button-row" style="margin-top: 0.5rem;">
        <button class="btn ${primaryClass}" data-action="qb-sneak">QB sneak (1v1)</button>
        <button class="btn ${primaryClass}" data-action="select-players" data-count="2">Run 2v3</button>
        <button class="btn ${primaryClass}" data-action="select-players" data-count="3">Run 3v4</button>
        <button class="btn ${primaryClass}" data-action="select-players" data-count="4">Run 4v5</button>
      </div>
    </div>`;
  },

  [Phase.PLAY_RESULT]: () => {
    const { offensePlayers, isQBSneak } = gameState.pendingPlay;

    // QB Sneak: simple win/tie/loss buttons
    if (isQBSneak) {
      return `
        <div class="control-section">
          <span class="offense-indicator offense-team${gameState.offenseTeam}">${offenseTeam().name} - QB sneak (1v1)</span>
          <div class="button-row">
            <button class="btn btn-neutral" data-action="result" data-cups="0">Lost (0)</button>
            <button class="btn btn-success" data-action="result" data-cups="1">Tied or won (+1)</button>
          </div>
        </div>`;
    }

    // Regular run play
    const defensePlayers = offensePlayers + 1;
    const buttons = [];

    // Loss buttons (defense wins, offense has unflipped cups)
    for (let i = offensePlayers; i >= 1; i--) {
      const yards = FLIP_CUP_YARDAGE[i];
      const isFumble = i === offensePlayers && offensePlayers > 1;
      const label = isFumble ? `Fumble (-${yards})` : `-${yards}`;
      buttons.push(`<button class="btn ${isFumble ? 'btn-danger' : 'btn-warning'}" data-action="result" data-cups="${-i}">${label}</button>`);
    }
    buttons.push(`<button class="btn btn-neutral" data-action="result" data-cups="0">0</button>`);
    // Gain buttons (offense wins, defense has unflipped cups)
    for (let i = 1; i <= defensePlayers; i++) {
      const yards = FLIP_CUP_YARDAGE[i];
      const label = yards === 'TD' ? 'Touchdown' : `+${yards}`;
      buttons.push(`<button class="btn btn-success" data-action="result" data-cups="${i}">${label}</button>`);
    }

    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${gameState.offenseTeam}">${offenseTeam().name} - run (${offensePlayers}v${defensePlayers})</span>
        <div class="button-row">${buttons.join('')}</div>
      </div>`;
  },

  [Phase.THROW_PLAY]: () => {
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${gameState.offenseTeam}">${offenseTeam().name} - passing (first made of 3)</span>
        <div class="button-row">
          <button class="btn btn-warning" data-action="throw-result" data-result="-2">-2</button>
          <button class="btn btn-warning" data-action="throw-result" data-result="-1">-1</button>
          <button class="btn btn-neutral" data-action="throw-result" data-result="0">0</button>
          <button class="btn btn-success" data-action="throw-result" data-result="1">+1</button>
          <button class="btn btn-success" data-action="throw-result" data-result="2">+2</button>
          <button class="btn btn-success" data-action="throw-result" data-result="3">+3</button>
          <button class="btn btn-success" data-action="throw-result" data-result="4">+4</button>
        </div>
        <div class="button-row" style="margin-top: 0.5rem;">
          <button class="btn btn-neutral" data-action="throw-result" data-result="incomplete">Incomplete</button>
          <button class="btn btn-danger" data-action="throw-result" data-result="int">Interception</button>
          <button class="btn btn-success" data-action="throw-result" data-result="5">+5</button>
          <span style="color: var(--text-muted); margin: 0 0.5rem;">Called:</span>
          <button class="btn btn-success" data-action="throw-result" data-result="6">+6</button>
          <button class="btn btn-success" data-action="throw-result" data-result="9">+9</button>
          <button class="btn btn-success" data-action="throw-result" data-result="td">Touchdown</button>
        </div>
      </div>`;
  },

  [Phase.PUNT]: () => {
    // Punting team wants to punt deep into opponent territory
    const goodDirectionRight = gameState.offenseTeam === 1; // Team 1 punts right, Team 2 punts left
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${gameState.offenseTeam}">${offenseTeam().name} - punting (best of 2)</span>
        <div class="cup-select-grid">${renderCupSelectGrid('punt-hit', true, goodDirectionRight)}</div>
        <div class="button-row" style="margin-top: 1rem;">
          <button class="btn btn-neutral" data-action="punt-miss">Missed (+10)</button>
        </div>
      </div>`;
  },

  [Phase.PUNT_RETURN]: () => {
    const defenseTeamNum = gameState.offenseTeam === 1 ? 2 : 1;
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${defenseTeamNum}">${defenseTeam().name} - punt return (best of 2)</span>
        <div class="cup-select-grid">${renderPuntReturnGrid('punt-return-hit')}</div>
        <div class="button-row" style="margin-top: 1rem;">
          <button class="btn btn-neutral" data-action="punt-return-miss">Missed (0)</button>
        </div>
      </div>`;
  },

  [Phase.FIELD_GOAL_ATTEMPT]: () => {
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${gameState.offenseTeam}">${offenseTeam().name} - field goal (best of 3)</span>
        <div class="button-row">
          <button class="btn btn-success" data-action="field-goal" data-result="make">Field goal</button>
          <button class="btn btn-danger" data-action="field-goal" data-result="miss">Missed</button>
        </div>
        <div class="button-row" style="margin-top: 0.5rem;">
          <button class="btn btn-danger" data-action="field-goal" data-result="miss">Blocked</button>
        </div>
      </div>`;
  },

  [Phase.TOUCHDOWN_CONVERSION]: () => `
    <div class="control-section">
      <span class="offense-indicator offense-team${gameState.offenseTeam}">${offenseTeam().name} - touchdown!</span>
      <div class="button-row">
        <button class="btn btn-primary" data-action="conversion-choice" data-choice="xp">Extra point (1 pt)</button>
        <button class="btn btn-primary" data-action="conversion-choice" data-choice="2pt">Two-point (2 pts)</button>
      </div>
    </div>`,

  [Phase.EXTRA_POINT]: () => {
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${gameState.offenseTeam}">${offenseTeam().name} - extra point (best of 3)</span>
        <div class="button-row">
          <button class="btn btn-success" data-action="extra-point" data-result="make">Extra point</button>
          <button class="btn btn-neutral" data-action="extra-point" data-result="miss">Missed</button>
        </div>
        <div class="button-row" style="margin-top: 0.5rem;">
          <button class="btn btn-neutral" data-action="extra-point" data-result="miss">Blocked</button>
        </div>
      </div>`;
  },

  [Phase.TWO_POINT_CONVERSION]: () => `
    <div class="control-section">
      <span class="offense-indicator offense-team${gameState.offenseTeam}">${offenseTeam().name} - two-point</span>
      <div class="button-row">
        <button class="btn btn-success" data-action="two-point" data-result="make">Two-point</button>
        <button class="btn btn-neutral" data-action="two-point" data-result="miss">Stopped</button>
      </div>
    </div>`,

  [Phase.GAME_OVER]: () => {
    const winner = gameState.team1.score > gameState.team2.score ? gameState.team1 :
                   gameState.team2.score > gameState.team1.score ? gameState.team2 : null;
    const winnerNum = gameState.team1.score > gameState.team2.score ? 1 : 2;
    if (!winner) {
      return `
        <div class="control-section">
          <span class="offense-indicator" style="background: var(--text-muted);">Game tied!</span>
          <div class="button-row">
            <button class="btn btn-primary" data-action="start-overtime">Start overtime</button>
          </div>
        </div>`;
    }
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${winnerNum}">${winner.name} wins! (${gameState.team1.score} - ${gameState.team2.score})</span>
        <div class="button-row">
          <button class="btn btn-primary" data-action="new-game">New game</button>
        </div>
      </div>`;
  },

  [Phase.OVERTIME_START]: () => `
    <div class="control-section">
      <span class="offense-indicator" style="background: var(--text-muted);">Overtime - first possession</span>
      <div class="button-row">
        <button class="btn btn-team1" data-action="ot-first" data-team="1">${gameState.team1.name}</button>
        <button class="btn btn-team2" data-action="ot-first" data-team="2">${gameState.team2.name}</button>
      </div>
    </div>`,

  [Phase.OVERTIME_FIELD_GOAL]: () => {
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${gameState.offenseTeam}">${offenseTeam().name} - OT field goal (best of 2)</span>
        <div class="button-row">
          <button class="btn btn-success" data-action="ot-fg" data-result="make">Field goal</button>
          <button class="btn btn-neutral" data-action="ot-fg" data-result="miss">Missed</button>
        </div>
      </div>`;
  }
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
  'regular-kickoff': handleRegularKickoff,
  'kickoff-land': e => handleKickoffLand(parseInt(e.target.dataset.cup)),
  'kickoff-miss': handleKickoffMiss,
  'onside-kick': handleOnsideKick,
  'onside-hit': e => handleOnsideHit(parseInt(e.target.dataset.cup)),
  'onside-miss': handleOnsideMiss,
  'return-hit': e => handleReturn(parseInt(e.target.dataset.cup)),
  'return-miss': handleReturnMiss,
  'punt-hit': e => handlePuntKick(parseInt(e.target.dataset.cup)),
  'punt-miss': handlePuntMiss,
  'punt-return-hit': e => handlePuntReturn(parseInt(e.target.dataset.cup)),
  'punt-return-miss': handlePuntReturnMiss,
  'select-players': e => handleSelectPlayers(parseInt(e.target.dataset.count), false),
  'qb-sneak': () => handleSelectPlayers(1, true),
  'start-throw': handleStartThrow,
  'throw-result': e => handleThrowResultSimple(e.target.dataset.result),
  'result': e => handlePlayResult(parseInt(e.target.dataset.cups)),
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
  gameState.ballPosition = gameState.offenseTeam === 1 ? 20 : 0;
  gameState.phase = Phase.KICKOFF;
}

function handleRegularKickoff() {
  gameState.phase = Phase.KICKOFF_KICK;
}

function handleKickoffLand(cup) {
  // Calculate landing position like punts: start + 10 + modifier
  // Kicking team is defense, kicks toward receiving team's endzone
  const kickModifier = gameState.offenseTeam === 1 ? (11 - cup) : (cup - 9);
  const startPos = gameState.offenseTeam === 1 ? 15 : 5; // Kicking team's 25
  const kickDirection = gameState.offenseTeam === 1 ? -1 : 1; // Toward receiver's endzone
  const landingPos = startPos + (10 + kickModifier) * kickDirection;
  gameState.kickResult = landingPos; // Store actual position (can be < 1 or > 19)
  gameState.phase = Phase.KICKOFF_RETURN;
}

function handleKickoffMiss() {
  // Both attempts missed - base kick of 10, no modifier
  const startPos = gameState.offenseTeam === 1 ? 15 : 5;
  const kickDirection = gameState.offenseTeam === 1 ? -1 : 1;
  const landingPos = startPos + 10 * kickDirection;
  gameState.kickResult = landingPos;
  gameState.phase = Phase.KICKOFF_RETURN;
}

function handleOnsideKick() {
  gameState.phase = Phase.ONSIDE_KICK;
}

function handleOnsideHit(cup) {
  // Valid range: kicking team's 25 to 50
  // Team 1 kicks (offense is Team 2): valid cups 15-10 (Team 1's 25 to 50)
  // Team 2 kicks (offense is Team 1): valid cups 5-10 (Team 2's 25 to 50)
  const kickingTeam = gameState.offenseTeam === 1 ? 2 : 1;
  const validStart = kickingTeam === 1 ? 5 : 10;
  const validEnd = kickingTeam === 1 ? 10 : 15;
  const inRange = cup >= validStart && cup <= validEnd;

  if (inRange) {
    // Kicking team recovers at that spot - they become offense
    gameState.offenseTeam = kickingTeam;
    gameState.ballPosition = cup;
    startNewPossession();
  } else {
    // Failed - receiving team gets ball at kicking team's 25
    handleOnsideMiss();
  }
}

function handleOnsideMiss() {
  // Receiving team gets ball at kicking team's 25 yard line
  // Kicking team is opposite of receiving team (offense)
  const kickingTeam = gameState.offenseTeam === 1 ? 2 : 1;
  // Kicking team's 25: cup 5 for Team 1, cup 15 for Team 2
  gameState.ballPosition = kickingTeam === 1 ? 5 : 15;
  startNewPossession();
}

function handleReturn(cup) {
  // kickResult is now actual landing position (can be < 1 or > 19 if in endzone)
  const kickLanding = gameState.kickResult;
  // Return modifier: cup 10 = +1, range -8 to +10
  const returnModifier = gameState.offenseTeam === 1 ? (cup - 9) : (11 - cup);

  // Calculate final position: landing + return modifier (in returner's direction)
  const finalPosition = gameState.offenseTeam === 1
    ? kickLanding + returnModifier  // Team 1 returns toward higher cups
    : kickLanding - returnModifier; // Team 2 returns toward lower cups

  // Check for touchdown: return goes into opponent's endzone
  const isTD = gameState.offenseTeam === 1 ? (finalPosition > 19) : (finalPosition < 1);
  if (isTD) {
    gameState.kickResult = null;
    handleTouchdown();
    return;
  }

  // Check for kick recovery: return negative AND final position in own endzone
  const finalInOwnEndzone = gameState.offenseTeam === 1 ? (finalPosition < 1) : (finalPosition > 19);
  if (returnModifier < 0 && finalInOwnEndzone) {
    // Kicking team recovers at receiver's 5 yard line
    gameState.offenseTeam = gameState.offenseTeam === 1 ? 2 : 1;
    gameState.ballPosition = gameState.offenseTeam === 1 ? 1 : 19;
    gameState.kickResult = null;
    startNewPossession();
    return;
  }

  gameState.ballPosition = clampToField(finalPosition);
  gameState.kickResult = null;
  startNewPossession();
}

function handleReturnMiss() {
  // Both attempts missed - return modifier = 0 (not negative, so no recovery)
  const kickLanding = gameState.kickResult;
  // Ball stays at kick landing position (clamped to field)
  gameState.ballPosition = clampToField(kickLanding);
  gameState.kickResult = null;
  startNewPossession();
}

function handleSelectPlayers(count, isQBSneak = false) {
  gameState.pendingPlay = { offensePlayers: count, isQBSneak };
  gameState.phase = Phase.PLAY_RESULT;
}

function handleStartThrow() {
  gameState.phase = Phase.THROW_PLAY;
}

// Simplified throw result handler - user clicks final result directly
function handleThrowResultSimple(result) {
  const team = gameState.offenseTeam;
  const position = gameState.ballPosition;

  // Touchdown
  if (result === 'td') {
    gameState.lastPlayResult = { team, position, type: 'td', text: 'TD' };
    scoreTouchdown();
    return;
  }

  // Interception
  if (result === 'int') {
    gameState.lastPlayResult = { team, position, type: 'turnover', text: '' };
    if (flipPossession(false)) return;
    startNewPossession();
    return;
  }

  // Incomplete (no yardage change)
  if (result === 'incomplete') {
    gameState.lastPlayResult = { team, position, type: 'neutral', text: '—' };
    gameState.down++;
    checkDowns();
    return;
  }

  // Yardage result (positive or negative)
  const yards = parseInt(result);

  // Record result
  if (yards > 0) {
    gameState.lastPlayResult = { team, position, type: 'gain', text: '+' + yards };
  } else if (yards < 0) {
    gameState.lastPlayResult = { team, position, type: 'loss', text: String(yards) };
  } else {
    gameState.lastPlayResult = { team, position, type: 'neutral', text: '0' };
  }

  gameState.ballPosition += yards * direction();

  // Check for touchdown
  if ((gameState.offenseTeam === 1 && gameState.ballPosition > TOTAL_CUPS) ||
      (gameState.offenseTeam === 2 && gameState.ballPosition < 1)) {
    gameState.ballPosition = clampToField(gameState.ballPosition);
    scoreTouchdown();
    return;
  }

  // Check for safety
  if ((gameState.offenseTeam === 1 && gameState.ballPosition < 1) ||
      (gameState.offenseTeam === 2 && gameState.ballPosition > TOTAL_CUPS)) {
    gameState.ballPosition = clampToField(gameState.ballPosition);
    scoreSafety();
    return;
  }

  gameState.ballPosition = clampToField(gameState.ballPosition);

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

function handlePlayResult(cups) {
  const { offensePlayers, isQBSneak } = gameState.pendingPlay;
  const team = gameState.offenseTeam;
  const position = gameState.ballPosition;
  gameState.pendingPlay = null;

  // QB Sneak special handling: win = +1, loss or tie = 0 (tie goes to offense)
  if (isQBSneak) {
    if (cups > 0) {
      // Offense won - gain 1 yard
      gameState.ballPosition += 1 * direction();
      gameState.ballPosition = clampToField(gameState.ballPosition);
      gameState.lastPlayResult = { team, position, type: 'gain', text: '1' };

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
    } else {
      // Tie or loss - no gain, down consumed
      gameState.lastPlayResult = { team, position, type: 'neutral', text: '0' };
      gameState.down++;
    }
    checkDowns();
    return;
  }

  // Regular run play
  // Fumble: max loss when offense sent > 1 player (all defenders finish before any offense)
  const isFumble = cups === -offensePlayers && offensePlayers > 1;

  if (cups === 0) {
    // Tie - no gain, down consumed
    gameState.lastPlayResult = { team, position, type: 'neutral', text: '0' };
    gameState.down++;
    checkDowns();
    return;
  }

  // Get yardage from schedule
  const yardageValue = cups > 0 ? FLIP_CUP_YARDAGE[cups] : FLIP_CUP_YARDAGE[-cups];

  // Check for TD on 5 unflipped cups (offense wins)
  if (yardageValue === 'TD' && cups > 0) {
    gameState.lastPlayResult = { team, position, type: 'td', text: 'TD' };
    scoreTouchdown();
    return;
  }

  // Convert to yards
  const yards = cups > 0 ? yardageValue : -yardageValue;

  // Record result
  if (isFumble) {
    gameState.lastPlayResult = { team, position, type: 'turnover', text: 'F' };
  } else if (yards > 0) {
    gameState.lastPlayResult = { team, position, type: 'gain', text: String(yards) };
  } else if (yards < 0) {
    gameState.lastPlayResult = { team, position, type: 'loss', text: String(yards) };
  } else {
    gameState.lastPlayResult = { team, position, type: 'neutral', text: '0' };
  }

  // Apply yardage in the direction the offense is moving
  gameState.ballPosition += yards * direction();

  // Check for touchdown (Team 1 scores at >19, Team 2 scores at <1)
  if ((gameState.offenseTeam === 1 && gameState.ballPosition > TOTAL_CUPS) ||
      (gameState.offenseTeam === 2 && gameState.ballPosition < 1)) {
    gameState.ballPosition = clampToField(gameState.ballPosition);
    scoreTouchdown();
    return;
  }

  // Check for safety (Team 1 safety at <1, Team 2 safety at >19)
  if ((gameState.offenseTeam === 1 && gameState.ballPosition < 1) ||
      (gameState.offenseTeam === 2 && gameState.ballPosition > TOTAL_CUPS)) {
    gameState.ballPosition = clampToField(gameState.ballPosition);
    scoreSafety();
    return;
  }

  // Fumble: defense takes over at current spot
  if (isFumble) {
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
  } else {
    // All plays available on all downs
    gameState.phase = Phase.NORMAL_PLAY;
  }
}

function handleFourthDown(choice) {
  // Now accessible from any down via unified play selector
  if (choice === 'punt') {
    gameState.phase = Phase.PUNT;
  } else if (choice === 'fg') {
    gameState.phase = Phase.FIELD_GOAL_ATTEMPT;
  }
}

function handlePuntKick(cup) {
  // Punter shot result - calculate punt landing position
  // Base punt = 10 cups, modifier uses new +1 formula (cup 10 = +1)
  const puntModifier = gameState.offenseTeam === 1 ? (cup - 9) : (11 - cup);
  const puntDistance = 10 + puntModifier;
  // Don't clamp - allow result to go into endzone for return math
  const landingPosition = gameState.ballPosition + puntDistance * direction();
  gameState.puntResult = landingPosition;
  gameState.phase = Phase.PUNT_RETURN;
}

function handlePuntMiss() {
  // Both attempts missed - base punt of 10
  const puntDistance = 10;
  // Don't clamp - allow result to go into endzone for return math
  const landingPosition = gameState.ballPosition + puntDistance * direction();
  gameState.puntResult = landingPosition;
  gameState.phase = Phase.PUNT_RETURN;
}

function handlePuntReturn(cup) {
  // Return modifier uses new +1 formula (cup 10 = +1)
  // Team 2 receiving (offense=1): 11 - cup (hit cup 1 = +10)
  // Team 1 receiving (offense=2): cup - 9 (hit cup 19 = +10)
  const returnModifier = gameState.offenseTeam === 1 ? (11 - cup) : (cup - 9);
  const returnerIsTeam1 = gameState.offenseTeam === 2; // Returner is the other team

  // Return modifier moves ball toward the receiver's endzone (opposite of punt direction)
  let finalPosition = gameState.puntResult - returnModifier * direction();

  // Check for touchdown: return goes into opponent's endzone
  // Returner Team 1 scores in right endzone (> 19), Returner Team 2 scores in left endzone (< 1)
  const isTD = returnerIsTeam1 ? (finalPosition > 19) : (finalPosition < 1);
  if (isTD) {
    // Switch to returner's possession for the TD
    gameState.offenseTeam = returnerIsTeam1 ? 1 : 2;
    gameState.puntResult = null;
    handleTouchdown();
    return;
  }

  // Check for punt recovery: return negative AND final position in own endzone
  const finalInOwnEndzone = returnerIsTeam1 ? (finalPosition < 1) : (finalPosition > 19);
  if (returnModifier < 0 && finalInOwnEndzone) {
    // Punt recovery by kicking team (current offense) at the 5 yard line
    gameState.ballPosition = gameState.offenseTeam === 1 ? 19 : 1;
    gameState.puntResult = null;
    startNewPossession(); // Same team keeps possession
    return;
  }

  gameState.ballPosition = clampToField(finalPosition);
  gameState.puntResult = null;
  if (flipPossession(true)) return; // Quarter transition handled
  startNewPossession();
}

function handlePuntReturnMiss() {
  // Both attempts missed - return modifier = 0 (not negative, so no recovery)
  // Ball stays at punt landing spot (clamped to field)
  gameState.ballPosition = clampToField(gameState.puntResult);
  gameState.puntResult = null;
  if (flipPossession(true)) return; // Quarter transition handled
  startNewPossession();
}

function handleFieldGoal(result) {
  if (result === 'make') {
    addScore(gameState.offenseTeam, 3);
    startKickoff();
  } else {
    // All 3 missed: turnover at current spot
    if (flipPossession(true)) return; // Quarter transition handled
    startNewPossession();
  }
}

function scoreTouchdown() {
  addScore(gameState.offenseTeam, 6);
  // Put ball in the endzone they scored in
  // Team 1 scores in right endzone (position 20), Team 2 in left endzone (position 0)
  gameState.ballPosition = gameState.offenseTeam === 1 ? 20 : 0;
  gameState.phase = Phase.TOUCHDOWN_CONVERSION;
}

function scoreSafety() {
  // Defense scores 2 points, then offense kicks off to defense
  addScore(gameState.offenseTeam === 1 ? 2 : 1, 2);
  startKickoff(true); // true = safety kickoff (no possession flip before kick)
}

function handleConversionChoice(choice) {
  // Put ball at the 5 yard line for visual consistency
  // Team 1 scored at cup 19's endzone, so ball at cup 19 (opponent's 5)
  // Team 2 scored at cup 1's endzone, so ball at cup 1 (opponent's 5)
  gameState.ballPosition = gameState.offenseTeam === 1 ? 19 : 1;

  if (choice === 'xp') {
    // Extra point - any cup hit is a make
    gameState.phase = Phase.EXTRA_POINT;
  } else {
    gameState.phase = Phase.TWO_POINT_CONVERSION;
  }
}

function handleExtraPoint(result) {
  if (result === 'make') {
    addScore(gameState.offenseTeam, 1);
  }
  // Either way, proceed to kickoff
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
  gameState.lastPlayResult = null;
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
    if (gameState.otFirstTeamMissed) {
      // Second team wins (first missed, second made)
      gameState.phase = Phase.GAME_OVER;
      return;
    }
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
    // Both attempts missed
    if (gameState.otFirstTeamMade) {
      // First team made, second missed both - first team wins
      gameState.phase = Phase.GAME_OVER;
      return;
    }
    // First team missed both, second team tries
    gameState.otFirstTeamMissed = true;
    gameState.otFirstTeam = currentTeam;
    gameState.offenseTeam = otherTeam;
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
