"""FastAPI somente leitura: um snapshot consistente carregado no lifespan."""

from contextlib import asynccontextmanager
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from .models import (DiagnosticsResponse, HealthResponse, OrderResponse,
                     OrdersResponse, OverviewResponse, ReplayResponse)
from .snapshot import DEMO_FIXTURE, load_snapshot
from .serialization import EscapedJSONResponse


def create_app(fixture_path: Path = DEMO_FIXTURE):
    @asynccontextmanager
    async def lifespan(application):
        snapshot = load_snapshot(fixture_path)
        # Validar todo o cache antes de a aplicação ficar disponível.
        for key, model in (("health", HealthResponse), ("overview", OverviewResponse),
                           ("orders", OrdersResponse), ("diagnostics", DiagnosticsResponse),
                           ("replay", ReplayResponse)):
            validated = model.model_validate(snapshot.payload(key))
            EscapedJSONResponse(validated.model_dump(mode="json"))
        for order in snapshot.payload("orders")["orders"]:
            validated = OrderResponse.model_validate(snapshot.payload("order:" + order["order_id"]))
            EscapedJSONResponse(validated.model_dump(mode="json"))
        application.state.snapshot = snapshot
        yield

    application = FastAPI(title="RescueOS · The Living Restaurant", version="1.0", lifespan=lifespan,
                          default_response_class=EscapedJSONResponse)
    application.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
                               allow_methods=["GET"], allow_headers=["Content-Type"])

    def payload(request, name):
        return request.app.state.snapshot.payload(name)

    @application.get("/api/v1/health", response_model=HealthResponse)
    def health(request: Request):
        return payload(request, "health")

    @application.get("/api/v1/overview", response_model=OverviewResponse)
    def overview(request: Request):
        return payload(request, "overview")

    @application.get("/api/v1/orders", response_model=OrdersResponse)
    def orders(request: Request):
        return payload(request, "orders")

    def individual(request, order_id):
        try:
            return payload(request, "order:" + order_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Pedido não encontrado neste cenário.") from None

    @application.get("/api/v1/order", response_model=OrderResponse)
    def lookup_order(request: Request, order_id: str | None = None, order_id_json: str | None = None):
        # Query evita ambiguidade de barras/proxies; JSON-string também transporta
        # unidades UTF-16 isoladas sem tentar colocá-las diretamente numa URL UTF-8.
        if (order_id is None) == (order_id_json is None):
            raise HTTPException(status_code=422, detail="Informe somente order_id ou order_id_json.")
        if order_id_json is not None:
            try:
                order_id = json.loads(order_id_json)
            except (ValueError, RecursionError):
                raise HTTPException(status_code=422, detail="order_id_json exige uma string JSON válida.") from None
            if not isinstance(order_id, str):
                raise HTTPException(status_code=422, detail="order_id_json exige uma string JSON válida.")
        return individual(request, order_id)

    @application.get("/api/v1/orders/{order_id:path}", response_model=OrderResponse)
    def order(order_id: str, request: Request):
        return individual(request, order_id)

    @application.get("/api/v1/diagnostics", response_model=DiagnosticsResponse)
    def diagnostics(request: Request):
        return payload(request, "diagnostics")

    @application.get("/api/v1/replay", response_model=ReplayResponse)
    def replay(request: Request):
        return payload(request, "replay")

    return application


app = create_app()
