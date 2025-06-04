import requests
import random
import time
from typing import List, Tuple, Optional

BASE_URL = "http://localhost:3000/api/v1"

PIECE_SYMBOLS = {
    0: {
        0: '👻',
        1: '♔',
        2: '💣',
        3: '♗',
        4: '♖',
        5: '♘',
    },
    1: {
        0: '👻',
        1: '♚',
        2: '💣',
        3: '♝',
        4: '♜',
        5: '♞',
    },
}


# --- Utility HTTP helpers -------------------------------------------------

def api_post(endpoint: str, data: dict, retries: int = 3) -> Tuple[bool, Optional[dict]]:
    """POST to the API endpoint with basic retry handling.

    Returns a tuple ``(success, payload)``. ``success`` is ``True`` if the
    request succeeded (HTTP 200/201/204). ``payload`` contains either the JSON
    response or the error message from the server.
    """
    url = f"{BASE_URL}/{endpoint}"
    for attempt in range(retries):
        try:
            res = requests.post(url, json=data, timeout=5)
            if res.status_code in (200, 201):
                return True, res.json() if res.text else {}
            if res.status_code == 204:
                return True, None
            try:
                err = res.json()
            except Exception:
                err = {"message": res.text}
            print(f"Error {res.status_code} from {endpoint}: {err.get('message')}")
            if res.status_code >= 500:
                time.sleep(1)
                continue
            return False, err
        except Exception as exc:
            print(f"Request error to {endpoint}: {exc}")
            time.sleep(1)
    return False, {"message": "request failed"}


def api_get(endpoint: str, retries: int = 3) -> Optional[dict]:
    url = f"{BASE_URL}/{endpoint}"
    for _ in range(retries):
        try:
            res = requests.get(url, timeout=5)
            if res.status_code == 200:
                return res.json()
            print(f"GET {endpoint} -> {res.status_code}: {res.text}")
        except Exception as exc:
            print(f"GET error {endpoint}: {exc}")
        time.sleep(1)
    return None


# --- Board display helpers -------------------------------------------------

def get_piece_symbol(piece: Optional[dict]) -> str:
    if not piece:
        return '·'
    return PIECE_SYMBOLS[piece['color']][piece['identity']]


def display_board(board: List[List[Optional[dict]]]) -> None:
    print("\n  A B C D E")
    print(" ───────────")
    ranks = len(board)
    for r in range(ranks - 1, -1, -1):
        row = board[r]
        print(f"{r+1}|", end=" ")
        for piece in row:
            print(get_piece_symbol(piece), end=" ")
        print(f"|{r+1}")
    print(" ───────────")
    print("  A B C D E\n")


def print_game_state(game_id: str) -> None:
    for color in (0, 1):
        success, view = api_post("games/getDetails", {"gameId": game_id, "color": color})
        if not success or not view:
            continue
        print(f"-- View for {'White' if color == 0 else 'Black'} --")
        display_board(view['board'])
        print(f"Captured white: {[get_piece_symbol(p) for p in view['captured'][0]]}")
        print(f"Captured black: {[get_piece_symbol(p) for p in view['captured'][1]]}\n")


# --- Game setup logic ------------------------------------------------------

def create_user(username: str, email: str) -> str:
    # Try to fetch existing user by email
    user = api_post("users/getList", {"email": email})[1]
    if user and isinstance(user, list) and len(user) > 0:
        return user[0]["_id"]
    # Otherwise, create a new user
    ok, user = api_post("users/create", {"username": username, "email": email})
    if not ok or not user:
        raise RuntimeError("Failed to create user")
    return user["_id"]


def enter_quickplay(user_id: str) -> None:
    api_post("lobby/enterQuickplay", {"userId": user_id})


def matchmaking_check() -> None:
    api_post("lobby/matchmaking/check", {})


def listen_for_match(user_id: str) -> str:
    while True:
        success, result = api_post("lobby/listenForMatch", {"userId": user_id})
        if success and result and result.get("status") == "matched":
            return result["gameId"]
        matchmaking_check()
        time.sleep(1)


def ready_player(game_id: str, color: int) -> None:
    api_post("gameAction/ready", {"gameId": game_id, "color": color})


def fetch_admin_game(game_id: str) -> dict:
    ok, game = api_post("games/getDetails", {"gameId": game_id, "color": "admin"})
    if not ok or not game:
        raise RuntimeError("Failed to fetch game details")
    return game


def resign_game(game_id: str, color: int) -> None:
    """Resign the game as the specified color."""
    api_post("gameAction/resign", {"gameId": game_id, "color": color})


def random_setup(game_id: str, color: int) -> None:
    game = fetch_admin_game(game_id)
    board = game["board"]
    ranks = len(board)
    files = len(board[0])
    stash = game["stashes"][color]
    random.shuffle(stash)
    placed = stash[:5]
    remaining = stash[5:]

    rank = 0 if color == 0 else ranks - 1
    pieces_payload = []
    for col, piece in enumerate(placed):
        pieces_payload.append({
            "row": rank,
            "col": col,
            "color": color,
            "identity": piece["identity"],
        })
    on_deck = remaining[0]
    ok, _ = api_post(
        "gameAction/setup",
        {
            "gameId": game_id,
            "color": color,
            "pieces": pieces_payload,
            "onDeck": {"color": color, "identity": on_deck["identity"]},
        },
    )
    if not ok:
        raise RuntimeError("Setup failed")


def generate_moves(board: List[List[Optional[dict]]], pos: Tuple[int, int], piece: dict) -> List[Tuple[int, int]]:
    r, c = pos
    ranks = len(board)
    files = len(board[0])
    moves = []
    identity = piece["identity"]
    color = piece["color"]

    def in_bounds(x, y):
        return 0 <= x < ranks and 0 <= y < files

    def empty_or_enemy(x, y):
        return not board[x][y] or board[x][y]["color"] != color

    if identity == 5:  # Knight
        for dr, dc in [(2, 1), (1, 2), (-1, 2), (-2, 1), (-2, -1), (-1, -2), (1, -2), (2, -1)]:
            nr, nc = r + dr, c + dc
            if in_bounds(nr, nc) and empty_or_enemy(nr, nc):
                moves.append((nr, nc))
    elif identity == 1:  # King
        for dr in [-1, 0, 1]:
            for dc in [-1, 0, 1]:
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if in_bounds(nr, nc) and empty_or_enemy(nr, nc):
                    moves.append((nr, nc))
    elif identity == 3:  # Bishop
        for dr, dc in [(1, 1), (1, -1), (-1, 1), (-1, -1)]:
            for i in range(1, 4):
                nr, nc = r + dr * i, c + dc * i
                if not in_bounds(nr, nc):
                    break
                if board[nr][nc]:
                    if board[nr][nc]["color"] != color:
                        moves.append((nr, nc))
                    break
                moves.append((nr, nc))
    elif identity == 4:  # Rook
        for dr, dc in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            for i in range(1, 4):
                nr, nc = r + dr * i, c + dc * i
                if not in_bounds(nr, nc):
                    break
                if board[nr][nc]:
                    if board[nr][nc]["color"] != color:
                        moves.append((nr, nc))
                    break
                moves.append((nr, nc))
    return moves


def random_move(game_id: str, color: int) -> None:
    while True:
        game = fetch_admin_game(game_id)
        board = game["board"]
        positions = []
        for r, row in enumerate(board):
            for c, piece in enumerate(row):
                if piece and piece["color"] == color:
                    positions.append((r, c, piece))
        random.shuffle(positions)
        for r, c, piece in positions:
            options = generate_moves(board, (r, c), piece)
            random.shuffle(options)
            for nr, nc in options:
                success, resp = api_post(
                    "gameAction/move",
                    {
                        "gameId": game_id,
                        "color": color,
                        "from": {"row": r, "col": c},
                        "to": {"row": nr, "col": nc},
                        "declaration": piece["identity"],
                    },
                )
                if success:
                    return
                if resp and "turn" in resp.get("message", "").lower():
                    break
        # if no move succeeded, refresh game state and retry
        time.sleep(1)


# --- Orchestration ---------------------------------------------------------

def main() -> None:
    user1 = create_user("py_user1", "py1@example.com")
    user2 = create_user("py_user2", "py2@example.com")
    print("Users Created Successfully")

    enter_quickplay(user1)
    enter_quickplay(user2)
    print("Users endered quickplay queue Successfully")

    print("Waiting for matchmaking...")
    game_id = listen_for_match(user1)
    print(f"Matched with game {game_id}")

    # Ready up
    ready_player(game_id, 0)
    ready_player(game_id, 1)

    # Setup phase
    random_setup(game_id, 0)
    random_setup(game_id, 1)
    print_game_state(game_id)

    # Play a few moves
    for turn in range(6):
        color = turn % 2
        random_move(game_id, color)
        print_game_state(game_id)
        game = fetch_admin_game(game_id)
        if not game.get("isActive", True):
            print("Game ended")
            break
    else:
        # Resign as black if the game is still active
        print("Black resigns")
        resign_game(game_id, 1)
        print_game_state(game_id)


if __name__ == "__main__":
    main()
