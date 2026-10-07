import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidFeatureBranchName } from '../src/domain/branchName.js';

test('accepts feature branches using the project_change convention', () => {
  assert.equal(isValidFeatureBranchName('feature/codingportfolioai_agentic-studio-workflow'), true);
  assert.equal(isValidFeatureBranchName('feature/api_v2-auth'), true);
});

test('rejects branches that do not use the feature project_change convention', () => {
  for (const name of ['main', 'development', 'codex/project-room', 'feature/change', 'feature/codingportfolioai_']) {
    assert.equal(isValidFeatureBranchName(name), false, name);
  }
});
