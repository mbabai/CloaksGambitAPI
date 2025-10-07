"""FastAPI application exposing REST and WebSocket endpoints for training management.

This module wires together the training manager, MCTS runner, and model exports.
It also mounts a Gradio UI for manual interactions. All network calls to the
existing Node.js game server are left as TODO placeholders.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Optional

import gradio as gr
import uvicorn
import yaml
from fastapi import BackgroundTasks, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from train_manager import TrainingManager
from mcts_runner import MCTSSimulationRunner
from onnx_export import export_model_to_onnx

# ---------------------------------------------------------------------------
# Configuration loading
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.yaml"
MODELS_DIR = BASE_DIR / "models"
TRAINING_RUNS_DIR = BASE_DIR / "training_runs"
SIMULATIONS_DIR = BASE_DIR / "simulations"


class HyperParams(BaseModel):
    """Pydantic schema mirroring the default hyperparameters."""

    learning_rate: float = Field(..., description="Optimizer learning rate")
    batch_size: int = Field(..., description="Minibatch size for gradient steps")
    epochs: int = Field(..., description="Number of epochs per training run")
    optimizer: str = Field(..., description="Optimizer identifier")
    weight_decay: float = Field(..., description="Weight decay regularization strength")
    lambda_guess: float = Field(..., alias="λ_guess", description="Guess head loss coefficient")
    replay_buffer_size: int = Field(..., description="Max number of samples in replay buffer")
    mcts_simulations: int = Field(..., description="Number of simulations per MCTS search")
    c_puct: float = Field(..., description="Exploration constant for PUCT")
    dirichlet_alpha: float = Field(..., description="Dirichlet noise alpha parameter")

    class Config:
        populate_by_name = True


class ModelCreateRequest(BaseModel):
    """Request body for creating a new model record."""

    name: str
    description: Optional[str] = None


class SimulationRequest(BaseModel):
    """Request body for launching new self-play simulations."""

    model_ids: list[str]
    num_games: int = Field(..., gt=0)
    concurrency: int = Field(1, gt=0, description="Parallel match count")
    additional_options: Dict[str, Any] | None = None


class TrainingRequest(BaseModel):
    """Request body used to start a training run."""

    dataset_id: str
    model_id: str
    hyperparams: HyperParams
    notes: Optional[str] = None


app = FastAPI(title="Cloaks' Gambit Local Trainer", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


def load_default_hyperparams() -> HyperParams:
    """Read hyperparameters from ``config.yaml``."""

    with CONFIG_PATH.open("r", encoding="utf-8") as file:
        data = yaml.safe_load(file)
    return HyperParams(**data)


# Instantiate shared helpers. MongoDB connections are left as TODO placeholders.
training_manager = TrainingManager(
    models_dir=MODELS_DIR,
    runs_dir=TRAINING_RUNS_DIR,
    config_path=CONFIG_PATH,
)

mcts_runner = MCTSSimulationRunner(
    simulations_dir=SIMULATIONS_DIR,
    game_server_url="http://localhost:3000/api",  # TODO: move to configuration
)


@app.post("/new_model")
async def create_model(request: ModelCreateRequest) -> JSONResponse:
    """Create a new model metadata entry in MongoDB and on disk."""

    try:
        model_info = training_manager.create_model_record(
            name=request.name,
            description=request.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return JSONResponse({"status": "ok", "model": model_info})


@app.post("/simulate")
async def run_simulation(request: SimulationRequest) -> JSONResponse:
    """Trigger self-play simulations via the game server REST API."""

    try:
        simulation_meta = await mcts_runner.launch_self_play(
            model_ids=request.model_ids,
            num_games=request.num_games,
            concurrency=request.concurrency,
            options=request.additional_options or {},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return JSONResponse({"status": "queued", "simulation": simulation_meta})


@app.post("/train")
async def start_training(request: TrainingRequest, background: BackgroundTasks) -> JSONResponse:
    """Start a background training run with the provided hyperparameters."""

    try:
        run_id = training_manager.schedule_training(
            dataset_id=request.dataset_id,
            model_id=request.model_id,
            hyperparams=request.hyperparams.dict(by_alias=True),
            notes=request.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    background.add_task(training_manager.execute_training, run_id)
    return JSONResponse({"status": "started", "run_id": run_id})


@app.websocket("/metrics/{run_id}")
async def metrics_stream(websocket: WebSocket, run_id: str) -> None:
    """Stream live metrics for an active training run."""

    await websocket.accept()
    queue = training_manager.register_listener(run_id)

    try:
        while True:
            update = await queue.get()
            await websocket.send_json(update)
    except WebSocketDisconnect:
        logger.info("WebSocket for run %s disconnected", run_id)
    finally:
        training_manager.unregister_listener(run_id, queue)


@app.post("/export/{model_id}")
async def export_model(model_id: str) -> JSONResponse:
    """Export a trained model to ONNX format."""

    model_path = MODELS_DIR / model_id / "latest.pt"
    export_path = MODELS_DIR / model_id / "model.onnx"

    if not model_path.exists():
        raise HTTPException(status_code=404, detail="Model checkpoint not found")

    export_model_to_onnx(
        model_path=model_path,
        export_path=export_path,
    )

    return JSONResponse({"status": "exported", "path": str(export_path)})


# ---------------------------------------------------------------------------
# Gradio UI
# ---------------------------------------------------------------------------


def build_interface() -> gr.Blocks:
    """Construct the Gradio Blocks interface."""

    default_params = load_default_hyperparams()

    with gr.Blocks(title="Cloaks' Gambit Trainer") as demo:
        gr.Markdown("# Cloaks' Gambit Local Trainer")
        gr.Markdown(
            """This dashboard orchestrates self-play simulations and supervised training.
            All actions call the FastAPI endpoints under the hood. Network calls to the
            game server are placeholders and need to be integrated with the official API."""
        )

        with gr.Tab("Models"):
            model_name = gr.Textbox(label="Model name")
            model_desc = gr.Textbox(label="Description")
            create_btn = gr.Button("Create Model")
            create_out = gr.JSON(label="Response")

            create_btn.click(
                fn=training_manager.create_model_record,
                inputs=[model_name, model_desc],
                outputs=create_out,
            )

        with gr.Tab("Simulation"):
            model_ids = gr.Textbox(label="Model IDs (comma separated)")
            num_games = gr.Number(value=10, label="Number of games", precision=0)
            concurrency = gr.Number(value=1, label="Parallel matches", precision=0)
            options = gr.JSON(label="Additional options", value={})
            simulate_btn = gr.Button("Launch Simulations")
            sim_output = gr.JSON(label="Simulation response")

            simulate_btn.click(
                fn=mcts_runner.gradio_simulation_handler,
                inputs=[model_ids, num_games, concurrency, options],
                outputs=sim_output,
            )

        with gr.Tab("Training"):
            dataset_id = gr.Textbox(label="Dataset ID")
            model_id = gr.Textbox(label="Model ID")
            hyperparams = gr.JSON(label="Hyperparameters", value=default_params.dict(by_alias=True))
            notes = gr.Textbox(label="Run notes", lines=2)
            train_btn = gr.Button("Start Training")
            train_output = gr.JSON(label="Training response")

            train_btn.click(
                fn=training_manager.gradio_training_handler,
                inputs=[dataset_id, model_id, hyperparams, notes],
                outputs=train_output,
            )

        with gr.Tab("Batch"):
            gr.Markdown(
                """Batch processing is a placeholder for orchestrating multiple simulations or
                training runs. Populate this tab with scheduling controls as the workflow
                matures."""
            )
            batch_plan = gr.JSON(label="Batch job definitions", value={})
            batch_btn = gr.Button("Queue Batch Jobs")
            batch_output = gr.JSON(label="Batch response")

            batch_btn.click(
                fn=training_manager.gradio_batch_handler,
                inputs=[batch_plan],
                outputs=batch_output,
            )

    return demo


ui = build_interface()
app = gr.mount_gradio_app(app, ui, path="/")


# ---------------------------------------------------------------------------
# Development entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=7860, reload=True)
