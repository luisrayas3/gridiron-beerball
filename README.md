# Gridiron Beerball

## Overview

Gridiron Beerball is a team drinking game that simulates American football using flip cup, beer pong throwing, and a field of 19 stationary cups. Two teams compete across four quarters to score touchdowns and field goals while defending their end zone.

## Setup

### The field

Line up 19 cups in a row down the center of a long table. The center cup (position 10) is the 50 yard line. Each cup represents a 5-yard increment:

- Cups 1-9: One team's territory (5, 10, 15, 20, 25, 30, 35, 40, 45 yard lines)
- Cup 10: The 50 yard line (midfield)
- Cups 11-19: Other team's territory (45, 40, 35, 30, 25, 20, 15, 10, 5 yard lines)

A marker ball sits inside whichever cup marks the current line of scrimmage. Each team's end zone is beyond one end of the table.

### Teams

Two teams of 5 or more players each. All players rotate into flip cup matchups throughout the game.

### Equipment

- 19 field cups (stationary, in a line)
- 1 marker ball (sits in the line-of-scrimmage cup)
- 1 throwing ball (for passes, field goals, kickoffs, and extra points)
- Flip cups and drinks for each player
- Something to track the first down marker (a coin, clip, or second marker)

## Gameplay

### Quarters & possessions

The game is played in 4 quarters. Each quarter consists of 2 possessions per team (4 total possessions per quarter, 16 total possessions in the game). Teams alternate possessions. A coin toss determines who receives the opening kickoff.

### Kickoffs

Kickoffs occur at the start of each half and after every score.

The kicking team and receiving team each have opportunities to throw a pong ball for better field position. In certain cases, a kick recovery by the offense is possible. A kick return for a touchdown is also possible.

Instead of a normal kickoff, the kicking team may attempt an onside kick (only after a score, not at the start of a half). If successful, the kicking team recovers the ball and becomes the offense. If it fails, the receiving team gets the ball at the kicking team's 25 yard line.

See [Kicks & returns](#kicks--returns).

### Drives & downs

The offense has 4 downs to advance the ball at least 3 cups from their first down line of scrimmage. If they succeed, they earn a fresh set of 4 downs. If they fail, possession flips at the current line of scrimmage.

On any down, the offense can choose from:

| Play | Description |
|---|---|
| Punt | Kick the ball away; possession flips after the return |
| Field goal | Attempt to score 3 points |
| Sneak | 1v1 flip cup — low risk, small gain |
| Run (2v3, 3v4, 4v5) | Flip cup race — higher risk and reward |
| Pass | Up to 3 pong shots — variable outcomes including turnovers |

**Running plays** are flip cup races where the offense sends 1-4 players and the defense sends one more. Yards gained or lost depend on how decisively one side wins. If the defense dominates completely, it's a fumble and they take possession. See [Running](#running) for detailed mechanics.

**Passing plays** give the offense up to 3 throws at field cups. Closer cups are safer with smaller gains; deeper cups offer bigger gains but risk incompletions or interceptions. See [Passing](#passing) for detailed mechanics.

**Punts** work like kickoffs: the punting team and receiving team each throw pong balls to improve their resulting field position. See [Kicks & returns](#kicks--returns) for detailed mechanics.

### Scoring

| Event | Points |
|---|---|
| Touchdown | 6 |
| Extra point | 1 |
| Two-point conversion | 2 |
| Field goal | 3 |
| Safety | 2 |

**Touchdown:** If the ball moves past the opponent's 5 yard line during a drive, it's a touchdown. The defense drinks a penalty (agree on intensity before the game). After scoring, the offense chooses to attempt an extra point or two-point conversion, then kicks off.

**Field goal:** The offense can attempt a field goal on any down. Success awards 3 points and a kickoff follows. Failure is a turnover at the current spot. See [Field goals](#field-goals) for detailed mechanics.

**Safety:** If the defense pushes the offense back past their own 5 yard line, it's a safety. The defense scores 2 points and receives a kickoff.

**Conversions:** See [Touchdown conversions](#touchdown-conversions) for extra point and two-point mechanics.

### Overtime

If the score is tied after 4 quarters, each team gets 1 possession starting at the 50 yard line. If still tied, teams alternate field goal attempts from the 50 yard line until one makes and the other misses.

## Play mechanics

All throws are made from behind your own goal line, except field goals and extra points which are thrown from behind the opponent's goal line.

### Kicks & returns

Kickoffs, punts, and their respective returns share the same core mechanics.

**Attempts:** Each kicker and returner gets up to 2 pong throw attempts; the first make counts.

**Throw modifiers:** All kicks and returns use the same modifier table. The cup you hit determines an offset (in cups) applied to the ball's position. Throwing deeper (toward the opponent's endzone) gives a better modifier:

| Cup hit | Modifier |
|---|---|
| Opponent's 5 | +10 (best) |
| Opponent's 10 | +9 |
| Opponent's 15 | +8 |
| Opponent's 20 | +7 |
| Opponent's 25 | +6 |
| Opponent's 30 | +5 |
| Opponent's 35 | +4 |
| Opponent's 40 | +3 |
| Opponent's 45 | +2 |
| 50 yard line | +1 |
| Own 45 | 0 |
| Own 40 | -1 |
| Own 35 | -2 |
| Own 30 | -3 |
| Own 25 | -4 |
| Own 20 | -5 |
| Own 15 | -6 |
| Own 10 | -7 |
| Own 5 | -8 (worst) |
| Miss both | 0 |

**Kickoffs:** The kicker's modifier determines where the ball lands (offset from the receiving 25). A miss means touchback at the receiving team's 25. After the kick lands, the returner throws and their modifier adjusts the final field position.

**Punts:** Base punt distance is 10 cups toward the opponent's end zone. The punter's modifier adjusts this distance, and the returner's modifier then adjusts the final position. Miss = base punt of 10 cups with no modifier.

**Return outcomes:**

- **Return touchdown:** If the returner's modifier pushes the ball past the opponent's endzone, it's a touchdown.
- **Kick recovery:** If the returner hits a cup but the ball ends up in their own endzone, the kicking team recovers at the returner's 5 yard line. This includes any cup hit when the kick landed in the endzone that doesn't get the ball out. For example, a +19 kick (4 cups into the endzone) only has 6 safe cups - the remaining 13 are all recoveries.
- **Touchback:** If the returner misses both throws, the ball is placed at the returner's 5 yard line (touchback). This is the only way to avoid a recovery when the kick lands deep in the endzone.

**Onside kick:** Instead of a normal kickoff (only after a score, not at start of half), the kicking team may attempt an onside kick:

- 1 attempt only (not 2)
- Must hit the kicking team's 35, 40, or 45 yard line
- **Success:** Kicking team gets the ball at the cup they hit
- **Failure:** Receiving team gets the ball at the kicking team's 25 yard line

### Running

Running plays are relay-style flip cup races. The offense chooses how many players to send (1-4), and the defense sends one more (except for sneaks). The relay proceeds in the direction the offense is attacking.

**The hike:** The first offensive player "hikes" the ball — as soon as they lift their cup off the table, the play is live.

**Offsides:** Any cup lifted before it should be (before the hike, or before the previous teammate has finished) is offsides — 1-cup penalty against that team and the down is repeated. Offsides cannot cause a safety or touchdown; if it occurs at the 5 yard line, the ball stays at the 5.

**Sneak (1v1):** A low-risk play.

- Offense wins: Gain 1 yard (touchdown if at opponent's 5)
- Defense wins or ties: No gain (0 yards)
- No fumble possible

**Regular runs (2v3, 3v4, 4v5):** Yardage is determined by unflipped cups on the losing side:

| Unflipped cups | Yards |
|---|---|
| 1 | 1 |
| 2 | 2 |
| 3 | 5 |
| 4 | 9 |
| 5 | Touchdown |

- **Offense wins:** Ball advances by the scheduled yards
- **Defense wins:** Ball moves backward by the scheduled yards
- **Tie:** No gain, no loss; down consumed

**Fumble:** If the defense wins and every defensive player finishes before any offensive player successfully flips, it's a fumble. The defense takes possession at the current line of scrimmage.

### Passing

The offense gets up to 3 throws from their end zone. The first meaningful result (gain, loss, or turnover) ends the play. If all 3 throws miss or are incomplete, the down is consumed with no yardage change.

**Sack fumble zone (own 5 to own 25):** Hitting cups 1-5 (closest to thrower) results in a sack fumble.

| Cup | Result |
|---|---|
| Own 5, 10, 15, 20, 25 | **Sack fumble** — defense recovers at spot minus 3 yards. Can result in defensive touchdown. |

**Middle zone (own 30 to opponent's 35):** Safe throws, no call required.

| Cup | Result |
|---|---|
| Own 30 | -3 yards |
| Own 35 | -2 yards |
| Own 40 | -1 yard |
| Own 45 | No gain |
| 50 yard line | +1 yard |
| Opponent's 45 | +2 yards |
| Opponent's 40 | +3 yards |
| Opponent's 35 | +4 yards |

**Danger zone (opponent's 30, 25, 20):**

| Cup | Result |
|---|---|
| Opponent's 30 | Incomplete (ends throws) |
| Opponent's 25 | **Unforced interception** — defense takes over at current spot |
| Opponent's 20 | Incomplete (ends throws) |

**Defensive interception shot:** If the offense hits a cup on the 2nd or 3rd throw, the defense gets one chance to intercept by hitting the exact same cup. If successful, it's an interception. No interception shot is allowed in response to cups made on the 1st throw.

**Deep zone (opponent's 15, 10, 5):** Called throws. Before throwing, announce which cup you're targeting.

| Called cup | Result |
|---|---|
| Opponent's 15 | +6 yards |
| Opponent's 10 | +9 yards |
| Opponent's 5 | Touchdown |

Rules for called throws:

- You only get credit for what you called: hitting deeper counts as a catch but you only get the points called
- Each attempt may make different calls
- Missing in front of your call = incomplete (ends throws)
- Hitting middle zone when you called deep = incomplete (ends throws)

### Field goals

Field goals are the only play thrown from behind the opponent's goal line. The kicker gets 3 attempts and must hit the current line of scrimmage or any cup beyond (closer to their own end zone).

- **Make:** 3 points, kickoff follows
- **Miss all 3:** Turnover at the current line of scrimmage

**Blocking rule:** If the kicker makes it on the first attempt, no block is allowed. If made on the second or third attempt, the defense gets one chance to hit the same cup. If they hit it, the kick is blocked — no points, turnover at the current spot.

### Touchdown conversions

After a touchdown, the scoring team chooses:

**Extra point (1 point):** A field goal attempt from the 5 yard line. Standard field goal rules apply, including the blocking rule.

**Two-point conversion (2 points):** A 1v1 flip cup (sneak rules). Win = 2 points. Tie or lose = 0 points. Offsides by offense = no good; offsides by defense = automatic 2 points.

## Quick reference

| Scoring | Points |
|---|---|
| Touchdown | 6 |
| Extra point (FG from the 5) | 1 |
| Two-point conversion (1v1 flip cup) | 2 |
| Field goal (3 attempts, blocking rule) | 3 |
| Safety | 2 |

| Run play | Result |
|---|---|
| Sneak — offense wins | +1 yard |
| Sneak — defense wins or ties | 0 yards |
| Flip cup — offense wins | Advance by schedule (1/2/5/9/TD) |
| Flip cup — defense wins | Lose by schedule |
| Flip cup — tie | No gain, down consumed |
| Fumble | All defenders flip before any offensive flip |

| Pass play | Result |
|---|---|
| Sack fumble zone (own 5-25) | Fumble, -3 yards, can be defensive TD |
| Middle zone (own 30 to opp 35) | -3 to +4 yards |
| Danger zone — 30 or 20 | Incomplete |
| Danger zone — 25 | Unforced interception |
| Deep zone — call 15/10/5 | +6 / +9 / TD |
| All incomplete | Down consumed |
| Interception shot | 2nd/3rd throw: defense can match cup |

| Kicks & returns | Result |
|---|---|
| Standard kick/return | 2 attempts each |
| Kickoff miss | Touchback at 25 |
| Punt miss | Base 10 cups |
| Return miss | No modifier |
| Return TD | Modifier pushes ball past opponent's endzone |
| Kick recovery | Any hit that leaves ball in own endzone |
| Touchback | Miss both throws when kick in endzone → own 5 |
| Onside kick | 1 attempt, hit own 35/40/45 |
| Onside success | Kicking team gets ball |
| Onside fail | Receiving team at kicker's 25 |
