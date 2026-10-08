import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveWorkspaceProjectListView } from './domain/workspaceProjectList.js';

const emptyBrief = { name: '', client: '', problem: '', targetUser: '', successSignal: '', approved: false };

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch (cause) {
    const error = new Error('The connection ended before Fieldwork could confirm the result. Check saved projects before retrying.');
    error.outcomeUnknown = true;
    error.cause = cause;
    throw error;
  }
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok && options.method === 'POST' && path === '/api/projects' && body === null) {
    const error = new Error('The server response could not be read, so the result is unconfirmed. Check saved projects before retrying.');
    error.outcomeUnknown = true;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(body?.error?.message || 'The workspace request failed.');
    error.status = response.status;
    error.code = body?.error?.code;
    error.field = body?.error?.field || null;
    error.missing = body?.error?.missing || [];
    error.invalid = body?.error?.invalid || [];
    error.issues = body?.issues || [];
    error.outcomeUnknown = response.status >= 500 || response.status === 408;
    throw error;
  }
  return body;
}

const jiraCallbackMessages = {
  authorization_received: 'Atlassian authorization succeeded. Select the accessible site and project to finish connecting.',
  authorization_denied: 'Atlassian authorization was denied. The project remains disconnected; you can start again.',
  authorization_failed: 'Jira authorization could not be completed. The project remains disconnected; start again.',
  setup_required: 'Jira OAuth is not configured on this Fieldwork server.',
  callback_invalid: 'The Jira authorization response was invalid, expired, or already used. Start again.',
  sign_in_required: 'Sign in to Fieldwork before completing Jira authorization, then start the connection again.',
  owner_required: 'Only a workspace owner can complete Jira authorization.',
  workspace_unavailable: 'The workspace could not verify the Jira authorization. Try again when it is available.',
};

function readJiraCallback() {
  const params = new URLSearchParams(window.location.search);
  const outcome = params.get('jira');
  const projectId = params.get('projectId');
  const result = Object.hasOwn(jiraCallbackMessages, outcome)
    ? { outcome, projectId: projectId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId) ? projectId : null }
    : null;
  if (params.has('jira') || params.has('projectId')) window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
  return result;
}

function JiraConnectionPanel({ project, canEdit, callbackResult, onCallbackHandled }) {
  const [connectionState, setConnectionState] = useState({ loading: true, data: null });
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [selectedJiraProjectId, setSelectedJiraProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const loadConnection = useCallback(async () => {
    setConnectionState((current) => ({ ...current, loading: true }));
    try {
      const data = await api(`/api/projects/${project.id}/jira/connection`);
      setConnectionState({ loading: false, data });
    } catch (requestError) {
      setConnectionState({ loading: false, data: null });
      setError(requestError);
    }
  }, [project.id]);

  const loadSites = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api(`/api/projects/${project.id}/jira/authorization/sites`);
      setSites(result.sites);
      setSiteId(result.sites[0]?.id || '');
      setChoosing(true);
      setNotice(result.sites.length > 0
        ? 'Choose the Jira site and project this client project should use.'
        : 'No accessible Jira sites were returned. Confirm the Atlassian account has Jira access, then connect again.');
    } catch (requestError) {
      setError(requestError);
      setChoosing(false);
    } finally {
      setBusy(false);
    }
  }, [project.id]);

  useEffect(() => {
    loadConnection();
    if (callbackResult) {
      setNotice(jiraCallbackMessages[callbackResult.outcome]);
      onCallbackHandled();
      if (callbackResult.outcome === 'authorization_received') loadSites();
    }
  }, [callbackResult, loadConnection, loadSites, onCallbackHandled]);

  const beginAuthorization = async () => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const result = await api(`/api/projects/${project.id}/jira/authorization`, { method: 'POST' });
      const authorizationUrl = new URL(result.authorizationUrl);
      if (authorizationUrl.protocol !== 'https:' || authorizationUrl.origin !== 'https://auth.atlassian.com') {
        throw new Error('Fieldwork returned an unexpected Jira authorization destination. No navigation occurred.');
      }
      window.location.assign(authorizationUrl.toString());
    } catch (requestError) {
      setError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const searchProjects = async (event, startAt = 0) => {
    event?.preventDefault();
    if (!siteId) return;
    setBusy(true);
    setError(null);
    setSearchResults(null);
    setSelectedJiraProjectId('');
    try {
      const params = new URLSearchParams({ query: search, startAt: String(startAt), maxResults: '25' });
      const result = await api(`/api/projects/${project.id}/jira/authorization/sites/${encodeURIComponent(siteId)}/projects?${params}`);
      setSearchResults(result);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const confirmSelection = async () => {
    if (!siteId || !selectedJiraProjectId) return;
    setBusy(true);
    setError(null);
    setNotice('Verifying the selected Jira project…');
    try {
      await api(`/api/projects/${project.id}/jira/authorization/selection`, {
        method: 'POST',
        body: JSON.stringify({ cloudId: siteId, jiraProjectId: selectedJiraProjectId }),
      });
      const verified = await api(`/api/projects/${project.id}/jira/connection`);
      if (verified.status !== 'connected' || !verified.connection || verified.connection.cloud_id !== siteId || verified.connection.jira_project_id !== selectedJiraProjectId) {
        throw new Error('Fieldwork could not verify the saved Jira connection. The connection is not shown as connected; reload to check its server status.');
      }
      setConnectionState({ loading: false, data: verified });
      setChoosing(false);
      setSearchResults(null);
      setNotice(`Connected to ${verified.connection.jira_project_key} and verified by Fieldwork.`);
    } catch (requestError) {
      setError(requestError);
      await loadConnection();
    } finally {
      setBusy(false);
    }
  };

  const disconnectConnection = async () => {
    setBusy(true);
    setError(null);
    setNotice('Removing Fieldwork’s stored Jira credentials…');
    try {
      await api(`/api/projects/${project.id}/jira/disconnect`, { method: 'POST' });
      const verified = await api(`/api/projects/${project.id}/jira/connection`);
      if (!['disconnected', 'not_connected'].includes(verified.status)) {
        throw new Error('Fieldwork could not verify the disconnected state. The connection remains unchanged in this view; reload to check the server.');
      }
      setConnectionState({ loading: false, data: verified });
      setChoosing(false);
      setConfirmingDisconnect(false);
      setSearchResults(null);
      setNotice('Fieldwork removed its stored Jira credentials. The Atlassian account grant may need to be revoked separately in Atlassian.');
    } catch (requestError) {
      setError(requestError);
      await loadConnection();
    } finally {
      setBusy(false);
    }
  };

  const connection = connectionState.data?.connection;
  const setup = connectionState.data?.setup;
  const currentPage = searchResults ? Math.floor(searchResults.startAt / searchResults.maxResults) + 1 : 0;

  return <section className="jira-connection-panel" aria-labelledby="jira-connection-title">
    <div className="jira-panel-heading"><div><p className="eyebrow">PROJECT INTEGRATION</p><h3 id="jira-connection-title">Jira connection</h3><p>Connect one verified Jira project to this client workspace.</p></div><span className={`jira-status-chip ${connection?.status === 'connected' ? 'is-connected' : ''}`} role="status">{connectionState.loading ? 'Checking…' : connection?.status === 'connected' ? 'Connected' : connection?.status === 'disconnected' ? 'Disconnected' : 'Not connected'}</span></div>
    {connectionState.data?.configured === false && connection?.status !== 'connected' && <div className="jira-setup-notice"><b>Jira OAuth setup required</b><p>Fieldwork will show a connected state only after a real Jira authorization and project verification.</p>{(setup?.missing?.length > 0 || setup?.invalid?.length > 0) && <ul>{[...(setup.missing || []), ...(setup.invalid || [])].map((setting) => <li key={setting}><code>{setting}</code></li>)}</ul>}</div>}
    {connection?.status === 'connected' && <div className="jira-connected-details"><span><small>JIRA SITE</small><b>{connection.site_url}</b></span><span><small>PROJECT</small><b>{connection.jira_project_key}</b></span></div>}
    {notice && <p className="jira-panel-notice" role="status">{notice}</p>}
    {error && <div className="workspace-alert jira-panel-error" role="alert"><b>{error.message}</b>{((error.missing?.length || 0) > 0 || (error.invalid?.length || 0) > 0) && <ul>{[...(error.missing || []), ...(error.invalid || [])].map((setting) => <li key={setting}><code>{setting}</code></li>)}</ul>}</div>}
    {canEdit && <div className="jira-panel-actions">
      {connection?.status !== 'connected' && <button className="button primary-button" type="button" disabled={busy || connectionState.loading || choosing} onClick={beginAuthorization}>{busy ? 'Working…' : 'Connect Jira'} <span>↗</span></button>}
      {connection?.status === 'connected' && <><button className="button subtle-button" type="button" disabled={busy} onClick={beginAuthorization}>Reconnect Jira</button><button className="button subtle-button jira-disconnect-trigger" type="button" disabled={busy} onClick={() => { setConfirmingDisconnect(true); setError(null); }}>Disconnect Jira</button></>}
      {!connectionState.data && !connectionState.loading && <button className="button subtle-button" type="button" onClick={() => { setError(null); loadConnection(); }}>Reload status</button>}
    </div>}
    {confirmingDisconnect && canEdit && <div className="jira-disconnect-confirm" role="alertdialog" aria-labelledby={`jira-disconnect-title-${project.id}`} aria-describedby={`jira-disconnect-description-${project.id}`}>
      <div><h4 id={`jira-disconnect-title-${project.id}`}>Disconnect Jira from {project.name}?</h4><p id={`jira-disconnect-description-${project.id}`}>Fieldwork will delete its stored Jira credentials for this project. This does not revoke the Atlassian account grant; manage that separately in Atlassian.</p></div>
      <div className="jira-disconnect-actions"><button className="button subtle-button" type="button" disabled={busy} onClick={() => setConfirmingDisconnect(false)}>Cancel</button><button className="button primary-button" type="button" autoFocus disabled={busy} onClick={disconnectConnection}>{busy ? 'Disconnecting…' : 'Confirm disconnect'}</button></div>
    </div>}
    {choosing && canEdit && <div className="jira-selection-flow" aria-labelledby="jira-selection-title">
      <h4 id="jira-selection-title">Select a Jira project</h4>
      {sites.length === 0 && <p className="jira-panel-muted">No accessible Jira sites were returned. Confirm the Atlassian account has Jira access, then restart authorization.</p>}
      <label htmlFor={`jira-site-${project.id}`}>Accessible Jira site</label>
      <select id={`jira-site-${project.id}`} value={siteId} disabled={busy || sites.length === 0} onChange={(event) => { setSiteId(event.target.value); setSearchResults(null); setSelectedJiraProjectId(''); }}>
        {sites.length === 0 && <option value="">No accessible Jira sites</option>}
        {sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.url}</option>)}
      </select>
      <form className="jira-project-search" onSubmit={searchProjects}>
        <label htmlFor={`jira-project-search-${project.id}`}>Search Jira projects</label>
        <div><input id={`jira-project-search-${project.id}`} value={search} maxLength="200" onChange={(event) => setSearch(event.target.value)} placeholder="Search by project name" /><button className="button subtle-button" type="submit" disabled={busy || !siteId}>Search</button></div>
      </form>
      {searchResults && <>
        <label htmlFor={`jira-project-${project.id}`}>Matching Jira project</label>
        <select id={`jira-project-${project.id}`} value={selectedJiraProjectId} onChange={(event) => setSelectedJiraProjectId(event.target.value)}>
          <option value="">Select a project</option>
          {searchResults.values.map((item) => <option key={item.id} value={item.id}>{item.key} · {item.name}</option>)}
        </select>
        {searchResults.values.length === 0 && <p className="jira-panel-muted">No Jira projects matched this search.</p>}
        <div className="jira-results-footer"><span>{searchResults.total} project(s) · page {currentPage}</span><div><button className="requirements-retry" type="button" disabled={busy || searchResults.startAt === 0} onClick={() => searchProjects(null, Math.max(0, searchResults.startAt - searchResults.maxResults))}>Previous</button><button className="requirements-retry" type="button" disabled={busy || searchResults.isLast} onClick={() => searchProjects(null, searchResults.startAt + searchResults.maxResults)}>Next</button></div></div>
      </>}
      {sites.length === 0 && <button className="button subtle-button" type="button" disabled={busy} onClick={beginAuthorization}>Restart Jira authorization</button>}
      <button className="button primary-button jira-confirm-button" type="button" disabled={busy || !selectedJiraProjectId} onClick={confirmSelection}>{busy ? 'Verifying…' : 'Verify and connect project'} <span>↗</span></button>
    </div>}
    {!canEdit && !connectionState.loading && <p className="jira-panel-muted">Only a workspace owner can change this Jira connection.</p>}
  </section>;
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

function ProjectForm({ onCreate, onCheckSaved, onCancel, onClearError, busy, error }) {
  const [form, setForm] = useState(emptyBrief);
  const [creationRequestId, setCreationRequestId] = useState(() => window.crypto.randomUUID());
  const [checkingSaved, setCheckingSaved] = useState(false);
  const [reconcileStatus, setReconcileStatus] = useState('');
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setCreationRequestId(window.crypto.randomUUID());
    setReconcileStatus('');
    onClearError();
  };
  const fieldError = (field) => error?.field === field ? error.message : '';
  const fieldErrorId = (field) => `brief-${field}-error`;
  const submit = async (event) => {
    event.preventDefault();
    const created = await onCreate(form, creationRequestId);
    if (created) {
      setForm(emptyBrief);
      setCreationRequestId(window.crypto.randomUUID());
      setReconcileStatus('');
    }
  };
  const checkSavedProjects = async () => {
    setCheckingSaved(true);
    setReconcileStatus('Checking the saved project list…');
    try {
      const result = await onCheckSaved(creationRequestId);
      setReconcileStatus(result === 'found'
        ? 'The saved project was found and opened.'
        : 'No project with this request was returned. You can safely retry this unchanged brief with the same request identifier.');
    } catch {
      setReconcileStatus('The saved project list is unavailable. Your brief remains in this form; no save success is confirmed.');
    } finally {
      setCheckingSaved(false);
    }
  };

  return <form className="workspace-project-form" onSubmit={submit}>
    <div className="workspace-form-heading"><span className="workspace-icon form-icon">＋</span><div><p className="eyebrow">NEW CLIENT PROJECT</p><h2>Start with the brief.</h2><p>Project details are stored in your authenticated workspace.</p></div></div>
    <div className="workspace-fields">
      <label htmlFor="brief-name">Project name<input id="brief-name" aria-invalid={fieldError('name') ? 'true' : undefined} aria-describedby={fieldError('name') ? fieldErrorId('name') : undefined} required maxLength="70" value={form.name} onChange={update('name')} placeholder="e.g. Waypoint" disabled={busy || checkingSaved || error?.outcomeUnknown} />{fieldError('name') && <small id={fieldErrorId('name')} className="workspace-field-error" role="alert">{fieldError('name')}</small>}</label>
      <label htmlFor="brief-client">Client name<input id="brief-client" aria-invalid={fieldError('client') ? 'true' : undefined} aria-describedby={fieldError('client') ? fieldErrorId('client') : undefined} required maxLength="70" value={form.client} onChange={update('client')} placeholder="e.g. Waypoint, Inc." disabled={busy || checkingSaved || error?.outcomeUnknown} />{fieldError('client') && <small id={fieldErrorId('client')} className="workspace-field-error" role="alert">{fieldError('client')}</small>}</label>
      <label className="field-wide" htmlFor="brief-problem">Business problem<textarea id="brief-problem" aria-invalid={fieldError('problem') ? 'true' : undefined} aria-describedby={fieldError('problem') ? fieldErrorId('problem') : undefined} required maxLength="500" rows="3" value={form.problem} onChange={update('problem')} placeholder="What outcome should the project create?" disabled={busy || checkingSaved || error?.outcomeUnknown} />{fieldError('problem') && <small id={fieldErrorId('problem')} className="workspace-field-error" role="alert">{fieldError('problem')}</small>}</label>
      <label htmlFor="brief-target-user">Target user<textarea id="brief-target-user" aria-invalid={fieldError('targetUser') ? 'true' : undefined} aria-describedby={fieldError('targetUser') ? fieldErrorId('targetUser') : undefined} required maxLength="250" rows="2" value={form.targetUser} onChange={update('targetUser')} placeholder="Who needs this?" disabled={busy || checkingSaved || error?.outcomeUnknown} />{fieldError('targetUser') && <small id={fieldErrorId('targetUser')} className="workspace-field-error" role="alert">{fieldError('targetUser')}</small>}</label>
      <label htmlFor="brief-success-signal">Success signal<textarea id="brief-success-signal" aria-invalid={fieldError('successSignal') ? 'true' : undefined} aria-describedby={fieldError('successSignal') ? fieldErrorId('successSignal') : undefined} required maxLength="250" rows="2" value={form.successSignal} onChange={update('successSignal')} placeholder="How will success be measured?" disabled={busy || checkingSaved || error?.outcomeUnknown} />{fieldError('successSignal') && <small id={fieldErrorId('successSignal')} className="workspace-field-error" role="alert">{fieldError('successSignal')}</small>}</label>
    </div>
    <label className="workspace-brief-approval" htmlFor="brief-approved"><input id="brief-approved" aria-invalid={fieldError('approved') ? 'true' : undefined} aria-describedby={fieldError('approved') ? fieldErrorId('approved') : undefined} required type="checkbox" checked={form.approved} onChange={(event) => { setForm((current) => ({ ...current, approved: event.target.checked })); setCreationRequestId(window.crypto.randomUUID()); setReconcileStatus(''); onClearError(); }} disabled={busy || checkingSaved || error?.outcomeUnknown} /><span><b>I approve saving this client brief.</b><small>This records who approved this brief and when. It does not approve agent work, Jira changes, or release.</small>{fieldError('approved') && <small id={fieldErrorId('approved')} className="workspace-field-error" role="alert">{fieldError('approved')}</small>}</span></label>
    {error && (!error.field || !fieldError(error.field)) && <p className="workspace-alert" role="alert">{error.message}</p>}
    {reconcileStatus && <p className="workspace-inline-notice" role="status" aria-live="polite">{reconcileStatus}</p>}
    <div className="workspace-form-actions">{onCancel ? <button className="button subtle-button" type="button" onClick={onCancel} disabled={busy || checkingSaved || error?.outcomeUnknown}>Back to Studio</button> : <span>Saving creates a server-side project record.</span>}{error?.outcomeUnknown && <button className="button subtle-button" type="button" onClick={checkSavedProjects} disabled={busy || checkingSaved}>{checkingSaved ? 'Checking saved projects…' : 'Check saved projects'}</button>}<button className="button primary-button" type="submit" disabled={busy || checkingSaved}>{busy ? 'Saving…' : error?.outcomeUnknown ? 'Retry this brief' : 'Create client project'} <span>↗</span></button></div>
  </form>;
}

function BriefEditor({ project, onCancel, onSave, busy, error }) {
  const [form, setForm] = useState({
    name: project.name,
    client: project.client,
    problem: project.problem,
    targetUser: project.targetUser,
    successSignal: project.successSignal,
    approved: false,
  });
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  return <form className="workspace-project-form brief-editor" onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
    <div className="workspace-form-heading"><span className="workspace-icon form-icon">✎</span><div><p className="eyebrow">UPDATE APPROVED BRIEF</p><h3>Edit project scope.</h3><p>Saving an approved change marks earlier Gherkin revisions as written for a prior brief.</p></div></div>
    <div className="workspace-fields">
      <label>Project name<input required maxLength="70" value={form.name} onChange={update('name')} /></label>
      <label>Client name<input required maxLength="70" value={form.client} onChange={update('client')} /></label>
      <label className="field-wide">Business problem<textarea required maxLength="500" rows="3" value={form.problem} onChange={update('problem')} /></label>
      <label>Target user<textarea required maxLength="250" rows="2" value={form.targetUser} onChange={update('targetUser')} /></label>
      <label>Success signal<textarea required maxLength="250" rows="2" value={form.successSignal} onChange={update('successSignal')} /></label>
    </div>
    <label className="workspace-brief-approval"><input required type="checkbox" checked={form.approved} onChange={(event) => setForm((current) => ({ ...current, approved: event.target.checked }))} /><span><b>I approve this updated brief.</b><small>The signed-in workspace owner and approval time will be recorded.</small></span></label>
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    <div className="workspace-form-actions"><button className="button subtle-button" type="button" onClick={onCancel}>Cancel</button><button className="button primary-button" type="submit" disabled={busy || !form.approved}>{busy ? 'Saving…' : 'Save approved brief'} <span>↗</span></button></div>
  </form>;
}

function RequirementsPanel({ project, canEdit }) {
  const [revisions, setRevisions] = useState([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedMessage, setSavedMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api(`/api/projects/${project.id}/requirements`);
      setRevisions(result.revisions);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setLoading(false);
    }
  }, [project.id, project.name, project.client, project.problem, project.targetUser, project.successSignal]);

  useEffect(() => { load(); }, [load]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSavedMessage('');
    try {
      const result = await api(`/api/projects/${project.id}/requirements`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      setRevisions((current) => [result.revision, ...current]);
      setContent('');
      setSavedMessage(`Revision ${result.revision.revision} saved with ${result.revision.scenarios.length} scenarios. QA review has not been recorded.`);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setBusy(false);
    }
  };

  return <section id={`project-requirements-${project.id}`} className="workspace-requirements" aria-labelledby="requirements-title">
    <div className="workspace-requirements-heading"><div><p className="eyebrow">BUSINESS ANALYST · GHERKIN</p><h3 id="requirements-title">Requirements revisions</h3><p>Versioned against this project brief. Structural validation does not replace QA review.</p></div><span className="requirements-count">{revisions.length} {revisions.length === 1 ? 'REVISION' : 'REVISIONS'}</span></div>
    {canEdit && <form className="requirements-editor" onSubmit={save}>
      <label htmlFor="gherkin-requirements-content">Gherkin feature</label>
      <textarea id="gherkin-requirements-content" data-testid="gherkin-requirements-content" maxLength="60000" rows="14" required value={content} onChange={(event) => setContent(event.target.value)} placeholder={'Feature: Describe the capability\n  As a specific actor\n  I want an observable capability\n  So that a measurable outcome is reached\n\n  Rule: Describe the policy\n    Scenario: Describe one outcome\n      Given explicit preconditions\n      When the actor takes one action\n      Then the system shows one result\n\n    Scenario: Describe a meaningful failure\n      Given the failure condition\n      When the action is attempted\n      Then the safe failure is visible'} />
      <div className="requirements-editor-footer"><span>Gherkin is parsed on the server. Invalid text is not saved as reviewable.</span><button className="button primary-button" type="submit" disabled={busy || loading}>{busy ? 'Validating…' : 'Validate and save revision'} <span>↗</span></button></div>
    </form>}
    {error && <div className="workspace-alert requirements-error" role="alert"><b>{error.message}</b>{error.issues.length > 0 && <ul>{error.issues.map((problem, index) => <li key={`${problem.code}-${index}`}>{problem.line ? `Line ${problem.line}: ` : ''}{problem.message}</li>)}</ul>}<button className="requirements-retry" type="button" onClick={load}>Reload revisions</button></div>}
    {savedMessage && <p className="requirements-saved" role="status">{savedMessage}</p>}
    {loading ? <p className="requirements-empty" role="status">Loading saved revisions…</p> : revisions.length === 0 ? <p className="requirements-empty">No Gherkin revision has been saved for this project.</p> : <ol className="requirements-history">{revisions.map((revision) => <li key={revision.id}>
      <details>
        <summary><span><b>Revision {revision.revision}</b><small>{revision.scenarios.length} scenarios · {new Date(revision.createdAt).toLocaleString()}</small></span><span className={revision.briefChanged ? 'revision-stale' : 'revision-current'}>{revision.briefChanged ? 'PRIOR BRIEF' : 'CURRENT BRIEF'}</span></summary>
        {revision.briefChanged && <p className="revision-warning">This revision was saved for a prior brief. It remains in history and needs review against the current brief.</p>}
        <pre>{revision.content}</pre>
        <ul className="revision-scenarios">{revision.scenarios.map((scenario) => <li key={scenario.id}><code>{scenario.id}</code><span>{scenario.type}: {scenario.name}</span>{scenario.tags.map((tag) => <small key={tag}>{tag}</small>)}</li>)}</ul>
      </details>
    </li>)}</ol>}
  </section>;
}

function AgentProviderPanel({ project, canEdit }) {
  const [readiness, setReadiness] = useState({ loading: true, data: null, error: '' });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [savingConfiguration, setSavingConfiguration] = useState(false);
  const roles = ['product-manager', 'business-analyst', 'project-manager', 'qa-analyst'];

  const load = useCallback(async () => {
    setReadiness({ loading: true, data: null, error: '' });
    try {
      const data = await api(`/api/projects/${project.id}/agents/openai/readiness`);
      setReadiness({ loading: false, data, error: '' });
    } catch (error) {
      setReadiness({ loading: false, data: null, error: error.message });
    }
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  const start = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setFeedback('');
    try {
      await api(`/api/projects/${project.id}/agents/runs`, {
        method: 'POST',
        body: JSON.stringify({ role: form.get('role'), artifact: form.get('artifact') }),
      });
      setFeedback('The server did not confirm a provider run.');
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy(false);
    }
  };

  const saveConfiguration = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const apiKeyInput = formElement.elements.namedItem('apiKey');
    const apiKey = String(form.get('apiKey') || '');
    if (apiKeyInput) apiKeyInput.value = '';
    setSavingConfiguration(true);
    setFeedback('');
    try {
      await api(`/api/projects/${project.id}/agents/openai/configuration`, {
        method: 'PUT',
        body: JSON.stringify({
          apiKey,
          model: form.get('model'),
          monthlyBudgetUsd: Number(form.get('monthlyBudgetUsd')),
          maxInputBytes: Number(form.get('maxInputBytes')),
          maxOutputTokens: Number(form.get('maxOutputTokens')),
        }),
      });
      formElement.reset();
      setFeedback('Project credentials were encrypted and saved. Provider execution remains disabled; no OpenAI request was sent.');
      await load();
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setSavingConfiguration(false);
    }
  };

  const configured = readiness.data?.canStartRun === true;
  const projectConfigured = readiness.data?.projectConfigured === true;
  const serverReady = readiness.data?.configured === true;
  return <section className="agent-provider-panel" aria-labelledby="agent-provider-title">
    <div className="jira-panel-heading"><div><p className="eyebrow">AGENT RUNTIME · OPENAI</p><h3 id="agent-provider-title">Project agent readiness</h3><p>Generation-only tasks. Agent outputs do not write to Jira, GitHub, or deployments.</p></div><span className="jira-status-chip" role="status">{readiness.loading ? 'Checking' : !projectConfigured ? 'Setup required' : !serverReady ? 'Server setup required' : readiness.data?.status === 'project_credential_invalid' ? 'Credential needs review' : readiness.data?.projectConfigurationValid === false ? 'Model needs review' : 'Configured · paused'}</span></div>
    {readiness.error ? <p className="workspace-alert" role="alert">{readiness.error}</p> : readiness.data && !configured && <div className="jira-setup-notice"><b>OpenAI agent tasks are blocked.</b><p>{readiness.data.status === 'execution_unavailable' ? 'Project and server settings are saved, but this server has no enabled execution adapter.' : readiness.data.status === 'project_credential_invalid' ? 'The saved project credential cannot be verified with the current server encryption keyring. Re-save the credential after checking the keyring configuration.' : readiness.data.status === 'project_model_not_allowed' ? 'The saved project model is no longer in the server allowlist. Choose an allowed model and save the project settings again.' : readiness.data.status === 'server_setup_required' ? 'Project settings are saved, but server-side credential encryption or pricing is not fully configured.' : 'Configure project-scoped credentials and spend limits. Saving them will not contact OpenAI or enable agent runs.'}</p>{[...readiness.data.missing, ...readiness.data.invalid].length > 0 && <ul>{[...readiness.data.missing, ...readiness.data.invalid].map((setting) => <li key={setting}><code>{setting}</code></li>)}</ul>}</div>}
    {canEdit && <form className="agent-task-form" onSubmit={saveConfiguration}>
      <p className="eyebrow">PROJECT CREDENTIALS</p>
      <label>OpenAI project API key<input name="apiKey" type="password" autoComplete="new-password" required minLength="23" maxLength="503" /></label>
      <label>Allowed model<select name="model" required defaultValue=""> <option value="" disabled>Select a server-allowed model</option>{(readiness.data?.allowedModels || []).map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
      <div className="agent-limits-grid"><label>Monthly budget (USD)<input name="monthlyBudgetUsd" type="number" min="0.01" max="100000" step="0.01" defaultValue="10" required /></label><label>Input limit (bytes)<input name="maxInputBytes" type="number" min="1" max="1000000" step="1" defaultValue="20000" required /></label><label>Output limit (tokens)<input name="maxOutputTokens" type="number" min="1" max="32000" step="1" defaultValue="2000" required /></label></div>
      <button className="button subtle-button" type="submit" disabled={savingConfiguration || readiness.loading || readiness.data?.canConfigure !== true || (readiness.data?.allowedModels || []).length === 0}>{savingConfiguration ? 'Encrypting and saving…' : 'Save encrypted project settings'}</button>
      <small>Only workspace owners can save. This form stays disabled until server encryption and pricing are configured. The key is cleared before the request is sent and never returned by the server. Saving does not run an agent.</small>
    </form>}
    {!canEdit && <p className="jira-panel-muted">Only a workspace owner can configure this project’s agent provider.</p>}
    {configured && <form className="agent-task-form" onSubmit={start}>
      <label>Agent role<select name="role" defaultValue="business-analyst">{roles.map((role) => <option key={role} value={role}>{role.replaceAll('-', ' ')}</option>)}</select></label>
      <label>Task input<textarea name="artifact" maxLength="60000" minLength="1" required rows="3" placeholder="Provide an approved brief or Gherkin requirements." /></label>
      <button className="button primary-button" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Start agent task'} <span>↗</span></button>
    </form>}
    {feedback && <p className="workspace-alert" role="alert">{feedback}</p>}
    <button className="requirements-retry" type="button" onClick={load} disabled={readiness.loading}>Refresh provider status</button>
  </section>;
}

function ProjectActivityPanel({ projectId }) {
  const [state, setState] = useState({ status: 'loading', events: [], agentRuns: [], error: '' });
  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', events: [], agentRuns: [], error: '' }));
    try {
      const activity = await api(`/api/projects/${projectId}/activity`);
      if (!Array.isArray(activity?.events) || !Array.isArray(activity?.agentRuns)) {
        throw new Error('Project activity returned an invalid response. Retry activity.');
      }
      setState({ status: 'ready', events: activity.events, agentRuns: activity.agentRuns, error: '' });
    } catch (error) {
      setState({ status: 'error', events: [], agentRuns: [], error: error.message });
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  const roleName = (role) => role.replaceAll('-', ' ');
  return <section className="workspace-activity-panel" aria-labelledby="project-activity-title">
    <div className="workspace-activity-heading"><div><p className="eyebrow">PERSISTED WORKSPACE EVENTS</p><h3 id="project-activity-title">Project activity</h3><p>Updates recorded for this client project.</p></div><button className="button subtle-button" type="button" onClick={load} disabled={state.status === 'loading'}>{state.status === 'loading' ? 'Refreshing…' : 'Refresh activity'}</button></div>
    {state.status === 'loading' && <p className="workspace-activity-state" role="status">Loading project activity…</p>}
    {state.status === 'error' && <div className="workspace-activity-error" role="alert"><p>{state.error}</p><button className="button subtle-button" type="button" onClick={load}>Retry activity</button></div>}
    {state.status === 'ready' && <div className="workspace-activity-columns">
      <section className="workspace-activity-list" aria-labelledby="project-events-title"><h4 id="project-events-title">Recent updates</h4>
        {state.events.length === 0 ? <p className="workspace-activity-empty">No project activity events have been recorded.</p> : <ol>{state.events.map((event) => <li key={event.id}><span className={`workspace-activity-mark activity-${event.category}`} aria-hidden="true">{event.category === 'jira' ? '↗' : event.category === 'requirements' ? '≋' : event.category === 'agent-settings' ? '◇' : '•'}</span><div><b>{event.label}</b><small>{event.actorDisplayName}</small></div><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time></li>)}</ol>}
      </section>
      <section className="workspace-agent-activity" aria-labelledby="agent-activity-title"><h4 id="agent-activity-title">Agent runs</h4>
        {state.agentRuns.length === 0 ? <p>No agent runs have been recorded for this project. No agents are shown as active.</p> : <ol>{state.agentRuns.map((run) => <li key={run.id}><span><b>{roleName(run.role)}</b><small>{run.status}</small></span><time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString()}</time></li>)}</ol>}
      </section>
    </div>}
  </section>;
}

function ProjectRoomOverview({ project }) {
  return <section className="workspace-room-overview" aria-labelledby="project-room-overview-title">
    <div><p className="eyebrow">DELIVERY ROOM · PERSISTED PROJECT</p><h3 id="project-room-overview-title">Project overview</h3><p>Current project details and recorded updates, with external work shown only when Fieldwork verifies its source.</p></div>
    <div className="workspace-room-cards">
      <article className="workspace-room-card"><span className="workspace-room-icon" aria-hidden="true">⌁</span><div><b>Design handoff</b><span className="workspace-room-status">Figma not connected</span><p>Design files and approval states are unavailable until a real project connection is configured.</p></div></article>
      <article className="workspace-room-card workspace-room-next"><span className="workspace-room-icon" aria-hidden="true">→</span><div><b>Available next action</b><span className="workspace-room-status">Review project requirements</span><p>Open the authenticated Gherkin requirements workspace for this project.</p><a className="button subtle-button" href={`#project-requirements-${project.id}`}>Open requirements <span>↗</span></a></div></article>
    </div>
  </section>;
}

function ProjectDetails({ project, canEdit, onSaveBrief, jiraCallback, onJiraCallbackHandled }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saveBrief = async (form) => {
    setBusy(true);
    setError('');
    try {
      await onSaveBrief(project.id, form);
      setEditing(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };
  return <div className="workspace-project-stack">
    <ProjectRoomOverview project={project} />
    <section className="workspace-project-detail" aria-labelledby="active-project-title">
      <div className="workspace-project-heading"><span className="workspace-project-avatar">{project.name.slice(0, 1).toUpperCase()}</span><div><p className="eyebrow">CLIENT PROJECT · SERVER SAVED</p><h2 id="active-project-title">{project.name}</h2><p>{project.client}</p></div><span className="workspace-saved"><i /> Approved · Persisted</span></div>
      <div className="workspace-brief-grid">
        <article><small>BUSINESS PROBLEM</small><p>{project.problem}</p></article>
        <article><small>TARGET USER</small><p>{project.targetUser}</p></article>
        <article><small>SUCCESS SIGNAL</small><p>{project.successSignal}</p></article>
      </div>
      <div className="workspace-project-footer"><span>Brief approved by {project.briefApprovedBy} · <time dateTime={project.briefApprovedAt}>{new Date(project.briefApprovedAt).toLocaleString()}</time></span><span>Created <time dateTime={project.createdAt}>{new Date(project.createdAt).toLocaleDateString()}</time> · Workspace access checked on every request</span>{canEdit && <button className="workspace-edit-brief" type="button" onClick={() => { setEditing(true); setError(''); }}>Edit approved brief</button>}</div>
    </section>
    {editing && <BriefEditor project={project} onCancel={() => setEditing(false)} onSave={saveBrief} busy={busy} error={error} />}
    <JiraConnectionPanel project={project} canEdit={canEdit} callbackResult={jiraCallback} onCallbackHandled={onJiraCallbackHandled} />
    <ProjectActivityPanel key={`activity-${project.id}`} projectId={project.id} />
    <RequirementsPanel project={project} canEdit={canEdit} />
    <AgentProviderPanel project={project} canEdit={canEdit} />
  </div>;
}

function EmptyStudioState({ onCreate }) {
  return <section className="studio-home-state studio-empty-state" aria-labelledby="studio-empty-title">
    <span className="studio-state-mark" aria-hidden="true">＋</span>
    <p className="eyebrow">A CLEAR START</p>
    <h2 id="studio-empty-title">Your first client project starts with a brief.</h2>
    <p>Describe the client, the problem to solve, who it affects, and how success will be measured. Nothing is saved until you submit the approved brief.</p>
    <button className="button primary-button" type="button" onClick={onCreate}>Create your first brief <span>↗</span></button>
  </section>;
}

function ProjectSelectionState({ onCreate }) {
  return <section className="studio-home-state studio-selection-state" aria-labelledby="studio-selection-title">
    <span className="studio-state-mark" aria-hidden="true">⌁</span>
    <p className="eyebrow">STUDIO OVERVIEW</p>
    <h2 id="studio-selection-title">Choose a project to open its room.</h2>
    <p>Your project details and connected work appear after you select a project from the workspace list.</p>
    <button className="button subtle-button" type="button" onClick={onCreate}>＋ Start another brief</button>
  </section>;
}

export default function Workspace() {
  const [jiraReturn] = useState(readJiraCallback);
  const handledJiraReturn = useRef(false);
  const handleJiraCallbackHandled = useCallback(() => { handledJiraReturn.current = true; }, []);
  const [state, setState] = useState({ loading: true, session: null, projects: [], selectedId: null, creatingProject: false, projectListStatus: 'loading', projectListError: '', setupError: null, signInError: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const loadProjects = useCallback(async () => {
    setState((current) => ({ ...current, projectListStatus: 'loading', projectListError: '', projects: [], selectedId: null, creatingProject: false }));
    try {
      const { projects } = await api('/api/projects');
      const callbackProjectId = jiraReturn?.projectId && projects.some((project) => project.id === jiraReturn.projectId) ? jiraReturn.projectId : null;
      setState((current) => ({ ...current, projectListStatus: 'ready', projectListError: '', projects, selectedId: callbackProjectId }));
    } catch (error) {
      if (error.status === 401) {
        setState((current) => ({ ...current, loading: false, session: null, projects: [], selectedId: null, projectListStatus: 'ready', projectListError: '', signInError: 'Your workspace session expired. Sign in again.' }));
      } else if (error.code === 'SETUP_REQUIRED') {
        setState((current) => ({ ...current, loading: false, session: null, projects: [], selectedId: null, projectListStatus: 'ready', projectListError: '', setupError: error }));
      } else {
        setState((current) => ({ ...current, projectListStatus: 'error', projectListError: 'We could not load your client projects. Your workspace session is still active; retry to check the saved project list.' }));
      }
    }
  }, [jiraReturn]);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, setupError: null, signInError: '' }));
    try {
      const { user, workspace } = await api('/api/session');
      setState((current) => ({ ...current, loading: false, session: { user, workspace }, projects: [], selectedId: null, projectListStatus: 'loading', projectListError: '', setupError: null, signInError: '' }));
      await loadProjects();
    } catch (error) {
      if (error.code === 'SETUP_REQUIRED' || error.code === 'WORKSPACE_UNAVAILABLE') {
        setState((current) => ({ ...current, loading: false, session: null, projects: [], selectedId: null, projectListStatus: 'ready', projectListError: '', setupError: error, signInError: '' }));
      } else if (error.status === 401) {
        setState((current) => ({ ...current, loading: false, session: null, projects: [], selectedId: null, projectListStatus: 'ready', projectListError: '', setupError: null, signInError: '' }));
      } else {
        setState((current) => ({ ...current, loading: false, session: null, projects: [], selectedId: null, projectListStatus: 'ready', projectListError: '', setupError: null, signInError: 'The workspace could not be reached. Check the connection and try again.' }));
      }
    }
  }, [loadProjects]);

  useEffect(() => { load(); }, [load]);

  const createProject = async (form, creationRequestId) => {
    setBusy(true);
    setFormError('');
    try {
      const { project } = await api('/api/projects', { method: 'POST', body: JSON.stringify({ ...form, creationRequestId }) });
      setState((current) => ({ ...current, projects: [project, ...current.projects], selectedId: project.id, creatingProject: false }));
      return true;
    } catch (error) {
      setFormError({ message: error.message, field: error.field, outcomeUnknown: error.code === 'PROJECT_OUTCOME_UNCONFIRMED' || error.outcomeUnknown });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const checkSavedProject = async (creationRequestId) => {
    const { projects } = await api('/api/projects');
    const savedProject = projects.find((project) => project.creationRequestId === creationRequestId);
    if (!savedProject) return 'not-found';
    setState((current) => ({ ...current, projects, selectedId: savedProject.id, creatingProject: false }));
    setFormError('');
    return 'found';
  };

  const saveProjectBrief = async (projectId, form) => {
    const { project } = await api(`/api/projects/${projectId}`, { method: 'PUT', body: JSON.stringify(form) });
    setState((current) => ({ ...current, projects: current.projects.map((item) => item.id === projectId ? project : item) }));
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
  if (!state.session) return <SignIn initialError={jiraReturn?.outcome === 'sign_in_required' ? jiraCallbackMessages.sign_in_required : state.signInError} />;

  const projectListView = resolveWorkspaceProjectListView({ status: state.projectListStatus, projects: state.projects, selectedId: state.selectedId });
  const selectedProject = projectListView.selectedProject;
  const callbackProjectExists = jiraReturn?.projectId && state.projects.some((project) => project.id === jiraReturn.projectId);
  const projectListConfirmed = projectListView.kind === 'projects' || projectListView.kind === 'empty';
  const showJiraCallbackGlobally = jiraReturn && !handledJiraReturn.current && (
    !jiraReturn.projectId || (projectListConfirmed && !callbackProjectExists)
  );
  return <main className="workspace-page workspace-authenticated">
    <header className="workspace-topbar">
      <div className="workspace-brand"><span className="brand-mark">f</span><span>FIELDWORK<small>AI PRODUCT STUDIO</small></span></div>
      <div className="workspace-user"><span><b>{state.session.workspace.name}</b><small>{state.session.user.email}</small></span><button className="button subtle-button" type="button" onClick={signOut}>Sign out</button></div>
    </header>
    {showJiraCallbackGlobally && <p className="workspace-alert jira-global-notice" role="status">{jiraReturn.projectId ? 'The Jira authorization could not be matched to a client project in this workspace. No connection was changed.' : jiraCallbackMessages[jiraReturn.outcome]}</p>}
    {state.session.user.role === 'owner' && <WorkspaceInvitation />}
    <section className="workspace-content">
      <div className="workspace-page-heading"><div><p className="eyebrow"><span className="live-dot" /> YOUR WORKSPACE</p><h1>Your studio, in motion.</h1><p>Client projects saved to <strong>{state.session.workspace.name}</strong> appear here.</p></div>{projectListView.count !== null && <div className="workspace-project-count"><b>{projectListView.count}</b><span>{projectListView.count === 1 ? 'PROJECT' : 'PROJECTS'} IN WORKSPACE</span></div>}</div>
      <div className="workspace-layout">
        <nav className="workspace-project-list" aria-label="Client projects" aria-busy={projectListView.kind === 'loading'}>
          <div className="workspace-list-heading"><b>PROJECTS</b>{projectListView.count !== null && <span>{projectListView.count}</span>}</div>
          {projectListView.kind === 'loading' && <p className="workspace-list-message" role="status">Loading your projects…</p>}
          {projectListView.projects.map((project) => <button key={project.id} type="button" aria-pressed={project.id === state.selectedId} className={`workspace-project-option ${project.id === state.selectedId ? 'selected' : ''}`} onClick={() => setState((current) => ({ ...current, selectedId: project.id, creatingProject: false }))}><span className="workspace-option-mark" aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</span><span><b>{project.name}</b><small>{project.client}</small></span><span className="option-chevron" aria-hidden="true">›</span></button>)}
          {projectListView.kind === 'empty' && <p className="workspace-list-message">No saved projects yet</p>}
          {projectListView.kind === 'error' && <p className="workspace-list-message">Project list unavailable</p>}
        </nav>
        <div className="workspace-main-panel">
          {projectListView.kind === 'loading' && <p className="studio-inline-status" role="status">Loading your workspace projects…</p>}
          {projectListView.kind === 'error' && <section className="studio-home-state studio-error-state" aria-labelledby="studio-project-error-title"><span className="studio-state-mark" aria-hidden="true">!</span><p className="eyebrow">PROJECT LIST UNAVAILABLE</p><h2 id="studio-project-error-title">Your projects could not be loaded.</h2><p>{state.projectListError}</p><button className="button primary-button" type="button" onClick={loadProjects}>Retry project list <span>↻</span></button></section>}
          {projectListView.kind === 'empty' && !state.creatingProject && <EmptyStudioState onCreate={() => setState((current) => ({ ...current, creatingProject: true }))} />}
          {projectListView.kind === 'projects' && !selectedProject && !state.creatingProject && <ProjectSelectionState onCreate={() => setState((current) => ({ ...current, creatingProject: true }))} />}
          {state.creatingProject && <ProjectForm onCreate={createProject} onCheckSaved={checkSavedProject} onClearError={() => setFormError('')} onCancel={() => { setState((current) => ({ ...current, creatingProject: false })); setFormError(''); }} busy={busy} error={formError} />}
          {selectedProject && !state.creatingProject && <ProjectDetails key={selectedProject.id} project={selectedProject} canEdit={state.session.user.role === 'owner'} onSaveBrief={saveProjectBrief} jiraCallback={jiraReturn?.projectId === selectedProject.id && !handledJiraReturn.current ? jiraReturn : null} onJiraCallbackHandled={handleJiraCallbackHandled} />}
          {projectListView.kind === 'projects' && !state.creatingProject && <button className="workspace-add-project" type="button" onClick={() => setState((current) => ({ ...current, selectedId: null, creatingProject: true }))}>＋ Start another brief</button>}
        </div>
      </div>
      <footer className="workspace-footer"><span>◈ Workspace isolation is enforced by the API.</span><a href="/demo">Open prototype demo ↗</a></footer>
    </section>
  </main>;
}
