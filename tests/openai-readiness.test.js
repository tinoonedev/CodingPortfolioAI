import test from 'node:test';
import assert from 'node:assert/strict';
import { openAiReadiness, validateAgentTaskInput } from '../src/domain/openaiReadiness.js';

test('OpenAI readiness fails closed and does not expose sensitive setting names', () => {
  const readiness = openAiReadiness({
    configured: false,
    projectId: 'project-a',
    missing: ['OPENAI_API_KEY', 'OPENAI_MODEL_ALLOWLIST', 'OPENAI_PROJECT_BUDGET_USD'],
  });

  assert.equal(readiness.status, 'not_configured');
  assert.equal(readiness.canStartRun, false);
  assert.equal(readiness.projectId, 'project-a');
  assert.deepEqual(readiness.missing, ['OPENAI_MODEL_ALLOWLIST', 'OPENAI_PROJECT_BUDGET_USD']);
  assert.doesNotMatch(JSON.stringify(readiness), /OPENAI_API_KEY/);
});

test('OpenAI readiness never exposes an enabled state without an execution adapter', () => {
  const readiness = openAiReadiness({
    configured: true,
    projectId: 'project-a',
  });
  assert.equal(readiness.status, 'execution_unavailable');
  assert.equal(readiness.configured, true);
  assert.equal(readiness.canStartRun, false);
});

test('agent task inputs only allow current generation-only roles and bounded non-empty artifacts', () => {
  assert.deepEqual(validateAgentTaskInput({ role: 'qa-analyst', artifact: 'Feature: Check behavior' }), {
    valid: true,
    task: { role: 'qa-analyst', artifact: 'Feature: Check behavior' },
  });
  assert.equal(validateAgentTaskInput({ role: 'project-manager', artifact: 'Sequence the approved work plan' }).valid, true);
  assert.equal(validateAgentTaskInput({ role: 'delivery-engineer', artifact: 'deploy' }).valid, false);
  assert.equal(validateAgentTaskInput({ role: 'business-analyst', artifact: '  ' }).valid, false);
  assert.equal(validateAgentTaskInput({ role: 'product-manager', artifact: 'x'.repeat(60001) }).valid, false);
  assert.equal(validateAgentTaskInput({ role: 'qa-analyst', artifact: 'café' }, { maxInputBytes: 5 }).valid, true);
  assert.equal(validateAgentTaskInput({ role: 'qa-analyst', artifact: 'café' }, { maxInputBytes: 4 }).code, 'AGENT_INPUT_TOO_LARGE');
});
