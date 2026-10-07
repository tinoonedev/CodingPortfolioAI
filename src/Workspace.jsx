import { useCallback, useEffect, useState } from 'react';

const emptyBrief = { name: '', client: '', problem: '', targetUser: '', successSignal: '', approved: false };

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error?.message || 'The workspace request failed.');
    error.status = response.status;
    error.code = body?.error?.code;
    error.missing = body?.error?.missing || [];
    error.invalid = body?.error?.invalid || [];
    throw error;
  }
  return body;
}

function SetupNotice({ error, onRetry }) {
  const settings = [...error.missing, ...error.invalid];
  return <main className="workspace-page">
    <section className="workspace-card setup-card" aria-labelledby="setup-title">
      <div className="workspace-brand"><span className="brand-mark">f</span><span>FIELDWORK<small>AI PRODUCT STUDIO</small></span></div>
      <span className="workspace-icon setup-icon">◈</span>
      <p className="eyebrow">WORKSPACE SETUP</p>
      <h1 id="setup-title">Connect the real workspace.</h1>
      <p className="workspace-copy">Fieldwork is blocked until server authentication and persistence are configured. No project data is saved in this browser.</p>
      {settings.length > 0 && <div className="setup-settings"><b>Server settings to configure</b><ul>{settings.map((setting) => <li key={setting}><code>{setting}</code></li>)}</ul></div>}
      <p className="setup-recovery">Run the workspace database migration after setting <code>DATABASE_URL</code>. Then restart the API.</p>
      <div className="workspace-actions"><button className="button subtle-button" type="button" onClick={onRetry}>Check setup again</button><a className="workspace-demo-link" href="/demo">Open the labeled prototype demo</a></div>
    </section>
  </main>;
}

function SignIn({ initialError = '' }) {
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      await api(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      window.location.assign('/');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };
  return <main className="workspace-page">
    <section className="workspace-card sign-in-card" aria-labelledby="signin-title">
      <div className="workspace-brand"><span className="brand-mark">f</span><span>FIELDWORK<small>AI PRODUCT STUDIO</small></span></div>
      <span className="workspace-icon sign-in-icon">↗</span>
      <p className="eyebrow">LOCAL POSTGRESQL ACCOUNT</p>
      <h1 id="signin-title">{mode === 'login' ? 'Your studio starts here.' : 'Join your studio.'}</h1>
      <p className="workspace-copy">{mode === 'login' ? 'Sign in with your email and password to open the workspace and its client projects.' : 'Use your invitation and set a password for this workspace.'}</p>
      <form className="workspace-auth-form" onSubmit={submit}>
        {mode === 'register' && <>
          <label>Display name<input name="displayName" required maxLength="120" autoComplete="name" /></label>
          <label>Invitation token<input name="inviteToken" required autoComplete="one-time-code" /></label>
        </>}
        <label>Email address<input name="email" required type="email" maxLength="254" autoComplete="email" /></label>
        <label>Password<input name="password" required type="password" minLength={mode === 'register' ? 12 : 1} maxLength="128" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {error && <p className="workspace-alert" role="alert">{error}</p>}
        <button className="button primary-button workspace-signin" type="submit" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'} <span>↗</span></button>
      </form>
      <p className="workspace-footnote">{mode === 'login' ? 'New to this workspace? Use a single-use invitation to create your account.' : 'Invitations are single-use and expire after 24 hours.'}</p>
      <button className="workspace-mode-toggle" type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create an account with an invitation' : 'Back to sign in'}</button>
    </section>
  </main>;
}

function WorkspaceInvitation() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [token, setToken] = useState('');
  const [invitedEmail, setInvitedEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setToken('');
    try {
      const result = await api('/api/auth/invitations', { method: 'POST', body: JSON.stringify({ email, role }) });
      setToken(result.invitation.token);
      setInvitedEmail(result.invitation.email);
      setEmail('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };
  return <details className="workspace-invitation">
    <summary>Invite a workspace member</summary>
    <form onSubmit={create}>
      <label>Email address<input required type="email" maxLength="254" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Access<select value={role} onChange={(event) => setRole(event.target.value)}><option value="member">Member</option><option value="owner">Owner</option></select></label>
      <button className="button subtle-button" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create invitation'}</button>
    </form>
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    {token && <div className="workspace-invitation-token"><b>Copy this invitation token now. It is shown once.</b><code>{token}</code><small>Send it only to {invitedEmail}; it expires in 24 hours.</small></div>}
  </details>;
}

function ProjectForm({ onCreate, busy, error }) {
  const [form, setForm] = useState(emptyBrief);
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    const created = await onCreate(form);
    if (created) setForm(emptyBrief);
  };

  return <form className="workspace-project-form" onSubmit={submit}>
    <div className="workspace-form-heading"><span className="workspace-icon form-icon">＋</span><div><p className="eyebrow">NEW CLIENT PROJECT</p><h2>Start with the brief.</h2><p>Project details are stored in your authenticated workspace.</p></div></div>
    <div className="workspace-fields">
      <label>Project name<input required maxLength="70" value={form.name} onChange={update('name')} placeholder="e.g. Waypoint" /></label>
      <label>Client name<input required maxLength="70" value={form.client} onChange={update('client')} placeholder="e.g. Waypoint, Inc." /></label>
      <label className="field-wide">Business problem<textarea required maxLength="500" rows="3" value={form.problem} onChange={update('problem')} placeholder="What outcome should the project create?" /></label>
      <label>Target user<textarea required maxLength="250" rows="2" value={form.targetUser} onChange={update('targetUser')} placeholder="Who needs this?" /></label>
      <label>Success signal<textarea required maxLength="250" rows="2" value={form.successSignal} onChange={update('successSignal')} placeholder="How will success be measured?" /></label>
    </div>
    <label className="workspace-brief-approval"><input required type="checkbox" checked={form.approved} onChange={(event) => setForm((current) => ({ ...current, approved: event.target.checked }))} /><span><b>I reviewed and approve this brief for the workspace.</b><small>This records my approval with my signed-in account and timestamp.</small></span></label>
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    <div className="workspace-form-actions"><span>Saving creates a server-side project record.</span><button className="button primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create client project'} <span>↗</span></button></div>
  </form>;
}

function ProjectDetails({ project }) {
  return <section className="workspace-project-detail" aria-labelledby="active-project-title">
    <div className="workspace-project-heading"><span className="workspace-project-avatar">{project.name.slice(0, 1).toUpperCase()}</span><div><p className="eyebrow">CLIENT PROJECT · SERVER SAVED</p><h2 id="active-project-title">{project.name}</h2><p>{project.client}</p></div><span className="workspace-saved"><i /> Approved · Persisted</span></div>
    <div className="workspace-brief-grid">
      <article><small>BUSINESS PROBLEM</small><p>{project.problem}</p></article>
      <article><small>TARGET USER</small><p>{project.targetUser}</p></article>
      <article><small>SUCCESS SIGNAL</small><p>{project.successSignal}</p></article>
    </div>
    <div className="workspace-project-footer"><span>Created {new Date(project.createdAt).toLocaleDateString()}</span><span>Workspace access checked on every request</span></div>
  </section>;
}

export default function Workspace() {
  const [state, setState] = useState({ loading: true, session: null, projects: [], selectedId: null, setupError: null, signInError: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, setupError: null, signInError: '' }));
    try {
      const { user, workspace } = await api('/api/session');
      const { projects } = await api('/api/projects');
      setState({ loading: false, session: { user, workspace }, projects, selectedId: projects[0]?.id || null, setupError: null, signInError: '' });
    } catch (error) {
      if (error.code === 'SETUP_REQUIRED' || error.code === 'WORKSPACE_UNAVAILABLE') {
        setState({ loading: false, session: null, projects: [], selectedId: null, setupError: error, signInError: '' });
      } else if (error.status === 401) {
        setState({ loading: false, session: null, projects: [], selectedId: null, setupError: null, signInError: '' });
      } else {
        setState({ loading: false, session: null, projects: [], selectedId: null, setupError: null, signInError: 'The workspace could not be reached. Check the connection and try again.' });
      }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createProject = async (form) => {
    setBusy(true);
    setFormError('');
    try {
      const { project } = await api('/api/projects', { method: 'POST', body: JSON.stringify(form) });
      setState((current) => ({ ...current, projects: [project, ...current.projects], selectedId: project.id }));
      return true;
    } catch (error) {
      setFormError(error.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      await load();
    } catch {
      setState((current) => ({ ...current, signInError: 'Sign out could not be confirmed. Retry while the workspace is available.' }));
    }
  };

  if (state.loading) {
    return <main className="workspace-page"><div className="workspace-loading" role="status"><i className="live-dot" /> Checking workspace access…</div></main>;
  }
  if (state.setupError) return <SetupNotice error={state.setupError} onRetry={load} />;
  if (!state.session) return <SignIn initialError={state.signInError} />;

  const selectedProject = state.projects.find((project) => project.id === state.selectedId);
  return <main className="workspace-page workspace-authenticated">
    <header className="workspace-topbar">
      <div className="workspace-brand"><span className="brand-mark">f</span><span>FIELDWORK<small>AI PRODUCT STUDIO</small></span></div>
      <div className="workspace-user"><span><b>{state.session.workspace.name}</b><small>{state.session.user.email}</small></span><button className="button subtle-button" type="button" onClick={signOut}>Sign out</button></div>
    </header>
    {state.session.user.role === 'owner' && <WorkspaceInvitation />}
    <section className="workspace-content">
      <div className="workspace-page-heading"><div><p className="eyebrow"><span className="live-dot" /> STUDIO OPERATIONS</p><h1>Your projects, built on real work.</h1><p>Client briefs are private to this workspace and persist on the server.</p></div><span className="workspace-project-count">{state.projects.length} {state.projects.length === 1 ? 'PROJECT' : 'PROJECTS'}</span></div>
      <div className="workspace-layout">
        <aside className="workspace-project-list" aria-label="Client projects">
          <div className="workspace-list-heading"><b>CLIENT PROJECTS</b><span>{state.projects.length}</span></div>
          {state.projects.map((project) => <button key={project.id} type="button" className={`workspace-project-option ${project.id === state.selectedId ? 'selected' : ''}`} onClick={() => setState((current) => ({ ...current, selectedId: project.id }))}><span className="workspace-option-mark">{project.name.slice(0, 1).toUpperCase()}</span><span><b>{project.name}</b><small>{project.client}</small></span><span className="option-chevron">›</span></button>)}
          {state.projects.length === 0 && <p className="workspace-empty-list">Your first client project will appear here.</p>}
        </aside>
        <div className="workspace-main-panel">
          {selectedProject ? <ProjectDetails project={selectedProject} /> : <ProjectForm onCreate={createProject} busy={busy} error={formError} />}
          {selectedProject && <button className="workspace-add-project" type="button" onClick={() => setState((current) => ({ ...current, selectedId: null }))}>＋ Add a client project</button>}
        </div>
      </div>
      <footer className="workspace-footer"><span>◈ Workspace isolation is enforced by the API.</span><a href="/demo">Open prototype demo ↗</a></footer>
    </section>
  </main>;
}
