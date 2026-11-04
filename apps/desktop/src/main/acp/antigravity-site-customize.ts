import {
  ANTIGRAVITY_SITE_CUSTOMIZE_LOADER,
  ANTIGRAVITY_SITE_CUSTOMIZE_PREAMBLE,
} from './antigravity-site-customize-helpers'

const ANTIGRAVITY_SITE_CUSTOMIZE_PATCH = `
def _patch_server_module(server_mod):
    if getattr(server_mod, "_superone_auto_patched", False):
        return
    setattr(server_mod, "_superone_auto_patched", True)

    config_options = server_mod.config_options
    schema = server_mod.schema
    existing_modes = list(config_options.AVAILABLE_SESSION_MODES)
    if not any(getattr(m, "id", None) == _AUTO_MODE_ID for m in existing_modes):
        auto_mode = schema.SessionMode(id=_AUTO_MODE_ID, name="Auto", description="Model-assessed auto-approve with sandbox")
        insert_idx = next((i + 1 for i, m in enumerate(existing_modes) if getattr(m, "id", None) == "auto_edit"), len(existing_modes))
        existing_modes.insert(insert_idx, auto_mode)
        config_options.AVAILABLE_SESSION_MODES = tuple(existing_modes)

    orig_resolve_skills_paths = server_mod.resolve_skills_paths

    def _patched_resolve_skills_paths(cwd=None, additional_directories=None):
        base_paths = list(orig_resolve_skills_paths(cwd, additional_directories))
        extra_paths = []
        for d in [cwd, *(additional_directories or ())]:
            if d:
                extra_paths.extend(_discover_workspace_skill_roots(d))
        try:
            gemini_home = server_mod.acp_paths.gemini_home()
        except Exception:
            gemini_home = os.path.expanduser("~/.gemini")
        plugins_dir = os.path.join(gemini_home, "config", "plugins")
        if os.path.isdir(plugins_dir):
            try:
                for entry in sorted(os.listdir(plugins_dir)):
                    p_skills = os.path.join(plugins_dir, entry, "skills")
                    if os.path.isdir(p_skills):
                        extra_paths.append(p_skills)
            except Exception:
                pass
        for fixed in (
            os.path.join(gemini_home, "antigravity-cli", "builtin", "skills"),
            os.path.join(os.path.expanduser("~"), ".agents", "skills"),
        ):
            if os.path.isdir(fixed):
                extra_paths.append(fixed)
        seen, merged = set(), []
        for p in [*extra_paths, *base_paths]:
            norm = os.path.abspath(p)
            if norm not in seen:
                seen.add(norm)
                merged.append(norm)
        return merged

    server_mod.resolve_skills_paths = _patched_resolve_skills_paths

    AgyAdapter = server_mod.AgyAdapter
    orig_init = AgyAdapter.__init__
    orig_on_connect = AgyAdapter.on_connect
    orig_new_session = AgyAdapter.new_session
    orig_restore_session = AgyAdapter._restore_session
    orig_create_agent_config = AgyAdapter._create_agent_config
    orig_build_literal_model_target = AgyAdapter._build_literal_model_target
    orig_maybe_apply_model_switch = AgyAdapter._maybe_apply_model_switch
    orig_permission_handler = AgyAdapter._permission_handler
    orig_stream_live_step = AgyAdapter._stream_live_step
    orig_prompt = AgyAdapter.prompt
    orig_maybe_send_usage_update = AgyAdapter._maybe_send_usage_update
    orig_send_available_commands_update = AgyAdapter._send_available_commands_update
    orig_ext_method = getattr(AgyAdapter, "ext_method", None)
    orig_cleanup = AgyAdapter.cleanup

    def _patched_init(self, *args, **kwargs):
        orig_init(self, *args, **kwargs)
        self._agent_mode_by_session_id = {}
        self._pending_mode_by_session_id = {}
        self._emitted_thinking_by_session = {}
        self._turn_start_usage_by_session = {}
        self._tool_opened_at = {}

    def _patched_on_connect(self, conn):
        orig_on_connect(self, conn)
        _wrap_client_for_auto_reason(self._client)

    def _patched_build_literal_model_target(self, model_id, endpoint):
        sdk_types = server_mod.sdk_types_module
        meta = server_mod.model_selection.DEFAULT_MODEL_METADATA_MAP.get(model_id)
        thinking_level = meta.thinking_level if meta is not None else None
        if thinking_level is None and isinstance(model_id, str):
            lower_id = model_id.lower()
            if lower_id.startswith("gemini") and not lower_id.startswith(("gemini-1.", "gemini-2.")):
                if "-minimal" in lower_id:
                    thinking_level = sdk_types.ThinkingLevel.MINIMAL
                elif "-low" in lower_id:
                    thinking_level = sdk_types.ThinkingLevel.LOW
                elif "-medium" in lower_id:
                    thinking_level = sdk_types.ThinkingLevel.MEDIUM
                else:
                    thinking_level = sdk_types.ThinkingLevel.HIGH
        if thinking_level is not None and isinstance(endpoint, (sdk_types.GeminiAPIEndpoint, sdk_types.VertexEndpoint)):
            options_cls = getattr(sdk_types, "GeminiModelOptions", None) or getattr(sdk_types, "GeminiOptions", None)
            endpoint_options = (
                endpoint.options.model_copy(update={"thinking_level": thinking_level})
                if endpoint.options is not None
                else options_cls(thinking_level=thinking_level)
            )
            endpoint = endpoint.model_copy(update={"options": endpoint_options})
        return orig_build_literal_model_target(self, model_id, endpoint)

    def _resolve_effective_mode_id(self, session_id):
        sessions = getattr(self, "_sessions", {})
        if session_id in sessions:
            return sessions[session_id].mode_id
        pending = getattr(self, "_pending_mode_by_session_id", {}).get(session_id)
        if isinstance(pending, str) and pending:
            return pending
        ctx_mode = _PENDING_NEW_MODE_VAR.get()
        if isinstance(ctx_mode, str) and ctx_mode:
            return ctx_mode
        try:
            meta = server_mod.session_store.read_sidecar_metadata(session_id)
            if isinstance(meta, dict) and isinstance(meta.get("mode_id"), str) and meta["mode_id"]:
                return meta["mode_id"]
        except Exception:
            pass
        return "default"

    async def _patched_new_session(self, cwd, additional_directories=None, mcp_servers=None, **kwargs):
        req_mode = _extract_requested_mode_id(kwargs)
        valid_ids = {m.id for m in config_options.AVAILABLE_SESSION_MODES}
        effective_req_mode = req_mode if req_mode in valid_ids else ""
        token = _PENDING_NEW_MODE_VAR.set(effective_req_mode)
        try:
            resp = await orig_new_session(self, cwd=cwd, additional_directories=additional_directories, mcp_servers=mcp_servers, **kwargs)
        finally:
            _PENDING_NEW_MODE_VAR.reset(token)
        if effective_req_mode and resp and getattr(resp, "session_id", None) in self._sessions:
            sid = resp.session_id
            session_info = self._sessions[sid]
            if session_info.mode_id != effective_req_mode:
                session_info.mode_id = effective_req_mode
                try:
                    server_mod.session_store.write_sidecar_metadata(sid, {"mode_id": effective_req_mode})
                except Exception:
                    pass
                selection = self._selection_state(session_info)
                resp = schema.NewSessionResponse(
                    session_id=sid, config_options=selection.config_options, models=selection.models,
                    modes=selection.modes, field_meta=self._tier_metadata(),
                )
        return resp

    async def _patched_restore_session(self, *, session_id, cwd, mcp_servers=None, **kwargs):
        req_mode = _extract_requested_mode_id(kwargs)
        valid_ids = {m.id for m in config_options.AVAILABLE_SESSION_MODES}
        effective_req_mode = req_mode if req_mode in valid_ids else None
        if effective_req_mode:
            self._pending_mode_by_session_id[session_id] = effective_req_mode
        try:
            result = await orig_restore_session(self, session_id=session_id, cwd=cwd, mcp_servers=mcp_servers, **kwargs)
        finally:
            self._pending_mode_by_session_id.pop(session_id, None)
        if effective_req_mode and session_id in self._sessions:
            session_info = self._sessions[session_id]
            if session_info.mode_id != effective_req_mode:
                session_info.mode_id = effective_req_mode
                try:
                    server_mod.session_store.write_sidecar_metadata(session_id, {"mode_id": effective_req_mode})
                except Exception:
                    pass
        return result

    async def _patched_create_agent_config(self, *, cwd, session_id, **kwargs):
        config, teardown_callback = await orig_create_agent_config(self, cwd=cwd, session_id=session_id, **kwargs)
        mode_id = _resolve_effective_mode_id(self, session_id)
        if not hasattr(self, "_agent_mode_by_session_id"):
            self._agent_mode_by_session_id = {}
        self._agent_mode_by_session_id[session_id] = mode_id
        if mode_id == _AUTO_MODE_ID:
            policy_mod, sdk_types, terminal_sandbox_mod = server_mod.policy, server_mod.sdk_types_module, server_mod.terminal_sandbox
            read_url_tool = sdk_types.BuiltinTools.READ_URL_CONTENT.value
            session_id_holder = [session_id]

            async def auto_handler(tool_call, reason=""):
                return await self._permission_handler(session_id_holder[0], tool_call, _auto_flagged=True, _auto_reason=reason)

            filtered_policies = [
                p for p in list(config.policies or [])
                if getattr(p, "tool", None) != read_url_tool or getattr(p, "name", None) in ("outside_workspace_deny", "outside_workspace_ask")
            ]
            config.policies = [policy_mod.allow("safe_view_file"), policy_mod.auto(handler=auto_handler)] + filtered_policies
            sandbox_fn = getattr(terminal_sandbox_mod, "os_sandbox_supported", None) or getattr(terminal_sandbox_mod, "is_available", None)
            if callable(sandbox_fn) and sandbox_fn() and config.capabilities is not None:
                config.capabilities = config.capabilities.model_copy(
                    update={"run_command_config": sdk_types.RunCommandConfig(enable_sandbox=True)}
                )
        return config, teardown_callback

    async def _patched_maybe_apply_model_switch(self, session_id):
        await orig_maybe_apply_model_switch(self, session_id)
        session_info = self._sessions.get(session_id)
        if session_info is None:
            return
        built_mode = getattr(self, "_agent_mode_by_session_id", {}).get(session_id, "default")
        if (built_mode == _AUTO_MODE_ID) != (session_info.mode_id == _AUTO_MODE_ID):
            await self._rebuild_session_agent(session_id)
            session_info = self._sessions.get(session_id)
            if session_info is not None:
                session_info.admin_controls_snapshot = self._admin_controls_snapshot()

    async def _announce_tool_call_pending_and_in_progress(self, session_id, tool_call):
        if self._client is None:
            return
        tool_name = server_mod._tool_call_name(tool_call)
        session_info = self._sessions.get(session_id)
        file_roots = self._session_workspace_roots(session_info)
        target_paths = server_mod._tool_call_target_paths(tool_call)
        if session_info is not None and server_mod._is_internal_mcp_schema_read(tool_name, target_paths, session_info):
            return
        tool_call_id = tool_call.id or server_mod.uuid.uuid4().hex
        tool_call.id = tool_call_id
        server_name = getattr(tool_call, "server_name", None)
        try:
            mcp_display_name, presented_input, mcp_meta = server_mod._unwrap_mcp_tool_call(tool_name, tool_call.args, server_name=server_name)
        except TypeError:
            mcp_display_name, presented_input, mcp_meta = server_mod._unwrap_mcp_tool_call(tool_name, tool_call.args)
        if hasattr(server_mod, "_extract_tool_display_title"):
            display_title = mcp_display_name or server_mod._extract_tool_display_title(tool_name, tool_call.args, server_name=server_name)
            tool_kind = server_mod._infer_tool_kind(tool_name, tool_call.args, server_name=server_name)
            tool_locations = server_mod._extract_tool_locations(tool_name, tool_call.args, server_name=server_name)
            tool_content = server_mod._extract_tool_content(tool_name, tool_call.args, server_name=server_name)
            prompt_title = display_title if (tool_kind == "execute" or mcp_meta is not None) else f"Run {display_title}?"
            live_title = display_title if (tool_kind == "execute" or mcp_meta is not None) else f"Running {display_title}"
        else:
            display_title = mcp_display_name or server_mod._DISPLAY_TITLE_BY_TOOL_NAME.get(tool_name) or tool_name
            tool_kind = "execute" if mcp_display_name else server_mod._tool_kind_for_name(tool_name)
            tool_locations = [] if mcp_display_name else server_mod._tool_locations(tool_name, tool_call.args, file_roots)
            tool_content = [] if mcp_display_name else server_mod._tool_preview_content(tool_name, tool_call.args, file_roots)
            outside_workspace = False if mcp_display_name else server_mod._call_accesses_outside_workspace(tool_call, file_roots)
            prompt_title = server_mod._permission_prompt_title(tool_name, display_title, tool_call.args, outside_workspace=outside_workspace)
            live_title = mcp_display_name or server_mod._live_tool_title(tool_name, tool_call.args, file_roots)
        await self._client.session_update(
            session_id=session_id,
            update=schema.ToolCallStart(
                session_update="tool_call", tool_call_id=tool_call_id, title=prompt_title, kind=tool_kind,
                content=tool_content, locations=tool_locations, raw_input=presented_input, status="pending", field_meta=mcp_meta,
            ),
        )
        if session_info is not None:
            reconcile_key = tool_name
            mcp_info = mcp_meta.get("mcp") if isinstance(mcp_meta, dict) else None
            if isinstance(mcp_info, dict) and "tool" in mcp_info:
                reconcile_key = mcp_info["tool"]
            session_info.pending_permission_frames.setdefault(reconcile_key, []).append(tool_call_id)
            if mcp_display_name is not None or mcp_meta is not None:
                session_info.mcp_frames[tool_call_id] = (mcp_display_name or prompt_title, presented_input, mcp_meta)
        self._tool_opened_at[tool_call_id] = server_mod.time.monotonic()
        await self._client.session_update(
            session_id=session_id,
            update=schema.ToolCallProgress(
                session_update="tool_call_update", tool_call_id=tool_call_id, title=live_title, kind=tool_kind,
                content=tool_content, locations=tool_locations, raw_input=presented_input, status="in_progress", field_meta=mcp_meta,
            ),
        )

    async def _patched_permission_handler(self, session_id, tool_call, _auto_flagged=False, _auto_reason=""):
        _wrap_client_for_auto_reason(self._client)
        session_info = self._sessions.get(session_id)
        tool_name = server_mod._tool_call_name(tool_call)
        if not _auto_flagged and session_info is not None and session_info.mode_id == _AUTO_MODE_ID:
            file_roots = self._session_workspace_roots(session_info)
            outside_workspace = server_mod._call_accesses_outside_workspace(tool_call, file_roots)
            always_ask_file = self._admin_file_access_always_ask() and outside_workspace
            exec_requires_review = tool_name in server_mod._EXEC_TOOLS and self._admin_terminal_requires_review()
            if not outside_workspace and not always_ask_file and not exec_requires_review and tool_name in server_mod._AUTO_EDIT_TOOLS:
                await _announce_tool_call_pending_and_in_progress(self, session_id, tool_call)
                return True
        prev_pending_len = sum(len(q) for q in session_info.pending_permission_frames.values()) if session_info is not None else 0
        token = _AUTO_REASON_VAR.set(_auto_reason if isinstance(_auto_reason, str) else "")
        try:
            allowed = await orig_permission_handler(self, session_id, tool_call)
        finally:
            _AUTO_REASON_VAR.reset(token)
        if allowed:
            after_pending_len = sum(len(q) for q in session_info.pending_permission_frames.values()) if session_info is not None else 0
            if after_pending_len == prev_pending_len:
                await _announce_tool_call_pending_and_in_progress(self, session_id, tool_call)
            elif self._client is not None and getattr(tool_call, "id", None):
                self._tool_opened_at[tool_call.id] = server_mod.time.monotonic()
                await self._client.session_update(
                    session_id=session_id,
                    update=schema.ToolCallProgress(session_update="tool_call_update", tool_call_id=tool_call.id, status="in_progress"),
                )
        return allowed

    async def _patched_stream_live_step(self, session_id, step, open_tool_calls, hidden_tool_calls=None):
        sdk_types = server_mod.sdk_types_module
        if self._client is not None and step.source == sdk_types.StepSource.MODEL and step.status != sdk_types.StepStatus.ERROR and not step.parent_trajectory_id:
            emitted_map = self._emitted_thinking_by_session.setdefault(session_id, {})
            step_key = getattr(step, "id", None) or step.step_index
            prev_len = emitted_map.get(step_key, 0)
            thinking_delta = getattr(step, "thinking_delta", None) or ""
            full_thinking = getattr(step, "thinking", None) or ""
            chunk_to_emit = ""
            if thinking_delta:
                chunk_to_emit = thinking_delta
                emitted_map[step_key] = prev_len + len(thinking_delta)
                step = step.model_copy(update={"thinking_delta": ""})
            elif full_thinking and len(full_thinking) > prev_len:
                chunk_to_emit = full_thinking[prev_len:]
                emitted_map[step_key] = len(full_thinking)
            if chunk_to_emit:
                await self._client.session_update(
                    session_id=session_id,
                    update=schema.AgentThoughtChunk(
                        session_update="agent_thought_chunk",
                        content=schema.TextContentBlock(type="text", text=chunk_to_emit),
                    ),
                )
        if step.type == sdk_types.StepType.TOOL_CALL and step.status in server_mod._TERMINAL_STEP_STATUSES and not step.tool_calls and open_tool_calls:
            for tc_id, tc_name in open_tool_calls.items():
                if tc_name in ("view_file", "safe_view_file", "client_view_file", "client_create_file", "client_edit_file"):
                    step = step.model_copy(update={"tool_calls": [sdk_types.ToolCall(id=tc_id, name=tc_name, args={})]})
                    break
        if step.type == sdk_types.StepType.TOOL_CALL and step.status in server_mod._TERMINAL_STEP_STATUSES and step.tool_calls:
            await orig_stream_live_step(self, session_id, step.model_copy(update={"status": sdk_types.StepStatus.ACTIVE}), open_tool_calls, hidden_tool_calls)
            now = server_mod.time.monotonic()
            min_wait = 0.0
            for call in step.tool_calls:
                call_name = server_mod._tool_call_name(call)
                for fid, fname in open_tool_calls.items():
                    if fname == call_name:
                        elapsed = now - self._tool_opened_at.setdefault(fid, now)
                        if elapsed < 0.045 and (0.045 - elapsed) > min_wait:
                            min_wait = 0.045 - elapsed
            if min_wait > 0:
                await server_mod.asyncio.sleep(min_wait)
        return await orig_stream_live_step(self, session_id, step, open_tool_calls, hidden_tool_calls)

    async def _patched_prompt(self, prompt, session_id, message_id=None, **kwargs):
        if not hasattr(self, "_turn_start_usage_by_session"):
            self._turn_start_usage_by_session = {}
        session_info = self._sessions.get(session_id)
        if session_info is not None:
            current_before = self._read_current_usage(session_id, session_info) or session_info.last_observed_usage
            self._turn_start_usage_by_session[session_id] = current_before.model_copy() if current_before is not None else None
        try:
            return await orig_prompt(self, prompt, session_id, message_id=message_id, **kwargs)
        finally:
            self._turn_start_usage_by_session.pop(session_id, None)

    async def _patched_maybe_send_usage_update(self, session_id):
        session_info = self._sessions.get(session_id)
        prev_observed = session_info.last_observed_usage if session_info is not None else None
        await orig_maybe_send_usage_update(self, session_id)
        session_info = self._sessions.get(session_id)
        if session_info is not None and session_info.last_observed_usage == prev_observed:
            async def _delayed_usage_poll():
                for delay in (0.04, 0.12):
                    await server_mod.asyncio.sleep(delay)
                    info = self._sessions.get(session_id)
                    if info is None or info.last_observed_usage != prev_observed:
                        return
                    await orig_maybe_send_usage_update(self, session_id)
                    info = self._sessions.get(session_id)
                    if info is not None and info.last_observed_usage != prev_observed:
                        return
            try:
                self._schedule_session_task(session_id, _delayed_usage_poll())
            except Exception:
                pass

    async def _patched_send_usage_update(self, session_id, *, used=None, model_id=None, defer=False):
        if defer:
            await server_mod.asyncio.sleep(0)
        session_info = self._sessions.get(session_id)
        if session_info is None or self._client is None:
            return
        effective_used = session_info.last_reported_used if used is None else used
        if effective_used is None:
            return
        try:
            effective_model_id = model_id or getattr(session_info, "agent_model_id", None) or getattr(session_info, "current_model_id", None)
            context_window_size = server_mod.model_selection.get_context_window_size(effective_model_id) or 1048576
            turn_usage = self._extract_turn_usage(session_id, getattr(self, "_turn_start_usage_by_session", {}).get(session_id))
            turn_meta = {"contextTokens": int(effective_used), "contextWindow": int(context_window_size), "model": str(effective_model_id or "")}
            if turn_usage is not None:
                in_tok = int(getattr(turn_usage, "input_tokens", 0) or 0)
                out_tok = int(getattr(turn_usage, "output_tokens", 0) or 0)
                thought_tok = int(getattr(turn_usage, "thought_tokens", 0) or 0)
                cache_tok = int(getattr(turn_usage, "cached_read_tokens", 0) or 0)
                uncached_in = max(0, in_tok - cache_tok) if (cache_tok > 0 and in_tok >= cache_tok) else in_tok
                turn_meta.update({"inputTokens": uncached_in, "outputTokens": out_tok + thought_tok, "cacheReadTokens": cache_tok, "thoughtsTokens": thought_tok})
            await self._client.session_update(
                session_id=session_id,
                update=schema.UsageUpdate(session_update="usage_update", used=effective_used, size=context_window_size, field_meta={"antigravityTurnUsage": turn_meta}),
            )
        except Exception:
            server_mod.logging.exception("Failed to send usage update for session %s", session_id)

    async def _patched_send_available_commands_update(self, session_id):
        if not self._client:
            return
        await server_mod.asyncio.sleep(0.08)
        if not self._client:
            return
        sdk_types = server_mod.sdk_types_module
        commands = [
            schema.AvailableCommand(name=cmd.value, description=server_mod._DESCRIPTION_BY_COMMAND.get(cmd, f"Execute the built-in /{cmd.value} command."))
            for cmd in sdk_types.BuiltinSlashCommandName.__members__.values()
        ]
        commands.extend([server_mod.logout.available_command(), server_mod.usage_lib.available_command()])
        seen_names = {c.name for c in commands}
        session_info = self._sessions.get(session_id)
        cwd = getattr(session_info, "cwd", None) if session_info is not None else None
        add_dirs = getattr(session_info, "additional_directories", None) if session_info is not None else None
        for skills_root in server_mod.resolve_skills_paths(cwd, add_dirs):
            if not os.path.isdir(skills_root):
                continue
            try:
                entries = sorted(os.listdir(skills_root))
            except Exception:
                continue
            for entry in entries:
                if entry.startswith("."):
                    continue
                skill_md = os.path.join(skills_root, entry, "SKILL.md")
                if not os.path.isfile(skill_md):
                    continue
                try:
                    with open(skill_md, "r", encoding="utf-8") as fh:
                        parsed = _parse_skill_frontmatter_py(fh.read(), entry)
                except Exception:
                    continue
                if not parsed or not parsed[0] or parsed[0] in seen_names:
                    continue
                seen_names.add(parsed[0])
                commands.append(schema.AvailableCommand(name=parsed[0], description=parsed[1], field_meta={"path": skill_md, "isSkill": True}))
        try:
            await self._client.session_update(
                session_id=session_id,
                update=schema.AvailableCommandsUpdate(session_update="available_commands_update", available_commands=commands),
            )
        except Exception:
            pass

    async def _patched_ext_method(self, method, params):
        if method in ("x.ai/interject", "_x.ai/interject"):
            return await _handle_antigravity_interject(self, server_mod, params)
        if orig_ext_method is not None:
            return await orig_ext_method(self, method, params)
        raise RuntimeError(f"Unsupported ext_method: {method}")

    async def _patched_cleanup(self, session_id=None):
        await orig_cleanup(self, session_id)
        for attr in ("_agent_mode_by_session_id", "_pending_mode_by_session_id", "_emitted_thinking_by_session", "_turn_start_usage_by_session"):
            m = getattr(self, attr, None)
            if isinstance(m, dict):
                m.pop(session_id, None) if session_id is not None else m.clear()
        if session_id is None and isinstance(getattr(self, "_tool_opened_at", None), dict):
            self._tool_opened_at.clear()

    AgyAdapter.__init__ = _patched_init
    AgyAdapter.on_connect = _patched_on_connect
    AgyAdapter.new_session = _patched_new_session
    AgyAdapter._restore_session = _patched_restore_session
    AgyAdapter._create_agent_config = _patched_create_agent_config
    AgyAdapter._build_literal_model_target = _patched_build_literal_model_target
    AgyAdapter._maybe_apply_model_switch = _patched_maybe_apply_model_switch
    AgyAdapter._permission_handler = _patched_permission_handler
    AgyAdapter._stream_live_step = _patched_stream_live_step
    AgyAdapter.prompt = _patched_prompt
    AgyAdapter._maybe_send_usage_update = _patched_maybe_send_usage_update
    AgyAdapter._send_usage_update = _patched_send_usage_update
    AgyAdapter._send_available_commands_update = _patched_send_available_commands_update
    AgyAdapter.ext_method = _patched_ext_method
    AgyAdapter.cleanup = _patched_cleanup
`

export const ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE = `${ANTIGRAVITY_SITE_CUSTOMIZE_PREAMBLE}\n${ANTIGRAVITY_SITE_CUSTOMIZE_PATCH}\n${ANTIGRAVITY_SITE_CUSTOMIZE_LOADER}`
