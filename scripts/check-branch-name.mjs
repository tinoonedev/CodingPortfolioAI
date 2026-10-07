import { execFileSync } from 'node:child_process';

const branchName = process.env.GITHUB_HEAD_REF || process.env.BRANCH_NAME || execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
const branchPattern = /^feature\/[a-z0-9-]+_[a-z0-9]+(?:-[a-z0-9]+)*$/;

if (!branchPattern.test(branchName)) {
  console.error(`Invalid branch name: ${branchName || '(detached HEAD)'}`);
  console.error('Use feature/<project>_<change>, for example feature/codingportfolioai_agentic-studio-workflow.');
  process.exit(1);
}

console.log(`Branch name is valid: ${branchName}`);
