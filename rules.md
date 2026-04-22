# Cloak's Gambit Rules

## Gold Standard

The text below is the current gold-standard rules wording for the project.

## Current Digital Implementation Overrides

The gold-standard wording below is preserved as the design reference. The current online implementation additionally uses these rule-layer clarifications:

- Ranked competitive matches are first to 3 points, not first to 5 or 10.
- Live clocks begin during the digital setup/pre-play flow rather than only after setup has fully finished.
- The player-facing move flow still treats an unanswered move as resolved immediately. Any delayed server-side finalization is considered an implementation detail, not a different player rule.

Overview
Cloak's Gambit is a fast-paced, strategic bluffing game where deception and bold moves collide. Imagine chess, but with secrets and surprises around every corner! The goal is to outsmart your opponent by capturing their king or boldly marching your king to their back rank-all while keeping your true pieces' identities hidden. Remember that when you bluff, your pieces are at stake!

Contents
1 board
5 dagger tokens
16 pieces (8 per color):
2 Kings ♔
4 Bishops ♗
4 Rooks ♖
4 Knights ♘
2 Bombs 💣

Setup
Choose one player as white, the other as black, giving each player all 8 of their respective pieces. Before play, Each player places 5 of their pieces on their first row on their side of the 5x6 board. One of these 5 must be their ♔ (king). Place 1 additional non-king piece "on deck" (the dark square behind the 5x6 board). The other 2 pieces are placed to the side. All pieces should be placed so that only the owner of those pieces can see what the piece is.
If you want some real fun, have your opponent blindly select these pieces, giving both players a random setup. This will lead to 3,240,000 possible starting configurations - go wild!

Play
Players alternate moves, starting with white. Between moves, depending on the situation, players may also ❗ ("Challenge"), or declare 💣 ("Bomb").

Move
A move starts with declaring a moveable piece type (♔, ♘, ♗, or ♖). Once the declaration is made, the player may move any of their pieces (regardless of what piece it actually is) in the manner that is allowed by the declared piece. Unless challenged (see below), a piece IS the declared piece, NOT what it "actually" is.
Pieces can move onto any empty spaces or capture an opponent's piece, as long as it is legal for the declared piece to do so. However, before the other player gets a turn, they may ❗ or declare 💣 (see below). Only after these are done (or the opponent passes on ❗ or declaring 💣) is the move "resolved." Once resolved, if a piece was captured, put it to the side and keep it revealed to BOTH players for the remainder of the game.

Movement
♔ King: Moves to any adjacent space, including diagonals.
♘ Knight: Moves in an L-shape: one square vertically and two horizontally or vice versa, and can jump over pieces.
♖ Rook: Moves by sliding horizontally or vertically up to 3 spaces. It cannot jump over other pieces.
♗ Bishop: Moves diagonally up to 3 spaces. It cannot jump over other pieces.
💣 Bomb: Cannot move, see "Bombs 💣" below.

Challenge❗
After a move or a 💣 declaration, the opponent may "Challenge" (❗). A ❗ is just one player claiming that the prior declaration is not the same as the true identity of the piece. Reveal the last declared piece to both players. If the challenger is right, then that piece is lost immediately. However, if the true identity matches the declaration, then the challenger receives a dagger token.
In the case that a ❗ fails, the player who made the original declaration must complete the "On Deck" phase (see below).

Challenging the true king!
If a player declares anything other than a ♔, is subsequently challenged, and the piece IS the ♔, then declarer loses immediately as their ♔ has just been effectively captured. However, if a player declares ♔, is subsequently challenged, and the piece is really the ♔, then the challenger loses immediately, as they can no longer capture their opponent's ♔ (see "On Deck").

On Deck
If a ❗ fails, the declared piece is replaced with the piece on deck. The declarer secretly picks a new piece to be "on deck" out of any of their pieces that is now not on the board. This could be the piece that was just on the board before. This refreshes the piece in play so that the opponent will never be certain of any piece's identity. The shadows are your friend.

Bombs💣
If a capture is attempted, the defender can declare 💣 ("Bomb"), and now the attacker may choose to ❗. If the attacker does not ❗, their piece is removed, and it becomes the 💣 declarer's turn. The piece declared 💣 stays on the board. However, if there is a ❗ and ...
If it really is a 💣: The attacker loses the attacking piece AND takes a dagger token. The 💣 player must complete the "On deck" phase with the 💣 piece.
If it is NOT a 💣: The piece is captured, and the 💣 declarer must take a dagger token.
You cannot declare 💣 if the attack was declared as a king, as kings are immune to bombs!

Summary: Move Flow:
Move is Declared: Player declares a piece type and moves it accordingly.
Opponent's Options:
Move Resolution: If no ❗ or 💣 is declared, the move is resolved and any captured piece is revealed.
❗ Challenge:
If Successful: Declared piece is lost immediately. Any captured piece is not actually captured.
If Unsuccessful: Challenger takes a dagger token, and On Deck phase follows for the mover.
💣 Bomb Declaration (only if a capture attempt occurs):
Opponent Passes on ❗ Challenge: Attacking piece is removed, and declared 💣 piece remains on the board.
Opponent ❗ the 💣:
If True (💣): Attacker loses the attacking piece and must take a dagger token. On deck phase follows for the 💣 declarer.
If False: Declared 💣 is captured, and 💣 declarer takes a dagger token.

End of Game
The game ends when:
A player captures the opponent's king after a move is resolved. The capturer wins.
A player declares that their king is moving to the opposite side of the board, and the move resolves successfully. The declarer wins.
A true king is declared and ❗follows. The challenger loses.
If a player takes a third dagger token.
Someone has had enough and flips the table over. Some people call this "forfeiting."
If no captures have occured or challenges have been made for 20 moves, the game is a draw.
For competitive play, count each game as a single "point," and play first to 5 or 10 points.

FAQ:
What if a player doesn't place their king on the board at the beginning of the game?
That's cheating, don't do that!

If I declare a non-king piece, but my king ends up on the opponent's back rank, do I win?
No, unless a piece is challenged, it IS the declared piece. So congrats, you just moved a rook (or whatever) to the back rank. Of course, if that rook is challenged, you lose, because the challenge is successful, and you lost your king before that move was resolved.

Can Bombs (💣) move?
Not by declaring them as a bomb. However, as a bluff (declaring it as another piece) they can. Declared as a 💣, they can only be used defensively when an opponent attempts to capture a piece.

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
- Failed move challenges and failed bomb challenges send the original declarer into the on-deck phase, which matches the gold-standard rules.
- The king may never be placed on deck, either during initial setup or during a later on-deck refresh.
- `onDeck.js` takes a matching non-king piece out of the player's stash and replaces `game.onDecks[color]`.

### Bomb/Challenge Notes In Code
- `bomb.js` only allows bombs against pending non-king moves and only when the defender controls the target square.
- `pass.js` removes the attacking piece from the original `from` square, because the move never resolves onto the destination after an unchallenged bomb.
- `challenge.js` can end the game through:
  - captured king
  - true-king reveal
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
