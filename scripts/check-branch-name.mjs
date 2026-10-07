import { execFileSync } from 'node:child_process';
import { isValidFeatureBranchName } from '../src/domain/branchName.js';

const branchName = process.env.GITHUB_HEAD_REF || process.env.BRANCH_NAME || execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();

if (!isValidFeatureBranchName(branchName)) {
  console.error(`Invalid branch name: ${branchName || '(detached HEAD)'}`);
  console.error('Use feature/<project>_<change>, for example feature/codingportfolioai_agentic-studio-workflow.');
  process.exit(1);
}

console.log(`Branch name is valid: ${branchName}`);
