import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkPlanDigest,
  createWorkPlanTaskIdempotencyKey,
  orderWorkPlanTasks,
  resolveJiraAssignee,
  validateJiraWorkPlan,
} from '../src/domain/jiraWorkPlan.js';

const revision = {
  id: 'requirements-rev-4',
  scenarios: [{ id: 'scenario-login' }, { id: 'scenario-error' }],
};
const plan = {
  requirementRevisionId: revision.id,
  tasks: [
    { id: 'frontend', title: 'Build sign-in screen', ownerRole: 'frontend-developer', scenarioIds: ['scenario-login'], dependsOn: ['api'] },
    { id: 'api', title: 'Add account endpoint', ownerRole: 'backend-developer', scenarioIds: ['scenario-login', 'scenario-error'], dependsOn: [] },
  ],
};

test('validates scenario coverage, role ownership, and in-plan dependencies', () => {
  assert.deepEqual(validateJiraWorkPlan(plan, revision), { valid: true, issues: [] });
});

test('rejects unmapped scenarios, unknown dependencies, and cycles', () => {
  const invalid = structuredClone(plan);
  invalid.tasks[0].scenarioIds = [];
  invalid.tasks[1].scenarioIds = ['scenario-login'];
  invalid.tasks[0].dependsOn = ['missing'];
  invalid.tasks[1].dependsOn = ['frontend'];
  const result = validateJiraWorkPlan(invalid, revision);
  assert.ok(result.issues.some(({ code }) => code === 'TASK_SCENARIOS_REQUIRED'));
  assert.ok(result.issues.some(({ code }) => code === 'UNKNOWN_DEPENDENCY'));
  assert.ok(result.issues.some(({ code }) => code === 'DEPENDENCY_CYCLE'));
  assert.ok(result.issues.some(({ code }) => code === 'UNMAPPED_SCENARIO'));
});

test('rejects changed or unbound requirement revisions', () => {
  const result = validateJiraWorkPlan({ ...plan, requirementRevisionId: 'requirements-rev-3' }, revision);
  assert.ok(result.issues.some(({ code }) => code === 'REQUIREMENT_REVISION_MISMATCH'));
});

test('rejects unrecognized plan and task fields instead of echoing arbitrary input', () => {
  const invalid = {
    ...plan,
    credential: 'must-not-be-accepted',
    tasks: [{ ...plan.tasks[0], internalToken: 'must-not-be-accepted' }, plan.tasks[1]],
  };
  const result = validateJiraWorkPlan(invalid, revision);
  assert.ok(result.issues.some(({ code }) => code === 'UNSUPPORTED_PLAN_FIELD'));
  assert.ok(result.issues.some(({ code }) => code === 'UNSUPPORTED_TASK_FIELD'));
  assert.ok(result.issues.every(({ message }) => !message.includes('must-not-be-accepted')));
});

test('orders dependencies before dependents deterministically', () => {
  assert.deepEqual(orderWorkPlanTasks(plan.tasks).map(({ id }) => id), ['api', 'frontend']);
});

test('binds plan digests to both immutable source revisions and exact Gherkin content', () => {
  const bindings = { briefRevisionId: 'brief-2', requirementRevisionId: revision.id, requirementContent: 'Feature: Account access' };
  const original = createWorkPlanDigest(plan, bindings);
  assert.equal(createWorkPlanDigest(structuredClone(plan), bindings), original);
  assert.notEqual(createWorkPlanDigest(plan, { ...bindings, briefRevisionId: 'brief-3' }), original);
  assert.notEqual(createWorkPlanDigest(plan, { ...bindings, requirementContent: 'Feature: Account access\n' }), original);
  assert.notEqual(createWorkPlanDigest({ ...plan, tasks: [...plan.tasks].reverse() }, bindings), original);
});

test('creates stable task idempotency keys bound to a digest and task ID', () => {
  const digest = 'a'.repeat(64);
  assert.equal(createWorkPlanTaskIdempotencyKey(digest, 'frontend'), createWorkPlanTaskIdempotencyKey(digest, 'frontend'));
  assert.notEqual(createWorkPlanTaskIdempotencyKey(digest, 'frontend'), createWorkPlanTaskIdempotencyKey(digest, 'api'));
  assert.throws(() => createWorkPlanTaskIdempotencyKey('invalid', 'frontend'), /SHA-256/);
  assert.throws(() => createWorkPlanTaskIdempotencyKey(digest, ' '), /stable task ID/);
});

test('maps Jira accounts explicitly and preserves the role when no account is configured', () => {
  assert.equal(resolveJiraAssignee('qa-analyst', {}), null);
  assert.equal(resolveJiraAssignee('qa-analyst', { 'qa-analyst': ' account-123 ' }), 'account-123');
});
