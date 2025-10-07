"""Utilities for launching self-play simulations via the Node.js game server.

The implementation here is intentionally lightweight; the real project should
replace the placeholders with authenticated calls to the production REST API and
robust status polling.
"""
from __future__ import annotations

import asyncio
import json
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Coroutine

import httpx


class MCTSSimulationRunner:
    """Client wrapper for invoking the game server to run MCTS self-play."""

    def __init__(self, *, simulations_dir: Path, game_server_url: str) -> None:
        self.simulations_dir = simulations_dir
        self.simulations_dir.mkdir(parents=True, exist_ok=True)
        self.game_server_url = game_server_url.rstrip("/")

    async def launch_self_play(
        self,
        *,
        model_ids: List[str],
        num_games: int,
        concurrency: int,
        options: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Submit a self-play job to the Node.js API."""

        simulation_id = uuid.uuid4().hex
        payload = {
            "model_ids": model_ids,
            "num_games": num_games,
            "concurrency": concurrency,
            "options": options,
        }

        endpoint = f"{self.game_server_url}/simulate"

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(endpoint, json=payload)
        if response.status_code >= 400:
            raise RuntimeError(f"Game server rejected request: {response.text}")

        loop = asyncio.get_running_loop()

        metadata = {
            "_id": simulation_id,
            "payload": payload,
            "submitted_at": loop.time(),
            "server_response": response.json(),
        }

        metadata_path = self.simulations_dir / f"{simulation_id}.json"
        metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
        return metadata

    def gradio_simulation_handler(
        self,
        model_ids: str,
        num_games: float,
        concurrency: float,
        options: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Synchronously accessible handler for the Gradio Simulation tab."""

        try:
            parsed_model_ids = [part.strip() for part in model_ids.split(",") if part.strip()]
            payload = {
                "model_ids": parsed_model_ids,
                "num_games": int(num_games),
                "concurrency": int(concurrency),
                "options": options or {},
            }
            metadata = self._run_in_event_loop(self.launch_self_play(**payload))
            return {"status": "queued", "simulation": metadata}
        except Exception as exc:  # pragma: no cover - UI convenience
            return {"status": "error", "detail": str(exc)}

    def _run_in_event_loop(self, coro: Coroutine[Any, Any, Dict[str, Any]]) -> Dict[str, Any]:
        """Run an async coroutine regardless of existing loops."""

        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(coro)

        # If we're already inside an event loop, execute in a temporary loop running in a thread.
        result: Dict[str, Any] | None = None
        exception: Exception | None = None

        def runner() -> None:
            nonlocal result, exception
            new_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(new_loop)
            try:
                result = new_loop.run_until_complete(coro)
            except Exception as exc:  # pragma: no cover - passthrough
                exception = exc
            finally:
                new_loop.close()

        thread = threading.Thread(target=runner, daemon=True)
        thread.start()
        thread.join()

        if exception:
            raise exception
        assert result is not None
        return result

