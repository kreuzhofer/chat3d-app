-- Drop non-agent mode: agent is now the only codegen pipeline.
-- Remove the agent_mode_enabled toggle settings (no longer needed).
DELETE FROM "generation_settings_overrides"
WHERE "key" IN ('chat.agent_mode_enabled', 'workbench.agent_mode_enabled');

-- Remove legacy codegen purpose mappings (replaced by agent_codegen).
DELETE FROM "llm_purpose_map"
WHERE "purpose" IN ('chat_codegen', 'workbench_codegen');
