const SECRET_FIELD = /(secret|token|key|credential|ciphertext)/i;

export function openAiReadiness({ configured = false, executionEnabled = false, missing = [], invalid = [], projectId }) {
  const safeMissing = missing.filter((name) => typeof name === 'string' && !SECRET_FIELD.test(name));
  const safeInvalid = invalid.filter((name) => typeof name === 'string' && !SECRET_FIELD.test(name));
  const configurationReady = configured && safeMissing.length === 0 && safeInvalid.length === 0;
  const ready = configurationReady && executionEnabled;

  return {
    provider: 'openai',
    projectId,
    status: ready ? 'ready' : configurationReady ? 'execution_unavailable' : 'not_configured',
    configured: configurationReady,
    missing: safeMissing,
    invalid: safeInvalid,
    canStartRun: ready,
  };
}

export function validateAgentTaskInput(input, { maxInputBytes } = {}) {
  const roles = new Set(['product-manager', 'business-analyst', 'project-manager', 'qa-analyst']);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, error: 'A named agent role and task input are required.' };
  }
  if (!roles.has(input.role)) {
    return { valid: false, error: 'This agent role is not enabled for provider execution.' };
  }
  if (typeof input.artifact !== 'string' || !input.artifact.trim() || input.artifact.length > 60000) {
    return { valid: false, error: 'Provide a non-empty task input of at most 60000 characters.' };
  }
  const artifact = input.artifact.trim();
  if (maxInputBytes !== undefined && (!Number.isInteger(maxInputBytes) || maxInputBytes < 1 || new TextEncoder().encode(artifact).byteLength > maxInputBytes)) {
    return { valid: false, code: 'AGENT_INPUT_TOO_LARGE', error: 'Task input exceeds this project’s configured byte limit.' };
  }
  return { valid: true, task: { role: input.role, artifact } };
}
