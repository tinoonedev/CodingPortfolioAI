import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceProjectListView } from '../src/domain/workspaceProjectList.js';

const persistedProjects = [
  { id: 'project-a', name: 'Northstar' },
  { id: 'project-b', name: 'Waypoint' },
];

test('loading state hides stale projects and does not invent a count', () => {
  assert.deepEqual(resolveWorkspaceProjectListView({ status: 'loading', projects: persistedProjects, selectedId: 'project-a' }), {
    kind: 'loading', projects: [], count: null, selectedProject: null,
  });
});

test('error state clears stale project rows, count, and selection', () => {
  assert.deepEqual(resolveWorkspaceProjectListView({ status: 'error', projects: persistedProjects, selectedId: 'project-a' }), {
    kind: 'error', projects: [], count: null, selectedProject: null,
  });
});

test('empty state reports a real zero and no selected project', () => {
  assert.deepEqual(resolveWorkspaceProjectListView({ status: 'ready', projects: [] }), {
    kind: 'empty', projects: [], count: 0, selectedProject: null,
  });
});

test('loaded state counts only returned projects and selects only a returned id', () => {
  const view = resolveWorkspaceProjectListView({ status: 'ready', projects: persistedProjects, selectedId: 'project-b' });
  assert.equal(view.kind, 'projects');
  assert.equal(view.count, 2);
  assert.deepEqual(view.projects, persistedProjects);
  assert.equal(view.selectedProject, persistedProjects[1]);

  const unknownSelection = resolveWorkspaceProjectListView({ status: 'ready', projects: persistedProjects, selectedId: 'foreign-id' });
  assert.equal(unknownSelection.selectedProject, null);
});
