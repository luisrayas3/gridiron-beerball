// Gridiron beerball

const STORAGE_KEY = 'gridiron-beerball-game';
const STORAGE_VERSION = 3;  // Increment when state structure changes
const CUPS_TO_FIRST_DOWN = 3;
const POSSESSIONS_PER_QUARTER = 4;
const TOTAL_QUARTERS = 4;
const BASE_KICK_DISTANCE = 10;  // Base punt/kick distance per rules
const SACK_FUMBLE_YARDS = 3;    // Yards lost on sack fumble
const HISTORY_LIMIT = 30;       // Max undo states to keep
const TD_YARDS = 20;            // Guaranteed TD from any position (field is -9 to 9)

// Down resolution modes for resolvePlay
const DownMode = {
  NORMAL: 0,    // Increment down, check first down, turnover on downs
  FRESH: 1,     // Fresh set of downs (returns, recoveries)
  REPLAY: 2,    // Replay the down (offsides)
  TURNOVER: 3   // Flip possession, then fresh downs
};

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
  KICKOFF_CHOICE: 'kickoff_choice',
  KICKOFF: 'kickoff',
  ONSIDE_KICK: 'onside_kick',
  KICKOFF_RETURN: 'kickoff_return',
  NORMAL_PLAY: 'normal_play',
  RUN_PLAY: 'run_play',
  THROW_PLAY: 'throw_play',
  PUNT: 'punt',
  PUNT_RETURN: 'punt_return',
  FIELD_GOAL_ATTEMPT: 'field_goal_attempt',
  TOUCHDOWN_CONVERSION: 'touchdown_conversion',
  EXTRA_POINT: 'extra_point',
  TWO_POINT_CONVERSION: 'two_point_conversion',
  GAME_OVER: 'game_over',
  OVERTIME_START: 'overtime_start',
  OVERTIME_FIELD_GOAL: 'overtime_field_goal',
  INCOMPLETE_DEFENSE_SHOT: 'incomplete_defense_shot'
};

const KICK_TO_RETURN_PHASE = {
  [Phase.KICKOFF]: Phase.KICKOFF_RETURN,
  [Phase.PUNT]: Phase.PUNT_RETURN
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

// Effect types for unified cup/button styling
const EffectType = {
  GAIN: 'gain',
  LOSS: 'loss',
  NEUTRAL: 'neutral',
  TURNOVER: 'turnover'
};

// Maps effect type to CSS classes for effect row and buttons
const EFFECT_STYLING = {
  [EffectType.GAIN]:     { effectClass: 'effect-gain',     btnVariant: 'success' },
  [EffectType.LOSS]:     { effectClass: 'effect-loss',     btnVariant: 'warning' },
  [EffectType.NEUTRAL]:  { effectClass: 'effect-neutral',  btnVariant: 'neutral' },
  [EffectType.TURNOVER]: { effectClass: 'effect-turnover', btnVariant: 'danger' }
};

// ============ EFFECT CALCULATOR SYSTEM ============

// Helper: Kick/punt effect (KICKOFF_KICK, PUNT)
function calcKickEffect(cup, team) {
  const total = BASE_KICK_DISTANCE + (cup * team + 1);
  const type = total > BASE_KICK_DISTANCE ? EffectType.GAIN
             : total === BASE_KICK_DISTANCE ? EffectType.NEUTRAL
             : EffectType.LOSS;
  return { type, text: `+${total}`, value: total };
}

// Helper: Return effect (KICKOFF_RETURN, PUNT_RETURN)
function calcReturnEffect(cup, landing, team) {
  const inEndzone = FieldPosition.isInEndzone(landing);
  const modifier = cup * team + 1;
  const finalPos = landing + modifier * team;
  const clampedFinal = FieldPosition.clampToField(finalPos);
  const isTD = FieldPosition.isTouchdown(finalPos, team);
  const isRecovery = FieldPosition.isSafety(finalPos, team) && (inEndzone || modifier <= 0);

  if (isTD) return { type: EffectType.GAIN, text: 'TD', isTD: true };
  if (isRecovery) return { type: EffectType.TURNOVER, text: 'REC', isRecovery: true };
  if (inEndzone) {
    const effectivePos = (clampedFinal + team * FieldPosition.FIELD_MAX) * team + 1;
    return {
      type: effectivePos > 1 ? EffectType.GAIN : EffectType.NEUTRAL,
      text: `+${effectivePos}`,
      value: effectivePos
    };
  }
  if (modifier >= 1) return { type: EffectType.GAIN, text: `+${modifier}`, value: modifier };
  if (modifier === 0) return { type: EffectType.NEUTRAL, text: '0', value: 0 };
  return { type: EffectType.LOSS, text: String(modifier), value: modifier };
}

// Helper: Throw effect (THROW_PLAY)
function calcThrowEffect(cup, team) {
  const relPos = cup * team;

  if (relPos >= THROW_ZONES.SACK_FUMBLE_START && relPos <= THROW_ZONES.SACK_FUMBLE_END) {
    return { type: EffectType.TURNOVER, text: 'FUM' };
  }
  if (relPos >= THROW_ZONES.MIDDLE_START && relPos <= -1) {
    const yards = relPos + 1;
    return {
      type: yards < 0 ? EffectType.LOSS : EffectType.NEUTRAL,
      text: yards < 0 ? String(yards) : '0',
      value: yards
    };
  }
  if (relPos >= 0 && relPos <= THROW_ZONES.MIDDLE_END) {
    return { type: EffectType.GAIN, text: `+${relPos + 1}`, value: relPos + 1 };
  }
  if (relPos === THROW_ZONES.INCOMPLETE_30 || relPos === THROW_ZONES.INCOMPLETE_20) {
    return { type: EffectType.NEUTRAL, text: '0' };
  }
  if (relPos === THROW_ZONES.INTERCEPTION) {
    return { type: EffectType.TURNOVER, text: 'INT' };
  }
  if (relPos >= THROW_ZONES.DEEP_START && relPos <= THROW_ZONES.DEEP_END) {
    return { type: EffectType.GAIN, text: '5+' };
  }
  return null;
}

// Helper: Field goal effect (FIELD_GOAL_ATTEMPT, OVERTIME_FIELD_GOAL)
function calcFieldGoalEffect(cup, ballPos, team, missType = EffectType.TURNOVER) {
  const isValid = cup * team <= ballPos * team;
  return { type: isValid ? EffectType.GAIN : missType, text: isValid ? 'FG' : '0' };
}

// Helper: Onside kick effect (ONSIDE_KICK)
function calcOnsideEffect(cup, team) {
  const validPositions = [-team * 3, -team * 2, -team * 1];
  if (validPositions.includes(cup)) {
    const cups = cup === -team * 3 ? 2 : cup === -team * 2 ? 3 : 4;
    return { type: EffectType.GAIN, text: `+${cups}`, value: cups };
  }
  return { type: EffectType.LOSS, text: '+2', value: 2 };
}

// Helper: Defense incomplete shot effect (INCOMPLETE_DEFENSE_SHOT)
function calcDefenseShotEffect(cup, team) {
  const relPos = cup * (-team);  // From defense's perspective

  if (relPos <= 0) return { type: EffectType.GAIN, text: '+1', value: 1 };
  if (relPos === 1) return { type: EffectType.NEUTRAL, text: '0', value: 0 };
  if (relPos >= 2 && relPos <= 4) {
    const yards = -(relPos - 1);
    return { type: EffectType.LOSS, text: String(yards), value: yards };
  }
  return { type: EffectType.TURNOVER, text: 'FUM' };
}

// Unified cup effect calculator - single switch over phases
function calculateCupEffect(phase, cup, context) {
  const { team, ballPosition, phaseData } = context;

  switch (phase) {
    case Phase.KICKOFF:
    case Phase.PUNT:
      return calcKickEffect(cup, team);

    case Phase.KICKOFF_RETURN:
    case Phase.PUNT_RETURN:
      return calcReturnEffect(cup, phaseData?.landing, team);

    case Phase.THROW_PLAY:
      return calcThrowEffect(cup, team);

    case Phase.FIELD_GOAL_ATTEMPT:
      return calcFieldGoalEffect(cup, ballPosition, team);

    case Phase.OVERTIME_FIELD_GOAL:
      return calcFieldGoalEffect(cup, ballPosition, team, EffectType.NEUTRAL);

    case Phase.EXTRA_POINT:
      return { type: EffectType.GAIN, text: '1PT' };

    case Phase.ONSIDE_KICK:
      return calcOnsideEffect(cup, team);

    case Phase.INCOMPLETE_DEFENSE_SHOT:
      return calcDefenseShotEffect(cup, team);

    default:
      return null;
  }
}

// ============ STATE MACHINE ============

// Setup helpers: state preparation + transition for common resolution points

function setupKickoff(allowOnside, onsideOnly = false) {
  gameState.ballPosition = -gameState.offenseTeam * FieldPosition.YARD_25;
  return { nextPhase: Phase.KICKOFF_CHOICE, phaseData: { allowOnside, onsideOnly } };
}

function setupPostScore() {
  if (gameState.overtime) return setupOvertimeDrive();
  const isHalfEnd = gameState.quarter % 2 === 0;
  const outOfPossessions = isHalfEnd && gameState.possession >= POSSESSIONS_PER_QUARTER;
  return setupKickoff(true, outOfPossessions);
}

// Unified play resolution - single entry point for all ball movement
// Handles TDs, safeties, turnovers, first downs, and down counting
function resolvePlay(yards, mode, playDetail = {}) {
  const beginPos = gameState.ballPosition;
  const originalTeam = gameState.offenseTeam;
  const phase = gameState.phase;
  const endPos = beginPos + yards * originalTeam;

  gameState.ballPosition = FieldPosition.clampToField(endPos);

  const isTurnover = mode === DownMode.TURNOVER;

  // Switch team early on turnover - unifies TD check
  if (isTurnover) {
    gameState.offenseTeam = -originalTeam;
  }

  const currentTeam = gameState.offenseTeam;

  // TD - unified check works for both offense and defensive TD
  if (FieldPosition.isTouchdown(endPos, currentTeam)) {
    setPlayResult(currentTeam, phase, beginPos, gameState.ballPosition, { ...playDetail, outcome: 'td' });
    addScore(currentTeam, 6);
    gameState.ballPosition = currentTeam * (FieldPosition.FIELD_MAX + 1);
    return { nextPhase: Phase.TOUCHDOWN_CONVERSION };
  }

  // Safety - only possible on non-turnovers (can't fumble into own endzone)
  if (!isTurnover && FieldPosition.isSafety(endPos, currentTeam)) {
    setPlayResult(currentTeam, phase, beginPos, gameState.ballPosition, { ...playDetail, outcome: 'safety' });
    addScore(-currentTeam, 2);
    return setupPostScore();
  }

  // Non-TD turnover - attribute play to original team, advance clock, fresh downs
  if (isTurnover) {
    setPlayResult(originalTeam, phase, beginPos, gameState.ballPosition, { outcome: 'turnover', ...playDetail });
    return advanceGameClock();
  }

  // Normal play result
  setPlayResult(currentTeam, phase, beginPos, gameState.ballPosition, playDetail);

  if (mode === DownMode.REPLAY) return { nextPhase: Phase.NORMAL_PLAY };
  if (mode === DownMode.FRESH) return setupFreshDowns();

  // DownMode.NORMAL: first down check, increment down, turnover on downs
  const madeFirstDown = gameState.ballPosition * currentTeam >= gameState.firstDownMarker * currentTeam;
  if (madeFirstDown) return setupFreshDowns();
  gameState.down++;
  if (gameState.down > 4) {
    gameState.offenseTeam = -currentTeam;  // Turnover on downs
    return advanceGameClock();
  }
  return { nextPhase: Phase.NORMAL_PLAY };
}

// Main state machine: returns { nextPhase, phaseData } or null if already handled
function computeTransition(action, data) {
  const phase = gameState.phase;
  const key = `${phase}:${action}`;

  switch (key) {
    // ---- COIN TOSS ----
    case `${Phase.COIN_TOSS}:coin-toss`: {
      const team = parseInt(data.team, 10);
      gameState.offenseTeam = -team;
      gameState.openingKickoffReceiver = team;
      setPlayResult(team, 'coin_toss', 0, 0);
      // Set ball at kicking team's 25
      gameState.ballPosition = -gameState.offenseTeam * FieldPosition.YARD_25;
      return { nextPhase: Phase.KICKOFF_CHOICE, phaseData: { allowOnside: false } };
    }

    // ---- KICKOFF CHOICE ----
    case `${Phase.KICKOFF_CHOICE}:regular-kickoff`:
      return { nextPhase: Phase.KICKOFF };

    case `${Phase.KICKOFF_CHOICE}:onside-kick`:
      return { nextPhase: Phase.ONSIDE_KICK };

    case `${Phase.KICKOFF_CHOICE}:skip-kickoff`:
      return computeSkipKickoffTransition();

    // ---- KICKOFF KICK ----
    case `${Phase.KICKOFF}:kick-land`:
      return computeKickTransition(parseInt(data.cup, 10));

    case `${Phase.KICKOFF}:kick-miss`:
      return computeKickTransition(null);

    // ---- KICKOFF RETURN ----
    case `${Phase.KICKOFF_RETURN}:return-result`:
      return computeReturnTransition(parseInt(data.cup, 10));

    case `${Phase.KICKOFF_RETURN}:return-miss`:
      return computeReturnMissTransition();

    // ---- ONSIDE KICK ----
    case `${Phase.ONSIDE_KICK}:onside-recovery`:
      return computeOnsideRecoveryTransition(parseInt(data.pos, 10));

    case `${Phase.ONSIDE_KICK}:onside-miss`:
      return computeOnsideMissTransition();

    // ---- NORMAL PLAY ----
    case `${Phase.NORMAL_PLAY}:run`: {
      const count = parseInt(data.count, 10);
      return { nextPhase: Phase.RUN_PLAY, phaseData: { offensePlayers: count, isQBSneak: count === 1 } };
    }

    case `${Phase.NORMAL_PLAY}:pass`:
      return { nextPhase: Phase.THROW_PLAY };

    case `${Phase.NORMAL_PLAY}:punt`:
      return { nextPhase: Phase.PUNT };

    case `${Phase.NORMAL_PLAY}:field-goal`:
      return { nextPhase: Phase.FIELD_GOAL_ATTEMPT };

    // ---- RUN PLAY ----
    case `${Phase.RUN_PLAY}:result`:
      return computeRunResultTransition(parseInt(data.cups, 10));

    case `${Phase.RUN_PLAY}:offsides`:
      return computeOffsidesTransition(parseInt(data.dir, 10));

    // ---- THROW PLAY ----
    case `${Phase.THROW_PLAY}:throw-result`:
      return computeThrowResultTransition(data.result);

    // ---- INCOMPLETE DEFENSE SHOT ----
    case `${Phase.INCOMPLETE_DEFENSE_SHOT}:defense-incomplete-shot`:
      return computeDefenseShotTransition(data.result);

    // ---- PUNT ----
    case `${Phase.PUNT}:kick-land`:
      return computeKickTransition(parseInt(data.cup, 10));

    case `${Phase.PUNT}:kick-miss`:
      return computeKickTransition(null);

    // ---- PUNT RETURN ----
    case `${Phase.PUNT_RETURN}:return-result`:
      return computeReturnTransition(parseInt(data.cup, 10));

    case `${Phase.PUNT_RETURN}:return-miss`:
      return computeReturnMissTransition();

    // ---- FIELD GOAL ----
    case `${Phase.FIELD_GOAL_ATTEMPT}:fg-result`:
      return computeFieldGoalTransition(data.result);

    // ---- TOUCHDOWN CONVERSION ----
    case `${Phase.TOUCHDOWN_CONVERSION}:conversion-choice`:
      return computeConversionChoiceTransition(data.choice);

    // ---- EXTRA POINT ----
    case `${Phase.EXTRA_POINT}:fg-result`:
      return computeExtraPointTransition(data.result);

    // ---- TWO POINT CONVERSION ----
    case `${Phase.TWO_POINT_CONVERSION}:two-point`:
      return computeTwoPointTransition(parseInt(data.cups, 10));

    // ---- OVERTIME ----
    case `${Phase.OVERTIME_START}:ot-first`:
      return computeOTFirstTransition(parseInt(data.team, 10));

    case `${Phase.OVERTIME_FIELD_GOAL}:fg-result`:
      return computeOTFieldGoalTransition(data.result);

    // ---- GAME OVER ----
    case `${Phase.GAME_OVER}:new-game`:
      return { nextPhase: null };  // Special: triggers new game setup

    default:
      console.error(`Invalid action ${action} in phase ${phase}`);
      return null;
  }
}

// ---- Transition helpers ----

function computeSkipKickoffTransition() {
  if (gameState.quarter >= TOTAL_QUARTERS) {
    if (gameState.team1.score === gameState.team2.score) {
      gameState.overtime = { firstOffense: null, fgShootout: null };
      return { nextPhase: Phase.OVERTIME_START };
    }
    return { nextPhase: Phase.GAME_OVER };
  }
  gameState.quarter++;
  if (gameState.quarter === 3) {
    gameState.possession = 0;
    gameState.offenseTeam = gameState.openingKickoffReceiver;
    return setupKickoff(false);
  }
  gameState.possession = 1;
  return setupFreshDowns();
}

function computeKickTransition(cup) {
  const team = gameState.offenseTeam;
  const beginPos = gameState.ballPosition;
  const modifier = cup != null ? (cup * team + 1) : 0;
  const landingPos = beginPos + (BASE_KICK_DISTANCE + modifier) * team;

  setPlayResult(team, gameState.phase, beginPos, landingPos);
  gameState.offenseTeam = -team;
  // ballPosition reflects clamped landing (never past endzone)
  // landing tracks raw value for return calculations
  gameState.ballPosition = FieldPosition.clampToEndzone(landingPos);
  gameState.phaseData = { landing: landingPos };
  return advanceGameClock();
}

function computeReturnTransition(cup) {
  const team = gameState.offenseTeam;
  const landing = gameState.phaseData.landing;
  const modifier = cup * team + 1;
  const finalPos = landing + modifier * team;

  // Calculate net yards from clamped ballPosition to final position
  const netYards = (finalPos - gameState.ballPosition) / team;

  // Recovery: ball ends in own endzone
  if (FieldPosition.isSafety(finalPos, team)) {
    const targetPos = -team * FieldPosition.YARD_5;
    const recoveryYards = (targetPos - gameState.ballPosition) / team;
    return resolvePlay(recoveryYards, DownMode.TURNOVER, { outcome: 'recovery' });
  }

  return resolvePlay(netYards, DownMode.FRESH);
}

function computeReturnMissTransition() {
  const team = gameState.offenseTeam;

  // Touchback: if in endzone (ballPosition at goal line), push to 5 yard line
  if (FieldPosition.isInEndzone(gameState.ballPosition)) {
    const targetPos = -team * FieldPosition.YARD_5;
    const touchbackYards = (targetPos - gameState.ballPosition) / team;
    return resolvePlay(touchbackYards, DownMode.FRESH);
  }

  return resolvePlay(0, DownMode.FRESH);
}

function computeOnsideRecoveryTransition(position) {
  const team = gameState.offenseTeam;
  const yards = (position - gameState.ballPosition) / team;
  return resolvePlay(yards, DownMode.FRESH, { outcome: 'recovery' });
}

function computeOnsideMissTransition() {
  const team = gameState.offenseTeam;
  const endPos = -team * 3;
  const yards = (endPos - gameState.ballPosition) / team;
  return resolvePlay(yards, DownMode.TURNOVER, { outcome: 'missed' });
}

function computeRunResultTransition(cups) {
  const { offensePlayers, isQBSneak } = gameState.phaseData;
  const playDetail = isQBSneak ? null : `${offensePlayers}v${offensePlayers + 1}`;

  // QB sneak: win = +1, tie/loss = 0
  if (isQBSneak) {
    return resolvePlay(cups > 0 ? 1 : 0, DownMode.NORMAL, { playDetail });
  }

  // Tie = 0 yards
  if (cups === 0) {
    return resolvePlay(0, DownMode.NORMAL, { playDetail });
  }

  const isFumble = cups === -offensePlayers;
  const yardageValue = FLIP_CUP_YARDAGE[Math.abs(cups)];

  // TD by table
  if (yardageValue === 'TD') {
    return resolvePlay(TD_YARDS, DownMode.NORMAL, { playDetail });
  }

  const yards = cups > 0 ? yardageValue : -yardageValue;

  if (isFumble) {
    return resolvePlay(yards, DownMode.TURNOVER, { turnoverReason: 'fumble', playDetail });
  }

  return resolvePlay(yards, DownMode.NORMAL, { playDetail });
}

function computeOffsidesTransition(dir) {
  return resolvePlay(dir, DownMode.REPLAY, {
    outcome: 'offsides',
    offender: dir < 0 ? 'offense' : 'defense'
  });
}

function computeThrowResultTransition(result) {
  if (result === 'td') {
    return resolvePlay(TD_YARDS, DownMode.NORMAL, { playDetail: 'called' });
  }
  if (result === 'int') {
    return resolvePlay(0, DownMode.TURNOVER, { turnoverReason: 'int' });
  }
  if (result === 'sack_fumble') {
    return resolvePlay(-SACK_FUMBLE_YARDS, DownMode.TURNOVER, { turnoverReason: 'fumble' });
  }
  if (result === 'incomplete') {
    return { nextPhase: Phase.INCOMPLETE_DEFENSE_SHOT, phaseData: { incompleteFrom: gameState.ballPosition } };
  }

  const yards = parseInt(result, 10);
  return resolvePlay(yards, DownMode.NORMAL, { playDetail: yards >= 6 ? 'called' : null });
}

function computeDefenseShotTransition(result) {
  if (result === 'fumble') {
    return resolvePlay(-SACK_FUMBLE_YARDS, DownMode.TURNOVER, { turnoverReason: 'fumble' });
  }
  const yards = result === 'miss' ? 0 : parseInt(result, 10);
  return resolvePlay(yards, DownMode.NORMAL, { outcome: 'incomplete' });
}

function computeFieldGoalTransition(result) {
  const team = gameState.offenseTeam;
  const pos = gameState.ballPosition;

  if (result === 'make') {
    setPlayResult(team, Phase.FIELD_GOAL_ATTEMPT, pos, pos, { outcome: 'made', points: 3 });
    addScore(team, 3);
    return setupPostScore();
  }
  setPlayResult(team, Phase.FIELD_GOAL_ATTEMPT, pos, pos, { outcome: 'missed' });
  gameState.offenseTeam = -team;
  return advanceGameClock();
}

function computeConversionChoiceTransition(choice) {
  const team = gameState.offenseTeam;
  const pos = team * FieldPosition.YARD_5;
  gameState.ballPosition = pos;
  setPlayResult(team, 'conversion_choice', pos, pos, { playDetail: choice === 'xp' ? 'extra point' : '2 point' });
  if (choice === 'xp') return { nextPhase: Phase.EXTRA_POINT };
  return { nextPhase: Phase.TWO_POINT_CONVERSION, phaseData: { offensePlayers: 1, isQBSneak: true } };
}

function computeExtraPointTransition(result) {
  const team = gameState.offenseTeam;
  const pos = gameState.ballPosition;
  if (result === 'make') {
    setPlayResult(team, Phase.EXTRA_POINT, pos, pos, { outcome: 'made', points: 1 });
    addScore(team, 1);
  } else {
    setPlayResult(team, Phase.EXTRA_POINT, pos, pos, { outcome: 'missed' });
  }
  return setupPostScore();
}

function computeTwoPointTransition(cups) {
  const team = gameState.offenseTeam;
  const pos = gameState.ballPosition;
  if (cups === 1) {
    setPlayResult(team, Phase.TWO_POINT_CONVERSION, pos, pos, { outcome: 'made', points: 2 });
    addScore(team, 2);
  } else {
    setPlayResult(team, Phase.TWO_POINT_CONVERSION, pos, pos, { outcome: 'missed' });
  }
  return setupPostScore();
}

function computeOTFirstTransition(team) {
  gameState.offenseTeam = team;
  gameState.overtime.firstOffense = team;
  gameState.possession = 1;
  gameState.ballPosition = 0;
  setPlayResult(team, 'ot_first', 0, 0);
  return setupFreshDowns();
}

function computeOTFieldGoalTransition(result) {
  const team = gameState.offenseTeam;
  const otherTeam = -team;
  const pos = gameState.ballPosition;
  const fg = gameState.overtime.fgShootout;

  const made = result === 'make';
  if (made) {
    setPlayResult(team, Phase.OVERTIME_FIELD_GOAL, pos, pos, { outcome: 'made', points: 3 });
    addScore(team, 3);
  } else {
    setPlayResult(team, Phase.OVERTIME_FIELD_GOAL, pos, pos, { outcome: 'missed' });
  }

  // First shot of the round - other team gets rebuttal
  if (fg.firstResult === null) {
    fg.firstResult = made;
    fg.firstTeam = team;
    gameState.offenseTeam = otherTeam;
    return { nextPhase: Phase.OVERTIME_FIELD_GOAL };
  }

  // Rebuttal shot - compare results
  if (made !== fg.firstResult) {
    // Different results - whoever made wins
    return { nextPhase: Phase.GAME_OVER };
  }

  // Same result - reset for next round
  fg.firstResult = null;
  fg.round++;
  gameState.offenseTeam = fg.firstTeam;
  return { nextPhase: Phase.OVERTIME_FIELD_GOAL };
}

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
    overtime: null         // { firstOffense, fgShootout: { firstTeam, firstResult, round } } - uses gameState.possession for OT possession tracking
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

// ============ Button factory ============

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

// ============ Grid renderers ============

// Render a grid of cup selection buttons for kicks/punts
function renderCupSelectGrid(action, phase) {
  const context = { team: gameState.offenseTeam, ballPosition: gameState.ballPosition, phaseData: gameState.phaseData };
  const buttons = [];
  for (let cup = FieldPosition.FIELD_MIN; cup <= FieldPosition.FIELD_MAX; cup++) {
    const effect = calculateCupEffect(phase, cup, context);
    if (!effect) continue;
    const styling = EFFECT_STYLING[effect.type];
    const btnClass = `btn btn-compact btn-${styling.btnVariant}`;
    buttons.push(`<button class="${btnClass}" data-action="${action}" data-cup="${cup}">${effect.text}</button>`);
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
// Uses calcReturnEffect for unified effect calculation
function renderReturnGrid(action, landingPosition, returnerTeam) {
  const buttons = [];
  let hasRecovery = false, recoveryCup = null;
  let hasTD = false, tdCup = null;

  for (let cup = FieldPosition.FIELD_MIN; cup <= FieldPosition.FIELD_MAX; cup++) {
    const effect = calcReturnEffect(cup, landingPosition, returnerTeam);

    if (effect.isTD) {
      if (!hasTD) { hasTD = true; tdCup = cup; }
      continue;  // Consolidate TD buttons
    }
    if (effect.isRecovery) {
      if (!hasRecovery) { hasRecovery = true; recoveryCup = cup; }
      continue;  // Consolidate recovery buttons
    }

    const styling = EFFECT_STYLING[effect.type];
    const btnClass = `btn btn-compact btn-${styling.btnVariant}`;
    buttons.push(`<button class="${btnClass}" data-action="${action}" data-cup="${cup}">${effect.text}</button>`);
  }

  // Add consolidated TD/Recovery buttons at appropriate edges
  // Team 1 (attacks right): Recovery on left, TD on right
  // Team -1 (attacks left): TD on left, Recovery on right
  if (returnerTeam > 0) {
    if (hasRecovery) buttons.unshift(`<button class="btn btn-danger" data-action="${action}" data-cup="${recoveryCup}">Recovery</button>`);
    if (hasTD) buttons.push(`<button class="btn btn-success" data-action="${action}" data-cup="${tdCup}">Touchdown</button>`);
  } else {
    if (hasTD) buttons.unshift(`<button class="btn btn-success" data-action="${action}" data-cup="${tdCup}">Touchdown</button>`);
    if (hasRecovery) buttons.push(`<button class="btn btn-danger" data-action="${action}" data-cup="${recoveryCup}">Recovery</button>`);
  }

  return buttons.join('');
}




// ============ DOM ============

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
  if (gameState.history.length > HISTORY_LIMIT) {
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
      // Defensive TD on fumble recovery
      if (result.outcome === 'td' && result.turnoverReason === 'fumble') {
        return `${teamName} fumble recovery: Touchdown!`;
      }
      if (result.outcome === 'td') return `${teamName} pass: Touchdown!` + (result.playDetail ? ` (${result.playDetail})` : '');
      if (result.outcome === 'turnover') {
        if (result.turnoverReason === 'int') return `${teamName} pass: Interception`;
        return `${teamName} pass: Sack fumble (${yardsStr})`;
      }
      if (result.outcome === 'incomplete') return `${teamName} pass: Incomplete`;
      return `${teamName} pass: ${yardsStr || 'No gain'}`;
    }

    case Phase.RUN_PLAY: {
      // Offsides
      if (result.outcome === 'offsides' || result.offender) {
        const who = result.offender === 'offense' ? 'Offense' : 'Defense';
        if (result.outcome === 'td') return `${who} offsides: Touchdown!`;
        if (result.outcome === 'safety') return `${who} offsides: Safety!`;
        return `${who} offsides: ${yards > 0 ? `+${yards}` : yards} yard`;
      }
      // Defensive TD on fumble recovery
      if (result.outcome === 'td' && result.turnoverReason === 'fumble') {
        return `${teamName} fumble recovery: Touchdown!`;
      }
      const playName = result.playDetail ? `run ${result.playDetail}` : 'sneak';
      if (result.outcome === 'td') return `${teamName} ${playName}: Touchdown!`;
      if (result.outcome === 'turnover') return `${teamName} ${playName}: Fumble (${yardsStr})`;
      return `${teamName} ${playName}: ${yards !== 0 && yardsStr ? yardsStr : 'No gain'}`;
    }

    case Phase.KICKOFF:
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
      return `${teamName} field goal: ${result.outcome === 'made' ? `Good! (${result.points} pts)` : 'No good'}`;

    case Phase.OVERTIME_FIELD_GOAL:
      return `${teamName} OT field goal: ${result.outcome === 'made' ? 'Good!' : 'No good'}`;

    case Phase.EXTRA_POINT:
      return `${teamName} extra point: ${result.outcome === 'made' ? 'Good!' : 'No good'}`;

    case Phase.TWO_POINT_CONVERSION:
      return `${teamName} 2 point conversion: ${result.outcome === 'made' ? `Good! (${result.points} pts)` : 'No good'}`;

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
    offender: opts.offender ?? null,
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
    const ot = gameState.overtime;
    elements.possessionDisplay.textContent = ot.fgShootout
      ? `FG shootout ${ot.fgShootout.round}`
      : `Poss ${gameState.possession}`;
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
  if ([Phase.KICKOFF_CHOICE, Phase.KICKOFF, Phase.ONSIDE_KICK].includes(phase)) {
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
const THROWING_PHASES = [Phase.THROW_PLAY, Phase.KICKOFF, Phase.ONSIDE_KICK, Phase.KICKOFF_RETURN,
                         Phase.PUNT, Phase.PUNT_RETURN, Phase.FIELD_GOAL_ATTEMPT, Phase.EXTRA_POINT,
                         Phase.OVERTIME_FIELD_GOAL, Phase.INCOMPLETE_DEFENSE_SHOT];
const PLAY_PHASES = [Phase.NORMAL_PLAY, Phase.RUN_PLAY, Phase.THROW_PLAY, Phase.FIELD_GOAL_ATTEMPT, Phase.PUNT, Phase.INCOMPLETE_DEFENSE_SHOT];

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

// Render the bottom row: cup effects and throwing indicator
function renderEffectRow(offenseGoesRight) {
  const effectRow = document.createElement('div');
  effectRow.className = 'field-row effect-row';

  if (THROWING_PHASES.includes(gameState.phase)) {
    // FG/XP kick toward own goal (backward), defense shot also goes opposite direction
    const isFieldGoalKick = [Phase.FIELD_GOAL_ATTEMPT, Phase.EXTRA_POINT, Phase.OVERTIME_FIELD_GOAL].includes(gameState.phase);
    const isDefenseShot = gameState.phase === Phase.INCOMPLETE_DEFENSE_SHOT;
    const throwerGoesRight = (isFieldGoalKick || isDefenseShot) ? !offenseGoesRight : offenseGoesRight;
    const throwArrow = document.createElement('span');
    throwArrow.className = `direction-arrow ${throwerGoesRight ? 'left' : 'right'}`;
    // Use play-specific emoji for throw indicator
    let throwEmoji;
    if ([Phase.KICKOFF, Phase.ONSIDE_KICK, Phase.PUNT].includes(gameState.phase)) {
      throwEmoji = '👟';  // Cleat for kicks/punts
    } else if (isFieldGoalKick) {
      throwEmoji = '🥅';  // Goal for field goals
    } else if ([Phase.KICKOFF_RETURN, Phase.PUNT_RETURN].includes(gameState.phase)) {
      throwEmoji = '🏃';  // Runner for returns
    } else if (isDefenseShot) {
      throwEmoji = '🛡️';  // Shield for defensive incomplete response
    } else {
      throwEmoji = '💪';  // Arm for passes
    }
    throwArrow.textContent = throwEmoji;
    effectRow.appendChild(throwArrow);
  }

  const context = {
    team: gameState.offenseTeam,
    ballPosition: gameState.ballPosition,
    phaseData: gameState.phaseData
  };

  for (let cup = FieldPosition.FIELD_MIN; cup <= FieldPosition.FIELD_MAX; cup++) {
    const cupEffect = calculateCupEffect(gameState.phase, cup, context);
    if (!cupEffect) continue;
    const effect = document.createElement('div');
    effect.className = 'cup-effect';
    effect.style.left = `${(cup + 10) * 5}%`;  // -9→5%, 0→50%, +9→95%
    effect.classList.add(EFFECT_STYLING[cupEffect.type].effectClass);
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
const FLIP_CUP_PHASES = [Phase.RUN_PLAY, Phase.TWO_POINT_CONVERSION];

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

  const ballPos = gameState.ballPosition;
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

// ============ Control Rendering ============

// Shared helper: Field goal attempt controls (FG, XP, OT FG)
function renderFGAttemptControls(title, makeLabel) {
  return controlSection(title, gameState.offenseTeam,
    Button.danger('No good', 'fg-result', { result: 'miss' }) +
    Button.success(makeLabel, 'fg-result', { result: 'make' })
  );
}

// Shared helper: Return controls (kickoff return, punt return)
function renderReturnControls() {
  const landing = gameState.phaseData?.landing ?? gameState.ballPosition;
  const inEndzone = FieldPosition.isInEndzone(gameState.ballPosition);
  const missLabel = inEndzone ? 'Missed (+1)' : 'Missed (0)';
  return gridSection(
    `${offenseTeam().name} - return (first of 2)`,
    gameState.offenseTeam,
    renderReturnGrid('return-result', landing, gameState.offenseTeam),
    missLabel, 'return-miss'
  );
}

// Shared helper: Kick/punt grid controls
function renderKickGridControls(title, phase) {
  return gridSection(title, gameState.offenseTeam,
    renderCupSelectGrid('kick-land', phase),
    'Missed (+10)', 'kick-miss'
  );
}

// Main control renderer - returns HTML for current phase
function renderControlsForPhase() {
  const teamName = offenseTeam().name;
  const team = gameState.offenseTeam;

  switch (gameState.phase) {
    case Phase.COIN_TOSS:
      return controlSection('Coin toss - receiving team', null,
        Button.team(1, gameState.team1.name, 'coin-toss', { team: 1 }) +
        Button.team(-1, gameState.team2.name, 'coin-toss', { team: -1 })
      );

    case Phase.KICKOFF_CHOICE: {
      const onsideOnly = gameState.phaseData?.onsideOnly;
      if (onsideOnly) {
        const isQ4 = gameState.quarter === TOTAL_QUARTERS;
        const isTied = gameState.team1.score === gameState.team2.score;
        const skipLabel = isQ4 ? (isTied ? 'To overtime' : 'End game') : 'End quarter';
        return controlSection(`${teamName} - onside kickoff option`, team,
          Button.primary('Onside kick', 'onside-kick') +
          Button.neutral(skipLabel, 'skip-kickoff')
        );
      }
      const canOnside = gameState.phaseData?.allowOnside && gameState.possession > 0;
      return controlSection(`${teamName} - kickoff type`, team,
        Button.primary('Regular', 'regular-kickoff') +
        (canOnside ? Button.neutral('Onside', 'onside-kick') : '')
      );
    }

    case Phase.KICKOFF:
      return renderKickGridControls(`${teamName} - kickoff (first of 2)`, Phase.KICKOFF);

    case Phase.ONSIDE_KICK:
      return controlSection(`${teamName} - onside kick (one attempt)`, team,
        renderOnsideRecoveryGrid(),
        Button.warning('Missed (+2)', 'onside-miss')
      );

    case Phase.KICKOFF_RETURN:
      return renderReturnControls();

    case Phase.PUNT:
      return renderKickGridControls(`${teamName} - punting (first of 2)`, Phase.PUNT);

    case Phase.PUNT_RETURN:
      return renderReturnControls();

    case Phase.NORMAL_PLAY: {
      const downNames = ['1st', '2nd', '3rd', '4th'];
      const isFourthDown = gameState.down === 4;
      const playVariant = isFourthDown ? 'neutral' : 'primary';
      const fgVariant = isFourthDown ? 'primary' : 'neutral';
      const puntUseless = gameState.overtime ||
        (gameState.possession >= POSSESSIONS_PER_QUARTER &&
         (gameState.quarter === 2 || gameState.quarter === 4));
      const puntVariant = (isFourthDown && !puntUseless) ? 'primary' : 'neutral';
      return controlSection(`${teamName} - ${downNames[gameState.down - 1]} down`, team,
        Button.create('Sneak 1v1', 'run', { count: 1 }, { variant: playVariant }) +
        Button.create('Run 2v3', 'run', { count: 2 }, { variant: playVariant }) +
        Button.create('Run 3v4', 'run', { count: 3 }, { variant: playVariant }) +
        Button.create('Run 4v5', 'run', { count: 4 }, { variant: playVariant }) +
        Button.create('Pass', 'pass', {}, { variant: playVariant }),
        Button.create('Field goal', 'field-goal', {}, { variant: fgVariant }) +
        Button.create('Punt', 'punt', {}, { variant: puntVariant })
      );
    }

    case Phase.RUN_PLAY: {
      const { offensePlayers, isQBSneak } = gameState.phaseData;
      const offsidesRow = Button.warning('Offense 🚩 (-1)', 'offsides', { dir: -1 }) +
                          Button.warning('Defense 🚩 (+1)', 'offsides', { dir: 1 });
      if (isQBSneak) {
        return controlSection(`${teamName} - Sneak 1v1`, team,
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
        buttons.push(Button.create(isFumble ? `Fumble (-${yards})` : `-${yards}`,
          'result', { cups: -i }, { variant: isFumble ? 'danger' : 'warning' }));
      }
      buttons.push(Button.neutral('0', 'result', { cups: 0 }));
      for (let i = 1; i <= defensePlayers; i++) {
        const yards = FLIP_CUP_YARDAGE[i];
        buttons.push(Button.success(yards === 'TD' ? 'Touchdown' : `+${yards}`, 'result', { cups: i }));
      }
      return controlSection(`${teamName} - run (${offensePlayers}v${defensePlayers})`, team,
        buttons.join(''), offsidesRow);
    }

    case Phase.THROW_PLAY:
      return controlSection(`${teamName} - passing (first of 3)`, team,
        Button.danger('Sack fumble (-3)', 'throw-result', { result: 'sack_fumble' }) +
        Button.warning('-3', 'throw-result', { result: '-3' }) +
        Button.warning('-2', 'throw-result', { result: '-2' }) +
        Button.warning('-1', 'throw-result', { result: '-1' }) +
        Button.neutral('0', 'throw-result', { result: '0' }) +
        Button.success('+1', 'throw-result', { result: '1' }) +
        Button.success('+2', 'throw-result', { result: '2' }) +
        Button.success('+3', 'throw-result', { result: '3' }) +
        Button.success('+4', 'throw-result', { result: '4' }),
        Button.neutral('Incomplete (0)', 'throw-result', { result: 'incomplete' }) +
        Button.danger('Interception (0)', 'throw-result', { result: 'int' }) +
        Button.success('+5', 'throw-result', { result: '5' }) +
        '<span style="color: var(--text-muted); margin: 0 0.5rem;">Called:</span>' +
        Button.success('+6', 'throw-result', { result: '6' }) +
        Button.success('+9', 'throw-result', { result: '9' }) +
        Button.success('Touchdown', 'throw-result', { result: 'td' })
      );

    case Phase.INCOMPLETE_DEFENSE_SHOT:
      return controlSection(`${getTeam(-team).name} - incomplete response (1 attempt)`, -team,
        Button.success('+1', 'defense-incomplete-shot', { result: '1' }) +
        Button.neutral('0', 'defense-incomplete-shot', { result: '0' }) +
        Button.warning('-1', 'defense-incomplete-shot', { result: '-1' }) +
        Button.warning('-2', 'defense-incomplete-shot', { result: '-2' }) +
        Button.warning('-3', 'defense-incomplete-shot', { result: '-3' }) +
        Button.danger('Sack fumble (-3)', 'defense-incomplete-shot', { result: 'fumble' }),
        Button.neutral('Missed (0)', 'defense-incomplete-shot', { result: 'miss' })
      );

    case Phase.FIELD_GOAL_ATTEMPT:
      return renderFGAttemptControls(`${teamName} - field goal (first of 3)`, 'Field goal');

    case Phase.EXTRA_POINT:
      return renderFGAttemptControls(`${teamName} - extra point (first of 3)`, 'Extra point');

    case Phase.OVERTIME_FIELD_GOAL:
      return renderFGAttemptControls(`${teamName} - OT field goal (1 attempt)`, 'Field goal');

    case Phase.TOUCHDOWN_CONVERSION:
      return controlSection(`${teamName} - touchdown!`, team,
        Button.primary('Extra point (1 pt)', 'conversion-choice', { choice: 'xp' }) +
        Button.primary('Two-point (2 pts)', 'conversion-choice', { choice: '2pt' })
      );

    case Phase.TWO_POINT_CONVERSION:
      return controlSection(`${teamName} - Two-point 1v1`, team,
        Button.neutral('No good', 'two-point', { cups: 0 }) +
        Button.success('2 points', 'two-point', { cups: 1 })
      );

    case Phase.GAME_OVER: {
      const winner = gameState.team1.score > gameState.team2.score ? gameState.team1 : gameState.team2;
      const winnerTeam = gameState.team1.score > gameState.team2.score ? 1 : -1;
      return controlSection(`${winner.name} wins! (${gameState.team1.score} - ${gameState.team2.score})`, winnerTeam,
        Button.neutral('New game', 'new-game')
      );
    }

    case Phase.OVERTIME_START:
      return controlSection('Overtime - first possession', null,
        Button.team(1, gameState.team1.name, 'ot-first', { team: 1 }) +
        Button.team(-1, gameState.team2.name, 'ot-first', { team: -1 })
      );

    default:
      return '';
  }
}

function renderControls() {
  elements.controls.innerHTML = renderControlsForPhase();
  elements.controls.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', dispatch);
  });
}

// ============ Action Handling ============

// Unified dispatcher - handles all button actions through the state machine
function dispatch(e) {
  const { action, ...data } = e.target.dataset;

  // Special case: new-game goes back to setup
  if (action === 'new-game') {
    clearSavedGame();
    showSetup();
    return;
  }

  pushHistory();
  const result = computeTransition(action, data);
  if (result?.nextPhase) {
    gameState.phaseData = result.phaseData ?? null;
    gameState.phase = result.nextPhase;
  }
  saveGame();
  render();
}

// ============ Game logic ============

function addScore(team, points) {
  getTeam(team).score += points;
}

// Reset to first down at current ball position, return transition to normal play
function setupFreshDowns() {
  gameState.down = 1;
  const team = gameState.offenseTeam;
  // Marker is CUPS_TO_FIRST_DOWN cups toward scoring endzone, capped at endzone
  const newMarker = gameState.ballPosition + CUPS_TO_FIRST_DOWN * team;
  if (team > 0) {
    gameState.firstDownMarker = Math.min(FieldPosition.FIELD_MAX + 1, newMarker);
  } else {
    gameState.firstDownMarker = Math.max(FieldPosition.FIELD_MIN - 1, newMarker);
  }
  return { nextPhase: Phase.NORMAL_PLAY };
}

function setupOvertimeDrive() {
  const ot = gameState.overtime;
  if (gameState.possession === 1) {
    // First team finished - second team gets ball at midfield
    gameState.possession = 2;
    gameState.offenseTeam = -ot.firstOffense;
    gameState.ballPosition = 0;
    return setupFreshDowns();
  }
  // Both teams had possession - check for winner
  if (gameState.team1.score !== gameState.team2.score) {
    return { nextPhase: Phase.GAME_OVER };
  }
  // Still tied - FG shootout
  gameState.offenseTeam = ot.firstOffense;
  ot.fgShootout = { firstTeam: null, firstResult: null, round: 1 };
  gameState.ballPosition = 0;
  return { nextPhase: Phase.OVERTIME_FIELD_GOAL };
}

function advanceGameClock() {
  if (gameState.overtime) return setupOvertimeDrive();

  gameState.possession++;
  if (gameState.possession > POSSESSIONS_PER_QUARTER) {
    gameState.quarter++;

    if (gameState.quarter > TOTAL_QUARTERS) {
      // Game over or overtime
      if (gameState.team1.score === gameState.team2.score) {
        gameState.overtime = { firstOffense: null, fgShootout: null };
        return { nextPhase: Phase.OVERTIME_START };
      }
      return { nextPhase: Phase.GAME_OVER };
    }
    if (gameState.quarter === 3) {
      // Second half kickoff: team that received opening kickoff now KICKS
      gameState.possession = 0;  // Reset to 0, advances when kick lands
      gameState.offenseTeam = gameState.openingKickoffReceiver;
      return setupKickoff(false, false);
    }
    // Q2/Q4: no kickoff, possession starts at 1
    gameState.possession = 1;
  }

  // Dispatch based on current phase
  const returnPhase = KICK_TO_RETURN_PHASE[gameState.phase];
  if (returnPhase) {
    return { nextPhase: returnPhase, phaseData: gameState.phaseData };
  }
  return setupFreshDowns();
}

// ============ Screen management ============

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
