export const ANTIGRAVITY_SITE_CUSTOMIZE_PREAMBLE = `import contextvars
import importlib.abc
import os
import re
import sys

_TARGET_MODULE = "google3.cloud.developer_experience.antigravity_extensions.acp_server.server"
_AUTO_MODE_ID = "auto"
_AUTO_REASON_VAR = contextvars.ContextVar("_superone_auto_reason", default="")
_PENDING_NEW_MODE_VAR = contextvars.ContextVar("_superone_pending_new_mode", default="")
_FRONTMATTER_RE = re.compile(r"^---\\r?\\n([\\s\\S]*?)\\r?\\n---(?:\\r?\\n|$)")
_STEP_TS_HEADER_RE = re.compile(r"^(?:Created At:\\s*[^\\r\\n]+\\r?\\n(?:Completed At:\\s*[^\\r\\n]+\\r?\\n)?|Completed At:\\s*[^\\r\\n]+\\r?\\n)")
_SPILLED_URI_RE = re.compile(r"^(?:(?:The output was large and was saved to|Result saved to URI):\\s*|The tool's output was truncated due to being too long\\.\\s*You can find the full output in a file at\\s+)(file://[^\\r\\n]+?|/[^\\r\\n]+?)\\.?\\s*(?:\\r?\\n|$)")


def _clean_mcp_output_py(text):
    if not isinstance(text, str) or not text:
        return None
    stripped = _STEP_TS_HEADER_RE.sub("", text)
    m = _SPILLED_URI_RE.match(stripped.strip())
    if m:
        target = m.group(1).strip().rstrip(".")
        try:
            import urllib.parse as _urlparse
            fpath = _urlparse.unquote(_urlparse.urlparse(target).path) if target.startswith("file://") else target
            if os.path.isfile(fpath) and os.path.getsize(fpath) <= 2 * 1024 * 1024:
                with open(fpath, "r", encoding="utf-8", errors="replace") as fh:
                    return _STEP_TS_HEADER_RE.sub("", fh.read())
        except Exception:
            pass
    return stripped


def _extract_mcp_call_target(server_mod, step):
    tool_name = ""
    call_args = None
    calls = getattr(step, "tool_calls", None)
    if calls:
        call = calls[0]
        raw_name = server_mod._tool_call_name(call) or ""
        raw_args = getattr(call, "args", None)
        if raw_name == "call_mcp_tool" and isinstance(raw_args, dict):
            tool_name = str(raw_args.get("ToolName") or raw_args.get("tool") or raw_args.get("tool_name") or "")
            inner = raw_args.get("Arguments")
            if isinstance(inner, dict):
                call_args = inner
            elif isinstance(inner, str) and inner.strip():
                try:
                    json_mod = getattr(server_mod, "json", None) or __import__("json")
                    parsed = json_mod.loads(inner)
                    if isinstance(parsed, dict):
                        call_args = parsed
                except Exception:
                    pass
        else:
            tool_name = raw_name
            if isinstance(raw_args, dict):
                call_args = raw_args
    return tool_name, call_args


def _read_mcp_step_output_once(adapter, server_mod, session_id, step_key, step_idx, tool_name, call_args=None, *, strict_args=True):
    used_by_session = getattr(adapter, "_used_mcp_db_idxs_by_session", None)
    if not isinstance(used_by_session, dict):
        used_by_session = {}
        try:
            setattr(adapter, "_used_mcp_db_idxs_by_session", used_by_session)
        except Exception:
            pass
    used_idxs = used_by_session.setdefault(session_id, set())
    matched_by_session = getattr(adapter, "_matched_mcp_db_idx_by_step", None)
    if not isinstance(matched_by_session, dict):
        matched_by_session = {}
        try:
            setattr(adapter, "_matched_mcp_db_idx_by_step", matched_by_session)
        except Exception:
            pass
    step_map = matched_by_session.setdefault(session_id, {})
    turn_min_map = getattr(adapter, "_turn_min_mcp_db_idx_by_session", None)
    turn_min_idx = turn_min_map.get(session_id, 0) if isinstance(turn_min_map, dict) else 0
    min_idx = max(int(step_idx) if (isinstance(step_idx, int) and step_idx >= 0) else 0, int(turn_min_idx))
    pinned_idx = step_map.get(step_key) if step_key else None

    session_store = getattr(server_mod, "session_store", None)
    trajectory_pb2 = getattr(server_mod, "trajectory_pb2", None)
    json_mod = getattr(server_mod, "json", None) or __import__("json")
    db_path = None
    if session_store is not None and hasattr(session_store, "trajectory_path"):
        try:
            db_path = session_store.trajectory_path(session_id)
        except Exception:
            db_path = None
    has_db = bool(isinstance(db_path, str) and os.path.isfile(db_path) and trajectory_pb2 is not None)
    if has_db:
        try:
            import sqlite3 as _sqlite3
            conn = _sqlite3.connect(db_path, timeout=1.0)
            try:
                if isinstance(pinned_idx, int):
                    rows = conn.execute("SELECT idx, step_payload FROM steps WHERE idx = ?", (pinned_idx,)).fetchall()
                else:
                    rows = conn.execute("SELECT idx, step_payload FROM steps WHERE idx >= ? ORDER BY idx ASC", (min_idx,)).fetchall()
                for r_idx, payload in rows:
                    if not payload:
                        continue
                    if pinned_idx is None and r_idx in used_idxs:
                        continue
                    p_step = trajectory_pb2.Step()
                    p_step.ParseFromString(payload)
                    if p_step.WhichOneof("step") != "mcp_tool":
                        continue
                    db_tool_name = p_step.mcp_tool.tool_call.name or ""
                    if tool_name and db_tool_name and db_tool_name != tool_name:
                        continue
                    if strict_args and isinstance(call_args, dict) and call_args and p_step.mcp_tool.tool_call.arguments_json:
                        try:
                            db_args = json_mod.loads(p_step.mcp_tool.tool_call.arguments_json)
                        except Exception:
                            db_args = None
                        if isinstance(db_args, dict) and db_args != call_args:
                            continue
                    out_str = None
                    res_kind = p_step.mcp_tool.WhichOneof("result")
                    if res_kind == "result_string" and p_step.mcp_tool.result_string:
                        out_str = _clean_mcp_output_py(p_step.mcp_tool.result_string)
                    elif res_kind == "result_uri" and p_step.mcp_tool.result_uri:
                        out_str = _clean_mcp_output_py(f"Result saved to URI: {p_step.mcp_tool.result_uri}")
                    elif hasattr(adapter, "_extract_tool_output"):
                        raw_out = adapter._extract_tool_output(p_step)
                        if isinstance(raw_out, str) and raw_out.strip():
                            out_str = _clean_mcp_output_py(raw_out)
                    if isinstance(out_str, str) and out_str:
                        used_idxs.add(r_idx)
                        if step_key:
                            step_map[step_key] = r_idx
                        return out_str, True
            finally:
                conn.close()
        except Exception:
            pass
        return None, True

    has_storage = False
    try:
        acp_paths = getattr(server_mod, "acp_paths", None)
        gemini_home = acp_paths.gemini_home() if (acp_paths and hasattr(acp_paths, "gemini_home")) else os.path.expanduser("~/.gemini")
        for sub in ("antigravity-acp", ""):
            logs_dir = (
                os.path.join(gemini_home, sub, "brain", session_id, ".system_generated", "logs")
                if sub
                else os.path.join(gemini_home, "brain", session_id, ".system_generated", "logs")
            )
            for fname in ("transcript_full.jsonl", "transcript.jsonl"):
                fpath = os.path.join(logs_dir, fname)
                if not os.path.isfile(fpath):
                    continue
                has_storage = True
                with open(fpath, "r", encoding="utf-8", errors="replace") as fh:
                    lines = fh.readlines()
                candidates = []
                for line in lines:
                    line = line.strip()
                    if not line or '"MCP_TOOL"' not in line:
                        continue
                    obj = json_mod.loads(line)
                    if obj.get("type") != "MCP_TOOL":
                        continue
                    if obj.get("status") not in ("DONE", "ERROR", "CORTEX_STEP_STATUS_DONE", "CORTEX_STEP_STATUS_ERROR"):
                        continue
                    t_idx = obj.get("step_index")
                    if isinstance(pinned_idx, int):
                        if t_idx != pinned_idx:
                            continue
                    else:
                        if isinstance(t_idx, int) and t_idx < min_idx:
                            continue
                        if isinstance(t_idx, int) and t_idx in used_idxs:
                            continue
                    candidates.append((t_idx if isinstance(t_idx, int) else 10**9, t_idx, obj.get("content")))
                candidates.sort(key=lambda item: item[0])
                for _, t_idx, content in candidates:
                    if isinstance(content, str) and content.strip():
                        cleaned = _clean_mcp_output_py(content)
                        if isinstance(cleaned, str) and cleaned:
                            if isinstance(t_idx, int):
                                used_idxs.add(t_idx)
                                if step_key:
                                    step_map[step_key] = t_idx
                            return cleaned, True
    except Exception:
        pass
    return None, has_storage


async def _resolve_live_mcp_step_output(adapter, server_mod, session_id, step):
    step_idx = getattr(step, "step_index", None)
    step_id = getattr(step, "id", None)
    if not isinstance(step_idx, int) and isinstance(step_id, str):
        for sep in (":", "_"):
            if sep in step_id:
                try:
                    step_idx = int(step_id.rsplit(sep, 1)[1])
                    break
                except Exception:
                    step_idx = None
    step_key = str(step_id) if (isinstance(step_id, str) and step_id) else (f"{session_id}:{step_idx}" if isinstance(step_idx, int) else "")
    tool_name, call_args = _extract_mcp_call_target(server_mod, step)
    for delay in (0.0, 0.02, 0.04, 0.08, 0.12):
        if delay > 0:
            await server_mod.asyncio.sleep(delay)
        out, has_storage = _read_mcp_step_output_once(
            adapter, server_mod, session_id, step_key, step_idx, tool_name, call_args, strict_args=True
        )
        if isinstance(out, str) and out:
            return out
        if not has_storage:
            break
    if isinstance(call_args, dict) and call_args:
        out, _ = _read_mcp_step_output_once(
            adapter, server_mod, session_id, step_key, step_idx, tool_name, call_args, strict_args=False
        )
        if isinstance(out, str) and out:
            return out
    return None


def _extract_requested_mode_id(kwargs):
    if not isinstance(kwargs, dict):
        return None
    agy = kwargs.get("antigravity")
    if not isinstance(agy, dict):
        meta = kwargs.get("_meta") or kwargs.get("field_meta")
        agy = meta.get("antigravity") if isinstance(meta, dict) else None
    mode_id = agy.get("modeId") if isinstance(agy, dict) else None
    return mode_id.strip() if isinstance(mode_id, str) and mode_id.strip() else None


def _parse_skill_frontmatter_py(raw, fallback_name):
    m = _FRONTMATTER_RE.match(raw)
    if not m:
        return None
    lines = m.group(1).splitlines()
    name, description, disabled, i = fallback_name, "", False, 0
    while i < len(lines):
        line = lines[i]
        idx = line.find(":")
        if idx <= 0:
            i += 1
            continue
        key, val = line[:idx].strip(), line[idx + 1:].strip()
        if key == "disable-slash-command" and val.lower() == "true":
            disabled = True
        elif key in ("name", "description"):
            if val in (">", ">-", "|", "|-"):
                parts = []
                i += 1
                while i < len(lines) and (lines[i].startswith((" ", "\\t")) or not lines[i].strip()):
                    if lines[i].strip():
                        parts.append(lines[i].strip())
                    i += 1
                joined = " ".join(parts).strip()
                if key == "name" and joined:
                    name = joined
                elif key == "description":
                    description = joined
                continue
            unquoted = val[1:-1].strip() if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"') else val
            if key == "name" and unquoted:
                name = unquoted
            elif key == "description":
                description = unquoted
        i += 1
    return None if (disabled or not description) else (name, description)


def _discover_workspace_skill_roots(start_dir):
    roots = []
    if not start_dir:
        return roots
    curr = os.path.abspath(os.path.expanduser(start_dir))
    rel_candidates = (".agents/skills", ".agent/skills", "_agents/skills", "_agent/skills", ".gemini/skills")
    while True:
        for rel in rel_candidates:
            candidate = os.path.join(curr, rel)
            if os.path.isdir(candidate):
                roots.append(candidate)
        if os.path.exists(os.path.join(curr, ".git")):
            break
        parent = os.path.dirname(curr)
        if parent == curr:
            break
        curr = parent
    return roots


def _wrap_client_for_auto_reason(client):
    if client is None or getattr(client, "_superone_wrapped", False):
        return client
    orig_request_permission = client.request_permission

    async def _patched_request_permission(*args, **kwargs):
        reason = _AUTO_REASON_VAR.get()
        options = kwargs.get("options")
        if reason and isinstance(options, list) and options:
            first = options[0]
            meta = dict(getattr(first, "field_meta", None) or {})
            if "agy.security.warning" not in meta:
                meta["agy.security.warning"] = {
                    "severity": "high",
                    "risk": "policy_guardian",
                    "title": "Flagged by PolicyGuardian",
                    "message": reason,
                }
                if hasattr(first, "model_copy"):
                    kwargs["options"] = [first.model_copy(update={"field_meta": meta})] + list(options[1:])
        return await orig_request_permission(*args, **kwargs)

    orig_session_update = getattr(client, "session_update", None)
    if callable(orig_session_update):
        async def _patched_session_update(*args, **kwargs):
            update = kwargs.get("update")
            if getattr(update, "session_update", None) == "agent_message_chunk":
                content = getattr(update, "content", None)
                text = getattr(content, "text", None)
                if isinstance(text, str) and text.strip() in (
                    "Trajectory was cancelled.",
                    "Trajectory was canceled.",
                    "The request was cancelled by the client.",
                    "The request was canceled by the client.",
                ):
                    return None
            return await orig_session_update(*args, **kwargs)
    else:
        _patched_session_update = None

    try:
        setattr(client, "request_permission", _patched_request_permission)
        if _patched_session_update is not None:
            setattr(client, "session_update", _patched_session_update)
        setattr(client, "_superone_wrapped", True)
    except Exception:
        pass
    return client


async def _handle_antigravity_interject(adapter, server_mod, params):
    params = params if isinstance(params, dict) else {}
    session_id = params.get("sessionId") or params.get("session_id") or ""
    session_info = getattr(adapter, "_sessions", {}).get(session_id)
    if session_info is None or not getattr(session_info.agent, "is_started", False):
        raise RuntimeError(f"Session not active: {session_id}")
    conn = getattr(session_info.agent.conversation, "_connection", None)
    if conn is None or getattr(conn, "is_idle", True):
        raise RuntimeError(f"Session turn is already idle: {session_id}")
    local_conn_mod = sys.modules.get(conn.__class__.__module__)
    pb2 = getattr(local_conn_mod, "localharness_pb2", None)
    to_proto = getattr(local_conn_mod, "to_proto_input_content", None)
    if pb2 is None or to_proto is None:
        raise RuntimeError("localharness_pb2 unavailable for interject")
    sdk_types = server_mod.sdk_types_module
    content_blocks = params.get("content")
    parts = []
    if isinstance(content_blocks, list) and content_blocks:
        import base64 as _b64
        for blk in content_blocks:
            if not isinstance(blk, dict):
                continue
            btype = blk.get("type")
            if btype == "text":
                parts.append(to_proto(str(blk.get("text") or "")))
            elif btype == "image" and blk.get("data"):
                raw_bytes = _b64.b64decode(blk["data"])
                mime = str(blk.get("mimeType") or blk.get("mime_type") or "image/png")
                parts.append(to_proto(sdk_types.Image(data=raw_bytes, mime_type=mime)))
    if not parts:
        parts.append(to_proto(str(params.get("text") or "")))
    event = pb2.InputEvent(user_input=pb2.UserInput(parts=parts))
    await conn._send_input_event(event)
    return {"accepted": True}
`

export const ANTIGRAVITY_SITE_CUSTOMIZE_LOADER = `
class _LoaderWrapper(importlib.abc.Loader):
    def __init__(self, loader):
        self._loader = loader

    def create_module(self, spec):
        return self._loader.create_module(spec) if hasattr(self._loader, "create_module") else None

    def exec_module(self, module):
        if hasattr(self._loader, "exec_module"):
            self._loader.exec_module(module)
        elif hasattr(self._loader, "load_module"):
            self._loader.load_module(module.__name__)
        _patch_server_module(module)

    def __getattr__(self, name):
        return getattr(self._loader, name)


class _ServerPatchFinder(importlib.abc.MetaPathFinder):
    def __init__(self):
        self._in_find = False

    def find_spec(self, fullname, path, target=None):
        if fullname != _TARGET_MODULE or self._in_find:
            return None
        self._in_find = True
        try:
            for finder in sys.meta_path:
                if finder is self or not hasattr(finder, "find_spec"):
                    continue
                spec = finder.find_spec(fullname, path, target)
                if spec is not None and spec.loader is not None:
                    spec.loader = _LoaderWrapper(spec.loader)
                    return spec
        finally:
            self._in_find = False
        return None


def _install():
    existing = sys.modules.get(_TARGET_MODULE)
    if existing is not None:
        _patch_server_module(existing)
    elif not any(isinstance(f, _ServerPatchFinder) for f in sys.meta_path):
        sys.meta_path.insert(0, _ServerPatchFinder())


_install()
`
