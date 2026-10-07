import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHumanTaskApproval } from '../src/domain/humanTaskApproval.js';

const context = {
  issueKey: 'SCRUM-12',
  taskRevision: 'brief-v3',
  proposedAt: '2026-10-07T10:00:00.000Z',
  authorizedAccountIds: ['human-account-1'],
};
const comment = {
  issueKey: 'SCRUM-12',
  authorAccountId: 'human-account-1',
  createdAt: '2026-10-07T10:01:00.000Z',
  body: 'AI-TASK-APPROVED: SCRUM-12@brief-v3',
};

test('accepts an authorized Jira comment for the exact issue and task revision', () => {
  assert.deepEqual(validateHumanTaskApproval({ ...context, comment }), { approved: true, reason: 'approved' });
});

test('rejects a comment from an unauthorized or missing author', () => {
  const result = validateHumanTaskApproval({ ...context, comment: { ...comment, authorAccountId: 'agent-account' } });
  assert.equal(result.reason, 'unauthorized-author');
});

test('rejects approval for a different issue or task revision', () => {
  assert.equal(validateHumanTaskApproval({ ...context, comment: { ...comment, issueKey: 'SCRUM-13' } }).reason, 'wrong-issue');
  assert.equal(validateHumanTaskApproval({ ...context, comment: { ...comment, body: 'AI-TASK-APPROVED: SCRUM-12@brief-v2' } }).reason, 'approval-does-not-match-task-revision');
});

test('rejects vague comments and missing verification context', () => {
  assert.equal(validateHumanTaskApproval({ ...context, comment: { ...comment, body: 'Looks good!' } }).approved, false);
  assert.equal(validateHumanTaskApproval({ comment, ...context, taskRevision: '' }).reason, 'missing-verification-context');
});

test('rejects approval comments posted before the task revision was proposed', () => {
  const result = validateHumanTaskApproval({ ...context, comment: { ...comment, createdAt: '2026-10-07T09:59:00.000Z' } });
  assert.equal(result.reason, 'stale-or-unverifiable-comment');
});
