# Gridiron beerball

## Overview

Gridiron beerball is a team drinking game that simulates American football using flip cup, beer pong throwing, and a field of 20 stationary cups. Two teams compete across four quarters to score touchdowns and field goals while defending their end zone.

## Setup

### The field

Line up 20 cups in a row down the center of a long table. Number them 1–20. These represent 5-yard increments for a full 100-yard field. A special ball (distinct from the throwing ball) sits inside whichever cup marks the current line of scrimmage.

Each team's end zone is beyond one end of the table. For any given possession, the offense is trying to move the ball toward cup 20 (the defensive team's end zone) and the defense is trying to push them back toward cup 1 (the offensive team's end zone).

### Teams

Two teams of 5 or more players each. All players rotate into flip cup matchups throughout the game.

### Equipment

- 20 field cups (stationary, in a line)
- 1 marker ball (sits in the line-of-scrimmage cup)
- 1 throwing ball (for field goals, kickoffs, and extra points)
- Flip cups and drinks for each player
- Something to track the first down marker (a coin, clip, or second marker)

## Game structure

The game is played in 4 quarters. Each quarter consists of 2 possessions per team (4 total possessions per quarter, 16 total possessions in the game). Teams alternate possessions. A coin toss determines who receives the opening kickoff.

## Kickoffs

Kickoffs occur at the start of each half and after every score.

### The kick

The kicking team throws the ball from behind their own goal line (behind cup 20, from the receiving team's perspective). The kicker is trying to land the ball in a cup as close to cup 1 as possible — a deep kick.

- If the ball lands in any cup, it starts there.
- If the ball misses all cups, the receiving team starts at cup 7 by default.
- The kicker should aim for cups 1-6 to gain an advantage over missing.

### The return

After the kick, the receiving team gets one return throw from behind their own goal line (behind cup 1). The return yardage is calculated as the cup number they hit minus 10. This modifier is added to the starting position from the kick.

- Hit cup 15 → modifier is +5 → starting position moves 5 cups forward.
- Hit cup 10 → modifier is 0 → no change.
- Hit cup 8 → modifier is −2 → starting position moves 2 cups backward.
- Miss all cups → no change.

The best possible starting position (assuming no kicker error) is cup 16 (kick lands at cup 7, return hits cup 20 for a +10 modifier). The worst case is cup 1 if the kicker lands it there and the return misses.

After the return, place the marker ball in the resulting cup. The receiving team is now on offense at that line of scrimmage.

## Offensive drives

### Downs

The offense has 4 downs to advance the ball at least 3 cups from their first down marker. If they reach or pass the marker, they earn a fresh set of 4 downs. If they fail, possession flips and the other team takes over at the current line of scrimmage.

### Playing a down — flip cup

On each down, the offense selects 1–4 players to send. The defense then sends one more player than the offense (n+1). Both sides line up for a relay-style flip cup race.

On "hike," both sides race. The first team to flip all their cups wins the down. Yardage is determined by the number of unflipped cups remaining on the losing side:

- **Offense wins:** The ball advances forward (toward cup 20) by the number of unflipped defensive cups.
- **Defense wins:** The ball moves backward (toward cup 1) by the number of unflipped offensive cups.
- **Tie (final cups flipped simultaneously, hangtime rule):** No gain, no loss. The down is still used.

This creates a risk/reward decision for the offense. Sending 1 player (against 2 defenders) is safe — max gain is 2, max loss is 1. Sending 4 players (against 5 defenders) swings big — max gain is 5, max loss is 4.

### Fourth down decisions

On 4th down, the offense must choose one of three options before the play:

- **Go for it:** Play a normal flip cup down. High risk, high reward.
- **Punt:** No flip cup is played. The ball moves 9 zones toward the opponent's end zone. If this would push the ball past cup 20, place it at cup 20 (touchback). Possession flips.
- **Field goal attempt:** See the field goals section below.

## Scoring

### Touchdown (6 points)

If the ball moves past cup 20 during an offensive drive, it's a touchdown. The defense drinks a penalty round (each defender finishes a cup or takes a shot — agree on intensity before the game starts).

After a touchdown, the scoring team chooses one of the following:

- **Extra point (1 point):** One player takes a single beer pong shot the endzone to the 4th cup from the endzone. Make it, 1 point.
- **Two-point conversion (2 points):** A 1v1 flip cup race. Win it, 2 points. Lose it, nothing.

A kickoff follows.

### Field goal (3 points)

The kicker throws the ball from behind their own goal line (behind cup 1) and must land it in the cup at the current line of scrimmage. The farther the ball has advanced down the field, the farther the throw and the harder the field goal.

- **Make it:** 3 points. A kickoff follows.
- **Miss it:** Turnover on downs. The opposing team takes over at the current line of scrimmage.

### Safety (2 points)

If the defense pushes the offense back past cup 1 (into their own end zone), it's a safety. The defensive team scores 2 points and the offense must kick off to them.

## Turnovers

### Interception

If the defense wins a flip cup round and every single defensive player finishes before any offensive player successfully flips, it's an interception. The defense takes possession at the current line of scrimmage. Directions reverse — what was defense is now offense, moving toward the opposite end zone.

**Exception**: If the offense sent a single player, the result of losing is still a single spot.

### Turnover on downs

If the offense fails to gain 3 zones in 4 downs and doesn't punt or attempt a field goal, possession simply flips at the current spot.

## Overtime

If the score is tied after 4 quarters, each team gets 1 possession starting at cup 10 (midfield). If still tied after both possessions, teams alternate field goal attempts from progressively farther back until one makes and the other misses.

## Quick reference

| Event | Points |
|---|---|
| Touchdown | 6 |
| Extra point (pong shot) | 1 |
| Two-point conversion (1v1 flip cup) | 2 |
| Field goal (pong shot) | 3 |
| Safety | 2 |

| Situation | Result |
|---|---|
| Flip cup — offense wins | Advance by # of unflipped defensive cups |
| Flip cup — defense wins | Lose yards by # of unflipped offensive cups |
| Flip cup — tie | No gain, down consumed |
| Interception | Defense wins and all defenders finish before any offensive flip |
| Punt | Ball moves 9 zones toward opponent's end zone (max cup 20) |
| Kickoff miss | Receiving team starts at cup 7 |
| Kickoff return | Cup hit minus 10, modifies starting position |
