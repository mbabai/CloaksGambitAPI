import requests
import json

# Constants for piece representation
PIECE_SYMBOLS = {
    0: {  # White pieces
        1: '♔',  # King
        2: '💣',  # Bomb
        3: '♗',  # Bishop
        4: '♖',  # Rook
        5: '♘',  # Knight
    },
    1: {  # Black pieces
        1: '♚',  # King
        2: '💣',  # Bomb
        3: '♝',  # Bishop
        4: '♜',  # Rook
        5: '♞',  # Knight
    }
}

def get_piece_symbol(piece):
    """Convert a piece object to its ASCII symbol."""
    if piece is None:
        return '·'
    return PIECE_SYMBOLS[piece['color']][piece['identity']]

def display_board(board):
    """Display the game board using ASCII art."""
    print("\n  A B C D E")
    print(" ───────────")
    for i, row in enumerate(board):
        print(f"{5-i}|", end=" ")
        for piece in row:
            print(get_piece_symbol(piece), end=" ")
        print(f"|{5-i}")
    print(" ───────────")
    print("  A B C D E\n")

def get_game(game_id):
    """Fetch game data from the API."""
    # Replace with your actual API endpoint
    url = f"http://localhost:3000/api/v1/games/{game_id}"
    response = requests.get(url)
    if response.status_code == 200:
        return response.json()
    else:
        print(f"Error fetching game: {response.status_code}")
        return None

def main():
    game_id = input("Enter game ID: ")
    game = get_game(game_id)
    
    if game:
        print("\nGame Status:")
        print(f"Active: {game['isActive']}")
        print(f"Current Turn: {'White' if game['playerTurn'] == 0 else 'Black'}")
        print(f"Winner: {'White' if game['winner'] == 0 else 'Black' if game['winner'] == 1 else 'None'}")
        
        print("\nBoard:")
        display_board(game['board'])
        
        print("\nCaptured Pieces:")
        print("White:", [get_piece_symbol(p) for p in game['captured'][0]])
        print("Black:", [get_piece_symbol(p) for p in game['captured'][1]])

if __name__ == "__main__":
    main() 