from unittest.mock import patch, Mock
import sys
import types
import os

requests_stub = types.SimpleNamespace(post=lambda *a, **k: None,
                                     get=lambda *a, **k: None)
sys.modules['requests'] = requests_stub
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import importlib
gv = importlib.import_module('game_viewer')


def test_api_post_success_200():
    mock_response = Mock(status_code=200, text='{"ok":1}')
    mock_response.json.return_value = {"ok": 1}
    with patch('requests.post', return_value=mock_response) as post:
        success, payload = gv.api_post('test', {"x": 1})
    post.assert_called_once()
    assert success is True
    assert payload == {"ok": 1}


def test_api_post_success_204():
    mock_response = Mock(status_code=204, text='')
    with patch('requests.post', return_value=mock_response):
        success, payload = gv.api_post('test', {})
    assert success is True
    assert payload is None


def test_api_post_error():
    mock_response = Mock(status_code=400, text='Bad')
    mock_response.json.return_value = {"message": "Bad"}
    with patch('requests.post', return_value=mock_response):
        success, payload = gv.api_post('test', {})
    assert success is False
    assert payload == {"message": "Bad"}


def test_create_user_existing():
    with patch('game_viewer.api_post') as api_post:
        api_post.return_value = (True, [{"_id": "abc"}])
        user_id = gv.create_user('u', 'e')
    api_post.assert_called_once_with('users/getList', {'email': 'e'})
    assert user_id == 'abc'


def test_create_user_new():
    with patch('game_viewer.api_post') as api_post:
        api_post.side_effect = [
            (True, []),
            (True, {"_id": "new"})
        ]
        user_id = gv.create_user('u', 'e')
    assert api_post.call_count == 2
    assert api_post.mock_calls[0].args[0] == 'users/getList'
    assert api_post.mock_calls[1].args[0] == 'users/create'
    assert user_id == 'new'


def test_generate_moves_knight():
    board = [[None for _ in range(5)] for _ in range(5)]
    piece = {"color": 0, "identity": 5}
    board[2][2] = piece
    moves = gv.generate_moves(board, (2, 2), piece)
    assert len(moves) == 8
    assert (4, 3) in moves and (0, 1) in moves
