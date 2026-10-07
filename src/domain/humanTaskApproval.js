const approvalPattern = /^AI-TASK-APPROVED:\s+([A-Z][A-Z0-9]+-\d+)@([a-zA-Z0-9._-]+)$/;

/**
 * Validate a Jira comment against one exact task revision and an authorized human.
 * The caller must fetch the comment from Jira; this function does not establish trust in its input.
 */
export function validateHumanTaskApproval({ comment, issueKey, taskRevision, proposedAt, authorizedAccountIds }) {
  if (!comment || !issueKey || !taskRevision || !proposedAt || !Array.isArray(authorizedAccountIds)) {
    return { approved: false, reason: 'missing-verification-context' };
  }

  if (comment.issueKey !== issueKey) {
    return { approved: false, reason: 'wrong-issue' };
  }

  if (!authorizedAccountIds.includes(comment.authorAccountId)) {
    return { approved: false, reason: 'unauthorized-author' };
  }

  const proposedAtMs = Date.parse(proposedAt);
  const commentCreatedAtMs = Date.parse(comment.createdAt);
  if (!Number.isFinite(proposedAtMs) || !Number.isFinite(commentCreatedAtMs) || commentCreatedAtMs < proposedAtMs) {
    return { approved: false, reason: 'stale-or-unverifiable-comment' };
  }

  const match = approvalPattern.exec(comment.body?.trim() || '');
  if (!match || match[1] !== issueKey || match[2] !== String(taskRevision)) {
    return { approved: false, reason: 'approval-does-not-match-task-revision' };
  }

  return { approved: true, reason: 'approved' };
}
