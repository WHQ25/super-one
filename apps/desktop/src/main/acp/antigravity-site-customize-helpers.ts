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

    try:
        setattr(client, "request_permission", _patched_request_permission)
        setattr(client, "_superone_wrapped", True)
    except Exception:
        pass
    return client
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
