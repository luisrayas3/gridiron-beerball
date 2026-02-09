// Gridiron Beerball - Game Tracker

const STORAGE_KEY = 'gridiron-beerball-game';
const STORAGE_VERSION = 3;  // Increment when state structure changes
const CUPS_TO_FIRST_DOWN = 3;
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

// Default game state
// Teams are 1 (goes right/positive) or -1 (goes left/negative)
// Cup positions are -9 to +9, where 0 = 50 yard line
function createInitialState(team1Name, team1Color, team2Name, team2Color) {
  return {
    version: STORAGE_VERSION,
    team1: { name: team1Name, color: team1Color, score: 0 },
    team2: { name: team2Name, color: team2Color, score: 0 },
    quarter: 1,
    possession: 0,  // Starts at 0, advances when kick lands
    offenseTeam: 1,        // 1 or -1
    ballPosition: 0,       // 0 = midfield
    firstDownMarker: 3,    // 3 cups toward scoring endzone
    down: 1,
    phase: Phase.COIN_TOSS,
    phaseData: null,       // Phase-specific transient data (replaces pendingPlay/kickResult/puntResult)
    // lastPlayResult: Rich play result for display
    // {
    //   team: 1 | -1,              // Who executed this play
    //   playType: Phase.*,         // Which phase/play type
    //   playDetail: string | null, // '3v4' for runs, 'called +6' for passes
    //   beginPosition: number,     // Ball position at start
    //   endPosition: number,       // Ball position at end
    //   outcome: string | null,    // 'td' | 'safety' | 'turnover' | 'incomplete' | 'made' | 'missed' | 'recovery'
    //   turnoverReason: string | null, // 'fumble' | 'int' | 'downs'
    //   points: number | null,     // Points scored this play
    // }
    lastPlayResult: { team: 1, playType: 'game_start', beginPosition: 0, endPosition: 0 },
    openingKickoffReceiver: null,
    history: [],
    overtime: null         // { round, firstOffense, firstTeamDone, fgShootout: { firstTeam, made, missed } }
  };
}

let gameState = null;

// ============ Helpers ============

// Get team object by team ID (1 or -1)
function getTeam(teamId) {
  return teamId > 0 ? gameState.team1 : gameState.team2;
}

// Get current offense team object
function offenseTeam() {
  return getTeam(gameState.offenseTeam);
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

// Handle any turnover: fumble, interception, downs
// Flips possession, optionally checks for defensive scoring, advances clock
function handleTurnover(opts = {}) {
  const { checkDefensiveScoring = false, advanceClock = true } = opts;

  gameState.offenseTeam = -gameState.offenseTeam;

  if (checkDefensiveScoring && checkScoring()) {
    // Defensive TD - counts as possession for recovering team
    gameState.possession++;
    return;
  }

  if (advanceClock && advanceGameClock()) return;
  startNewPossession();
}

// Get display label for a cup (yard lines)
// Cup 0 = 50, cup ±5 = 25, cup ±9 = 5
function cupDisplayLabel(cup) {
  if (cup === 0) return 50;
  return (10 - Math.abs(cup)) * 5;
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

// Create header HTML for control sections
function controlSectionHeader(text, team) {
  const headerClass = team
    ? `offense-indicator offense-team${team > 0 ? 1 : 2}`
    : 'offense-indicator';
  const style = team ? '' : ' style="background: var(--text-muted);"';
  return `<span class="${headerClass}"${style}>${text}</span>`;
}

// Create a control section with header and button rows
function controlSection(headerText, headerTeam, ...buttonRows) {
  const rowsHtml = buttonRows
    .map((row, i) => `<div class="button-row"${i > 0 ? ' style="margin-top: 0.5rem;"' : ''}>${row}</div>`)
    .join('');

  return `<div class="control-section">${controlSectionHeader(headerText, headerTeam)}${rowsHtml}</div>`;
}

// Create a control section with a grid and optional miss button
function gridSection(headerText, headerTeam, gridHtml, missLabel = null, missAction = null) {
  const missRow = missLabel
    ? `<div class="button-row" style="margin-top: 0.5rem;">${Button.neutral(missLabel, missAction)}</div>`
    : '';
  return `<div class="control-section">${controlSectionHeader(headerText, headerTeam)}<div class="button-row">${gridHtml}</div>${missRow}</div>`;
}

// ============ Grid Renderers ============

// Render a grid of cup selection buttons for kicks/punts
function renderCupSelectGrid(action) {
  const buttons = [];
  for (let cup = FieldPosition.FIELD_MIN; cup <= FieldPosition.FIELD_MAX; cup++) {
    let btnClass = 'btn btn-compact';
    // Modifier = cup * team + 1 (range -8 to +10)
    const modifier = cup * gameState.offenseTeam + 1;
    // Total ball movement = base + modifier (range: +2 to +20)
    const totalMovement = BASE_KICK_DISTANCE + modifier;

    if (totalMovement > BASE_KICK_DISTANCE) {
      btnClass += ' btn-success';
    } else if (totalMovement === BASE_KICK_DISTANCE) {
      btnClass += ' btn-neutral';
    } else {
      btnClass += ' btn-warning';
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

  // Only 3 valid recovery positions: 35, 40, 45 yard lines (toward opponent from kicking team's 25)
  const positions = [
    { pos: -team * 3, label: 'Recovery (+2)' },  // 35 yard line
    { pos: -team * 2, label: 'Recovery (+3)' },  // 40 yard line
    { pos: -team * 1, label: 'Recovery (+4)' }   // 45 yard line
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
  return renderReturnGrid(action, gameState.phaseData?.kickLanding, gameState.offenseTeam);
}

function renderPuntReturnGrid(action) {
  // Returner is offense (possession flipped when punt landed)
  return renderReturnGrid(action, gameState.phaseData?.puntLanding, gameState.offenseTeam);
}



// ============ DOM Elements ============

const elements = {};

function initElements() {
  const ids = [
    'setup-screen', 'game-screen', 'team1-name', 'team1-color', 'team2-name', 'team2-color',
    'start-game', 'resume-game', 'score-team1-name', 'score-team2-name', 'score-team1', 'score-team2',
    'quarter-display', 'possession-display', 'down-text', 'situation-text', 'field',
    'endzone-left', 'endzone-right', 'controls', 'undo', 'last-play-result'
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
  renderLastPlayResult();
  elements.undo.disabled = gameState.history.length === 0;
}

// Format lastPlayResult into a rich display string
function formatLastPlayResult(result) {
  if (!result) return '';

  const teamName = getTeam(result.team).name;
  const otherTeamName = getTeam(-result.team).name;

  // Calculate yards from positions
  const yards = result.endPosition != null && result.beginPosition != null
    ? (result.endPosition - result.beginPosition) * result.team
    : null;
  const yardsStr = yards != null
    ? (yards > 0 ? `+${yards}` : String(yards)) + (Math.abs(yards) === 1 ? ' yard' : ' yards')
    : null;

  // Common outcome formatter for yards-based plays
  const formatYardsOutcome = () => {
    if (result.outcome === 'td') return 'Touchdown!';
    if (result.outcome === 'recovery') return `Recovery (by ${otherTeamName})`;
    return yardsStr || 'No gain';
  };

  switch (result.playType) {
    case Phase.THROW_PLAY: {
      if (result.outcome === 'td') return `${teamName} pass: Touchdown!` + (result.playDetail ? ` (${result.playDetail})` : '');
      if (result.outcome === 'turnover') {
        if (result.turnoverReason === 'int') return `${teamName} pass: Interception`;
        return `${teamName} pass: Sack fumble (${yardsStr})`;
      }
      if (result.outcome === 'incomplete') return `${teamName} pass: Incomplete`;
      return `${teamName} pass: ${yardsStr || 'No gain'}`;
    }

    case Phase.PLAY_RESULT: {
      const playName = result.playDetail ? `run ${result.playDetail}` : 'sneak';
      if (result.outcome === 'td') return `${teamName} ${playName}: Touchdown!`;
      if (result.outcome === 'turnover') return `${teamName} ${playName}: Fumble (${yardsStr})`;
      return `${teamName} ${playName}: ${yards !== 0 && yardsStr ? yardsStr : 'No gain'}`;
    }

    case Phase.KICKOFF_KICK:
    case Phase.PUNT:
      return `${teamName} ${result.playType === Phase.PUNT ? 'punt' : 'kickoff'}: ${yardsStr || '0 yards'}`;

    case Phase.KICKOFF_RETURN:
    case Phase.PUNT_RETURN: {
      if (result.outcome === 'td') return `${teamName} return: Touchdown!`;
      if (result.outcome === 'recovery') return `${teamName} return: Recovery (by ${otherTeamName})`;
      // For endzone returns, show effective yards from goal line (matching button labels)
      const wasInEndzone = FieldPosition.isInEndzone(result.beginPosition);
      let displayYards;
      if (wasInEndzone) {
        // Effective position = distance from own goal line + 1
        const effectivePos = (result.endPosition + result.team * FieldPosition.FIELD_MAX) * result.team + 1;
        displayYards = effectivePos;
      } else {
        displayYards = yards;
      }
      const displayStr = displayYards != null
        ? (displayYards > 0 ? `+${displayYards}` : String(displayYards)) + (Math.abs(displayYards) === 1 ? ' yard' : ' yards')
        : 'No gain';
      return `${teamName} return: ${displayStr}`;
    }

    case Phase.ONSIDE_KICK:
      return `${teamName} onside: ${result.outcome === 'recovery' ? 'Recovered' : 'Failed'}`;

    case Phase.FIELD_GOAL_ATTEMPT:
    case Phase.OVERTIME_FIELD_GOAL: {
      const name = result.playType === Phase.OVERTIME_FIELD_GOAL ? 'OT field goal' : 'field goal';
      return `${teamName} ${name}: ${result.outcome === 'made' ? `Good! (${result.points} pts)` : 'No good'}`;
    }

    case Phase.EXTRA_POINT:
      return `${teamName} extra point: ${result.outcome === 'made' ? 'Good!' : 'No good'}`;

    case Phase.TWO_POINT_CONVERSION:
      return `${teamName} 2 point conversion: ${result.outcome === 'made' ? `Good! (${result.points} pts)` : 'No good'}`;

    case 'offsides': {
      const who = result.playDetail === 'offense' ? 'Offense' : 'Defense';
      if (result.outcome === 'td') return `${who} offsides: Touchdown!`;
      if (result.outcome === 'safety') return `${who} offsides: Safety!`;
      return `${who} offsides: ${yards > 0 ? `+${yards}` : String(yards)} yard`;
    }

    case 'coin_toss':
      return `${teamName} receives`;

    case 'conversion_choice':
      return `${teamName} going for ${result.playDetail}`;

    case 'ot_first':
      return `${teamName} has first possession`;

    case 'game_start':
      return 'Coin toss to begin';

    default:
      return '';
  }
}

function renderLastPlayResult() {
  const text = formatLastPlayResult(gameState.lastPlayResult);
  elements.lastPlayResult.textContent = text;
}

// Helper to set lastPlayResult with sensible defaults
function setPlayResult(team, playType, beginPosition, endPosition, opts = {}) {
  gameState.lastPlayResult = {
    team,
    playType,
    playDetail: opts.playDetail ?? null,
    beginPosition,
    endPosition,
    outcome: opts.outcome ?? null,
    turnoverReason: opts.turnoverReason ?? null,
    points: opts.points ?? null
  };
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
  if ([Phase.KICKOFF, Phase.KICKOFF_KICK, Phase.ONSIDE_KICK].includes(phase)) {
    elements.downText.textContent = 'Kickoff';
    elements.situationText.textContent = `${offenseTeam().name} kicking`;
    return;
  }
  if (phase === Phase.KICKOFF_RETURN) {
    elements.downText.textContent = 'Kickoff';
    elements.situationText.textContent = `${offenseTeam().name} returning`;
    return;
  }

  // Punt phases - show current down (usually 4th) and punt situation
  if ([Phase.PUNT, Phase.PUNT_RETURN].includes(phase)) {
    elements.downText.textContent = downText;
    if (phase === Phase.PUNT) {
      elements.situationText.textContent = `${offenseTeam().name} punting`;
    } else {
      elements.situationText.textContent = `${offenseTeam().name} returning`;
    }
    return;
  }

  // Normal play phases
  elements.downText.textContent = downText;
  elements.situationText.textContent = `${offenseTeam().name} ball at ${cupToLabel(gameState.ballPosition)}`;
}

// Phase groupings for field rendering
const RETURN_PHASES = [Phase.KICKOFF_RETURN, Phase.PUNT_RETURN];
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
      // Kicking from team's own 25 (opposite their scoring direction)
      return -team * FieldPosition.YARD_25;

    case Phase.TOUCHDOWN_CONVERSION:
      // Ball in scoring endzone
      return team * FieldPosition.ENDZONE_RIGHT;

    case Phase.KICKOFF_RETURN:
    case Phase.PUNT_RETURN:
      const landing = gameState.phaseData?.kickLanding ?? gameState.phaseData?.puntLanding;
      if (landing != null) {
        return FieldPosition.clampToEndzone(landing);
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
    const arrowRight = offenseGoesRight;

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
    // Onside kick: only 35, 40, 45 yard lines are valid (toward opponent from kicking team's 25)
    const validPositions = [-team * 3, -team * 2, -team * 1];
    const inRange = validPositions.includes(cupIndex);
    if (inRange) {
      const cups = cupIndex === -team * 3 ? 2 : cupIndex === -team * 2 ? 3 : 4;
      effect.className = 'effect-gain';
      effect.text = `+${cups}`;
    } else {
      effect.className = 'effect-loss';
      effect.text = '+2';
    }
  } else if ([Phase.KICKOFF_KICK, Phase.PUNT].includes(phase)) {
    // Good direction: toward opponent (same as team's scoring direction)
    const modifier = cupIndex * team + 1;  // +1 offset gives +2 to +20 range
    const totalMovement = BASE_KICK_DISTANCE + modifier;

    if (totalMovement > BASE_KICK_DISTANCE) effect.className = 'effect-gain';
    else if (totalMovement === BASE_KICK_DISTANCE) effect.className = 'effect-neutral';
    else effect.className = 'effect-loss';
    effect.text = `+${totalMovement}`;
  } else if (RETURN_PHASES.includes(phase)) {
    const landing = gameState.phaseData?.kickLanding ?? gameState.phaseData?.puntLanding;
    if (landing != null) {
      const result = getReturnEffect(cupIndex, landing, team);
      effect.className = result.className;
      effect.text = result.text;
    }
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
    // FG/XP kick toward own goal (backward), all others go in offense direction
    const isFieldGoalKick = [Phase.FIELD_GOAL_ATTEMPT, Phase.EXTRA_POINT].includes(gameState.phase);
    const throwerGoesRight = isFieldGoalKick ? !offenseGoesRight : offenseGoesRight;
    const throwArrow = document.createElement('span');
    throwArrow.className = `direction-arrow ${throwerGoesRight ? 'left' : 'right'}`;
    // Use play-specific emoji for throw indicator
    let throwEmoji;
    if ([Phase.KICKOFF_KICK, Phase.ONSIDE_KICK, Phase.PUNT].includes(gameState.phase)) {
      throwEmoji = '👟';  // Cleat for kicks/punts
    } else if (isFieldGoalKick) {
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
    const onsideOnly = gameState.phaseData?.onsideOnly;

    if (onsideOnly) {
      // Out of possessions - offer onside or skip
      const isQ4 = gameState.quarter === TOTAL_QUARTERS;
      const isTied = gameState.team1.score === gameState.team2.score;
      const skipLabel = isQ4 ? (isTied ? 'To overtime' : 'End game') : 'End quarter';
      return controlSection(
        `${offenseTeam().name} - onside kickoff option`,
        gameState.offenseTeam,
        Button.primary('Onside kick', 'onside-kick') +
        Button.neutral(skipLabel, 'skip-kickoff')
      );
    }

    const buttons = Button.primary('Regular', 'regular-kickoff');
    // Onside only available when possession > 0 (not at start of quarter)
    const canOnside = gameState.phaseData?.allowOnside && gameState.possession > 0;
    const onsideBtn = canOnside ? Button.neutral('Onside', 'onside-kick') : '';
    return controlSection(
      `${offenseTeam().name} - kickoff type`,
      gameState.offenseTeam,
      buttons + onsideBtn
    );
  },

  [Phase.KICKOFF_KICK]: () => gridSection(
    `${offenseTeam().name} - kickoff (first of 2)`,
    gameState.offenseTeam,
    renderCupSelectGrid('kickoff-land'),
    'Missed (+10)', 'kickoff-miss'
  ),

  [Phase.ONSIDE_KICK]: () => controlSection(
    `${offenseTeam().name} - onside kick (one attempt)`,
    gameState.offenseTeam,
    renderOnsideRecoveryGrid(),
    Button.warning('Missed (+2)', 'onside-miss')
  ),

  [Phase.KICKOFF_RETURN]: () => {
    const landing = gameState.phaseData?.kickLanding ?? 0;
    const missLabel = FieldPosition.isInEndzone(landing) ? 'Missed (+1)' : 'Missed (0)';
    return gridSection(
      `${offenseTeam().name} - return (first of 2)`,
      gameState.offenseTeam,
      renderKickoffReturnGrid('return-hit'),
      missLabel, 'return-miss'
    );
  },

  [Phase.NORMAL_PLAY]: () => {
    const downNames = ['1st', '2nd', '3rd', '4th'];
    const isFourthDown = gameState.down === 4;
    const playVariant = isFourthDown ? 'neutral' : 'primary';
    const fgVariant = isFourthDown ? 'primary' : 'neutral';
    // Punt is wasteful on last possession of Q2/Q4 (no kickoff follows)
    const isLastPossessionOfHalf = gameState.possession >= POSSESSIONS_PER_QUARTER &&
                                   (gameState.quarter === 2 || gameState.quarter === 4);
    const puntVariant = (isFourthDown && !isLastPossessionOfHalf) ? 'primary' : 'neutral';
    return controlSection(
      `${offenseTeam().name} - ${downNames[gameState.down - 1]} down`,
      gameState.offenseTeam,
      Button.create('Sneak 1v1', 'qb-sneak', {}, { variant: playVariant }) +
      Button.create('Run 2v3', 'select-players', { count: 2 }, { variant: playVariant }) +
      Button.create('Run 3v4', 'select-players', { count: 3 }, { variant: playVariant }) +
      Button.create('Run 4v5', 'select-players', { count: 4 }, { variant: playVariant }) +
      Button.create('Pass', 'start-throw', {}, { variant: playVariant }),
      Button.create('Field goal', 'fourth-down', { choice: 'fg' }, { variant: fgVariant }) +
      Button.create('Punt', 'fourth-down', { choice: 'punt' }, { variant: puntVariant })
    );
  },

  [Phase.PLAY_RESULT]: () => {
    const { offensePlayers, isQBSneak } = gameState.phaseData;
    const offsidesRow = Button.warning('Offense 🚩 (-1)', 'offsides', { dir: -1 }) +
                        Button.warning('Defense 🚩 (+1)', 'offsides', { dir: 1 });

    if (isQBSneak) {
      return controlSection(
        `${offenseTeam().name} - Sneak 1v1`,
        gameState.offenseTeam,
        Button.neutral('Tied or lost (0)', 'result', { cups: 0 }) +
        Button.success('Won (+1)', 'result', { cups: 1 }),
        offsidesRow
      );
    }

    const defensePlayers = offensePlayers + 1;
    const buttons = [];

    for (let i = offensePlayers; i >= 1; i--) {
      const yards = FLIP_CUP_YARDAGE[i];
      const isFumble = i === offensePlayers && offensePlayers > 1;
      const label = isFumble ? `Fumble (-${yards})` : `-${yards}`;
      const variant = isFumble ? 'danger' : 'warning';
      buttons.push(Button.create(label, 'result', { cups: -i }, { variant }));
    }
    buttons.push(Button.neutral('0', 'result', { cups: 0 }));
    for (let i = 1; i <= defensePlayers; i++) {
      const yards = FLIP_CUP_YARDAGE[i];
      const label = yards === 'TD' ? 'Touchdown' : `+${yards}`;
      buttons.push(Button.success(label, 'result', { cups: i }));
    }

    return controlSection(
      `${offenseTeam().name} - run (${offensePlayers}v${defensePlayers})`,
      gameState.offenseTeam,
      buttons.join(''),
      offsidesRow
    );
  },

  [Phase.THROW_PLAY]: () => {
    const row1 =
      Button.danger('Sack fumble (-3)', 'throw-result', { result: 'sack_fumble' }) +
      Button.warning('-3', 'throw-result', { result: '-3' }) +
      Button.warning('-2', 'throw-result', { result: '-2' }) +
      Button.warning('-1', 'throw-result', { result: '-1' }) +
      Button.neutral('0', 'throw-result', { result: '0' }) +
      Button.success('+1', 'throw-result', { result: '1' }) +
      Button.success('+2', 'throw-result', { result: '2' }) +
      Button.success('+3', 'throw-result', { result: '3' }) +
      Button.success('+4', 'throw-result', { result: '4' });
    const row2 =
      Button.neutral('Incomplete (0)', 'throw-result', { result: 'incomplete' }) +
      Button.danger('Interception (0)', 'throw-result', { result: 'int' }) +
      Button.success('+5', 'throw-result', { result: '5' }) +
      '<span style="color: var(--text-muted); margin: 0 0.5rem;">Called:</span>' +
      Button.success('+6', 'throw-result', { result: '6' }) +
      Button.success('+9', 'throw-result', { result: '9' }) +
      Button.success('Touchdown', 'throw-result', { result: 'td' });
    return controlSection(
      `${offenseTeam().name} - passing (first of 3)`,
      gameState.offenseTeam,
      row1, row2
    );
  },

  [Phase.PUNT]: () => gridSection(
    `${offenseTeam().name} - punting (first of 2)`,
    gameState.offenseTeam,
    renderCupSelectGrid('punt-hit'),
    'Missed (+10)', 'punt-miss'
  ),

  [Phase.PUNT_RETURN]: () => {
    const landing = gameState.phaseData?.puntLanding ?? 0;
    const missLabel = FieldPosition.isInEndzone(landing) ? 'Missed (+1)' : 'Missed (0)';
    return gridSection(
      `${offenseTeam().name} - punt return (first of 2)`,
      gameState.offenseTeam,
      renderPuntReturnGrid('punt-return-hit'),
      missLabel, 'punt-return-miss'
    );
  },

  [Phase.FIELD_GOAL_ATTEMPT]: () => controlSection(
    `${offenseTeam().name} - field goal (first of 3)`,
    gameState.offenseTeam,
    Button.danger('No good', 'field-goal', { result: 'miss' }) +
    Button.success('Field goal', 'field-goal', { result: 'make' })
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
    Button.neutral('No good', 'extra-point', { result: 'miss' }) +
    Button.success('Extra point', 'extra-point', { result: 'make' })
  ),

  [Phase.TWO_POINT_CONVERSION]: () => controlSection(
    `${offenseTeam().name} - Two-point 1v1`,
    gameState.offenseTeam,
    Button.neutral('No good', 'two-point', { cups: 0 }) +
    Button.success('2 points', 'two-point', { cups: 1 })
  ),

  [Phase.GAME_OVER]: () => {
    const winner = gameState.team1.score > gameState.team2.score ? gameState.team1 :
                   gameState.team2.score > gameState.team1.score ? gameState.team2 : null;
    const winnerTeam = gameState.team1.score > gameState.team2.score ? 1 : -1;
    if (!winner) {
      return controlSection('Game tied!', null, Button.primary('Start overtime', 'start-overtime'));
    }
    return controlSection(
      `${winner.name} wins! (${gameState.team1.score} - ${gameState.team2.score})`,
      winnerTeam
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
    Button.neutral('Missed', 'ot-fg', { result: 'miss' }) +
    Button.success('Field goal', 'ot-fg', { result: 'make' })
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
  'skip-kickoff': handleSkipKickoff,
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
  'ot-fg': e => handleOTFieldGoal(e.target.dataset.result)
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

// ============ Phase Entry Functions ============
// Single point of entry for each phase - ensures consistent setup

function enterPhase(phase, data = null) {
  gameState.phaseData = data;
  gameState.phase = phase;
}

// ============ Game Logic ============

function handleCoinToss(receivingTeam) {
  // Kicker is offense during kick phase
  gameState.offenseTeam = -receivingTeam;
  gameState.openingKickoffReceiver = receivingTeam;
  setPlayResult(receivingTeam, 'coin_toss', 0, 0);
  enterKickoffPhase(false);  // No onside at start of game
}

function enterKickoffPhase(allowOnside = true) {
  // Ball at kicking team's 25 (their own territory, opposite their scoring direction)
  gameState.ballPosition = -gameState.offenseTeam * FieldPosition.YARD_25;
  // Check if we're out of possessions - only offer onside or skip
  const outOfPossessions = gameState.possession >= POSSESSIONS_PER_QUARTER;
  enterPhase(Phase.KICKOFF, { allowOnside, onsideOnly: outOfPossessions });
}

function handleRegularKickoff() {
  enterPhase(Phase.KICKOFF_KICK);
}

function handleSkipKickoff() {
  // Skip kickoff - advance to next quarter or end game
  if (gameState.quarter >= TOTAL_QUARTERS) {
    enterPhase(Phase.GAME_OVER);
  } else {
    gameState.quarter++;
    if (gameState.quarter === 3) {
      // Second half: kickoff, team that received opening kickoff now kicks
      gameState.possession = 0;
      gameState.offenseTeam = gameState.openingKickoffReceiver;
      enterKickoffPhase(false);  // No onside at start of half
    } else {
      // Q2/Q4: no kickoff, play continues
      gameState.possession = 1;
      startNewPossession();
    }
  }
}

// Shared kick/punt handler - calculates landing, flips possession, enters return phase
function handleKick(cup, kickPhase, returnPhase, landingKey) {
  const team = gameState.offenseTeam;
  const beginPos = gameState.ballPosition;
  const modifier = cup != null ? (cup * team + 1) : 0;  // null cup = miss
  const landingPos = beginPos + (BASE_KICK_DISTANCE + modifier) * team;

  setPlayResult(team, kickPhase, beginPos, landingPos);

  // Flip to receiver and advance clock
  gameState.offenseTeam = -team;
  if (advanceGameClock()) return;

  enterPhase(returnPhase, { [landingKey]: landingPos });
}

function handleKickoffLand(cup) {
  handleKick(cup, Phase.KICKOFF_KICK, Phase.KICKOFF_RETURN, 'kickLanding');
}

function handleKickoffMiss() {
  handleKick(null, Phase.KICKOFF_KICK, Phase.KICKOFF_RETURN, 'kickLanding');
}

function handleOnsideKick() {
  enterPhase(Phase.ONSIDE_KICK);
}

function handleOnsideRecovery(position) {
  const team = gameState.offenseTeam;  // Kicker is offense
  const beginPos = gameState.ballPosition;

  setPlayResult(team, Phase.ONSIDE_KICK, beginPos, position, { outcome: 'recovery' });
  gameState.ballPosition = position;
  // Kicker keeps possession - no clock advance, just continue
  startNewPossession();
}

function handleOnsideMiss() {
  const team = gameState.offenseTeam;  // Kicker is offense
  const beginPos = gameState.ballPosition;
  const endPos = -team * 3;  // Ball at 35 yard line (toward opponent from kicking team's 25)

  setPlayResult(team, Phase.ONSIDE_KICK, beginPos, endPos, { outcome: 'missed' });
  gameState.ballPosition = endPos;
  handleTurnover();
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

// Shared return handler - handles both kickoff and punt returns
function handleReturnHit(cup, returnPhase, landingKey) {
  const team = gameState.offenseTeam;
  const beginPos = gameState.phaseData[landingKey];
  const result = calculateReturn(cup, beginPos, team);

  if (result.type === 'td') {
    setPlayResult(team, returnPhase, beginPos, team * FieldPosition.FIELD_MAX, { outcome: 'td' });
    scoreTouchdown();
    return;
  }

  if (result.type === 'recovery') {
    const endPos = -team * FieldPosition.YARD_5;
    setPlayResult(team, returnPhase, beginPos, endPos, { outcome: 'recovery' });
    gameState.ballPosition = endPos;
    handleTurnover({ advanceClock: false });
    return;
  }

  const endPos = FieldPosition.clampToField(result.finalPosition);
  setPlayResult(team, returnPhase, beginPos, endPos);
  gameState.ballPosition = endPos;
  startNewPossession();
}

function handleReturnMissShared(returnPhase, landingKey) {
  const team = gameState.offenseTeam;
  const beginPos = gameState.phaseData[landingKey];
  const endPos = FieldPosition.clampToField(beginPos);

  setPlayResult(team, returnPhase, beginPos, endPos);
  gameState.ballPosition = endPos;
  startNewPossession();
}

function handleReturn(cup) {
  handleReturnHit(cup, Phase.KICKOFF_RETURN, 'kickLanding');
}

function handleReturnMiss() {
  handleReturnMissShared(Phase.KICKOFF_RETURN, 'kickLanding');
}

function handleSelectPlayers(count, isQBSneak = false) {
  enterPhase(Phase.PLAY_RESULT, { offensePlayers: count, isQBSneak });
}

function handleStartThrow() {
  enterPhase(Phase.THROW_PLAY);
}

// Simplified throw result handler - user clicks final result directly
function handleThrowResultSimple(result) {
  const team = gameState.offenseTeam;
  const beginPos = gameState.ballPosition;

  if (result === 'td') {
    setPlayResult(team, Phase.THROW_PLAY, beginPos, team * FieldPosition.FIELD_MAX, { outcome: 'td', playDetail: 'called' });
    scoreTouchdown();
    return;
  }

  if (result === 'int') {
    setPlayResult(team, Phase.THROW_PLAY, beginPos, beginPos, { outcome: 'turnover', turnoverReason: 'int' });
    handleTurnover();
    return;
  }

  if (result === 'sack_fumble') {
    const endPos = beginPos + -3 * team;
    setPlayResult(team, Phase.THROW_PLAY, beginPos, FieldPosition.clampToField(endPos), { outcome: 'turnover', turnoverReason: 'fumble' });
    gameState.ballPosition = endPos;
    handleTurnover({ checkDefensiveScoring: true });
    return;
  }

  if (result === 'incomplete') {
    setPlayResult(team, Phase.THROW_PLAY, beginPos, beginPos, { outcome: 'incomplete' });
    gameState.down++;
    checkDowns();
    return;
  }

  const yards = parseInt(result);
  const endPos = beginPos + yards * team;

  if (FieldPosition.isTouchdown(endPos, team)) {
    const playDetail = yards >= 6 ? 'called' : null;
    setPlayResult(team, Phase.THROW_PLAY, beginPos, FieldPosition.clampToField(endPos), { outcome: 'td', playDetail });
    gameState.ballPosition = FieldPosition.clampToField(endPos);
    scoreTouchdown();
    return;
  }

  if (FieldPosition.isSafety(endPos, team)) {
    setPlayResult(team, Phase.THROW_PLAY, beginPos, FieldPosition.clampToField(endPos), { outcome: 'safety' });
    gameState.ballPosition = FieldPosition.clampToField(endPos);
    scoreSafety();
    return;
  }

  gameState.ballPosition = FieldPosition.clampToField(endPos);
  setPlayResult(team, Phase.THROW_PLAY, beginPos, gameState.ballPosition);
  checkFirstDownAndAdvance();
}

function handlePlayResult(cups) {
  const { offensePlayers, isQBSneak } = gameState.phaseData;
  const team = gameState.offenseTeam;
  const beginPos = gameState.ballPosition;
  const playDetail = isQBSneak ? null : `${offensePlayers}v${offensePlayers + 1}`;

  // QB Sneak: win = +1, tie/loss = 0
  if (isQBSneak) {
    if (cups > 0) {
      const result = advanceBall(1);
      if (result === 'td') {
        setPlayResult(team, Phase.PLAY_RESULT, beginPos, team * FieldPosition.FIELD_MAX, { outcome: 'td', playDetail });
        return;
      }
      setPlayResult(team, Phase.PLAY_RESULT, beginPos, gameState.ballPosition, { playDetail });
      checkFirstDownAndAdvance();
    } else {
      setPlayResult(team, Phase.PLAY_RESULT, beginPos, beginPos, { playDetail });
      gameState.down++;
      checkDowns();
    }
    return;
  }

  // Regular run play
  const isFumble = cups === -offensePlayers && offensePlayers > 1;

  if (cups === 0) {
    setPlayResult(team, Phase.PLAY_RESULT, beginPos, beginPos, { playDetail });
    gameState.down++;
    checkDowns();
    return;
  }

  const yardageValue = cups > 0 ? FLIP_CUP_YARDAGE[cups] : FLIP_CUP_YARDAGE[-cups];

  if (yardageValue === 'TD' && cups > 0) {
    setPlayResult(team, Phase.PLAY_RESULT, beginPos, team * FieldPosition.FIELD_MAX, { outcome: 'td', playDetail });
    scoreTouchdown();
    return;
  }

  const yards = cups > 0 ? yardageValue : -yardageValue;
  const endPos = beginPos + yards * team;

  if (isFumble) {
    gameState.ballPosition = endPos;
    setPlayResult(team, Phase.PLAY_RESULT, beginPos, FieldPosition.clampToField(endPos), { outcome: 'turnover', turnoverReason: 'fumble', playDetail });
    handleTurnover({ checkDefensiveScoring: true });
    return;
  }

  const result = advanceBall(yards);
  if (result === 'td') {
    setPlayResult(team, Phase.PLAY_RESULT, beginPos, team * FieldPosition.FIELD_MAX, { outcome: 'td', playDetail });
    return;
  }
  if (result === 'safety') {
    setPlayResult(team, Phase.PLAY_RESULT, beginPos, -team * FieldPosition.FIELD_MAX, { outcome: 'safety', playDetail });
    return;
  }
  setPlayResult(team, Phase.PLAY_RESULT, beginPos, gameState.ballPosition, { playDetail });
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
    enterPhase(Phase.NORMAL_PLAY);
  }
}

function handleOffsides(dir) {
  const team = gameState.offenseTeam;
  const beginPos = gameState.ballPosition;
  const newPos = beginPos + dir * team;
  const playDetail = dir < 0 ? 'offense' : 'defense';

  gameState.ballPosition = newPos;

  // Check for TD (ball pushed past opponent's endzone)
  if (FieldPosition.isTouchdown(newPos, team)) {
    setPlayResult(team, 'offsides', beginPos, team * FieldPosition.FIELD_MAX, { playDetail, outcome: 'td' });
    gameState.ballPosition = FieldPosition.clampToField(newPos);
    scoreTouchdown();
    return;
  }

  // Check for safety (ball pushed past own endzone)
  if (FieldPosition.isSafety(newPos, team)) {
    setPlayResult(team, 'offsides', beginPos, -team * FieldPosition.FIELD_MAX, { playDetail, outcome: 'safety' });
    gameState.ballPosition = FieldPosition.clampToField(newPos);
    scoreSafety();
    return;
  }

  // Normal penalty - clamp to field
  gameState.ballPosition = FieldPosition.clampToField(newPos);
  setPlayResult(team, 'offsides', beginPos, gameState.ballPosition, { playDetail });
  enterPhase(Phase.NORMAL_PLAY);
}

function handleFourthDown(choice) {
  // Now accessible from any down via unified play selector
  if (choice === 'punt') {
    enterPhase(Phase.PUNT);
  } else if (choice === 'fg') {
    enterPhase(Phase.FIELD_GOAL_ATTEMPT);
  }
}

function handlePuntKick(cup) {
  handleKick(cup, Phase.PUNT, Phase.PUNT_RETURN, 'puntLanding');
}

function handlePuntMiss() {
  handleKick(null, Phase.PUNT, Phase.PUNT_RETURN, 'puntLanding');
}

function handlePuntReturn(cup) {
  handleReturnHit(cup, Phase.PUNT_RETURN, 'puntLanding');
}

function handlePuntReturnMiss() {
  handleReturnMissShared(Phase.PUNT_RETURN, 'puntLanding');
}

function handleFieldGoal(result) {
  const team = gameState.offenseTeam;
  const pos = gameState.ballPosition;

  if (result === 'make') {
    setPlayResult(team, Phase.FIELD_GOAL_ATTEMPT, pos, pos, { outcome: 'made', points: 3 });
    addScore(team, 3);
    startKickoff();
  } else {
    setPlayResult(team, Phase.FIELD_GOAL_ATTEMPT, pos, pos, { outcome: 'missed' });
    if (flipPossession(true)) return;
    startNewPossession();
  }
}

function scoreTouchdown() {
  addScore(gameState.offenseTeam, 6);
  // Ball in the endzone they scored in (team's scoring endzone = team * (FieldPosition.FIELD_MAX+1))
  gameState.ballPosition = gameState.offenseTeam * (FieldPosition.FIELD_MAX + 1);
  enterPhase(Phase.TOUCHDOWN_CONVERSION);
}

function scoreSafety() {
  // Defense scores 2 points
  addScore(-gameState.offenseTeam, 2);
  startKickoff();
}

function handleConversionChoice(choice) {
  const team = gameState.offenseTeam;
  const pos = team * FieldPosition.YARD_5;
  gameState.ballPosition = pos;
  setPlayResult(team, 'conversion_choice', pos, pos, { playDetail: choice === 'xp' ? 'extra point' : '2 point' });
  if (choice === 'xp') {
    enterPhase(Phase.EXTRA_POINT);
  } else {
    enterPhase(Phase.TWO_POINT_CONVERSION, { offensePlayers: 1, isQBSneak: true });
  }
}

function handleExtraPoint(result) {
  const team = gameState.offenseTeam;
  const pos = gameState.ballPosition;

  if (result === 'make') {
    setPlayResult(team, Phase.EXTRA_POINT, pos, pos, { outcome: 'made', points: 1 });
    addScore(team, 1);
  } else {
    setPlayResult(team, Phase.EXTRA_POINT, pos, pos, { outcome: 'missed' });
  }
  startKickoff();
}

function handleTwoPoint(cups) {
  const team = gameState.offenseTeam;
  const pos = gameState.ballPosition;

  if (cups === 1) {
    setPlayResult(team, Phase.TWO_POINT_CONVERSION, pos, pos, { outcome: 'made', points: 2 });
    addScore(team, 2);
  } else {
    setPlayResult(team, Phase.TWO_POINT_CONVERSION, pos, pos, { outcome: 'missed' });
  }
  startKickoff();
}

function addScore(team, points) {
  getTeam(team).score += points;
}

// Start a fresh possession at current ball position
function startNewPossession() {
  gameState.down = 1;
  setFirstDownMarker();
  enterPhase(Phase.NORMAL_PLAY);
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

function startKickoff() {
  if (gameState.overtime) {
    handleOTTransition();
    return;
  }
  enterKickoffPhase();
}

function advanceGameClock() {
  if (gameState.overtime) return false;

  gameState.possession++;
  if (gameState.possession > POSSESSIONS_PER_QUARTER) {
    gameState.quarter++;

    if (gameState.quarter > TOTAL_QUARTERS) {
      enterPhase(Phase.GAME_OVER);
      return true;
    }
    if (gameState.quarter === 3) {
      // Second half kickoff: team that received opening kickoff now KICKS
      gameState.possession = 0;  // Reset to 0, advances when kick lands
      gameState.offenseTeam = gameState.openingKickoffReceiver;
      enterKickoffPhase(false);  // No onside at start of half
      return true;
    }
    // Q2/Q4: no kickoff, possession starts at 1
    gameState.possession = 1;
  }
  return false;
}

// ============ Overtime ============

function handleStartOvertime() {
  gameState.overtime = { round: 1, firstOffense: null, firstTeamDone: false, fgShootout: null };
  enterPhase(Phase.OVERTIME_START);
}

function handleOTFirst(team) {
  gameState.offenseTeam = team;
  gameState.overtime.firstOffense = team;
  gameState.overtime.firstTeamDone = false;
  gameState.ballPosition = 0;
  setPlayResult(team, 'ot_first', 0, 0);
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
      enterPhase(Phase.GAME_OVER);
    } else {
      // Still tied - go to FG shootout
      gameState.ballPosition = 0;
      gameState.offenseTeam = ot.firstOffense;
      ot.fgShootout = { firstTeam: null, firstMade: false, firstMissed: false };
      enterPhase(Phase.OVERTIME_FIELD_GOAL);
    }
    return true;
  }
}

function handleOTFieldGoal(result) {
  const currentTeam = gameState.offenseTeam;
  const otherTeam = -currentTeam;
  const pos = gameState.ballPosition;
  const fg = gameState.overtime.fgShootout;

  if (result === 'make') {
    setPlayResult(currentTeam, Phase.OVERTIME_FIELD_GOAL, pos, pos, { outcome: 'made', points: 3 });
    if (fg.firstMissed) {
      // Second team wins (first missed, second made)
      enterPhase(Phase.GAME_OVER);
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
    setPlayResult(currentTeam, Phase.OVERTIME_FIELD_GOAL, pos, pos, { outcome: 'missed' });
    if (fg.firstMade) {
      // First team made, second missed both - first team wins
      enterPhase(Phase.GAME_OVER);
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
  elements.undo.addEventListener('click', undo);

  showSetup();
}

document.addEventListener('DOMContentLoaded', init);
