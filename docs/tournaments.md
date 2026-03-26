# Tournament Mode

## Overview

Tournament mode adds a new menu entry that lets users create, join, and watch organized multi-match events. A tournament begins with a timed rolling round-robin phase, then converts the standings into a seeded elimination bracket. Tournament data, standings, bracket state, and linked matches/games must be saved as first-class records.

This is the durable product/spec document. The implementation plan lives in [docs/tournament-mode-execplan.md](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/docs/tournament-mode-execplan.md).

## Main Menu Entry

- Add a `Tournament` button to [public/index.html](/C:/Users/marce/OneDrive/Documents/GitHub/CloaksGambitAPI/public/index.html).
- Place it directly below `Ranked` and above `Rulebook`.
- Use the provided trophy/bracket icon.
- Clicking it opens the tournament browser modal.

## Tournament Browser Modal

The browser modal lists live tournaments in the `starting` and `active` states. Each row should show:

- tournament label
- state badge
- host username
- current phase if active
- player count
- viewer count

Top actions:

- `Create`
- `Join`
- `View`

Rules:

- `Join` and `View` stay disabled until a tournament row is selected.
- `Join` is allowed only for tournaments in `starting`.
- `View` is allowed for both `starting` and `active`.
- `Join` requires a logged-in user.
- If the user is not logged in, `Join` stays disabled and shows the tooltip `Log in to join tournaments.`

## Tournament States

Persisted tournament lifecycle states:

- `starting`
- `active`
- `completed`
- `cancelled`

Only `starting` and `active` belong in the live browser list. `completed` and `cancelled` remain in MongoDB history.

## Roles

Tournament membership roles:

- `host`
- `player`
- `viewer`
- `eliminated`

Confirmed product decisions:

- creating a tournament requires login
- the owner is called the `host`
- the host does not auto-join as a player
- while the tournament is `starting`, the host has a `Participate` toggle that adds or removes them from the player field
- viewers do not affect seeding or pairings

## Create Tournament Modal

Creating a tournament opens a config modal with required choices:

1. `Round robin time`: integer minutes `1` through `30`, default `15`
2. `Elimination style`: `Single Elimination` or `Double Elimination`, default `Single Elimination`
3. `Victory points`: `3`, `4`, or `5`, default `3`

After creation:

- create the tournament object
- set the creating user as host
- default the host participation toggle to off
- open the pre-start tournament lobby modal

## Pre-Start Tournament Lobby Modal

For the host:

- show `Start Tournament`
- show `Cancel Tournament`
- show a `Participate` toggle while the tournament is `starting`
- show an `Add Bot` action while the tournament is `starting`

For a joined player who is not the host:

- show `Leave Tournament`

For a viewer:

- show `Leave Tournament`

The body must show the joined player list. A separate viewer list is optional.

`Add Bot` opens a small modal with:

- a required bot display-name text input
- a required difficulty dropdown

Difficulty options:

- include `Easy` and `Medium` now
- in the future, populate this dropdown from all available bot profiles

`Add Bot` behavior rules:

- host only
- allowed only while the tournament state is `starting`
- creates a bot tournament participant using the selected name and difficulty
- bots count as normal players for player count, start eligibility, round-robin pairing, seeding, and elimination

`Cancel Tournament` removes everyone from the live tournament, closes the live state, and persists the record as `cancelled`.

## Active Tournament UI

Once started, tournament details move onto the main play surface.

Desktop:

- show a right-side tournament panel

Mobile:

- show a tournament tab that slides over the board

The live panel must show:

- current phase: `Round Robin` or `Elimination`
- player list
- round-robin `W/L/D` standings while relevant
- elimination status once the bracket begins
- `Bracket View` button during elimination

## Spectating Rules

Tournament spectating should reuse the existing viewer mode.

Viewers:

- can click a player name to watch that player's current tournament game, if one exists
- return to the same tournament surface when the viewed game ends

Players:

- cannot spectate other games while assigned to an active game
- may spectate other games only while idle and not currently playing
- also return to the same tournament surface when spectating ends

Eliminated players stay in the tournament as viewers and must be clearly marked `Eliminated`.

## Round-Robin Phase

This is a timed rolling pairing phase, not a precomputed everyone-plays-everyone-once schedule.

Rules:

- the phase lasts for the configured round-robin minutes
- pair free players randomly into single games
- use the ranked time control and increment
- these games do not change ELO
- these games are single-game results, not first-to-`N` series
- when a game ends, those players can be paired again
- prefer opponents they have not yet faced in this tournament
- after a player has faced everyone, repeated pairings are allowed
- when the timer expires, stop creating new round-robin games
- do not end games already in progress
- start elimination only after the last round-robin games finish

Recommended odd-player handling:

- allow odd player counts
- one player may idle when necessary
- rotate the idle assignment fairly

## Seeding Rules

When round robin ends, rank players by:

1. more wins
2. fewer losses
3. draws do not directly affect ordering
4. higher pre-tournament ELO
5. deterministic random tie-breaker recorded on the tournament

Recommended assumption:

- every joined player advances to elimination
- if the count is not a power of two, pad the bracket with BYEs for the highest seeds

## Elimination Phase

When a bracket match becomes ready, both players receive an accept overlay with a visible 30-second countdown.

Rules:

- the overlay must appear on top of whatever the user is doing
- both players must accept before the series starts
- if a player fails to accept, they forfeit that elimination matchup
- in single elimination, that loss removes them from the tournament
- in double elimination, that loss should follow the bracket normally: upper-bracket loss drops to lower bracket, lower-bracket loss eliminates

Series format:

- elimination is first to the configured `victoryPoints`
- each individual game uses normal Cloaks' Gambit rules and the ranked time control
- the series winner advances

ELO:

- elimination matches affect ELO
- apply ELO once per elimination match/series, exactly like ranked `Match` scoring
- round-robin games do not affect ELO

## Bracket Rules

Single elimination:

- seed the field from round-robin ranking
- use standard seeded `inner_outer` ordering
- pad with BYEs to the next power of two if needed
- without a bronze match, third place may be tied between semifinal losers

Double elimination:

- all players begin in the upper bracket
- first loss sends a player to the lower bracket
- second loss eliminates them
- the lower bracket alternates between major and minor rounds
- recommended grand final behavior is a true reset final: if the lower-bracket finalist beats the undefeated upper-bracket finalist once, play one last deciding series

## Bracket View

During elimination, `Bracket View` opens a pannable/zoomable visual bracket.

Requirements:

- show current bracket state
- show player names and live series scores
- make active match nodes clickable for spectating
- return users to the tournament surface when spectating ends

Recommended technical direction:

- keep bracket structure as explicit tournament data
- evaluate `brackets-manager.js` for bracket generation
- evaluate `brackets-viewer.js` for browser rendering
- self-host viewer assets instead of relying on a runtime CDN

## Tournament Completion

When the tournament ends:

- show a final modal
- display `1st`, `2nd`, and `3rd`
- allow `3rd` to contain a tie where the bracket does not produce a unique third-place finisher
- provide `Finish`

`Finish` removes the user from the tournament and returns them to the main lobby.

## Persistence and History

Add a first-class `Tournament` object and save it in MongoDB.

Persist:

- config
- host
- lifecycle state
- phase
- timestamps
- players
- viewers
- pre-tournament ELO snapshots
- round-robin standings
- seeding
- bracket state
- linked matches
- linked games
- final placements

Also:

- saved matches that belong to a tournament must include `tournamentId`
- saved games should include `tournamentId` or reliably derive it through the match
- history needs a `Tournament` section/filter
- round-robin and elimination matches both appear there
- elimination matches affect ELO but still belong to tournament history, not ordinary ranked queue history

Recovery:

- once a tournament has started, its tournament object must be persisted in MongoDB so the server can recover it after restart
- active in-progress matches and games do not need to survive restart
- on recovery, the tournament should reload from MongoDB, detect any lost in-progress matchup state, and put the affected players back into a recoverable waiting or pending-match state rather than pretending the lost game still exists

## External Research Notes

Bracket structure recommendations here are based on:

- [Brackets Documentation: Ordering](https://drarig29.github.io/brackets-docs/user-guide/ordering/)
- [Brackets Documentation: Structure](https://drarig29.github.io/brackets-docs/user-guide/structure/)
- [Brackets Documentation: Glossary](https://drarig29.github.io/brackets-docs/user-guide/glossary/)
- [ORAU Science Bowl: Seeding of Teams for Single Elimination Tournament](https://www.orau.gov/sciencebowl/files/teams/seeding-of-teams-for-single-elimination-tournament.pdf)

## Confirmed Decisions

The following product calls are now locked for implementation:

1. tournament creation requires login
2. the tournament owner is called the `host`
3. the host can choose whether to participate through a starting-mode toggle and is not auto-added as a player
4. minimum player count to start is `4`
5. all joined players advance to elimination, with BYEs where needed
6. a missed accept window counts as a loss of the current matchup
7. double elimination uses a true bracket-reset final
8. elimination ELO is awarded once per match/series, like ranked play
9. the pre-start lobby needs only the player list plus viewer count
10. active tournaments must persist in MongoDB for recovery, even though in-progress matches/games may be lost
