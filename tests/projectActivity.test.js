import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapProjectActivityEvent, mapProjectAgentRun } from '../src/domain/projectActivity.js';

test('project activity exposes only allowlisted action labels and safe actor/time fields', () => {
  const event = mapProjectActivityEvent({
    id: 42,
    action: 'client_project.requirements_saved',
    display_name: 'Workspace Owner',
    created_at: new Date('2026-10-08T12:00:00.000Z'),
    actor_subject: 'private-subject',
    email: 'owner@example.test',
    metadata: { credential: 'must-not-leak' },
  });

  assert.deepEqual(event, {
    id: '42',
    category: 'requirements',
    label: 'Gherkin requirements saved',
    actorDisplayName: 'Workspace Owner',
    occurredAt: new Date('2026-10-08T12:00:00.000Z'),
  });
  assert.equal(JSON.stringify(event).includes('private-subject'), false);
  assert.equal(JSON.stringify(event).includes('owner@example.test'), false);
  assert.equal(JSON.stringify(event).includes('must-not-leak'), false);
});

test('unknown and incomplete project audit rows are omitted', () => {
  assert.equal(mapProjectActivityEvent({ id: 1, action: 'workspace.sign_in', created_at: new Date() }), null);
  assert.equal(mapProjectActivityEvent({ id: 1, action: 'client_project.created' }), null);
});

test('agent run summary accepts only persisted supported roles and statuses', () => {
  const run = mapProjectAgentRun({
    id: 'run-1', role: 'qa-analyst', status: 'failed', started_at: new Date('2026-10-08T12:00:00.000Z'),
    finished_at: new Date('2026-10-08T12:00:05.000Z'), artifact: 'private result',
  });
  assert.deepEqual(run, {
    id: 'run-1', role: 'qa-analyst', status: 'failed',
    startedAt: new Date('2026-10-08T12:00:00.000Z'), finishedAt: new Date('2026-10-08T12:00:05.000Z'),
  });
  assert.equal(JSON.stringify(run).includes('private result'), false);
  assert.equal(mapProjectAgentRun({ id: 'run-2', role: 'customer', status: 'running', started_at: new Date() }), null);
});
