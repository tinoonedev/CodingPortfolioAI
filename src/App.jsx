import { Fragment, useEffect, useRef, useState } from 'react';

const stages = [
  { number: '01', icon: '⌕', title: 'Discover', detail: 'Problem, users & success criteria', state: 'complete', status: '✓ COMPLETE', owner: 'AL', name: 'Alex', role: 'Business analyst', footer: 'Brief · WAY-21', note: '2 artifacts' },
  { number: '02', icon: '▤', title: 'Plan & design', detail: 'Stories, flows & wireframes', state: 'active-stage', status: '● IN PROGRESS', owner: 'MK', name: 'Mika', role: 'Project manager', footer: 'WAY-22 · WAY-24', note: '1 of 2 ready', progress: 62 },
  { number: '03', icon: '⌘', title: 'Build', detail: 'Frontend + backend delivery', state: 'waiting', status: 'UP NEXT', owner: 'FE', name: 'Frontend & API', role: 'Developer agents', footer: 'WAY-25 · WAY-26', note: '2 stories', pair: true },
  { number: '04', icon: '⌁', title: 'Verify', detail: 'Test, review & fix', state: 'waiting', status: 'UP NEXT', owner: 'QA', name: 'Quinn', role: 'QA analyst', footer: 'WAY-27', note: 'Test plan drafted' },
  { number: '05', icon: '↗', title: 'Deliver', detail: 'PR, CI/CD & preview', state: 'waiting', status: 'UP NEXT', owner: 'DV', name: 'Devon', role: 'Delivery engineer', footer: 'WAY-28', note: 'Release approval' },
];

const agents = [
  { initials: 'AL', tone: 'avatar-analyst', name: 'Alex Lee', role: 'Business analyst', state: 'DELIVERED', stateClass: 'state-done', taskLabel: 'LAST DELIVERABLE', task: 'Product brief · WAY-21', detail: 'Problem framing and acceptance criteria', footer: '✳ 2 artifacts', time: '4 min ago' },
  { initials: 'MK', tone: 'avatar-pm', name: 'Mika Kim', role: 'Project manager', state: 'WORKING', stateClass: 'state-working', taskLabel: 'ACTIVE TASK', task: 'Refining stories · WAY-24', detail: 'Waiting for an answer on saved trips', footer: '◷ 3 updates', time: 'Active now' },
  { initials: 'FI', tone: 'avatar-designer', name: 'Fia Ito', role: 'Product designer', state: 'NEEDS INPUT', stateClass: 'state-blocked', taskLabel: 'BLOCKED BY', task: 'Open product question', detail: 'Wireframe is paused until scope is clear', footer: '◇ Figma handoff', time: '12 min ago' },
  { initials: 'QA', tone: 'avatar-qa', name: 'Quinn Avery', role: 'QA analyst', state: 'READY', stateClass: 'state-ready', taskLabel: 'NEXT UP', task: 'Review acceptance criteria', detail: 'Draft test plan and tag coverage', footer: '⌁ Test planning', time: 'Standing by' },
  { initials: 'FE', tone: 'avatar-fe', name: 'Frontend + API', role: 'Developer agents', state: 'READY', stateClass: 'state-ready', taskLabel: 'NEXT UP', task: 'Build saved trips', detail: 'Two scoped stories queued in Jira', footer: '⌘ Code delivery', time: 'Standing by', pair: true },
  { initials: 'DV', tone: 'avatar-delivery', name: 'Devon Vale', role: 'Delivery engineer', state: 'READY', stateClass: 'state-ready', taskLabel: 'OWNS RELEASE', task: 'PR, CI/CD & preview', detail: 'Production release stays human-approved', footer: '↗ Release pipeline', time: 'Standing by' },
];

const artifacts = [
  { icon: '▤', tone: 'brief', title: 'Product brief & acceptance criteria', meta: 'Alex · WAY-21 · Updated 18 min ago', type: 'DOCUMENT' },
  { icon: '◈', tone: 'figma', title: 'Saved trips — wireframe v1', meta: 'Fia · WAY-24 · Waiting for your input', type: 'FIGMA' },
  { icon: '⌁', tone: 'qa', title: 'Initial QA coverage proposal', meta: 'Quinn · WAY-23 · 8 scenarios tagged', type: 'TEST PLAN' },
  { icon: '◆', tone: 'jira', title: 'Implementation stories', meta: 'Mika · WAY-25, WAY-26 · Ready for build', type: 'JIRA' },
];

const events = [
  { icon: '?', tone: 'marker-question', title: 'Alex asked a question about saved trips', body: 'Clarification requested before wireframes and acceptance criteria are finalized.', label: 'WAY-24 · Analyst → You', time: '12 min' },
  { icon: '◆', tone: 'marker-jira', title: 'Mika updated Jira story WAY-24', body: 'Status moved to Needs clarification. Design work paused until product scope is resolved.', label: 'JIRA · Product planning', time: '16 min' },
  { icon: '◈', tone: 'marker-figma', title: 'Fia attached a first wireframe', body: 'Dashboard and trip detail flow are ready to review. Saved trips screen is pending.', label: 'FIGMA · 1 artifact', time: '28 min' },
  { icon: '✓', tone: 'marker-done', title: 'Alex completed the product brief', body: 'Problem statement, target users, constraints, and measurable success criteria recorded.', label: 'WAY-21 · 2 artifacts', time: '42 min' },
  { icon: '✳', tone: 'marker-system', title: 'Project workflow started', body: 'Demo run initialized with Jira, Figma, GitHub, and preview deployment connectors in simulated mode.', label: 'SYSTEM · DEMO RUN', time: '1 hr' },
];

const tabs = [
  { id: 'workflow', label: 'Workflow', count: '7' },
  { id: 'team', label: 'Team', count: '8' },
  { id: 'artifacts', label: 'Artifacts', count: '12' },
  { id: 'activity', label: 'Activity' },
];

const PROJECT_STORAGE_KEY = 'fieldwork.client-projects.v1';
const SELECTED_PROJECT_KEY = 'fieldwork.selected-project.v1';
const sampleProjects = [
  { id: 'waypoint', name: 'Waypoint', client: 'Waypoint, Inc.', color: 'lime', demo: true, description: 'A calm, clear home base for independent travel planners.' },
  { id: 'juniper', name: 'Juniper Market', client: 'Sample client', color: 'orange', placeholder: true },
  { id: 'atlas', name: 'Atlas Care', client: 'Sample client', color: 'blue', placeholder: true },
];

function readSavedProjects() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PROJECT_STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function readSelectedProject() {
  try {
    return window.localStorage.getItem(SELECTED_PROJECT_KEY) || 'waypoint';
  } catch {
    return 'waypoint';
  }
}

function Avatar({ initials, tone, pair }) {
  if (pair) return <span className="mini-avatars"><i className="avatar-fe">FE</i><i className="avatar-be">BE</i></span>;
  return <span className={`agent-avatar ${tone}`}>{initials}</span>;
}

function Sidebar({ activeView, onNavigate, onConnections, projects, selectedProjectId, onSelectProject, onCreateProject }) {
  const nav = [
    { id: 'overview', icon: '◫', name: 'Overview' },
    { id: 'project', icon: '▦', name: 'Projects', count: String(projects.filter((project) => !project.placeholder).length) },
    { id: 'activity', icon: '◷', name: 'Activity' },
    { id: 'agents', icon: '✳', name: 'Agent team' },
  ];
  return (
    <aside className="sidebar">
      <a className="brand" href="#overview"><span className="brand-mark">f</span><span>FIELDWORK<small>AI PRODUCT STUDIO</small></span></a>
      <button className="workspace-switch" type="button" onClick={onConnections}><span className="workspace-icon">N</span><span><small>WORKSPACE</small><b>Northstar Studio</b></span><span className="chevron">⌄</span></button>
      <p className="side-label">STUDIO</p>
      <nav className="side-nav" aria-label="Studio navigation">
        {nav.map((item) => <button key={item.id} className={`nav-item ${activeView === item.id ? 'active' : ''}`} type="button" onClick={() => onNavigate(item.id)}><span>{item.icon}</span>{item.name}{item.count && <i>{item.count}</i>}</button>)}
      </nav>
      <div className="side-projects">
        <p className="side-label">YOUR PROJECTS <button type="button" aria-label="Create client project" onClick={onCreateProject}>+</button></p>
        {projects.map((project) => <button key={project.id} className={`project-link ${project.id === selectedProjectId ? 'selected' : ''}`} type="button" onClick={() => onSelectProject(project)}><span className={`project-dot ${project.color || 'lime'}`} /><span>{project.name}</span>{project.id === selectedProjectId && <small>ACTIVE</small>}</button>)}
      </div>
      <div className="sidebar-bottom">
        <button className="integration-status" id="connections-button" type="button" onClick={onConnections}><span className="connection-icon">↗</span><span><b>Jira site</b><small>Detected · browser link pending</small></span><span className="connection-dot" /></button>
        <div className="user-profile"><span className="user-avatar">TN</span><span><b>Tino Navarro</b><small>Studio owner</small></span><span className="more">···</span></div>
      </div>
    </aside>
  );
}

function StageCard({ stage }) {
  return <article className={`stage-card ${stage.state}`}>
    <div className="stage-top"><span className="stage-number">{stage.number}</span><span className="stage-status">{stage.status}</span></div>
    <div className="stage-icon">{stage.icon}</div><h3>{stage.title}</h3><p>{stage.detail}</p>
    <div className="stage-owner"><Avatar initials={stage.owner} tone={`avatar-${stage.owner.toLowerCase()}`} pair={stage.pair} /><span>{stage.name}<small>{stage.role}</small></span></div>
    {stage.progress && <div className="stage-progress"><span style={{ width: `${stage.progress}%` }} /></div>}
    <div className="stage-footer"><a href="#workflow">{stage.footer} <span>↗</span></a><span>{stage.note}</span></div>
  </article>;
}

function WorkflowPanel({ paused, onPause }) {
  return <section className="panel workflow-panel">
    <div className="workflow-summary"><div><h2>Delivery workflow</h2><p>Work advances through Jira. Each handoff includes an owner and a check.</p></div><div className="workflow-legend"><span><i className="legend-active" /> In progress</span><span><i className="legend-blocked" /> Needs input</span><span><i className="legend-done" /> Complete</span></div></div>
    <div className="pipeline" id="workflow">{stages.map((stage, index) => <Fragment key={stage.number}><StageCard stage={stage} />{index < stages.length - 1 && <div className={`handoff ${index === 0 ? 'done-handoff' : ''}`}><span>{index === 0 ? '↗' : '→'}</span></div>}</Fragment>)}</div>
    <div className="workflow-foot"><span><i className="live-dot" /> Last handoff: Mika updated WAY-24 <b>· 4 min ago</b></span><button id="pause-run" type="button" onClick={onPause}>{paused ? '▶' : 'Ⅱ'} <span>{paused ? 'Resume workflow' : 'Pause workflow'}</span></button></div>
  </section>;
}

function TeamPanel() {
  return <section className="panel"><div className="subpanel-heading"><div><h2>Your agent team</h2><p>Specialists take ownership of Jira work and hand off with evidence.</p></div><span className="team-online"><i /> 3 ACTIVE</span></div><div className="agent-grid">
    {agents.map((agent) => <article className={`agent-card ${agent.stateClass === 'state-working' ? 'working' : ''}`} key={agent.name}>
      <div className="agent-card-head"><Avatar initials={agent.initials} tone={agent.tone} pair={agent.pair} /><span className={`agent-state ${agent.stateClass}`}>{agent.stateClass === 'state-working' && <i />}{agent.state}</span></div>
      <h3>{agent.name}</h3><p>{agent.role}</p><div className="agent-task"><small>{agent.taskLabel}</small><b>{agent.task}</b><span>{agent.detail}</span></div><div className="agent-card-foot">{agent.footer}<span>{agent.time}</span></div>
    </article>)}
  </div></section>;
}

function ArtifactsPanel() {
  return <section className="panel"><div className="subpanel-heading"><div><h2>Project artifacts</h2><p>Reviewable outputs attached to their Jira work.</p></div><button className="filter-button" type="button">↕ <span>Newest first</span></button></div><div className="artifact-list">
    {artifacts.map((artifact) => <a className="artifact-row" href="#artifact" key={artifact.title}><span className={`artifact-icon ${artifact.tone}`}>{artifact.icon}</span><span className="artifact-main"><b>{artifact.title}</b><small>{artifact.meta}</small></span><span className="artifact-type">{artifact.type}</span><span className="artifact-arrow">↗</span></a>)}
  </div></section>;
}

function ActivityPanel() {
  return <section className="panel"><div className="subpanel-heading"><div><h2>Activity trail</h2><p>Recorded project events across agents, Jira, Figma, and delivery.</p></div><span className="demo-note">SEEDED DEMO EVENTS</span></div><div className="activity-list">
    {events.map((event) => <div className="activity-row" key={event.title}><span className={`activity-marker ${event.tone}`}>{event.icon}</span><div><b>{event.title}</b><p>{event.body}</p><small>{event.label}</small></div><time>{event.time}</time></div>)}
  </div></section>;
}

function IntakePanel({ project, onEdit }) {
  return <section className="panel intake-panel">
    <div className="subpanel-heading"><div><h2>Client intake</h2><p>Your starter brief is saved in this browser and ready for discovery.</p></div><span className="demo-note">LOCAL DRAFT</span></div>
    <div className="intake-overview"><div className="intake-mark">{project.name.slice(0, 1).toUpperCase()}</div><div><h3>{project.name}</h3><p>{project.client}</p></div><span className="intake-status">SCOPE NOT REVIEWED</span></div>
    <div className="intake-grid">
      <article><small>BUSINESS PROBLEM</small><p>{project.problem}</p></article>
      <article><small>TARGET USER</small><p>{project.targetUser}</p></article>
      <article><small>SUCCESS SIGNAL</small><p>{project.successSignal}</p></article>
    </div>
    <div className="intake-next"><span className="intake-next-icon">→</span><div><b>Next: review and shape the scope</b><p>After discovery, connect this project to Jira and let the delivery team create its first issues.</p></div><button className="button subtle-button" type="button" onClick={onEdit}>Edit intake</button></div>
  </section>;
}

function NewProjectDialog({ dialogRef, projectToEdit, onCreate, onUpdate }) {
  const emptyForm = { name: '', client: '', problem: '', targetUser: '', successSignal: '' };
  const [form, setForm] = useState(() => projectToEdit ? { name: projectToEdit.name, client: projectToEdit.client, problem: projectToEdit.problem, targetUser: projectToEdit.targetUser, successSignal: projectToEdit.successSignal } : emptyForm);
  useEffect(() => setForm(projectToEdit ? { name: projectToEdit.name, client: projectToEdit.client, problem: projectToEdit.problem, targetUser: projectToEdit.targetUser, successSignal: projectToEdit.successSignal } : emptyForm), [projectToEdit]);
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const submit = (event) => {
    event.preventDefault();
    if (projectToEdit) onUpdate(projectToEdit.id, form);
    else onCreate(form);
    setForm({ name: '', client: '', problem: '', targetUser: '', successSignal: '' });
  };
  return <dialog className="answer-dialog project-dialog" ref={dialogRef}>
    <form onSubmit={submit}>
      <button className="dialog-close" type="button" aria-label="Close" onClick={() => dialogRef.current?.close()}>×</button>
      <span className="dialog-icon project-dialog-icon">＋</span><p className="eyebrow">{projectToEdit ? 'EDIT CLIENT INTAKE' : 'NEW CLIENT PROJECT'}</p><h2>{projectToEdit ? 'Refine the brief.' : 'Start with the idea.'}</h2>
      <p className="dialog-description">Capture the outcome and the people it should help. This creates a local intake draft; no Jira issues or agent runs start yet.</p>
      <div className="intake-form-grid">
        <label>Project name<input required maxLength="70" value={form.name} onChange={update('name')} placeholder="e.g. Waypoint" /></label>
        <label>Client name<input required maxLength="70" value={form.client} onChange={update('client')} placeholder="e.g. Waypoint, Inc." /></label>
        <label className="form-wide">What problem should this solve?<textarea required maxLength="500" rows="3" value={form.problem} onChange={update('problem')} placeholder="Describe the business problem and why it matters..." /></label>
        <label>Who is it for?<textarea required maxLength="250" rows="2" value={form.targetUser} onChange={update('targetUser')} placeholder="The people who will use it..." /></label>
        <label>How will success look?<textarea required maxLength="250" rows="2" value={form.successSignal} onChange={update('successSignal')} placeholder="An outcome we can measure..." /></label>
      </div>
      <div className="dialog-actions"><button className="button subtle-button" type="button" onClick={() => dialogRef.current?.close()}>Cancel</button><button className="button primary-button" type="submit">{projectToEdit ? 'Save intake' : 'Create intake'} <span>↗</span></button></div>
    </form>
  </dialog>;
}

function Dialog({ dialogRef, children, className = '' }) {
  return <dialog className={`answer-dialog ${className}`} ref={dialogRef}><form method="dialog"><button className="dialog-close" aria-label="Close">×</button>{children}</form></dialog>;
}

export default function App() {
  const [savedProjects, setSavedProjects] = useState(readSavedProjects);
  const projects = [...sampleProjects, ...savedProjects];
  const [selectedProjectId, setSelectedProjectId] = useState(readSelectedProject);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || sampleProjects[0];
  const isDemo = Boolean(selectedProject.demo);
  const [activePanel, setActivePanel] = useState('workflow');
  const [activeView, setActiveView] = useState('project');
  const [answer, setAnswer] = useState('');
  const [paused, setPaused] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef();
  const answerDialog = useRef(null);
  const connectionDialog = useRef(null);
  const projectDialog = useRef(null);
  const answerInput = useRef(null);
  const [projectToEdit, setProjectToEdit] = useState(null);

  const persistProjects = (nextProjects) => {
    setSavedProjects(nextProjects);
    try {
      window.localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(nextProjects));
    } catch {
      notify('Could not save this intake in browser storage.');
    }
  };

  const createProject = (fields) => {
    const project = { ...fields, id: window.crypto?.randomUUID?.() || `project-${Date.now()}`, color: 'lime', demo: false, createdAt: new Date().toISOString() };
    persistProjects([project, ...savedProjects]);
    setSelectedProjectId(project.id);
    try { window.localStorage.setItem(SELECTED_PROJECT_KEY, project.id); } catch { /* Selection still works for this session. */ }
    setActiveView('project');
    setActivePanel('workflow');
    projectDialog.current?.close();
    notify('Client intake created and saved locally.');
  };

  const updateProject = (id, fields) => {
    persistProjects(savedProjects.map((project) => project.id === id ? { ...project, ...fields } : project));
    projectDialog.current?.close();
    notify('Client intake updated.');
  };

  const openNewProject = () => {
    setProjectToEdit(null);
    window.setTimeout(() => projectDialog.current?.showModal(), 0);
  };

  const openEditProject = () => {
    setProjectToEdit(selectedProject);
    window.setTimeout(() => projectDialog.current?.showModal(), 0);
  };

  const selectProject = (project) => {
    if (project.placeholder) {
      notify('This sample project is a placeholder. Create an intake to start a client project.');
      return;
    }
    setSelectedProjectId(project.id);
    try { window.localStorage.setItem(SELECTED_PROJECT_KEY, project.id); } catch { /* Selection still works for this session. */ }
    setActiveView('project');
    setActivePanel('workflow');
    setAnswer('');
  };

  const notify = (message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3200);
  };

  const openAnswer = () => {
    setAnswer('');
    answerDialog.current?.showModal();
    window.setTimeout(() => answerInput.current?.focus(), 0);
  };

  const submitAnswer = (value) => {
    if (!value.trim()) return;
    setAnswer(value.trim());
    answerDialog.current?.close();
    notify('Answer recorded in this demo project. Jira is not connected.');
  };

  const navigate = (view) => {
    setActiveView(view);
    if (view === 'activity') setActivePanel('activity');
    else if (view === 'agents') setActivePanel('team');
    else setActivePanel('workflow');
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify('Project room link copied.');
    } catch {
      notify('Copy this page URL to share the project room.');
    }
  };

  return <div className="app-shell">
    <Sidebar activeView={activeView} onNavigate={navigate} onConnections={() => connectionDialog.current?.showModal()} projects={projects} selectedProjectId={selectedProject.id} onSelectProject={selectProject} onCreateProject={openNewProject} />
    <main className="main-area" id="project">
      <header className="topbar"><div className="breadcrumbs"><span>Projects</span><b>/</b><strong>{selectedProject.name}</strong><span className={`demo-pill ${isDemo ? '' : 'intake-pill'}`}><i /> {isDemo ? 'DEMO RUN' : 'LOCAL INTAKE'}</span></div><div className="top-actions"><button className="icon-button" type="button" aria-label="Notifications">♧<i className="notification-dot" /></button><span className="top-divider" /><button className="help-button" type="button">? <span>Help</span></button></div></header>
      <div className="content">
        <section className="project-heading"><div><div className="eyebrow"><span className="live-dot" /> CLIENT PROJECT <span className="eyebrow-divider">/</span> {isDemo ? 'WEB APP' : 'INTAKE DRAFT'}</div><h1>{selectedProject.name} <span className="heading-menu">⌄</span></h1><p className="project-subtitle">{selectedProject.description || selectedProject.problem}</p></div><div className="heading-actions"><button className="button subtle-button" id="share-button" type="button" onClick={share}><span>↗</span> Share room</button><button className="button primary-button" id="new-run" type="button" onClick={() => notify('Live agent runs are not configured yet.')} disabled={!isDemo}><span>✳</span> Start a run</button></div></section>
        {isDemo ? <div className="project-meta-row"><div className="meta-group"><span className="client-avatar">W</span><span>Waypoint, Inc.</span><span className="meta-separator">·</span><span className="jira-mark">◆</span><a href="#workflow">WAY-24</a><span className="meta-separator">·</span><span>Updated 4 min ago</span></div><div className="health"><span className="health-ring">72</span><span><b>On track</b><small>2 items need attention</small></span><span className="health-chevron">⌄</span></div></div> : <div className="project-meta-row intake-meta"><div className="meta-group"><span className="client-avatar">{selectedProject.client.slice(0, 1).toUpperCase()}</span><span>{selectedProject.client}</span><span className="meta-separator">·</span><span>LOCAL DRAFT · Saved in this browser</span></div></div>}
        {isDemo && <section className="attention-card" id="attention"><div className="attention-icon">{answer ? '✓' : '?'}</div><div className="attention-copy"><div className="attention-kicker">{answer ? 'ANSWER RECORDED' : 'NEEDS YOUR INPUT'} <span>·</span> WAY-24</div><h2>{answer ? 'Answer shared with Alex' : 'Where should saved trips appear?'}</h2><p>{answer ? `Your answer: “${answer}” This demo records the choice locally; connect Jira to write it to WAY-24.` : 'The analyst found one open question in the brief. Clarifying it now keeps design and development aligned.'}</p>{!answer && <div className="answer-options"><button className="answer-option" type="button" onClick={() => submitAnswer('A dedicated Saved trips page')}>A dedicated Saved trips page <span>↗</span></button><button className="answer-option" type="button" onClick={() => submitAnswer('A section on the dashboard')}>A section on the dashboard <span>↗</span></button><button className="answer-option custom-answer" type="button" onClick={openAnswer}>Add a different answer <span>＋</span></button></div>}</div><div className="attention-owner"><Avatar initials="AL" tone="avatar-analyst" /><span><b>Alex · Analyst</b><small>Asked 12 min ago</small></span></div></section>}
        {isDemo && <div className="section-tabs" role="tablist" aria-label="Project sections">{tabs.map((tab) => <button key={tab.id} className={`tab ${activePanel === tab.id ? 'active' : ''}`} role="tab" aria-selected={activePanel === tab.id} type="button" onClick={() => setActivePanel(tab.id)}>{tab.label}{tab.count && <span className="tab-count">{tab.count}</span>}</button>)}<div className="tab-spacer" /><button className="filter-button" type="button">☷ <span>Filter</span></button><button className="more-button" type="button" aria-label="More options">···</button></div>}
        <div className="panel-stack">{isDemo ? <><div className={activePanel === 'workflow' ? '' : 'hidden'}><WorkflowPanel paused={paused} onPause={() => setPaused((value) => !value)} /></div><div className={activePanel === 'team' ? '' : 'hidden'}><TeamPanel /></div><div className={activePanel === 'artifacts' ? '' : 'hidden'}><ArtifactsPanel /></div><div className={activePanel === 'activity' ? '' : 'hidden'}><ActivityPanel /></div></> : <IntakePanel project={selectedProject} onEdit={openEditProject} />}</div>
        <footer className="project-footer"><span><i className="shield-icon">◈</i> Activity is auditable. Human approval required for scope changes &amp; production release.</span><a href="#settings">Run settings ↗</a></footer>
      </div>
    </main>
    {toast && <div className="toast visible" role="status" aria-live="polite">{toast}</div>}
    <Dialog dialogRef={answerDialog}><span className="dialog-icon">?</span><p className="eyebrow">CLARIFICATION · WAY-24</p><h2>Tell Alex what you want.</h2><p className="dialog-description">Your answer will be added to the Jira story and shared with the design and delivery agents.</p><label htmlFor="answer-input">Your direction</label><textarea id="answer-input" ref={answerInput} rows="4" placeholder="For example: show saved trips as a section on the dashboard..." value={answer} onChange={(event) => setAnswer(event.target.value)} /><div className="dialog-actions"><button className="button subtle-button" value="cancel">Cancel</button><button className="button primary-button" type="button" onClick={() => submitAnswer(answer)}>Send answer <span>↗</span></button></div></Dialog>
    <Dialog dialogRef={connectionDialog} className="connection-dialog"><span className="dialog-icon connection-dialog-icon">↗</span><p className="eyebrow">PROJECT CONNECTIONS</p><h2>Connected tools</h2><p className="dialog-description">The Atlassian connector in this Codex session can access the site. The static project room has no app-side OAuth or sync yet, so Waypoint remains seeded demo data.</p><a className="site-link" href="https://tinoonegithub.atlassian.net/" target="_blank" rel="noreferrer">tinoonegithub.atlassian.net <span>↗</span></a><div className="site-project"><span className="project-dot blue" /><span><b>TinoDevTeam</b><small>SCRUM · Jira Software project</small></span><span className="site-available">AVAILABLE HERE</span></div><div className="site-project"><span className="figma-connection-icon">◈</span><span><b>Figma</b><small>Not connected in this workspace</small></span><span className="site-pending">PENDING</span></div><div className="connection-next">Next app-side step <span>Build OAuth-backed Jira and Figma connections, then let the studio owner select the client project and design file.</span></div><div className="dialog-actions"><button className="button subtle-button" value="close">Close</button></div></Dialog>
    <NewProjectDialog dialogRef={projectDialog} projectToEdit={projectToEdit} onCreate={createProject} onUpdate={updateProject} />
  </div>;
}
