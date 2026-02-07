# Gridiron beerball

## Overview

Gridiron beerball is a team drinking game that simulates American football using flip cup, beer pong throwing, and a field of 19 stationary cups. Two teams compete across four quarters to score touchdowns and field goals while defending their end zone.

## Setup

### The field

Line up 19 cups in a row down the center of a long table. The center cup (position 10) is the 50 yard line. Each cup represents a 5-yard increment:

- Cups 1-9: One team's territory (5, 10, 15, 20, 25, 30, 35, 40, 45 yard lines)
- Cup 10: The 50 yard line (midfield)
- Cups 11-19: Other team's territory (45, 40, 35, 30, 25, 20, 15, 10, 5 yard lines)

A special ball (distinct from the throwing ball) sits inside whichever cup marks the current line of scrimmage.

Each team's end zone is beyond one end of the table. For any given possession, the offense is trying to move the ball toward the defensive team's end zone and the defense is trying to push them back toward the offensive team's end zone.

### Teams

Two teams of 5 or more players each. All players rotate into flip cup matchups throughout the game.

### Equipment

- 19 field cups (stationary, in a line)
- 1 marker ball (sits in the line-of-scrimmage cup)
- 1 throwing ball (for passes, field goals, kickoffs, and extra points)
- Flip cups and drinks for each player
- Something to track the first down marker (a coin, clip, or second marker)

## Game structure

The game is played in 4 quarters. Each quarter consists of 2 possessions per team (4 total possessions per quarter, 16 total possessions in the game). Teams alternate possessions. A coin toss determines who receives the opening kickoff.

## Kickoffs

Kickoffs occur at the start of each half and after every score. **Each kicker and returner gets 2 attempts; first make counts.**

### The kick

The kicking team throws the ball from behind their own goal line. The kicker is trying to land the ball in a cup as close to the opponent's 5 yard line as possible (a deep kick).

- If the ball lands in any cup (within 2 attempts), the return begins from there.
- If both attempts miss, the receiving team starts at the 25 yard line (touchback).

### The return

After the kick, the receiving team gets up to 2 return throws from behind their own goal line. The return modifier is calculated as the cup hit minus 10 (with cup 10 being midfield/neutral).

- Hit a cup in the opponent's half → positive modifier → better field position.
- Hit cup 10 (midfield) → 0 modifier → no change.
- Hit a cup in your own half → negative modifier → worse field position.
- Miss both attempts → no change.

After the return, place the marker ball in the resulting cup. The receiving team is now on offense at that line of scrimmage.

### Onside kick

Instead of a normal kickoff, the kicking team may attempt an onside kick:

- **1 throw only** (not 2 attempts).
- Must hit a cup between the kicking team's 25 yard line and the 50 yard line.
- **Success:** The kicking team recovers the ball at the cup they hit and becomes the offense.
- **Failure (miss or hit wrong cup):** The receiving team gets the ball at the kicking team's 25 yard line.

## Punts

Punts occur when the offense chooses to punt. The mechanism is similar to kickoffs, with both teams getting up to 2 shots each.

### The punt

The punter throws from behind their own goal line (all throws in this game are from your own endzone). The base punt distance is 10 cups toward the opponent's end zone. The punter's shot modifies this:

- Hit a cup in the opponent's half of the field → bonus yards added to the punt.
- Hit a cup in your own half → penalty yards subtracted from the punt.
- Hit cup 10 (midfield) → no change, base punt of 10.
- Miss both attempts → no change, base punt of 10.

The modifier equals the cup number hit minus 10 (from the punter's perspective, hitting farther = better).

### The return

After the punt lands, the receiving team gets up to 2 return throws from behind their own goal line. The return works exactly like a kickoff return:

- Hit a cup in the opponent's half → ball moves back toward your goal (good return).
- Hit a cup in your own half → ball moves toward opponent's goal (bad return).
- Hit cup 10 or miss both → no change.

After the return, possession flips. The receiving team is now on offense at the resulting line of scrimmage.

## Offensive drives

### Downs

The offense has 4 downs to advance the ball at least 3 cups from their first down marker. If they reach or pass the marker, they earn a fresh set of 4 downs. If they fail, possession flips and the other team takes over at the current line of scrimmage.

### Play options

On **any down**, the offense can choose from the following plays:

| Play | Description |
|---|---|
| Punt | Kick the ball away (see punts section) |
| Field goal | Attempt to score 3 points |
| Spike | Consume a down with no play (no flip cup, no throw) |
| QB sneak | 1v1 flip cup (safe play) |
| Run 2v3 | 2 offense vs 3 defense flip cup |
| Run 3v4 | 3 offense vs 4 defense flip cup |
| Run 4v5 | 4 offense vs 5 defense flip cup |
| Throw | Up to 3 pong shots |

### Running — flip cup

The offense selects how many players to send (1-4). If sending 1, it's a QB sneak. Otherwise, the defense sends one more player than the offense (n+1). Both sides line up for a relay-style flip cup race.

On "hike," both sides race. The first team to flip all their cups wins the down.

#### QB sneak (1v1)

A safe, low-risk play:

- **Offense wins:** Gain 1 yard.
- **Defense wins or tie:** No gain (0 yards). Tie goes to offense.
- No interception possible on QB sneak.

#### Regular runs (2v3, 3v4, 4v5)

Yardage is determined by the number of unflipped cups remaining on the losing side:

| Unflipped cups | Yards |
|---|---|
| 1 | 1 |
| 2 | 2 |
| 3 | 5 |
| 4 | 9 |
| 5 | Touchdown! |

- **Offense wins:** The ball advances forward by the scheduled yards.
- **Defense wins:** The ball moves backward by the scheduled yards.
- **Tie (final cups flipped simultaneously):** No gain, no loss. The down is still used.

#### Running — fumble

If the defense wins a flip cup round and **every single defensive player finishes before any offensive player successfully flips**, it's a fumble. The defense takes possession at the current line of scrimmage.

**Exception:** QB sneaks (1v1) cannot result in fumbles.

### Throwing — passing play

The offense can throw up to 3 pong shots from their endzone. The first meaningful result (gain, loss, or turnover) ends the play.

#### Middle zone (safe throws)

The 7 cups from your own 35 yard line to the opponent's 35 yard line are the middle zone. No "call" is required.

| Position | Yard line | Result |
|---|---|---|
| 3 behind 50 | Own 35 | Lose 2 yards |
| 2 behind 50 | Own 40 | Lose 1 yard |
| 1 behind 50 | Own 45 | No gain |
| 50 yard line | 50 | Gain 1 yard |
| 1 beyond 50 | Opp 45 | Gain 2 yards |
| 2 beyond 50 | Opp 40 | Gain 3 yards |
| 3 beyond 50 | Opp 35 | Gain 4 yards |

Hitting your own territory beyond the 35 (own 30 yard line and back) = **immediate incomplete** (lose remaining throws).

#### Danger zone

The 3 cups at the opponent's 30, 25, and 20 yard lines:

| Yard line | Result |
|---|---|
| Opponent's 30 | Incomplete (ends throws) |
| Opponent's 25 | **Interception!** Defense takes over at current spot. |
| Opponent's 20 | Incomplete (ends throws) |

#### Deep zone (called throws)

The final 3 cups (opponent's 15, 10, 5 yard lines) require a "call." Before throwing, announce which cup you're targeting.

| Called cup | Gain |
|---|---|
| 15 yard line | 6 yards |
| 10 yard line | 9 yards |
| 5 yard line | Touchdown! |

**Important rules for called throws:**

- You only get the gain for what you *called*, even if you hit deeper.
- Hitting the middle zone when you called a deep cup = incomplete (ends throws).
- If you don't make your call (or farther), it's incomplete (ends throws).

#### All throws incomplete

If all 3 throws miss or result in incomplete, the down is consumed with no yardage change.

## Scoring

### Touchdown (6 points)

If the ball moves past the opponent's 5 yard line during an offensive drive, it's a touchdown. The defense drinks a penalty round (each defender finishes a cup or takes a shot — agree on intensity before the game starts).

After a touchdown, the scoring team chooses one of the following:

- **Extra point (1 point):** One player throws from the opponent's endzone and gets up to **3 pong shots**. Hit **any cup** and it's good, subject to blocking rule (if not made on first attempt, defense gets one shot at the same cup to block).
- **Two-point conversion (2 points):** A 1v1 flip cup race. Win it, 2 points. Lose it, nothing.

A kickoff follows.

### Field goal (3 points)

The kicker throws the ball from behind the **opponent's** goal line (the only play thrown from the opponent's side). The kicker must hit a valid cup: either the current line of scrimmage or any cup closer to the kicker's home endzone. **The kicker gets 3 attempts.**

- **Make any:** 3 points, subject to blocking rule (see below). A kickoff follows.
- **Miss all 3:** Turnover. The opposing team takes over at the current line of scrimmage regardless of what down it was.

#### Blocking rule (field goals and extra points)

If the kicker makes it on the **first attempt**, the kick is good — no block attempt allowed. If the kicker makes it on the **second or third attempt**, the defense gets **one chance** to hit the exact same cup to block the kick. If blocked, no points are scored and it counts as a turnover.

### Safety (2 points)

If the defense pushes the offense back past their own 5 yard line (into their own end zone), it's a safety. The defensive team scores 2 points and the offense must kick off to them.

## Turnovers

### Fumble (flip cup)

If the defense wins a flip cup round and every single defensive player finishes before any offensive player successfully flips, it's a fumble. The defense takes possession at the current line of scrimmage. Directions reverse — what was defense is now offense, moving toward the opposite end zone.

**Exception:** QB sneaks (1v1) cannot result in fumbles.

### Interception (throw)

If a throwing play hits the interception cup (opponent's 25 yard line), it's an interception. The defense takes possession at the current line of scrimmage.

### Turnover on downs

If the offense fails to gain 3 cups in 4 downs and doesn't punt or attempt a field goal, possession simply flips at the current spot.

## Overtime

If the score is tied after 4 quarters, each team gets 1 possession starting at cup 10 (midfield). If still tied after both possessions, teams alternate field goal attempts (2 shots each) from progressively farther back until one makes and the other misses.

## Quick reference

| Event | Points |
|---|---|
| Touchdown | 6 |
| Extra point (any cup, 3 attempts, blocking rule) | 1 |
| Two-point conversion (1v1 flip cup) | 2 |
| Field goal (valid cup, 3 attempts, blocking rule) | 3 |
| Safety | 2 |

| Run play | Result |
|---|---|
| QB sneak — offense wins | +1 yard |
| QB sneak — defense wins or tie | 0 yards |
| Flip cup — offense wins | Advance by schedule (1→1, 2→2, 3→5, 4→9, 5→TD) |
| Flip cup — defense wins | Lose by schedule |
| Flip cup — tie | No gain, down consumed |
| Flip cup fumble | All defenders finish before any offensive flip |

| Throw play | Result |
|---|---|
| Middle zone (own 35 to opp 35) | -2 to +4 yards based on position |
| Behind own 35 | Immediate incomplete (ends throws) |
| Danger zone — 30 or 20 | Incomplete (ends throws) |
| Danger zone — 25 | Interception |
| Deep zone — called 15 | +6 yards |
| Deep zone — called 10 | +9 yards |
| Deep zone — called 5 | Touchdown |
| All 3 throws incomplete | Down consumed, no change |

| Kick/return | Result |
|---|---|
| All kicks | 2 attempts (first make counts) |
| Kickoff miss (both) | Touchback at 25 yard line |
| Onside kick | 1 attempt, must hit own 25 to 50 |
| Onside success | Kicking team gets ball at that cup |
| Onside fail | Receiving team gets ball at kicking team's 25 |
| Punt miss (both) | Base punt of 10 cups |
| Return miss (both) | No change to landing position |
