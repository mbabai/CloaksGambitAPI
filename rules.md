# Cloak's Gambit Rules

## Gold Standard

The text below is the current gold-standard rules wording for the project.

## Current Digital Implementation Overrides

The gold-standard wording below is preserved as the design reference. The current online implementation additionally uses these rule-layer clarifications:

- Ranked competitive matches are first to 3 points, not first to 5 or 10.
- Live clocks begin during the digital setup/pre-play flow rather than only after setup has fully finished.
- The player-facing move flow still treats an unanswered move as resolved immediately. Any delayed server-side finalization is considered an implementation detail, not a different player rule.

Overview
Cloak's Gambit is a fast-paced, strategic bluffing game where deception and bold moves collide. Imagine chess, but with secrets and surprises around every corner! The goal is to outsmart your opponent by capturing their Heart or boldly marching your Heart to their back rank-all while keeping your true pieces' identities hidden. Remember that when you bluff, your pieces are at stake!

Contents
1 board
5 dagger tokens
16 pieces (8 per color):
2 Hearts
4 Spears
4 Swords
4 Scythes
2 Poisons

Setup
Choose one player as white, the other as black, giving each player all 8 of their respective pieces. Before play, Each player places 5 of their pieces on their first row on their side of the 5x6 board. One of these 5 must be their Heart. Place 1 additional non-Heart piece "on deck" (the dark square behind the 5x6 board). The other 2 pieces are placed to the side. All pieces should be placed so that only the owner of those pieces can see what the piece is.
If you want some real fun, have your opponent blindly select these pieces, giving both players a random setup. This will lead to 3,240,000 possible starting configurations - go wild!

Play
Players alternate moves, starting with white. Between moves, depending on the situation, players may also Challenge, or declare Poison.

Move
A move starts with declaring a moveable piece type (Heart, Scythe, Spear, or Sword). Once the declaration is made, the player may move any of their pieces (regardless of what piece it actually is) in the manner that is allowed by the declared piece. Unless challenged (see below), a piece IS the declared piece, NOT what it "actually" is.
Pieces can move onto any empty spaces or capture an opponent's piece, as long as it is legal for the declared piece to do so. However, before the other player gets a turn, they may Challenge or declare Poison (see below). Only after these are done (or the opponent passes on Challenge or declaring Poison) is the move "resolved." Once resolved, if a piece was captured, put it to the side and keep it revealed to BOTH players for the remainder of the game.

Movement
Heart: Moves like a king in chess: to any adjacent space, including diagonals.
Scythe: Moves like a knight in chess: in an L-shape, one square vertically and two horizontally or vice versa, and can jump over pieces.
Sword: Moves like a rook in chess, sliding horizontally or vertically up to 3 spaces. It cannot jump over other pieces.
Spear: Moves like a bishop in chess, diagonally up to 3 spaces. It cannot jump over other pieces.
Poison: Cannot move, see "Poison" below.

Challenge
After a move or a Poison declaration, the opponent may "Challenge". A Challenge is just one player claiming that the prior declaration is not the same as the true identity of the piece. Reveal the last declared piece to both players. If the challenger is right, then that piece is lost immediately. However, if the true identity matches the declaration, then the challenger receives a dagger token.
In the case that a Challenge fails, the player who made the original declaration must complete the "On Deck" phase (see below).

Challenging the true Heart!
If a player declares anything other than a Heart, is subsequently challenged, and the piece IS the Heart, then declarer loses immediately as their Heart has just been effectively captured. However, if a player declares Heart, is subsequently challenged, and the piece is really the Heart, then the challenger loses immediately, as they can no longer capture their opponent's Heart (see "On Deck").

On Deck
If a Challenge fails, the declared piece is replaced with the piece on deck. The declarer secretly picks a new piece to be "on deck" out of any of their pieces that is now not on the board. This could be the piece that was just on the board before. This refreshes the piece in play so that the opponent will never be certain of any piece's identity. The shadows are your friend.

Poison
If a capture is attempted, the defender can declare Poison, and now the attacker may choose to Challenge. If the attacker does not Challenge, their piece is removed, and it becomes the Poison declarer's turn. The piece declared Poison stays on the board. However, if there is a Challenge and ...
If it really is Poison: The attacker loses the attacking piece AND takes a dagger token. The Poison player must complete the "On deck" phase with the Poison piece.
If it is NOT Poison: The piece is captured, and the Poison declarer must take a dagger token.
You cannot declare Poison if the attack was declared as a Heart, as Hearts are immune to Poison!

Summary: Move Flow:
Move is Declared: Player declares a piece type and moves it accordingly.
Opponent's Options:
Move Resolution: If no Challenge or Poison is declared, the move is resolved and any captured piece is revealed.
Challenge:
If Successful: Declared piece is lost immediately. Any captured piece is not actually captured.
If Unsuccessful: Challenger takes a dagger token, and On Deck phase follows for the mover.
Poison Declaration (only if a capture attempt occurs):
Opponent Passes on Challenge: Attacking piece is removed, and declared Poison piece remains on the board.
Opponent Challenges the Poison:
If True (Poison): Attacker loses the attacking piece and must take a dagger token. On deck phase follows for the Poison declarer.
If False: Declared Poison is captured, and Poison declarer takes a dagger token.

End of Game
The game ends when:
A player captures the opponent's Heart after a move is resolved. The capturer wins.
A player declares that their Heart is moving to the opposite side of the board, and the move resolves successfully. The declarer wins.
A true Heart is declared and challenged. The challenger loses.
If a player takes a third dagger token.
Someone has had enough and flips the table over. Some people call this "forfeiting."
If no captures have occurred or challenges have been made for 20 moves, the game is a draw.
For competitive play, count each game as a single "point," and play first to 5 or 10 points.

FAQ:
What if a player doesn't place their Heart on the board at the beginning of the game?
That's cheating, don't do that!

If I declare a non-Heart piece, but my Heart ends up on the opponent's back rank, do I win?
No, unless a piece is challenged, it IS the declared piece. So congrats, you just moved a Sword (or whatever) to the back rank. Of course, if that Sword is challenged, you lose, because the challenge is successful, and you lost your Heart before that move was resolved.

Can Poison move?
Not by declaring it as Poison. However, as a bluff (declaring it as another piece) it can. Declared as Poison, it can only be used defensively when an opponent attempts to capture a piece.

## Implementation Notes (Codebase State: March 10, 2026)

### Code Ownership
- Live HTTP gameplay flow lives in `src/routes/v1/gameAction/`.
- Shared live-route helpers live in `src/services/game/liveGameRules.js`.
- Machine-readable enums and defaults live in `shared/constants/game.json`.

### Current Live Move Lifecycle
- A submitted move is recorded as `PENDING` in `move.js`, and the turn flips immediately to open the response window.
- The board is not committed at move-submit time. Resolution happens through:
  - `challenge.js`
  - `bomb.js`
  - `pass.js`
  - automatic pending-move resolution inside `move.js` before a later move is validated
- The code currently uses three move-state values:
  - `PENDING`: response window open.
  - `COMPLETED`: board consequences applied, but an on-deck replacement still needs to happen.
  - `RESOLVED`: fully finished.

### Current On-Deck Behavior
- `setup.js` requires one real on-deck piece during initial setup.
- Failed move challenges and failed Poison challenges send the original declarer into the on-deck phase, which matches the gold-standard rules.
- The Heart may never be placed on deck, either during initial setup or during a later on-deck refresh.
- `onDeck.js` takes a matching non-Heart piece out of the player's stash and replaces `game.onDecks[color]`.

### Poison/Challenge Notes In Code
- `bomb.js` only allows Poison against pending non-Heart moves and only when the defender controls the target square.
- `pass.js` removes the attacking piece from the original `from` square, because the move never resolves onto the destination after unchallenged Poison.
- `challenge.js` can end the game through:
  - captured Heart
  - true-Heart reveal
  - third dagger

### Clock and Match Notes
- Live clock authority is now stored on `game.clockState` and emitted to clients as `clocks`.
- In the current online flow, the clock can start during setup/pre-play rather than waiting for the first normal move.
- Quickplay and custom matches are currently one-game matches in code (`WIN_SCORE: 1`).
- Ranked play currently uses first-to-3 (`WIN_SCORE: 3`).
- Ranked default time control is `180000` ms with a `3000` ms increment.
- Quickplay and custom default to `300000` ms with the same `3000` ms increment.

### Related Refactor Records
- `docs/board-annotations-clock-rules-execplan.md`
- `docs/clock-authority-debug-execplan.md`
