export function resolveWorkspaceProjectListView({ status, projects = [], selectedId = null }) {
  if (status === 'loading') return { kind: 'loading', projects: [], count: null, selectedProject: null };
  if (status === 'error') return { kind: 'error', projects: [], count: null, selectedProject: null };

  const persistedProjects = Array.isArray(projects) ? projects : [];
  if (persistedProjects.length === 0) return { kind: 'empty', projects: [], count: 0, selectedProject: null };

  return {
    kind: 'projects',
    projects: persistedProjects,
    count: persistedProjects.length,
    selectedProject: persistedProjects.find((project) => project.id === selectedId) || null,
  };
}
