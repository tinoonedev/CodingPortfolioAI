const activityActions = Object.freeze({
  'client_project.created': { category: 'project', label: 'Client project created' },
  'client_project.brief_updated': { category: 'project', label: 'Approved brief updated' },
  'client_project.requirements_saved': { category: 'requirements', label: 'Gherkin requirements saved' },
  'jira.authorization_started': { category: 'jira', label: 'Jira authorization started' },
  'jira.authorization_received': { category: 'jira', label: 'Jira authorization received' },
  'jira.project_connected': { category: 'jira', label: 'Jira project connected' },
  'jira.connection_disconnected': { category: 'jira', label: 'Jira project disconnected' },
  'openai.project_configuration_saved': { category: 'agent-settings', label: 'Agent provider settings saved' },
});

export function mapProjectActivityEvent(row) {
  const action = activityActions[row?.action];
  if (!action || row?.id == null || !row?.created_at) return null;
  return {
    id: String(row.id),
    category: action.category,
    label: action.label,
    actorDisplayName: typeof row.display_name === 'string' && row.display_name.trim() ? row.display_name : 'Workspace member',
    occurredAt: row.created_at,
  };
}

export function mapProjectAgentRun(row) {
  const roles = new Set(['product-manager', 'business-analyst', 'project-manager', 'qa-analyst']);
  const statuses = new Set(['running', 'completed', 'failed', 'unknown']);
  if (!row?.id || !roles.has(row.role) || !statuses.has(row.status) || !row.started_at) return null;
  return {
    id: row.id,
    role: row.role,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
