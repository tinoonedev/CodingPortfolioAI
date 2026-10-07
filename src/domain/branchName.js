export function isValidFeatureBranchName(branchName) {
  return typeof branchName === 'string'
    && /^feature\/[a-z0-9-]+_[a-z0-9]+(?:-[a-z0-9]+)*$/.test(branchName);
}
