import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { formatJiraAgentComment, JIRA_AGENT_ROLES, renderJiraFeatureDescription } from '../src/domain/jiraContent.js';

const gherkin = `Feature: Save a client brief
  As a workspace owner
  I want to save a validated brief
  So that the team can plan delivery

  Scenario: Save valid requirements
    Given the owner has entered a valid brief
    When the owner saves the requirements
    Then the saved revision is returned`;

test('formats comments with the canonical role prefix and safely encoded text', () => {
  const comment = formatJiraAgentComment('qa-analyst', '<script>alert("x")</script>\nQA evidence');

  assert.match(comment, /^<p><strong>\[QA\]<\/strong> /);
  assert.match(comment, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;<br \/>QA evidence/);
  assert.equal(comment.includes('<script>'), false);
});

test('rejects missing, unknown, and inherited object roles', () => {
  for (const role of ['', 'agent', 'toString', '__proto__']) {
    assert.throws(() => formatJiraAgentComment(role, 'Update'), /recognized authoring agent role/);
  }
  assert.throws(() => formatJiraAgentComment('qa-analyst', '  '), /Comment must be non-empty/);
});

test('exposes a frozen role catalog with visible prefixes', () => {
  assert.equal(Object.isFrozen(JIRA_AGENT_ROLES), true);
  assert.equal(JIRA_AGENT_ROLES['backend-developer'], '[BE Dev]');
  assert.equal(JIRA_AGENT_ROLES['business-analyst'], '[BA]');
});

test('renders Jira semantic sections and colored Gherkin keywords', () => {
  const description = renderJiraFeatureDescription({
    actor: 'workspace owner',
    capability: 'save validated requirements',
    outcome: 'the team can plan delivery',
    productDecision: 'HTML-like input must remain plain text.',
    gherkin,
    implementationNotes: ['Use the selected project connection.'],
    outOfScope: ['Changing Jira permissions.'],
  });

  assert.match(description, /data-type="panel-info"/);
  assert.match(description, /<h2>Feature<\/h2>/);
  assert.match(description, /<h2>Gherkin acceptance criteria<\/h2>/);
  assert.match(description, /<strong><span style="color: #403294">Feature<\/span><\/strong>: Save a client brief/);
  assert.match(description, /<strong><span style="color: #006644">Given<\/span><\/strong>/);
  assert.match(description, /<strong><span style="color: #0747a6">When<\/span><\/strong>/);
  assert.match(description, /<strong><span style="color: #bf2600">Then<\/span><\/strong>/);
  assert.equal(description.includes('language-gherkin'), false);
  assert.match(description, /<h2>Implementation notes<\/h2>/);
  assert.match(description, /<h2>Out of scope<\/h2>/);
});

test('renders untrusted feature content as text and rejects invalid Gherkin', () => {
  const description = renderJiraFeatureDescription({
    actor: '<img src=x onerror=alert(1)>',
    capability: 'save <script> requirements',
    outcome: 'avoid & preserve input',
    gherkin: gherkin.replace('Save a client brief', 'Save <img src=x>'),
    implementationNotes: ['<script>run()</script>'],
  });

  assert.match(description, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(description, /save &lt;script&gt; requirements/);
  assert.match(description, /Save &lt;img src=x&gt;/);
  assert.match(description, /&lt;script&gt;run\(\)&lt;\/script&gt;/);
  assert.equal(description.includes('<img'), false);
  assert.equal(description.includes('<script>'), false);
  assert.throws(() => renderJiraFeatureDescription({ actor: 'owner', capability: 'save', outcome: 'plan', gherkin: 'not gherkin' }), /Gherkin acceptance criteria are invalid/);
  assert.throws(() => renderJiraFeatureDescription({ actor: 'owner', capability: 'save', outcome: 'plan', gherkin, unexpected: 'ignored data' }), /unsupported field/);
});

test('CLI renders formatted Jira content for the MCP authoring workflow', () => {
  const result = spawnSync(process.execPath, ['scripts/render-jira-content.mjs'], {
    encoding: 'utf8',
    input: JSON.stringify({ type: 'agent-comment', role: 'frontend-developer', message: 'Implemented the form.' }),
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^<p><strong>\[FE Dev\]<\/strong> Implemented the form\.<\/p>/);
});

test('CLI fails closed without echoing an invalid Gherkin request', () => {
  const result = spawnSync(process.execPath, ['scripts/render-jira-content.mjs'], {
    encoding: 'utf8',
    input: JSON.stringify({ type: 'feature-description', input: { actor: 'owner', capability: 'save', outcome: 'plan', gherkin: '<script>secret</script>' } }),
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /secret|script/);
});
