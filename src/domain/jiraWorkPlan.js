import { createHash } from 'node:crypto';

export const WORK_PLAN_ROLES = Object.freeze([
  'business-analyst',
  'project-manager',
  'product-designer',
  'qa-analyst',
  'frontend-developer',
  'backend-developer',
  'integration-engineer',
  'security-engineer',
  'test-automation-engineer',
  'delivery-engineer',
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function problem(code, message, taskId) {
  return { code, message, ...(taskId ? { taskId } : {}) };
}

export function orderWorkPlanTasks(tasks = []) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const indegree = new Map(tasks.map((task) => [task.id, task.dependsOn.length]));
  const dependents = new Map(tasks.map((task) => [task.id, []]));
  for (const task of tasks) {
    for (const dependencyId of task.dependsOn) dependents.get(dependencyId)?.push(task.id);
  }

  const ready = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
  const ordered = [];
  while (ready.length) {
    const id = ready.shift();
    ordered.push(byId.get(id));
    for (const dependentId of dependents.get(id)) {
      const degree = indegree.get(dependentId) - 1;
      indegree.set(dependentId, degree);
      if (degree === 0) {
        ready.push(dependentId);
        ready.sort();
      }
    }
  }
  return ordered;
}

export function validateJiraWorkPlan(plan, requirementRevision) {
  const issues = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { valid: false, issues: [problem('PLAN_REQUIRED', 'Provide a work plan object.')] };
  }
  if (!requirementRevision || typeof requirementRevision.id !== 'string' || !requirementRevision.id) {
    issues.push(problem('REQUIREMENT_REVISION_REQUIRED', 'Bind the work plan to a saved requirement revision.'));
  }
  if (plan.requirementRevisionId !== requirementRevision?.id) {
    issues.push(problem('REQUIREMENT_REVISION_MISMATCH', 'The work plan must reference the supplied immutable requirement revision.'));
  }
  const allowedPlanFields = new Set(['requirementRevisionId', 'tasks']);
  for (const field of Object.keys(plan)) {
    if (!allowedPlanFields.has(field)) issues.push(problem('UNSUPPORTED_PLAN_FIELD', 'Work plan contains an unsupported field.'));
  }
  if (!Array.isArray(requirementRevision?.scenarios) || requirementRevision.scenarios.length === 0) {
    issues.push(problem('REQUIREMENT_SCENARIOS_REQUIRED', 'The source revision must contain parsed Gherkin scenarios.'));
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    issues.push(problem('WORK_PLAN_TASKS_REQUIRED', 'Add at least one independently deliverable Jira task.'));
    return { valid: false, issues };
  }

  const scenarioIds = new Set((requirementRevision?.scenarios || []).map((scenario) => scenario.id));
  const mappedScenarioIds = new Set();
  const taskIds = new Set();

  for (const task of plan.tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) {
      issues.push(problem('INVALID_TASK', 'Every work plan entry must be a task object.'));
      continue;
    }
    const taskId = typeof task.id === 'string' ? task.id.trim() : '';
    const safeTaskId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(taskId) ? taskId : undefined;
    const allowedTaskFields = new Set(['id', 'title', 'ownerRole', 'scenarioIds', 'dependsOn']);
    for (const field of Object.keys(task)) {
      if (!allowedTaskFields.has(field)) issues.push(problem('UNSUPPORTED_TASK_FIELD', 'A task contains an unsupported field.', safeTaskId));
    }
    if (!safeTaskId) {
      issues.push(problem('INVALID_TASK_ID', 'Use a stable task ID containing only letters, digits, dot, underscore, or hyphen.'));
    } else if (taskIds.has(taskId)) {
      issues.push(problem('DUPLICATE_TASK_ID', `Task ID “${taskId}” is repeated.`, taskId));
    } else {
      taskIds.add(taskId);
    }
    if (typeof task.title !== 'string' || !task.title.trim() || task.title.length > 255) {
      issues.push(problem('INVALID_TASK_TITLE', 'Each task needs a non-empty title of at most 255 characters.', safeTaskId));
    }
    if (!WORK_PLAN_ROLES.includes(task.ownerRole)) {
      issues.push(problem('INVALID_OWNER_ROLE', 'Choose an accountable Fieldwork role from the supported role list.', safeTaskId));
    }
    if (!Array.isArray(task.scenarioIds) || task.scenarioIds.length === 0) {
      issues.push(problem('TASK_SCENARIOS_REQUIRED', 'Map each task to at least one source Gherkin scenario ID.', safeTaskId));
    } else {
      if (new Set(task.scenarioIds).size !== task.scenarioIds.length) {
        issues.push(problem('DUPLICATE_SCENARIO', 'A task cannot repeat the same Gherkin scenario ID.', safeTaskId));
      }
      for (const id of task.scenarioIds) {
        if (typeof id !== 'string') issues.push(problem('INVALID_SCENARIO_ID', 'Scenario mappings must use string IDs from the bound Gherkin revision.', safeTaskId));
        else if (!scenarioIds.has(id)) issues.push(problem('UNKNOWN_SCENARIO', 'A task references a scenario outside the bound requirement revision.', safeTaskId));
        else mappedScenarioIds.add(id);
      }
    }
    if (!Array.isArray(task.dependsOn) || task.dependsOn.some((id) => typeof id !== 'string')) {
      issues.push(problem('INVALID_DEPENDENCIES', 'Dependencies must be a list of task IDs.', safeTaskId));
    } else {
      if (new Set(task.dependsOn).size !== task.dependsOn.length) {
        issues.push(problem('DUPLICATE_DEPENDENCY', 'A task cannot depend on the same task more than once.', safeTaskId));
      }
      for (const dependencyId of task.dependsOn) {
        if (dependencyId === taskId) issues.push(problem('SELF_DEPENDENCY', 'A task cannot depend on itself.', safeTaskId));
        else if (!plan.tasks.some((candidate) => candidate?.id === dependencyId)) {
          issues.push(problem('UNKNOWN_DEPENDENCY', 'A task references a dependency outside this plan.', safeTaskId));
        }
      }
    }
  }

  for (const scenarioId of scenarioIds) {
    if (!mappedScenarioIds.has(scenarioId)) issues.push(problem('UNMAPPED_SCENARIO', `Scenario “${scenarioId}” is not covered by a Jira task.`));
  }

  const dependencySafeTasks = plan.tasks.filter((task) => task && typeof task.id === 'string' && Array.isArray(task.dependsOn));
  if (dependencySafeTasks.length === plan.tasks.length && taskIds.size === plan.tasks.length) {
    const ordered = orderWorkPlanTasks(dependencySafeTasks);
    if (ordered.length !== plan.tasks.length) issues.push(problem('DEPENDENCY_CYCLE', 'Work plan dependencies must form an acyclic graph.'));
  }

  return { valid: issues.length === 0, issues };
}

export function createWorkPlanDigest(plan, { briefRevisionId, requirementRevisionId, requirementContent }) {
  if (![briefRevisionId, requirementRevisionId].every((value) => typeof value === 'string' && value)) {
    throw new TypeError('Brief and requirement revision IDs are required to bind a work plan.');
  }
  if (typeof requirementContent !== 'string' || !requirementContent) {
    throw new TypeError('The exact saved Gherkin content is required to bind a work plan.');
  }
  return digest({
    schemaVersion: 1,
    briefRevisionId,
    requirementRevisionId,
    requirementDigest: digest(requirementContent),
    plan,
  });
}

export function createWorkPlanTaskIdempotencyKey(planDigest, taskId) {
  if (!/^[0-9a-f]{64}$/.test(planDigest) || typeof taskId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(taskId)) {
    throw new TypeError('A SHA-256 plan digest and stable task ID are required.');
  }
  return digest({ schemaVersion: 1, planDigest, taskId });
}

export function resolveJiraAssignee(ownerRole, roleToAccountId = {}) {
  const accountId = roleToAccountId[ownerRole];
  return typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null;
}
