-- Add only the explicitly reviewed Groq provider identity. Existing rows,
-- quotas, table privileges and wallet/execution authority are unchanged.
ALTER TABLE broker_v2_model_registry
  DROP CONSTRAINT broker_v2_model_registry_provider_check;
ALTER TABLE broker_v2_model_registry
  ADD CONSTRAINT broker_v2_model_registry_provider_check
  CHECK (provider IN ('GEMINI', 'OPENAI', 'ANTHROPIC', 'XAI', 'BANKR', 'GROQ'));

ALTER TABLE broker_v2_provider_usage
  DROP CONSTRAINT broker_v2_provider_usage_provider_check;
ALTER TABLE broker_v2_provider_usage
  ADD CONSTRAINT broker_v2_provider_usage_provider_check
  CHECK (provider IN ('GEMINI', 'OPENAI', 'ANTHROPIC', 'XAI', 'BANKR', 'GROQ'));
