// Gridiron Beerball - Game Tracker

const STORAGE_KEY = 'gridiron-beerball-game';
const STORAGE_VERSION = 3;  // Increment when state structure changes
const CUPS_TO_FIRST_DOWN = 3;
const TOTAL_CUPS = 19;
const POSSESSIONS_PER_QUARTER = 4;
const TOTAL_QUARTERS = 4;
const BASE_KICK_DISTANCE = 10;  // Base punt/kick distance per rules

// Field position abstraction - encapsulates all position logic
const FieldPosition = {
  ENDZONE_LEFT: -10,
  ENDZONE_RIGHT: 10,
  FIELD_MIN: -9,
  FIELD_MAX: 9,
  MIDFIELD: 0,
  YARD_25: 5,   // Cup position for 25 yard line
  YARD_5: 9,    // Cup position for 5 yard line (same as FIELD_MAX)

  isOnField(pos) {
    return pos >= this.FIELD_MIN && pos <= this.FIELD_MAX;
  },

  isInEndzone(pos) {
    return !this.isOnField(pos);
  },

  isTouchdown(pos, team) {
    return pos * team > this.FIELD_MAX;
  },

  isSafety(pos, team) {
    return pos * team < -this.FIELD_MAX;
  },

  clampToField(pos) {
    if (pos < this.FIELD_MIN) return this.FIELD_MIN;
    if (pos > this.FIELD_MAX) return this.FIELD_MAX;
    return pos;
  },

  clampToEndzone(pos) {
    if (pos < this.FIELD_MIN) return this.ENDZONE_LEFT;
    if (pos > this.FIELD_MAX) return this.ENDZONE_RIGHT;
    return pos;
  },

  toDisplayPercent(pos) {
    if (pos <= this.ENDZONE_LEFT) return -3;
    if (pos >= this.ENDZONE_RIGHT) return 103;
    return (pos + 10) * 5;
  },

  yardLine(yards, team) {
    const cupFromMidfield = (50 - yards) / 5;
    return cupFromMidfield * team;
  }
};

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

// Throwing zones (relative positions from offense perspective)
// Positive = toward scoring endzone, Negative = toward own endzone
const THROW_ZONES = {
  // Sack fumble zone (cups 1-5 from thrower): -9 to -5
  SACK_FUMBLE_START: -9,  // own 5 yard line
  SACK_FUMBLE_END: -5,    // own 25 yard line
  // Middle zone (no call needed): -4 to +3
  MIDDLE_START: -4,   // own 30 yard line (loss of 3)
  MIDDLE_END: 3,      // opponent's 35 yard line (gain of 4)
  // Danger zone: +4 to +6
  INCOMPLETE_30: 4,   // opponent's 30 yard line - incomplete
  INTERCEPTION: 5,    // opponent's 25 yard line - INT
  INCOMPLETE_20: 6,   // opponent's 20 yard line - incomplete
  // Deep zone (must call): +7 to +9
  DEEP_START: 7,      // opponent's 15 yard line, gain 6
  DEEP_END: 9         // opponent's 5 yard line, TD
};

// Gains for deep zone: relative position 7→6, 8→9, 9→TD
const DEEP_GAINS = { 7: 6, 8: 9, 9: 'TD' };


// Default game state
// Teams are 1 (goes right/positive) or -1 (goes left/negative)
// Cup positions are -9 to +9, where 0 = 50 yard line
function createInitialState(team1Name, team1Color, team2Name, team2Color) {
  return {
    version: STORAGE_VERSION,
    team1: { name: team1Name, color: team1Color, score: 0 },
    team2: { name: team2Name, color: team2Color, score: 0 },
    quarter: 1,
    possession: 1,
    offenseTeam: 1,        // 1 or -1
    ballPosition: 0,       // 0 = midfield
    firstDownMarker: 3,    // 3 cups toward scoring endzone
    down: 1,
    phase: Phase.COIN_TOSS,
    phaseData: null,       // Phase-specific transient data (replaces pendingPlay/kickResult/puntResult)
    lastPlayResult: null,  // { team, type, text } - position derived from ballPosition
    openingKickoffReceiver: null,
    history: [],
    overtime: null         // { round, firstOffense, firstTeamDone, fgShootout: { firstTeam, made, missed } }
  };
}

let gameState = null;

// ============ Helpers ============

// Convert cup position to relative position from offense perspective
// Positive = toward offense's scoring endzone
function toRelativePosition(cup) {
  return cup * gameState.offenseTeam;
}

// Get throw result for a cup hit
// Returns { type: 'gain'|'incomplete'|'incomplete_end'|'interception'|'touchdown'|'sack_fumble', yards: number|null }
function getThrowResult(cup, calledCup) {
  const team = gameState.offenseTeam;
  const relPos = cup * team;
  const calledRelPos = calledCup !== null ? calledCup * team : null;

  // Sack fumble zone (cups 1-5, own 5-25): -3 yards, turnover, can be defensive TD
  if (relPos >= THROW_ZONES.SACK_FUMBLE_START && relPos <= THROW_ZONES.SACK_FUMBLE_END) {
    return { type: 'sack_fumble', yards: -3 };
  }

  // Middle zone (-4 to +3): gains or losses, no call needed
  if (relPos >= THROW_ZONES.MIDDLE_START && relPos <= THROW_ZONES.MIDDLE_END) {
    if (calledRelPos !== null) {
      return { type: 'incomplete_end', yards: null };
    }
    // Gain/loss: relPos directly (-3→-2 yards, 0→+1 yard, +3→+4 yards)
    const yards = relPos + 1;
    return { type: 'gain', yards };
  }

  // Danger zone
  if (relPos === THROW_ZONES.INCOMPLETE_30 || relPos === THROW_ZONES.INCOMPLETE_20) {
    return { type: 'incomplete_end', yards: null };
  }
  if (relPos === THROW_ZONES.INTERCEPTION) {
    return { type: 'interception', yards: null };
  }

  // Deep zone (+7 to +9): must have called, and hit at least as far
  if (relPos >= THROW_ZONES.DEEP_START && relPos <= THROW_ZONES.DEEP_END) {
    if (calledRelPos === null) {
      return { type: 'incomplete_end', yards: null };
    }
    if (relPos < calledRelPos) {
      return { type: 'incomplete_end', yards: null };
    }
    const gain = DEEP_GAINS[calledRelPos];
    if (gain === 'TD') {
      return { type: 'touchdown', yards: null };
    }
    return { type: 'gain', yards: gain };
  }

  return { type: 'incomplete', yards: null };
}

// Get the callable deep zone cups (for UI display)
function getDeepZoneCups() {
  const team = gameState.offenseTeam;
  const cups = [];
  for (let relPos = THROW_ZONES.DEEP_START; relPos <= THROW_ZONES.DEEP_END; relPos++) {
    const actualCup = relPos * team;  // Convert back to absolute cup
    const gain = DEEP_GAINS[relPos];
    cups.push({ cup: actualCup, relPos, gain });
  }
  return cups;
}

// Get team object by team ID (1 or -1)
function getTeam(teamId) {
  return teamId > 0 ? gameState.team1 : gameState.team2;
}

// Get current offense/defense team objects
function offenseTeam() {
  return getTeam(gameState.offenseTeam);
}

function defenseTeam() {
  return getTeam(-gameState.offenseTeam);
}

// Check if current ball position results in TD or safety, and handle it
// Returns: 'td', 'safety', or null (play continues normally)
// Clamps position and triggers scoring if applicable
function checkScoring() {
  const team = gameState.offenseTeam;

  // Touchdown: past opponent's endzone
  if (FieldPosition.isTouchdown(gameState.ballPosition, team)) {
    gameState.ballPosition = FieldPosition.clampToField(gameState.ballPosition);
    scoreTouchdown();
    return 'td';
  }

  // Safety: pushed back past own endzone
  if (FieldPosition.isSafety(gameState.ballPosition, team)) {
    gameState.ballPosition = FieldPosition.clampToField(gameState.ballPosition);
    scoreSafety();
    return 'safety';
  }

  return null;
}

// Move ball by yards in offense's direction, then check for TD/safety
// Returns: 'td', 'safety', or null (normal play continues)
function advanceBall(yards) {
  gameState.ballPosition += yards * gameState.offenseTeam;
  return checkScoring();
}

// Get display label for a cup (yard lines)
// Cup 0 = 50, cup ±5 = 25, cup ±9 = 5
function cupDisplayLabel(cup) {
  if (cup === 0) return 50;
  return (10 - Math.abs(cup)) * 5;
}

// Get CSS class for cup based on which team's territory
// Negative cups: Team -1's territory (left side)
// Positive cups: Team +1's territory (right side)
function cupColorClass(cup) {
  if (cup < 0) return 'team1-half';
  if (cup > 0) return 'team2-half';
  return 'midfield';
}

// Convert cup position to display string with team abbreviation
function cupToLabel(cup) {
  if (!gameState) return `${cupDisplayLabel(cup)}`;
  if (cup === 0) return '50';
  // Negative cups = left side = team1's territory (team1 defends left)
  // Positive cups = right side = team2's territory (team2 defends right)
  const team = cup < 0 ? gameState.team1 : gameState.team2;
  const abbrev = team.name.substring(0, 3).toUpperCase();
  return `${abbrev} ${cupDisplayLabel(cup)}`;
}

// ============ Button Factory ============

const Button = {
  create(text, action, data = {}, options = {}) {
    const { variant = 'primary', size = 'normal' } = options;
    const dataAttrs = Object.entries(data)
      .map(([k, v]) => `data-${k}="${v}"`).join(' ');
    const sizeClass = size === 'small' ? ' btn-small' : '';
    return `<button class="btn btn-${variant}${sizeClass}" data-action="${action}" ${dataAttrs}>${text}</button>`;
  },

  success(text, action, data = {}, options = {}) {
    return Button.create(text, action, data, { ...options, variant: 'success' });
  },
  warning(text, action, data = {}, options = {}) {
    return Button.create(text, action, data, { ...options, variant: 'warning' });
  },
  danger(text, action, data = {}, options = {}) {
    return Button.create(text, action, data, { ...options, variant: 'danger' });
  },
  neutral(text, action, data = {}, options = {}) {
    return Button.create(text, action, data, { ...options, variant: 'neutral' });
  },
  primary(text, action, data = {}, options = {}) {
    return Button.create(text, action, data, { ...options, variant: 'primary' });
  },

  team(teamId, text, action, data = {}, options = {}) {
    const variant = teamId > 0 ? 'team1' : 'team2';
    return Button.create(text, action, data, { ...options, variant });
  }
};

// Create a control section with header and button rows
function controlSection(headerText, headerTeam, ...buttonRows) {
  const headerClass = headerTeam
    ? `offense-indicator offense-team${headerTeam > 0 ? 1 : 2}`
    : 'offense-indicator';
  const style = headerTeam ? '' : ' style="background: var(--text-muted);"';

  const rowsHtml = buttonRows
    .map((row, i) => `<div class="button-row"${i > 0 ? ' style="margin-top: 0.5rem;"' : ''}>${row}</div>`)
    .join('');

  return `<div class="control-section"><span class="${headerClass}"${style}>${headerText}</span>${rowsHtml}</div>`;
}

// Render controls for sneak-style 1v1 flip cup (used by both Sneak and Two-Point)
// This is a single source of truth - any flip cup 1v1 UI must use this function
function renderSneakControls(title, resultAction, offsidesAction, options = {}) {
  const {
    lossLabel = 'Tied or lost (0)',
    winLabel = 'Won (+1)',
  } = options;
  const teamClass = teamCssClass(gameState.offenseTeam);
  return `
    <div class="control-section">
      <span class="offense-indicator offense-team${teamClass}">${offenseTeam().name} - ${title}</span>
      <div class="button-row">
        <button class="btn btn-neutral" data-action="${resultAction}" data-cups="0">${lossLabel}</button>
        <button class="btn btn-success" data-action="${resultAction}" data-cups="1">${winLabel}</button>
      </div>
      <div class="button-row" style="margin-top: 0.5rem;">
        <button class="btn btn-warning" data-action="${offsidesAction}" data-dir="-1">Offense 🚩 (-1)</button>
        <button class="btn btn-warning" data-action="${offsidesAction}" data-dir="1">Defense 🚩 (+1)</button>
      </div>
    </div>`;
}

// ============ Grid Renderers ============

// Render a grid of cup selection buttons for kicks/punts
// goodDirection: 1 for right, -1 for left (direction that's good for the thrower)
function renderCupSelectGrid(action, colorByPosition = false, goodDirection = 1) {
  const buttons = [];
  for (let cup = FieldPosition.FIELD_MIN; cup <= FieldPosition.FIELD_MAX; cup++) {
    let btnClass = 'btn btn-compact';
    // Modifier = cup * goodDirection + 1 (range -8 to +10)
    const modifier = cup * goodDirection + 1;
    // Total ball movement = base + modifier (range: +2 to +20)
    const totalMovement = BASE_KICK_DISTANCE + modifier;

    if (colorByPosition) {
      if (totalMovement > BASE_KICK_DISTANCE) {
        btnClass += ' btn-success';
      } else if (totalMovement === BASE_KICK_DISTANCE) {
        btnClass += ' btn-neutral';
      } else {
        btnClass += ' btn-warning';
      }
    }
    const label = `+${totalMovement}`;
    buttons.push(`<button class="${btnClass}" data-action="${action}" data-cup="${cup}">${label}</button>`);
  }
  return buttons.join('');
}

// Render onside kick recovery buttons for valid positions (35, 40, 45 only)
function renderOnsideRecoveryGrid() {
  const team = gameState.offenseTeam;
  const buttons = [];

  // Only 3 valid recovery positions: 35, 40, 45 yard lines
  const positions = [
    { pos: team * 3, label: 'Recovery (+2)' },  // 35 yard line
    { pos: team * 2, label: 'Recovery (+3)' },  // 40 yard line
    { pos: team * 1, label: 'Recovery (+4)' }   // 45 yard line
  ];

  positions.forEach(({ pos, label }) => {
    buttons.push(`<button class="btn btn-success" data-action="onside-recovery" data-pos="${pos}">${label}</button>`);
  });

  return buttons.join('');
}

// Shared helper for rendering return grids (kickoff and punt returns)
// landingPosition: where the kick/punt landed
// returnerTeam: team ID of the returner (1 or -1)
// action: the data-action attribute for buttons
function renderReturnGrid(action, landingPosition, returnerTeam) {
  const buttons = [];
  let hasRecovery = false;
  let recoveryCup = null;
  let hasTD = false;
  let tdCup = null;

  // Calculate missed result (where ball ends up if return is missed)
  const missedPosition = FieldPosition.clampToField(landingPosition);

  // Generate buttons for all cups in field order (left to right: -9 to +9)
  for (let cup = FieldPosition.FIELD_MIN; cup <= FieldPosition.FIELD_MAX; cup++) {
    // Return modifier = cups gained toward scoring endzone (positive = good)
    const returnModifier = cup * returnerTeam + 1;

    // Calculate final position: landing + modifier in returner's direction
    const finalPosition = landingPosition + returnModifier * returnerTeam;
    const clampedFinal = FieldPosition.clampToField(finalPosition);
    const isTD = FieldPosition.isTouchdown(finalPosition, returnerTeam);
    const inEndzone = FieldPosition.isInEndzone(landingPosition);
    const finalInOwnEndzone = FieldPosition.isSafety(finalPosition, returnerTeam);
    const isRecovery = finalInOwnEndzone && (inEndzone || returnModifier <= 0);

    let btnClass = 'btn btn-compact';
    let label;

    if (isTD) {
      // Track TD but don't add button yet - will add consolidated button
      if (!hasTD) {
        hasTD = true;
        tdCup = cup;
      }
      continue; // Skip individual TD buttons
    } else if (isRecovery) {
      // Track recovery but don't add button yet - will add consolidated button
      if (!hasRecovery) {
        hasRecovery = true;
        recoveryCup = cup;
      }
      continue; // Skip individual recovery buttons
    } else if (inEndzone) {
      // Ball in endzone - show effective position from touchback
      const effectivePos = (clampedFinal + returnerTeam * FieldPosition.FIELD_MAX) * returnerTeam + 1;
      // +1 is neutral (matches "Missed +1"), higher is success
      btnClass += effectivePos > 1 ? ' btn-success' : ' btn-neutral';
      label = `+${effectivePos}`;
    } else if (returnModifier >= 1) {
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
  }

  // Add consolidated buttons at appropriate edges
  // Team 1 (attacks right): Recovery on left, TD on right
  // Team -1 (attacks left): TD on left, Recovery on right
  if (returnerTeam > 0) {
    if (hasRecovery) {
      buttons.unshift(`<button class="btn btn-danger" data-action="${action}" data-cup="${recoveryCup}">Recovery</button>`);
    }
    if (hasTD) {
      buttons.push(`<button class="btn btn-success" data-action="${action}" data-cup="${tdCup}">Touchdown</button>`);
    }
  } else {
    if (hasTD) {
      buttons.unshift(`<button class="btn btn-success" data-action="${action}" data-cup="${tdCup}">Touchdown</button>`);
    }
    if (hasRecovery) {
      buttons.push(`<button class="btn btn-danger" data-action="${action}" data-cup="${recoveryCup}">Recovery</button>`);
    }
  }

  return buttons.join('');
}

function renderKickoffReturnGrid(action) {
  // Offense IS the returner on kickoff
  return renderReturnGrid(action, gameState.phaseData?.kickLanding, gameState.offenseTeam);
}

function renderPuntReturnGrid(action) {
  // Offense is the PUNTER, so returner is the other team (defense)
  return renderReturnGrid(action, gameState.phaseData?.puntLanding, -gameState.offenseTeam);
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
      // Clear old saves from previous coordinate system
      if (!parsed.version || parsed.version < STORAGE_VERSION) {
        clearSavedGame();
        return null;
      }
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
  } else if (gameState.overtime) {
    elements.quarterDisplay.textContent = 'OT';
    elements.possessionDisplay.textContent = `Round ${gameState.overtime.round}`;
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
    elements.downText.textContent = 'Coin toss';
    elements.situationText.textContent = '';
    return;
  }

  if (phase === Phase.GAME_OVER) {
    elements.downText.textContent = 'Game over';
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
    elements.downText.textContent = 'OT field goal';
    elements.situationText.textContent = `${offenseTeam().name}`;
    return;
  }

  // Calculate down & distance info
  const team = gameState.offenseTeam;
  const cupsToGo = Math.max(0, (gameState.firstDownMarker - gameState.ballPosition) * team);
  const isGoalRange = gameState.ballPosition * team > FieldPosition.FIELD_MAX - CUPS_TO_FIRST_DOWN;
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

// Phase groupings for field rendering
const KICKING_PHASES = [Phase.KICKOFF, Phase.KICKOFF_KICK, Phase.ONSIDE_KICK];
const RETURN_PHASES = [Phase.KICKOFF_RETURN, Phase.PUNT_RETURN];
const CONVERSION_PHASES = [Phase.TOUCHDOWN_CONVERSION, Phase.TWO_POINT_CONVERSION];
const THROWING_PHASES = [Phase.THROW_PLAY, Phase.KICKOFF_KICK, Phase.ONSIDE_KICK, Phase.KICKOFF_RETURN,
                         Phase.PUNT, Phase.PUNT_RETURN, Phase.FIELD_GOAL_ATTEMPT, Phase.EXTRA_POINT];
const PLAY_PHASES = [Phase.NORMAL_PLAY, Phase.PLAY_RESULT, Phase.THROW_PLAY, Phase.FIELD_GOAL_ATTEMPT, Phase.PUNT];

// Calculate ball display position based on current phase
function calculateBallPosition() {
  const phase = gameState.phase;
  const team = gameState.offenseTeam;

  switch (phase) {
    case Phase.COIN_TOSS:
      return FieldPosition.MIDFIELD;

    case Phase.KICKOFF:
    case Phase.KICKOFF_KICK:
    case Phase.ONSIDE_KICK:
      // Kicking from 25 yard line
      return team * FieldPosition.YARD_25;

    case Phase.TOUCHDOWN_CONVERSION:
      // Ball in scoring endzone
      return team * FieldPosition.ENDZONE_RIGHT;

    case Phase.KICKOFF_RETURN:
      if (gameState.phaseData?.kickLanding != null) {
        return FieldPosition.clampToEndzone(gameState.phaseData.kickLanding);
      }
      return gameState.ballPosition;

    case Phase.PUNT_RETURN:
      if (gameState.phaseData?.puntLanding != null) {
        return FieldPosition.clampToEndzone(gameState.phaseData.puntLanding);
      }
      return gameState.ballPosition;

    default:
      // All other phases use actual ball position
      return gameState.ballPosition;
  }
}

// Render the top row: football and direction arrow
function renderBallRow(ballPos, isReturnPhase, offenseGoesRight) {
  const ballRow = document.createElement('div');
  ballRow.className = 'field-row ball-row';
  const ENDZONE = FieldPosition.FIELD_MAX + 1;  // 10

  // Ball on field (-9 to +9) or in endzone during returns
  const onField = FieldPosition.isOnField(ballPos);
  const inEndzone = ballPos === -ENDZONE || ballPos === ENDZONE;
  const showBallInRow = onField || (isReturnPhase && inEndzone);

  if (showBallInRow) {
    const ball = document.createElement('span');
    ball.className = 'ball-position';
    // Convert cup (-9 to +9) to percentage (5% to 95%)
    // Endzones: at goal line (0%/100%) during returns, centered (-3%/103%) otherwise
    let displayPos;
    if (ballPos === -ENDZONE) displayPos = isReturnPhase ? 0 : -3;
    else if (ballPos === ENDZONE) displayPos = isReturnPhase ? 100 : 103;
    else displayPos = (ballPos + 10) * 5;
    ball.style.left = `${displayPos}%`;
    ball.textContent = '🏈';
    ballRow.appendChild(ball);
  }

  const showDirection = gameState.phase !== Phase.COIN_TOSS && gameState.phase !== Phase.GAME_OVER;
  if (showDirection && (showBallInRow || onField)) {
    const isKickoff = KICKING_PHASES.includes(gameState.phase);
    const isKickoffReturn = gameState.phase === Phase.KICKOFF_RETURN;
    const isPuntReturn = gameState.phase === Phase.PUNT_RETURN;

    let arrowRight;
    if (isKickoff) arrowRight = !offenseGoesRight;
    else if (isKickoffReturn) arrowRight = offenseGoesRight;
    else if (isPuntReturn) arrowRight = !offenseGoesRight;
    else arrowRight = offenseGoesRight;

    const arrow = document.createElement('span');
    arrow.className = 'direction-arrow';
    let arrowBasePos;
    if (ballPos === -ENDZONE) arrowBasePos = 0;
    else if (ballPos === ENDZONE) arrowBasePos = 100;
    else arrowBasePos = (ballPos + 10) * 5;
    arrow.style.left = `${arrowBasePos + (arrowRight ? 2 : -2)}%`;
    arrow.style.transform = 'translateX(-50%) translateY(-50%)';
    arrow.textContent = arrowRight ? '›' : '‹';
    ballRow.appendChild(arrow);
  }

  return ballRow;
}

// Calculate return effect for a cup in kickoff/punt return phases
// Returns { className, text } for the effect indicator
function getReturnEffect(cupIndex, landing, returnerTeam) {
  const inEndzone = FieldPosition.isInEndzone(landing);
  const returnModifier = cupIndex * returnerTeam + 1;
  const finalPosition = landing + returnModifier * returnerTeam;
  const clampedFinal = FieldPosition.clampToField(finalPosition);
  const isTD = FieldPosition.isTouchdown(finalPosition, returnerTeam);
  const finalInOwnEndzone = FieldPosition.isSafety(finalPosition, returnerTeam);
  const isRecovery = finalInOwnEndzone && (inEndzone || returnModifier <= 0);

  if (isTD) return { className: 'effect-gain', text: 'TD' };
  if (isRecovery) return { className: 'effect-turnover', text: 'REC' };
  if (inEndzone) {
    const effectivePos = (clampedFinal + returnerTeam * FieldPosition.FIELD_MAX) * returnerTeam + 1;
    return {
      className: effectivePos > 1 ? 'effect-gain' : 'effect-neutral',
      text: `+${effectivePos}`
    };
  }
  if (returnModifier >= 1) return { className: 'effect-gain', text: `+${returnModifier}` };
  if (returnModifier === 0) return { className: 'effect-neutral', text: '0' };
  return { className: 'effect-loss', text: String(returnModifier) };
}

// Get the effect class and text for a single cup in the effect row
function getCupEffect(cupIndex, phase) {
  const effect = { className: '', text: '' };
  const team = gameState.offenseTeam;

  if (phase === Phase.FIELD_GOAL_ATTEMPT) {
    // Valid FG: cup at ball position or behind it (toward kicker's home)
    const ballPos = gameState.ballPosition;
    const isValidFG = cupIndex * team <= ballPos * team;
    effect.className = isValidFG ? 'effect-gain' : 'effect-turnover';
    effect.text = isValidFG ? 'FG' : '0';
  } else if (phase === Phase.EXTRA_POINT) {
    effect.className = 'effect-gain';
    effect.text = '1PT';
  } else if (phase === Phase.ONSIDE_KICK) {
    // Onside kick: only 35, 40, 45 yard lines are valid
    const validPositions = [team * 3, team * 2, team * 1];
    const inRange = validPositions.includes(cupIndex);
    if (inRange) {
      const cups = cupIndex === team * 3 ? 2 : cupIndex === team * 2 ? 3 : 4;
      effect.className = 'effect-gain';
      effect.text = `+${cups}`;
    } else {
      effect.className = 'effect-loss';
      effect.text = '+2';
    }
  } else if ([Phase.KICKOFF_KICK, Phase.PUNT].includes(phase)) {
    // Good direction: for punt = team direction, for kick = -team direction
    const goodDirection = phase === Phase.PUNT ? team : -team;
    const modifier = cupIndex * goodDirection + 1;  // +1 offset gives +2 to +20 range
    const totalMovement = BASE_KICK_DISTANCE + modifier;

    if (totalMovement > BASE_KICK_DISTANCE) effect.className = 'effect-gain';
    else if (totalMovement === BASE_KICK_DISTANCE) effect.className = 'effect-neutral';
    else effect.className = 'effect-loss';
    effect.text = `+${totalMovement}`;
  } else if (phase === Phase.KICKOFF_RETURN && gameState.phaseData?.kickLanding != null) {
    const result = getReturnEffect(cupIndex, gameState.phaseData.kickLanding, team);
    effect.className = result.className;
    effect.text = result.text;
  } else if (phase === Phase.PUNT_RETURN && gameState.phaseData?.puntLanding != null) {
    const result = getReturnEffect(cupIndex, gameState.phaseData.puntLanding, -team);
    effect.className = result.className;
    effect.text = result.text;
  } else if (phase === Phase.THROW_PLAY) {
    // Relative position: cup * team (positive = toward scoring endzone)
    const relPos = cupIndex * team;

    if (relPos >= THROW_ZONES.SACK_FUMBLE_START && relPos <= THROW_ZONES.SACK_FUMBLE_END) {
      effect.className = 'effect-turnover'; effect.text = 'FUM';
    } else if (relPos >= THROW_ZONES.MIDDLE_START && relPos <= -1) {
      const yards = relPos + 1;  // -4→-3, -3→-2, -2→-1, -1→0
      effect.className = yards < 0 ? 'effect-loss' : 'effect-neutral';
      effect.text = yards < 0 ? String(yards) : '0';
    } else if (relPos >= 0 && relPos <= THROW_ZONES.MIDDLE_END) {
      effect.className = 'effect-gain';
      effect.text = `+${relPos + 1}`;  // 0→+1, 1→+2, 2→+3, 3→+4
    } else if (relPos === THROW_ZONES.INCOMPLETE_30 || relPos === THROW_ZONES.INCOMPLETE_20) {
      effect.className = 'effect-neutral';
      effect.text = '0';
    } else if (relPos === THROW_ZONES.INTERCEPTION) {
      effect.className = 'effect-turnover';
      effect.text = 'INT';
    } else if (relPos >= THROW_ZONES.DEEP_START && relPos <= THROW_ZONES.DEEP_END) {
      effect.className = 'effect-gain';
      effect.text = '5+';
    }
  }

  return effect;
}

// Render the bottom row: cup effects and throwing indicator
function renderEffectRow(offenseGoesRight) {
  const effectRow = document.createElement('div');
  effectRow.className = 'field-row effect-row';

  if (THROWING_PHASES.includes(gameState.phase)) {
    const oppositeDirection = [Phase.KICKOFF_KICK, Phase.ONSIDE_KICK, Phase.PUNT_RETURN,
                               Phase.FIELD_GOAL_ATTEMPT, Phase.EXTRA_POINT];
    const throwerGoesRight = oppositeDirection.includes(gameState.phase) ? !offenseGoesRight : offenseGoesRight;
    const throwArrow = document.createElement('span');
    throwArrow.className = `direction-arrow ${throwerGoesRight ? 'left' : 'right'}`;
    // Use play-specific emoji for throw indicator
    let throwEmoji;
    if ([Phase.KICKOFF_KICK, Phase.ONSIDE_KICK, Phase.PUNT].includes(gameState.phase)) {
      throwEmoji = '👟';  // Cleat for kicks/punts
    } else if ([Phase.FIELD_GOAL_ATTEMPT, Phase.EXTRA_POINT].includes(gameState.phase)) {
      throwEmoji = '🥅';  // Goal for field goals
    } else if ([Phase.KICKOFF_RETURN, Phase.PUNT_RETURN].includes(gameState.phase)) {
      throwEmoji = '🏃';  // Runner for returns
    } else {
      throwEmoji = '💪';  // Arm for passes
    }
    throwArrow.textContent = throwEmoji;
    effectRow.appendChild(throwArrow);
  }

  for (let cup = FieldPosition.FIELD_MIN; cup <= FieldPosition.FIELD_MAX; cup++) {
    const cupEffect = getCupEffect(cup, gameState.phase);
    // Only render cups that have an effect
    if (!cupEffect.className && !cupEffect.text) continue;
    const effect = document.createElement('div');
    effect.className = 'cup-effect';
    effect.style.left = `${(cup + 10) * 5}%`;  // -9→5%, 0→50%, +9→95%
    if (cupEffect.className) effect.classList.add(cupEffect.className);
    if (cupEffect.text) effect.textContent = cupEffect.text;
    effectRow.appendChild(effect);
  }

  return effectRow;
}

// Render the middle row: yard numbers
function renderNumberRow() {
  const numberRow = document.createElement('div');
  numberRow.className = 'field-row number-row';

  for (let cup = FieldPosition.FIELD_MIN; cup <= FieldPosition.FIELD_MAX; cup++) {
    const num = document.createElement('span');
    num.className = 'yard-number';
    // Major markers at 50 (cup 0), 25s (cups ±5)
    if (cup === 0 || cup === -5 || cup === 5) num.classList.add('major');
    num.style.left = `${(cup + 10) * 5}%`;
    num.textContent = cupDisplayLabel(cup);
    numberRow.appendChild(num);
  }

  return numberRow;
}

// Render player circles during run plays
// Shows two rows (top=team+1/away, bottom=team-1/home) with gain/loss values
// Replaces the effect row but uses same cup-effect styling
// Phases that use flip cup mechanics and should show player circles.
// When adding new flip cup phases, ensure they:
// 1. Set phaseData = { offensePlayers, isQBSneak } when entering the phase
// 2. Have a control renderer with result buttons (and offsides if applicable)
// 3. Are included in this array for player circle rendering
const FLIP_CUP_PHASES = [Phase.PLAY_RESULT, Phase.TWO_POINT_CONVERSION];

function renderPlayerCircles() {
  if (!FLIP_CUP_PHASES.includes(gameState.phase)) return null;
  const { offensePlayers, isQBSneak } = gameState.phaseData || {};
  if (!offensePlayers) return null;

  const team = gameState.offenseTeam;
  // Top row is ALWAYS team +1 (away/right), bottom is ALWAYS team -1 (home/left)
  const team1IsOffense = team > 0;

  // Build position data for each slot
  const topRowData = [];  // team +1
  const bottomRowData = [];  // team -1

  // Offense lines up on their right (looking from own endzone toward opponent's)
  // Team +1 attacks right, so their right = bottom of screen
  // Team -1 attacks left, so their right = top of screen
  if (isQBSneak) {
    // Sneak/Two-point: 1v1, defense wins = points/yards, offense loses = 0
    const isTwoPoint = gameState.phase === Phase.TWO_POINT_CONVERSION;
    const winLabel = isTwoPoint ? '2PT' : '+1';
    if (team1IsOffense) {
      topRowData[0] = winLabel;  // defense (team -1)
      bottomRowData[0] = '0';   // offense (team +1) - on their right
    } else {
      topRowData[0] = '0';   // offense (team -1) - on their right
      bottomRowData[0] = winLabel;  // defense (team +1)
    }
  } else {
    const defensePlayers = offensePlayers + 1;
    const maxPlayers = defensePlayers;

    for (let i = 0; i < maxPlayers; i++) {
      // For team +1 offense (attacks right): positions grow left-to-right, extra defender on right
      // For team -1 offense (attacks left): positions grow right-to-left, extra defender on left
      const slotIndex = team > 0 ? i : (maxPlayers - 1 - i);

      // Offense has fewer players - check if this slot has an offense player
      const hasOffensePlayer = slotIndex < offensePlayers;

      // Calculate offense value (loss if offense has unflipped cups)
      let offenseValue = '';
      if (hasOffensePlayer) {
        const unflipped = offensePlayers - slotIndex;
        if (unflipped === offensePlayers) {
          offenseValue = 'FUM';
        } else {
          const yards = FLIP_CUP_YARDAGE[unflipped];
          offenseValue = `-${yards}`;
        }
      }

      // Calculate defense value (gain if defense has unflipped cups)
      const defUnflipped = defensePlayers - slotIndex;
      const defYards = FLIP_CUP_YARDAGE[defUnflipped];
      const defenseValue = defYards === 'TD' ? 'TD' : `+${defYards}`;

      // Assign based on which team is offense
      // Offense on their right: team +1 offense → bottom, team -1 offense → top
      if (team1IsOffense) {
        topRowData[i] = defenseValue;  // team -1 is defense
        bottomRowData[i] = offenseValue;  // team +1 is offense (their right = bottom)
      } else {
        topRowData[i] = offenseValue;  // team -1 is offense (their right = top)
        bottomRowData[i] = defenseValue;  // team +1 is defense
      }
    }
  }

  // Create effect row with two sub-rows of circles
  const effectRow = document.createElement('div');
  effectRow.className = 'field-row effect-row player-circles-mode';

  // Calculate center position and spacing
  const centerPercent = 50;
  const spacing = 5;  // percentage between circles
  const numPlayers = topRowData.length;
  const startOffset = -((numPlayers - 1) * spacing) / 2;

  const createCircle = (value, posIndex) => {
    const circle = document.createElement('div');
    circle.className = 'cup-effect';
    circle.style.left = `${centerPercent + startOffset + posIndex * spacing}%`;

    if (!value) {
      circle.classList.add('empty');
    } else if (value === 'FUM') {
      circle.classList.add('effect-turnover');
    } else if (value.startsWith('+')) {
      circle.classList.add('effect-gain');
    } else if (value.startsWith('-')) {
      circle.classList.add('effect-loss');
    } else if (value === 'TD' || value.endsWith('PT')) {
      circle.classList.add('effect-gain');
    } else if (value === '0') {
      circle.classList.add('effect-neutral');
    }
    circle.textContent = value || '';
    return circle;
  };

  // Add top row circles (offset up)
  topRowData.forEach((value, i) => {
    const circle = createCircle(value, i);
    circle.classList.add('player-top');
    effectRow.appendChild(circle);
  });

  // Add bottom row circles (offset down)
  bottomRowData.forEach((value, i) => {
    const circle = createCircle(value, i);
    circle.classList.add('player-bottom');
    effectRow.appendChild(circle);
  });

  return effectRow;
}

// Render line of scrimmage marker
function renderLineOfScrimmage(ballPos) {
  if (!FieldPosition.isOnField(ballPos)) return null;

  const markerEl = document.createElement('div');
  markerEl.className = 'line-of-scrimmage';
  markerEl.style.left = `${(ballPos + 10) * 5}%`;
  return markerEl;
}

// Render first down marker if applicable
function renderFirstDownMarker() {
  if (!PLAY_PHASES.includes(gameState.phase)) return null;
  const marker = gameState.firstDownMarker;
  if (marker < FieldPosition.FIELD_MIN - 1 || marker > FieldPosition.FIELD_MAX + 1) return null;

  const markerEl = document.createElement('div');
  markerEl.className = 'first-down-marker';
  markerEl.style.left = `${(marker + 10) * 5}%`;
  return markerEl;
}

// Update endzone labels and optional football
function renderEndzones(ballPos, isReturnPhase) {
  const ENDZONE = FieldPosition.FIELD_MAX + 1;
  elements.endzoneLeft.querySelector('.endzone-label').textContent = gameState.team1.name.toUpperCase();
  elements.endzoneRight.querySelector('.endzone-label').textContent = gameState.team2.name.toUpperCase();

  elements.endzoneLeft.querySelectorAll('.ball-position').forEach(f => f.remove());
  elements.endzoneRight.querySelectorAll('.ball-position').forEach(f => f.remove());

  // Show ball in endzone during non-return phases
  if ((ballPos === -ENDZONE || ballPos === ENDZONE) && !isReturnPhase) {
    const football = document.createElement('span');
    football.className = 'ball-position';
    football.style.position = 'absolute';
    football.style.top = '50%';
    football.style.left = '50%';
    football.style.transform = 'translate(-50%, -50%)';
    football.textContent = '🏈';
    (ballPos === -ENDZONE ? elements.endzoneLeft : elements.endzoneRight).appendChild(football);
  }
}

function renderField() {
  elements.field.innerHTML = '';

  const ballPos = calculateBallPosition();
  const isReturnPhase = RETURN_PHASES.includes(gameState.phase);
  const offenseGoesRight = gameState.offenseTeam > 0;  // Team +1 goes right

  elements.field.appendChild(renderBallRow(ballPos, isReturnPhase, offenseGoesRight));
  elements.field.appendChild(renderNumberRow());

  // Show player circles during run plays, otherwise show effect row
  const playerCircles = renderPlayerCircles();
  if (playerCircles) {
    elements.field.appendChild(playerCircles);
  } else {
    elements.field.appendChild(renderEffectRow(offenseGoesRight));
  }

  const lineOfScrimmage = renderLineOfScrimmage(ballPos);
  if (lineOfScrimmage) elements.field.appendChild(lineOfScrimmage);

  const firstDownMarker = renderFirstDownMarker();
  if (firstDownMarker) elements.field.appendChild(firstDownMarker);

  renderEndzones(ballPos, isReturnPhase);
}

function renderResultIndicators() {
  elements.resultIndicatorsTop.innerHTML = '';
  elements.resultIndicatorsBottom.innerHTML = '';

  const result = gameState.lastPlayResult;
  if (!result) return;

  // Team +1 (home/right) shows above, Team -1 (away/left) shows below
  const container = result.team > 0 ? elements.resultIndicatorsTop : elements.resultIndicatorsBottom;

  const indicator = document.createElement('div');
  indicator.className = `result-indicator result-${result.type}`;
  indicator.style.left = `${(result.position + 10) * 5}%`;
  indicator.textContent = result.text;
  container.appendChild(indicator);
}

// Helper to get CSS class number (1 or 2) from team ID (+1 or -1)
function teamCssClass(teamId) {
  return teamId > 0 ? 1 : 2;
}

// Control renderers
const controlRenderers = {
  [Phase.COIN_TOSS]: () => controlSection(
    'Coin toss - receiving team',
    null,
    Button.team(1, gameState.team1.name, 'coin-toss', { team: 1 }) +
    Button.team(-1, gameState.team2.name, 'coin-toss', { team: -1 })
  ),

  [Phase.KICKOFF]: () => {
    const buttons = Button.primary('Regular', 'regular-kickoff');
    const onsideBtn = gameState.phaseData?.allowOnside ? Button.neutral('Onside', 'onside-kick') : '';
    return controlSection(
      `${defenseTeam().name} - kickoff type`,
      -gameState.offenseTeam,
      buttons + onsideBtn
    );
  },

  [Phase.KICKOFF_KICK]: () => {
    const kickingTeam = defenseTeam();
    const kickingTeamClass = teamCssClass(-gameState.offenseTeam);
    // Kick direction: toward receiver's defending endzone = opposite of offense's direction
    const goodDirection = -gameState.offenseTeam;
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${kickingTeamClass}">${kickingTeam.name} - kickoff (first of 2)</span>
        <div class="button-row">${renderCupSelectGrid('kickoff-land', true, goodDirection)}</div>
        <div class="button-row" style="margin-top: 0.5rem;">
          <button class="btn btn-neutral" data-action="kickoff-miss">Missed (+10)</button>
        </div>
      </div>`;
  },

  [Phase.ONSIDE_KICK]: () => controlSection(
    `${defenseTeam().name} - onside kick (one attempt)`,
    -gameState.offenseTeam,
    renderOnsideRecoveryGrid(),
    Button.warning('Missed (+2)', 'onside-miss')
  ),

  [Phase.KICKOFF_RETURN]: () => {
    const teamClass = teamCssClass(gameState.offenseTeam);
    const landing = gameState.phaseData?.kickLanding ?? 0;
    const inEndzone = FieldPosition.isInEndzone(landing);
    const missLabel = inEndzone ? 'Missed (+1)' : 'Missed (0)';
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${teamClass}">${offenseTeam().name} - return (first of 2)</span>
        <div class="button-row">${renderKickoffReturnGrid('return-hit')}</div>
        <div class="button-row" style="margin-top: 0.5rem;">
          <button class="btn btn-neutral" data-action="return-miss">${missLabel}</button>
        </div>
      </div>`;
  },

  [Phase.NORMAL_PLAY]: () => {
    const downNames = ['1st', '2nd', '3rd', '4th'];
    const isFourthDown = gameState.down === 4;
    const primaryClass = isFourthDown ? 'btn-neutral' : 'btn-primary';
    const kickClass = isFourthDown ? 'btn-primary' : 'btn-neutral';
    const teamClass = teamCssClass(gameState.offenseTeam);
    return `
    <div class="control-section">
      <span class="offense-indicator offense-team${teamClass}">${offenseTeam().name} - ${downNames[gameState.down - 1]} down</span>
      <div class="button-row">
        <button class="btn ${kickClass}" data-action="fourth-down" data-choice="punt">Punt</button>
        <button class="btn ${kickClass}" data-action="fourth-down" data-choice="fg">Field goal</button>
        <button class="btn ${primaryClass}" data-action="start-throw">Pass</button>
      </div>
      <div class="button-row" style="margin-top: 0.5rem;">
        <button class="btn ${primaryClass}" data-action="qb-sneak">Sneak 1v1</button>
        <button class="btn ${primaryClass}" data-action="select-players" data-count="2">Run 2v3</button>
        <button class="btn ${primaryClass}" data-action="select-players" data-count="3">Run 3v4</button>
        <button class="btn ${primaryClass}" data-action="select-players" data-count="4">Run 4v5</button>
      </div>
    </div>`;
  },

  [Phase.PLAY_RESULT]: () => {
    const { offensePlayers, isQBSneak } = gameState.phaseData;
    const teamClass = teamCssClass(gameState.offenseTeam);

    if (isQBSneak) {
      return renderSneakControls('Sneak 1v1', 'result', 'offsides');
    }

    const defensePlayers = offensePlayers + 1;
    const buttons = [];

    for (let i = offensePlayers; i >= 1; i--) {
      const yards = FLIP_CUP_YARDAGE[i];
      const isFumble = i === offensePlayers && offensePlayers > 1;
      const label = isFumble ? `Fumble (-${yards})` : `-${yards}`;
      buttons.push(`<button class="btn ${isFumble ? 'btn-danger' : 'btn-warning'}" data-action="result" data-cups="${-i}">${label}</button>`);
    }
    buttons.push(`<button class="btn btn-neutral" data-action="result" data-cups="0">0</button>`);
    for (let i = 1; i <= defensePlayers; i++) {
      const yards = FLIP_CUP_YARDAGE[i];
      const label = yards === 'TD' ? 'Touchdown' : `+${yards}`;
      buttons.push(`<button class="btn btn-success" data-action="result" data-cups="${i}">${label}</button>`);
    }

    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${teamClass}">${offenseTeam().name} - run (${offensePlayers}v${defensePlayers})</span>
        <div class="button-row">${buttons.join('')}</div>
        <div class="button-row" style="margin-top: 0.5rem;">
          <button class="btn btn-warning" data-action="offsides" data-dir="-1">Offense 🚩 (-1)</button>
          <button class="btn btn-warning" data-action="offsides" data-dir="1">Defense 🚩 (+1)</button>
        </div>
      </div>`;
  },

  [Phase.THROW_PLAY]: () => {
    const teamClass = teamCssClass(gameState.offenseTeam);
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${teamClass}">${offenseTeam().name} - passing (first of 3)</span>
        <div class="button-row">
          <button class="btn btn-danger" data-action="throw-result" data-result="sack_fumble">Sack fumble (-3)</button>
          <button class="btn btn-warning" data-action="throw-result" data-result="-3">-3</button>
          <button class="btn btn-warning" data-action="throw-result" data-result="-2">-2</button>
          <button class="btn btn-warning" data-action="throw-result" data-result="-1">-1</button>
          <button class="btn btn-neutral" data-action="throw-result" data-result="0">0</button>
          <button class="btn btn-success" data-action="throw-result" data-result="1">+1</button>
          <button class="btn btn-success" data-action="throw-result" data-result="2">+2</button>
          <button class="btn btn-success" data-action="throw-result" data-result="3">+3</button>
          <button class="btn btn-success" data-action="throw-result" data-result="4">+4</button>
        </div>
        <div class="button-row" style="margin-top: 0.5rem;">
          <button class="btn btn-neutral" data-action="throw-result" data-result="incomplete">Incomplete (0)</button>
          <button class="btn btn-danger" data-action="throw-result" data-result="int">Interception (0)</button>
          <button class="btn btn-success" data-action="throw-result" data-result="5">+5</button>
          <span style="color: var(--text-muted); margin: 0 0.5rem;">Called:</span>
          <button class="btn btn-success" data-action="throw-result" data-result="6">+6</button>
          <button class="btn btn-success" data-action="throw-result" data-result="9">+9</button>
          <button class="btn btn-success" data-action="throw-result" data-result="td">Touchdown</button>
        </div>
      </div>`;
  },

  [Phase.PUNT]: () => {
    const teamClass = teamCssClass(gameState.offenseTeam);
    // Punt direction = offense's direction
    const goodDirection = gameState.offenseTeam;
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${teamClass}">${offenseTeam().name} - punting (first of 2)</span>
        <div class="button-row">${renderCupSelectGrid('punt-hit', true, goodDirection)}</div>
        <div class="button-row" style="margin-top: 0.5rem;">
          <button class="btn btn-neutral" data-action="punt-miss">Missed (+10)</button>
        </div>
      </div>`;
  },

  [Phase.PUNT_RETURN]: () => {
    const returnerTeamClass = teamCssClass(-gameState.offenseTeam);
    const landing = gameState.phaseData?.puntLanding ?? 0;
    const inEndzone = FieldPosition.isInEndzone(landing);
    const missLabel = inEndzone ? 'Missed (+1)' : 'Missed (0)';
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${returnerTeamClass}">${defenseTeam().name} - punt return (first of 2)</span>
        <div class="button-row">${renderPuntReturnGrid('punt-return-hit')}</div>
        <div class="button-row" style="margin-top: 0.5rem;">
          <button class="btn btn-neutral" data-action="punt-return-miss">${missLabel}</button>
        </div>
      </div>`;
  },

  [Phase.FIELD_GOAL_ATTEMPT]: () => controlSection(
    `${offenseTeam().name} - field goal (first of 3)`,
    gameState.offenseTeam,
    Button.success('Field goal', 'field-goal', { result: 'make' }) +
    Button.danger('No good', 'field-goal', { result: 'miss' })
  ),

  [Phase.TOUCHDOWN_CONVERSION]: () => controlSection(
    `${offenseTeam().name} - touchdown!`,
    gameState.offenseTeam,
    Button.primary('Extra point (1 pt)', 'conversion-choice', { choice: 'xp' }) +
    Button.primary('Two-point (2 pts)', 'conversion-choice', { choice: '2pt' })
  ),

  [Phase.EXTRA_POINT]: () => controlSection(
    `${offenseTeam().name} - extra point (first of 3)`,
    gameState.offenseTeam,
    Button.success('Extra point', 'extra-point', { result: 'make' }) +
    Button.neutral('No good', 'extra-point', { result: 'miss' })
  ),

  [Phase.TWO_POINT_CONVERSION]: () => {
    const teamClass = teamCssClass(gameState.offenseTeam);
    return `
      <div class="control-section">
        <span class="offense-indicator offense-team${teamClass}">${offenseTeam().name} - Two-point 1v1</span>
        <div class="button-row">
          <button class="btn btn-neutral" data-action="two-point" data-cups="0">No good</button>
          <button class="btn btn-success" data-action="two-point" data-cups="1">2 points</button>
        </div>
      </div>`;
  },

  [Phase.GAME_OVER]: () => {
    const winner = gameState.team1.score > gameState.team2.score ? gameState.team1 :
                   gameState.team2.score > gameState.team1.score ? gameState.team2 : null;
    const winnerTeam = gameState.team1.score > gameState.team2.score ? 1 : -1;
    if (!winner) {
      return controlSection('Game tied!', null, Button.primary('Start overtime', 'start-overtime'));
    }
    return controlSection(
      `${winner.name} wins! (${gameState.team1.score} - ${gameState.team2.score})`,
      winnerTeam,
      Button.primary('New game', 'new-game')
    );
  },

  [Phase.OVERTIME_START]: () => controlSection(
    'Overtime - first possession',
    null,
    Button.team(1, gameState.team1.name, 'ot-first', { team: 1 }) +
    Button.team(-1, gameState.team2.name, 'ot-first', { team: -1 })
  ),

  [Phase.OVERTIME_FIELD_GOAL]: () => controlSection(
    `${offenseTeam().name} - OT field goal (first of 3)`,
    gameState.offenseTeam,
    Button.success('Field goal', 'ot-fg', { result: 'make' }) +
    Button.neutral('Missed', 'ot-fg', { result: 'miss' })
  )
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
  'onside-recovery': e => handleOnsideRecovery(parseInt(e.target.dataset.pos)),
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
  'offsides': e => handleOffsides(parseInt(e.target.dataset.dir)),
  'fourth-down': e => handleFourthDown(e.target.dataset.choice),
  'field-goal': e => handleFieldGoal(e.target.dataset.result),
  'conversion-choice': e => handleConversionChoice(e.target.dataset.choice),
  'extra-point': e => handleExtraPoint(e.target.dataset.result),
  'two-point': e => handleTwoPoint(parseInt(e.target.dataset.cups)),
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
  enterKickoffPhase(false);  // No onside at start of game
}

function enterKickoffPhase(allowOnside = true) {
  // Ball at kicking team's 25
  gameState.ballPosition = -gameState.offenseTeam * FieldPosition.YARD_25;
  gameState.phaseData = { allowOnside };
  gameState.phase = Phase.KICKOFF;
}

function handleRegularKickoff() {
  gameState.phase = Phase.KICKOFF_KICK;
}

function handleKickoffLand(cup) {
  // Kicking team kicks toward receiving team's defending endzone (opposite of team direction)
  const team = gameState.offenseTeam;
  // Modifier: cup * (-team) + 1 gives +2 to +20 range
  const kickModifier = cup * (-team) + 1;
  // Kicking team's 25 is in their territory (team's direction from midfield)
  const startPos = team * FieldPosition.YARD_25;
  // Total distance then kick in -team direction (toward receiver's defending endzone)
  const landingPos = startPos + (BASE_KICK_DISTANCE + kickModifier) * (-team);
  gameState.phaseData = { kickLanding: landingPos };
  gameState.phase = Phase.KICKOFF_RETURN;
}

function handleKickoffMiss() {
  // Both attempts missed - base kick distance, no modifier
  const team = gameState.offenseTeam;
  // Kicking team's 25 is in their territory (team's direction from midfield)
  const startPos = team * FieldPosition.YARD_25;
  // Kick in -team direction (toward receiver's defending endzone)
  const landingPos = startPos + BASE_KICK_DISTANCE * (-team);
  gameState.phaseData = { kickLanding: landingPos };
  gameState.phase = Phase.KICKOFF_RETURN;
}

function handleOnsideKick() {
  gameState.phase = Phase.ONSIDE_KICK;
}

function handleOnsideRecovery(position) {
  // Kicking team recovers at the specified position
  gameState.offenseTeam = -gameState.offenseTeam;
  gameState.ballPosition = position;
  startNewPossession();
}

function handleOnsideMiss() {
  // Receiving team gets ball at kicking team's 35 yard line
  const team = gameState.offenseTeam;
  // Kicking team's 35 is at cup position team * 3
  gameState.ballPosition = team * 3;
  startNewPossession();
}

// Calculate return outcome: 'td', 'recovery', or 'normal'
function calculateReturn(cup, landing, returnerTeam) {
  const returnModifier = cup * returnerTeam + 1;
  const finalPosition = landing + returnModifier * returnerTeam;

  if (FieldPosition.isTouchdown(finalPosition, returnerTeam)) {
    return { type: 'td', finalPosition, returnModifier };
  }
  if (returnModifier <= 0 && FieldPosition.isSafety(finalPosition, returnerTeam)) {
    return { type: 'recovery', finalPosition, returnModifier };
  }
  return { type: 'normal', finalPosition, returnModifier };
}

function handleReturn(cup) {
  const team = gameState.offenseTeam;
  const result = calculateReturn(cup, gameState.phaseData.kickLanding, team);
  gameState.phaseData = null;

  if (result.type === 'td') {
    scoreTouchdown();
    return;
  }

  if (result.type === 'recovery') {
    // Kicking team recovers at receiver's 5 yard line
    gameState.offenseTeam = -team;
    gameState.ballPosition = -team * FieldPosition.YARD_5;
    startNewPossession();
    return;
  }

  gameState.ballPosition = FieldPosition.clampToField(result.finalPosition);
  startNewPossession();
}

function handleReturnMiss() {
  gameState.ballPosition = FieldPosition.clampToField(gameState.phaseData.kickLanding);
  gameState.phaseData = null;
  startNewPossession();
}

function handleSelectPlayers(count, isQBSneak = false) {
  gameState.phaseData = { offensePlayers: count, isQBSneak };
  gameState.phase = Phase.PLAY_RESULT;
}

function handleStartThrow() {
  gameState.phase = Phase.THROW_PLAY;
}

// Simplified throw result handler - user clicks final result directly
function handleThrowResultSimple(result) {
  const team = gameState.offenseTeam;
  const position = gameState.ballPosition;

  if (result === 'td') {
    gameState.lastPlayResult = { team, position, type: 'td', text: 'TD' };
    scoreTouchdown();
    return;
  }

  if (result === 'int') {
    gameState.lastPlayResult = { team, position, type: 'turnover', text: '' };
    if (flipPossession(false)) return;
    startNewPossession();
    return;
  }

  if (result === 'sack_fumble') {
    // Sack fumble: -3 yards, turnover, can result in defensive TD
    gameState.lastPlayResult = { team, position, type: 'turnover', text: 'FUM' };
    gameState.ballPosition += -3 * team;

    // Flip possession - defense recovers
    gameState.offenseTeam = -team;
    const newTeam = gameState.offenseTeam;

    // Check for defensive TD (ball in new offense's scoring endzone)
    if (FieldPosition.isTouchdown(gameState.ballPosition, newTeam)) {
      gameState.ballPosition = FieldPosition.clampToField(gameState.ballPosition);
      scoreTouchdown();
      return;
    }

    // Check for safety (ball in new offense's own endzone - shouldn't happen but handle it)
    if (FieldPosition.isSafety(gameState.ballPosition, newTeam)) {
      gameState.ballPosition = FieldPosition.clampToField(gameState.ballPosition);
      scoreSafety();
      return;
    }

    gameState.ballPosition = FieldPosition.clampToField(gameState.ballPosition);
    if (advanceGameClock()) return;
    startNewPossession();
    return;
  }

  if (result === 'incomplete') {
    gameState.lastPlayResult = { team, position, type: 'neutral', text: '—' };
    gameState.down++;
    checkDowns();
    return;
  }

  const yards = parseInt(result);

  if (yards > 0) {
    gameState.lastPlayResult = { team, position, type: 'gain', text: '+' + yards };
  } else if (yards < 0) {
    gameState.lastPlayResult = { team, position, type: 'loss', text: String(yards) };
  } else {
    gameState.lastPlayResult = { team, position, type: 'neutral', text: '0' };
  }

  gameState.ballPosition += yards * team;

  // Check for touchdown (past opponent's endzone)
  if (FieldPosition.isTouchdown(gameState.ballPosition, team)) {
    gameState.ballPosition = FieldPosition.clampToField(gameState.ballPosition);
    scoreTouchdown();
    return;
  }

  // Check for safety (past own endzone)
  if (FieldPosition.isSafety(gameState.ballPosition, team)) {
    gameState.ballPosition = FieldPosition.clampToField(gameState.ballPosition);
    scoreSafety();
    return;
  }

  gameState.ballPosition = FieldPosition.clampToField(gameState.ballPosition);
  checkFirstDownAndAdvance();
}

function handlePlayResult(cups) {
  const { offensePlayers, isQBSneak } = gameState.phaseData;
  const team = gameState.offenseTeam;
  const position = gameState.ballPosition;
  gameState.phaseData = null;

  // QB Sneak: win = +1, tie/loss = 0
  if (isQBSneak) {
    if (cups > 0) {
      const result = advanceBall(1);
      if (result === 'td') {
        gameState.lastPlayResult = { team, position, type: 'td', text: 'TD' };
        return;
      }
      // Safety not possible on sneak win, but advanceBall handles it
      gameState.lastPlayResult = { team, position, type: 'gain', text: '1' };
      checkFirstDownAndAdvance();
    } else {
      gameState.lastPlayResult = { team, position, type: 'neutral', text: '0' };
      gameState.down++;
      checkDowns();
    }
    return;
  }

  // Regular run play
  const isFumble = cups === -offensePlayers && offensePlayers > 1;

  if (cups === 0) {
    gameState.lastPlayResult = { team, position, type: 'neutral', text: '0' };
    gameState.down++;
    checkDowns();
    return;
  }

  const yardageValue = cups > 0 ? FLIP_CUP_YARDAGE[cups] : FLIP_CUP_YARDAGE[-cups];

  if (yardageValue === 'TD' && cups > 0) {
    gameState.lastPlayResult = { team, position, type: 'td', text: 'TD' };
    scoreTouchdown();
    return;
  }

  const yards = cups > 0 ? yardageValue : -yardageValue;

  if (isFumble) {
    gameState.lastPlayResult = { team, position, type: 'turnover', text: 'F' };
  } else if (yards > 0) {
    gameState.lastPlayResult = { team, position, type: 'gain', text: String(yards) };
  } else if (yards < 0) {
    gameState.lastPlayResult = { team, position, type: 'loss', text: String(yards) };
  } else {
    gameState.lastPlayResult = { team, position, type: 'neutral', text: '0' };
  }

  // Handle fumble: possession flips BEFORE checking TD/safety
  if (isFumble) {
    gameState.ballPosition += yards * team;
    gameState.offenseTeam = -team;

    // Check TD/safety from NEW offense's perspective
    if (checkScoring()) return;

    // Normal fumble recovery - start new possession for recovering team
    if (advanceGameClock()) return;
    startNewPossession();
    return;
  }

  // Non-fumble: advance ball and check TD/safety
  if (advanceBall(yards)) return;
  checkFirstDownAndAdvance();
}

// Check first down and advance to next down (or reset if first down made)
function checkFirstDownAndAdvance() {
  const team = gameState.offenseTeam;
  const madeFirstDown = gameState.ballPosition * team >= gameState.firstDownMarker * team;
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

function handleOffsides(dir) {
  const team = gameState.offenseTeam;
  // dir: +1 = offense gains (defense offsides), -1 = offense loses (offense offsides)
  const newPosition = gameState.ballPosition + dir * team;

  // Clamp at 5 yard lines - no safety or TD from offsides
  if (newPosition * team > FieldPosition.YARD_5) {
    gameState.ballPosition = team * FieldPosition.YARD_5;
  } else if (newPosition * team < -FieldPosition.YARD_5) {
    gameState.ballPosition = -team * FieldPosition.YARD_5;
  } else {
    gameState.ballPosition = newPosition;
  }

  // Clear pending play and repeat down
  gameState.phaseData = null;
  gameState.phase = Phase.NORMAL_PLAY;
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
  const team = gameState.offenseTeam;
  // Modifier = cup * team + 1 gives +2 to +20 range
  const puntModifier = cup * team + 1;
  const puntDistance = BASE_KICK_DISTANCE + puntModifier;
  const landingPosition = gameState.ballPosition + puntDistance * team;
  gameState.phaseData = { puntLanding: landingPosition };
  gameState.phase = Phase.PUNT_RETURN;
}

function handlePuntMiss() {
  const team = gameState.offenseTeam;
  const landingPosition = gameState.ballPosition + BASE_KICK_DISTANCE * team;
  gameState.phaseData = { puntLanding: landingPosition };
  gameState.phase = Phase.PUNT_RETURN;
}

function handlePuntReturn(cup) {
  const returnerTeam = -gameState.offenseTeam;
  const result = calculateReturn(cup, gameState.phaseData.puntLanding, returnerTeam);
  gameState.phaseData = null;

  if (result.type === 'td') {
    gameState.offenseTeam = returnerTeam;
    scoreTouchdown();
    return;
  }

  if (result.type === 'recovery') {
    // Punting team recovers at returner's 5 yard line
    gameState.ballPosition = -returnerTeam * FieldPosition.YARD_5;
    startNewPossession();
    return;
  }

  gameState.ballPosition = FieldPosition.clampToField(result.finalPosition);
  if (flipPossession(true)) return;
  startNewPossession();
}

function handlePuntReturnMiss() {
  // Both attempts missed - return modifier = 0 (not negative, so no recovery)
  // Ball stays at punt landing spot (clamped to field)
  gameState.ballPosition = FieldPosition.clampToField(gameState.phaseData.puntLanding);
  gameState.phaseData = null;
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
  // Ball in the endzone they scored in (team's scoring endzone = team * (FieldPosition.FIELD_MAX+1))
  gameState.ballPosition = gameState.offenseTeam * (FieldPosition.FIELD_MAX + 1);
  gameState.phase = Phase.TOUCHDOWN_CONVERSION;
}

function scoreSafety() {
  // Defense scores 2 points
  addScore(-gameState.offenseTeam, 2);
  startKickoff(true); // Safety kickoff
}

function handleConversionChoice(choice) {
  // Ball at opponent's 5 yard line (which is in offense's scoring direction)
  gameState.ballPosition = gameState.offenseTeam * FieldPosition.YARD_5;
  if (choice === 'xp') {
    gameState.phase = Phase.EXTRA_POINT;
  } else {
    gameState.phaseData = { offensePlayers: 1, isQBSneak: true };
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

function handleTwoPoint(cups) {
  // cups: 1 = won (offense scores 2), 0 = tied or lost
  if (cups === 1) addScore(gameState.offenseTeam, 2);
  startKickoff();
}

function addScore(team, points) {
  getTeam(team).score += points;
}

// Start a fresh possession at current ball position
function startNewPossession() {
  gameState.down = 1;
  setFirstDownMarker();
  gameState.phaseData = null;
  gameState.lastPlayResult = null;
  gameState.phase = Phase.NORMAL_PLAY;
}

// Set first down marker in the direction the offense is moving
function setFirstDownMarker() {
  const team = gameState.offenseTeam;
  // Marker is CUPS_TO_FIRST_DOWN cups toward scoring endzone, capped at endzone
  const newMarker = gameState.ballPosition + CUPS_TO_FIRST_DOWN * team;
  // Cap at endzone (FieldPosition.FIELD_MAX + 1 or FieldPosition.FIELD_MIN - 1)
  if (team > 0) {
    gameState.firstDownMarker = Math.min(FieldPosition.FIELD_MAX + 1, newMarker);
  } else {
    gameState.firstDownMarker = Math.max(FieldPosition.FIELD_MIN - 1, newMarker);
  }
}

function flipPossession(advancePossession = true) {
  if (gameState.overtime) {
    return handleOTTransition();
  }
  gameState.offenseTeam = -gameState.offenseTeam;
  return advancePossession ? advanceGameClock() : false;
}

function startKickoff(isSafetyKickoff = false) {
  if (gameState.overtime) {
    handleOTTransition();
    return;
  }

  const handled = advanceGameClock();
  if (handled) return;

  if (!isSafetyKickoff) {
    // After score, scoring team kicks off - opponent receives
    gameState.offenseTeam = -gameState.offenseTeam;
  }
  enterKickoffPhase();
}

function advanceGameClock() {
  if (gameState.overtime) return false;

  gameState.possession++;
  if (gameState.possession > POSSESSIONS_PER_QUARTER) {
    gameState.possession = 1;
    gameState.quarter++;

    if (gameState.quarter > TOTAL_QUARTERS) {
      gameState.phase = Phase.GAME_OVER;
      return true;
    }
    if (gameState.quarter === 3) {
      // Second half kickoff: team that didn't receive opening kickoff now receives
      gameState.offenseTeam = -gameState.openingKickoffReceiver;
      enterKickoffPhase(false);  // No onside at start of half
      return true;
    }
  }
  return false;
}

// ============ Overtime ============

function handleStartOvertime() {
  gameState.overtime = { round: 1, firstOffense: null, firstTeamDone: false, fgShootout: null };
  gameState.phase = Phase.OVERTIME_START;
}

function handleOTFirst(team) {
  gameState.offenseTeam = team;
  gameState.overtime.firstOffense = team;
  gameState.overtime.firstTeamDone = false;
  gameState.ballPosition = 0;
  startNewPossession();
}

// Handle OT possession transitions (after turnover, score, etc.)
function handleOTTransition() {
  const ot = gameState.overtime;
  if (!ot.firstTeamDone) {
    // First team just finished - give second team ball at midfield
    ot.firstTeamDone = true;
    gameState.offenseTeam = -ot.firstOffense;
    gameState.ballPosition = 0;
    startNewPossession();
    return true;
  } else {
    // Both teams have had possessions - check for winner
    if (gameState.team1.score !== gameState.team2.score) {
      gameState.phase = Phase.GAME_OVER;
    } else {
      // Still tied - go to FG shootout
      gameState.phase = Phase.OVERTIME_FIELD_GOAL;
      gameState.ballPosition = 0;
      gameState.offenseTeam = ot.firstOffense;
      ot.fgShootout = { firstTeam: null, firstMade: false, firstMissed: false };
    }
    return true;
  }
}

function handleOTFieldGoal(result) {
  const currentTeam = gameState.offenseTeam;
  const otherTeam = -currentTeam;
  const fg = gameState.overtime.fgShootout;

  if (result === 'make') {
    if (fg.firstMissed) {
      // Second team wins (first missed, second made)
      gameState.phase = Phase.GAME_OVER;
      return;
    }
    if (!fg.firstMade) {
      // First team made it, other team needs to match
      fg.firstMade = true;
      fg.firstTeam = currentTeam;
      gameState.offenseTeam = otherTeam;
    } else {
      // Both teams made it - move back and continue
      gameState.ballPosition--;
      fg.firstMade = false;
      gameState.offenseTeam = fg.firstTeam;
    }
  } else {
    // Both attempts missed
    if (fg.firstMade) {
      // First team made, second missed both - first team wins
      gameState.phase = Phase.GAME_OVER;
      return;
    }
    // First team missed both, second team tries
    fg.firstMissed = true;
    fg.firstTeam = currentTeam;
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
