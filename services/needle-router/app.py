from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import needle

HOST = "127.0.0.1"
PORT = int(os.environ.get("BUILDER_NEEDLE_PORT", "3322"))
MAX_BODY_BYTES = 512 * 1024
MAX_CACHED_AGENTS = 8
DEFAULT_THRESHOLD = float(os.environ.get("BUILDER_NEEDLE_CONFIDENCE", "0.82"))

_cache_lock = threading.Lock()
_inference_lock = threading.Lock()
_agents: OrderedDict[str, Any] = OrderedDict()


def _agent_key(tools: list[dict[str, Any]], system: str | None) -> str:
    raw = json.dumps({"tools": tools, "system": system or ""}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _get_agent(tools: list[dict[str, Any]], system: str | None):
    key = _agent_key(tools, system)
    with _cache_lock:
        agent = _agents.get(key)
        if agent is not None:
            _agents.move_to_end(key)
            return agent
        agent = needle.Needle(tools=tools, system=system or None)
        _agents[key] = agent
        while len(_agents) > MAX_CACHED_AGENTS:
            _agents.popitem(last=False)
        return agent


def _type_matches(value: Any, expected: str) -> bool:
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "array":
        return isinstance(value, list)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "null":
        return value is None
    return True


def _validate_call(call: Any, tools: list[dict[str, Any]]) -> list[str]:
    if not isinstance(call, dict):
        return ["call must be an object"]
    name = call.get("name")
    arguments = call.get("arguments")
    if not isinstance(name, str) or not name:
        return ["call name is required"]
    declared = next((tool for tool in tools if tool.get("name") == name), None)
    if declared is None:
        return [f"unknown tool: {name}"]
    if not isinstance(arguments, dict):
        return [f"{name}: arguments must be an object"]

    schema = declared.get("parameters") if isinstance(declared.get("parameters"), dict) else {}
    properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    required = schema.get("required") if isinstance(schema.get("required"), list) else []
    errors: list[str] = []

    for field in required:
        if isinstance(field, str) and field not in arguments:
            errors.append(f"{name}: missing required argument {field}")

    # The router is intentionally stricter than generic JSON Schema: undeclared
    # arguments are never allowed to cross the confidence gate.
    for field in arguments:
        if field not in properties:
            errors.append(f"{name}: undeclared argument {field}")
            continue
        field_schema = properties.get(field)
        if isinstance(field_schema, dict):
            expected = field_schema.get("type")
            if isinstance(expected, str) and not _type_matches(arguments[field], expected):
                errors.append(f"{name}: {field} must be {expected}")
            enum = field_schema.get("enum")
            if isinstance(enum, list) and arguments[field] not in enum:
                errors.append(f"{name}: {field} is outside the allowed enum")

    return errors


def _validate_calls(calls: list[Any], tools: list[dict[str, Any]]) -> list[str]:
    if not calls:
        return ["no tool call produced"]
    errors: list[str] = []
    for index, call in enumerate(calls):
        for error in _validate_call(call, tools):
            errors.append(f"call[{index}]: {error}")
    return errors


def route(payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query") or "").strip()
    tools = payload.get("tools")
    system = str(payload.get("system") or "").strip() or None
    threshold = float(payload.get("confidenceThreshold", DEFAULT_THRESHOLD))
    if not query:
        raise ValueError("query is required")
    if not isinstance(tools, list) or not tools:
        raise ValueError("tools must be a non-empty JSON-schema tool array")
    if len(tools) > 1000:
        raise ValueError("too many tools")
    if not 0.0 <= threshold <= 1.0:
        raise ValueError("confidenceThreshold must be between 0 and 1")

    started = time.perf_counter()
    agent = _get_agent(tools, system)
    with _inference_lock:
        agent.reset()
        response = agent.complete(query)

    confidence = response.get("confidence")
    calls = response.get("function_calls") if isinstance(response.get("function_calls"), list) else []
    validation_errors = _validate_calls(calls, tools)
    schema_valid = not validation_errors
    accepted = schema_valid and isinstance(confidence, (int, float)) and confidence >= threshold
    return {
        "ok": True,
        "type": response.get("type"),
        "calls": calls if accepted else [],
        "candidateCalls": calls,
        "confidence": confidence,
        "threshold": threshold,
        "schemaValid": schema_valid,
        "validationErrors": validation_errors,
        "accepted": accepted,
        "escalate": not accepted,
        "latencyMs": round((time.perf_counter() - started) * 1000, 2),
        "metrics": {
            "prefillTps": response.get("prefill_tps"),
            "decodeTps": response.get("decode_tps"),
            "peakRamMb": response.get("peak_ram_mb"),
        },
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "AutonomousBuilderNeedle/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path != "/health":
            self._json(404, {"ok": False, "error": "not found"})
            return
        self._json(200, {"ok": True, "service": "needle-router", "serviceVersion": "1.1", "needleVersion": getattr(needle, "__version__", "unknown"), "threshold": DEFAULT_THRESHOLD, "host": HOST, "port": PORT})

    def do_POST(self) -> None:
        if self.path != "/route":
            self._json(404, {"ok": False, "error": "not found"})
            return
        try:
            size = int(self.headers.get("content-length", "0"))
            if size <= 0 or size > MAX_BODY_BYTES:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(size).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("JSON object required")
            self._json(200, route(payload))
        except (ValueError, json.JSONDecodeError) as error:
            self._json(400, {"ok": False, "error": str(error)})
        except Exception as error:
            self._json(500, {"ok": False, "error": type(error).__name__})


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
