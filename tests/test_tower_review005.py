"""Regressões HTTP independentes da Code Review #005."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from urllib.parse import quote

from fastapi.testclient import TestClient

from rescueos.contracts import validate_event
from rescueos.ingest import read_jsonl
from rescueos.tower.api import create_app


def creation(order_id):
    return {"event_id": "created", "order_id": order_id, "restaurant_id": "rest-test",
            "occurred_at": "2026-10-29T18:00:00-03:00", "type": "ORDER_CREATED",
            "data": {"promised_ready_at": "2026-10-29T18:20:00-03:00",
                     "promised_delivery_at": "2026-10-29T18:40:00-03:00"}}


class Review005HttpRegressionTests(unittest.TestCase):
    def test_individual_query_supports_slash_without_changing_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ids.jsonl"
            path.write_text(json.dumps(creation("with/slash")), encoding="utf-8")
            with TestClient(create_app(path)) as client:
                expected = client.get("/api/v1/orders").json()["orders"][0]
                response = client.get("/api/v1/order", params={"order_id": "with/slash"})
                self.assertEqual(200, response.status_code, response.text)
                self.assertEqual(expected, response.json()["order"])

    def test_surrogate_accepted_by_core_is_serializable_on_every_resource(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "surrogate.jsonl"
            oid = "lone-\ud800"
            path.write_text(json.dumps(creation(oid), ensure_ascii=True), encoding="utf-8")
            original = path.read_bytes()
            self.assertEqual(1, len(read_jsonl(path).events))
            with TestClient(create_app(path), raise_server_exceptions=False) as client:
                for resource in ("health", "overview", "orders", "diagnostics", "replay"):
                    with self.subTest(resource=resource):
                        response = client.get("/api/v1/" + resource)
                        self.assertEqual(200, response.status_code, response.text)
                        json.loads(response.content)
                response = client.get("/api/v1/orders")
                if response.status_code == 200:
                    self.assertEqual(oid, response.json()["orders"][0]["order_id"])
            self.assertEqual(original, path.read_bytes())


class Review005HttpContractTests(unittest.TestCase):
    def test_special_ids_unicode_and_json_query_preserve_identity_and_fixture(self):
        for oid in ("normal", "with/slash", "with?query", "with#hash", "with spaces", "João", "🍲", "e\u0301", "lone-\ud800"):
            with self.subTest(order_id=repr(oid)), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "ids.jsonl"
                path.write_text(json.dumps(creation(oid), ensure_ascii=True), encoding="utf-8")
                original = path.read_bytes()
                with TestClient(create_app(path)) as client:
                    expected = client.get("/api/v1/orders").json()
                    responses = [client.get("/api/v1/order", params={"order_id_json": json.dumps(oid, ensure_ascii=True)})]
                    if "\ud800" not in oid:
                        responses.extend((client.get("/api/v1/order", params={"order_id": oid}),
                                          client.get("/api/v1/orders/" + quote(oid, safe=""))))
                    for response in responses:
                        self.assertEqual(200, response.status_code, response.text)
                        self.assertEqual(expected["snapshot_id"], response.json()["snapshot_id"])
                        self.assertEqual(expected["orders"][0], response.json()["order"])
                        self.assertTrue(response.content.isascii())
                    replay = client.get("/api/v1/replay").json()
                    self.assertEqual(expected["orders"], replay["frames"][-1]["orders"])
                self.assertEqual(original, path.read_bytes())

    def test_invalid_query_is_controlled_and_unknown_order_is_404(self):
        with TestClient(create_app()) as client:
            for params in ({}, {"order_id": "a", "order_id_json": '"a"'}, {"order_id_json": "{"},
                           {"order_id_json": "null"}, {"order_id_json": "[]"}, {"order_id_json": "42"}):
                with self.subTest(params=params):
                    self.assertEqual(422, client.get("/api/v1/order", params=params).status_code)
            self.assertEqual(404, client.get("/api/v1/order", params={"order_id": "unknown"}).status_code)
            self.assertEqual(404, client.get("/api/v1/order", params={"order_id_json": '"unknown"'}).status_code)

    def test_explicit_response_keeps_response_model_validation(self):
        from fastapi import FastAPI
        from rescueos.tower.models import Rational
        from rescueos.tower.serialization import EscapedJSONResponse

        app = FastAPI(default_response_class=EscapedJSONResponse)

        @app.get("/invalid", response_model=Rational)
        def invalid():
            return {"numerator": "1", "denominator": "0"}

        with TestClient(app, raise_server_exceptions=False) as client:
            self.assertEqual(500, client.get("/invalid").status_code)


class Review005IdentifierCompatibilityTests(unittest.TestCase):
    def assert_node(self, script, data):
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=Path(__file__).resolve().parents[1] / "frontend",
            input=json.dumps(data, ensure_ascii=True), capture_output=True,
            text=True, encoding="utf-8", timeout=30,
        )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def responses(self, event):
        self.assertEqual([], validate_event(event))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ids.jsonl"
            path.write_text(json.dumps(event, ensure_ascii=True), encoding="utf-8")
            self.assertEqual(1, len(read_jsonl(path).events))
            with TestClient(create_app(path)) as client:
                bundle = {}
                for name in ("replay", "overview", "orders", "diagnostics"):
                    response = client.get("/api/v1/" + name)
                    self.assertEqual(200, response.status_code)
                    bundle[name] = response.json()
                response = client.get("/api/v1/order", params={
                    "order_id_json": json.dumps(event["order_id"], ensure_ascii=True),
                })
                self.assertEqual(200, response.status_code)
                self.assertEqual(event["order_id"], response.json()["order"]["order_id"])
                return {"bundle": bundle, "detail": response.json()}

    def check_clients(self, field):
        cases = []
        for identifier in ("\ufeff", "\t \ufeff \r\n", "with/slash", "João", "🍲",
                           "e\u0301", "lone-\ud800", "\u180e", "\u200b", " ID "):
            event = creation("order-test")
            event[field] = identifier
            cases.append(self.responses(event))
        self.assert_node(r"""
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ApiError, loadBundle, loadOrder } from './src/api/client.ts';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const cases = JSON.parse(input); let current, invalid = false;
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  let body;
  if (url.pathname === '/api/v1/order') {
    assert.equal(JSON.parse(url.searchParams.get('order_id_json')), current.detail.order.order_id);
    body = current.detail;
  } else body = invalid && url.pathname.endsWith('/orders') ? {} : current.bundle[url.pathname.split('/').at(-1)];
  response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(body));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fetcher = (url, options) => fetch(`http://127.0.0.1:${server.address().port}${url}`, options);
try {
  for (current of cases) {
    assert.deepEqual(await loadBundle(undefined, fetcher), current.bundle);
    assert.deepEqual(await loadOrder(current.detail.order.order_id, undefined, fetcher,
      current.bundle.replay.snapshot_id), current.detail);
  }
  invalid = true;
  await assert.rejects(loadBundle(undefined, fetcher), error => error instanceof ApiError && error.kind === 'schema');
  invalid = false;
  assert.deepEqual(await loadBundle(undefined, fetcher), current.bundle);
} catch (error) { console.error(error); process.exitCode = 1;
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
""", cases)

    def test_order_id_feff_and_special_ids_through_both_http_clients(self):
        self.check_clients("order_id")

    def test_event_id_feff_and_special_ids_through_both_http_clients(self):
        self.check_clients("event_id")

    def test_restaurant_id_feff_and_special_ids_through_both_http_clients(self):
        self.check_clients("restaurant_id")

    def test_whitespace_acceptance_matches_actual_python_contract(self):
        whitespace = [chr(code) for code in range(0x110000) if chr(code).isspace()]
        candidates = list(dict.fromkeys([
            "\ufeff", " \ufeff ", "", " \t\r\n", "".join(whitespace),
            "with/slash", "João", "🍲", "lone-\ud800", "\u180e", "\u200b",
            *whitespace,
            *(chr(ord(char) + step) for char in whitespace for step in (-1, 1)),
        ]))
        cases = []
        for field in ("order_id", "event_id", "restaurant_id"):
            for value in candidates:
                event = creation("order-test")
                event[field] = value
                cases.append({"field": field, "value": value, "accepted": not validate_event(event)})
        self.assert_node(r"""
import assert from 'node:assert/strict';
import { validateBundle } from './src/api/validation.ts';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const { bundle, cases } = JSON.parse(input), mismatches = [];
for (const entry of cases) {
  const data = structuredClone(bundle);
  data.diagnostics.evidence_catalog[0][entry.field] = entry.value;
  const before = JSON.stringify(data); let accepted = true;
  try { validateBundle(data); } catch { accepted = false; }
  assert.equal(JSON.stringify(data), before, 'Validation must not mutate identities');
  if (accepted !== entry.accepted) mismatches.push({ ...entry, actual: accepted });
}
assert.deepEqual(mismatches, [], 'Frontend identifier acceptance differs from Python validate_event');
""", {"bundle": self.responses(creation("order-test"))["bundle"], "cases": cases})
