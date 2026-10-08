import { validateGherkinRequirements } from './gherkinRequirements.js';

export const JIRA_AGENT_ROLES = Object.freeze({
  'business-analyst': '[BA]',
  'project-manager': '[PM]',
  'product-designer': '[Designer]',
  'qa-analyst': '[QA]',
  'frontend-developer': '[FE Dev]',
  'backend-developer': '[BE Dev]',
  'integration-engineer': '[Integration]',
  'security-engineer': '[Security]',
  'test-automation-engineer': '[Test Automation]',
  'delivery-engineer': '[Delivery]',
  'devops-engineer': '[DevOps]',
});

const MAX_TEXT_LENGTH = 4_000;
const MAX_GHERKIN_LENGTH = 60_000;
const MAX_NOTES = 12;

function requiredText(value, field, limit = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new TypeError(`${field} must be non-empty text within the allowed length.`);
  }
  return value.trim();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function renderText(value) {
  return escapeHtml(value).replace(/\r\n?/g, '\n').replace(/\n/g, '<br />');
}

const GHERKIN_KEYWORD_COLORS = Object.freeze({
  Feature: '#403294',
  Rule: '#403294',
  Background: '#403294',
  Scenario: '#0747a6',
  'Scenario Outline': '#0747a6',
  Examples: '#0747a6',
  Given: '#006644',
  When: '#0747a6',
  Then: '#bf2600',
  And: '#008da6',
  But: '#bf2600',
});

function renderGherkin(gherkin) {
  const lines = gherkin.split(/\r?\n/);
  return lines.map((line, index) => {
    const match = line.match(/^(\s*)(Scenario Outline|Background|Examples|Feature|Scenario|Rule|Given|When|Then|And|But)(?=\s|:)/);
    const tag = line.match(/^(\s*)(@[A-Za-z0-9_-]+)(?=\s|$)/);
    const indent = match?.[1] ?? tag?.[1] ?? '';
    const indentHtml = '&nbsp;'.repeat([...indent].reduce((size, character) => size + (character === '\t' ? 2 : 1), 0));
    let content = escapeHtml(line.slice(indent.length));
    if (match) {
      const keyword = match[2];
      const safeKeyword = escapeHtml(keyword);
      const rest = escapeHtml(line.slice(indent.length + keyword.length));
      content = `<strong><span style="color: ${GHERKIN_KEYWORD_COLORS[keyword]}">${safeKeyword}</span></strong>${rest}`;
    } else if (tag) {
      const safeTag = escapeHtml(tag[2]);
      const rest = escapeHtml(line.slice(indent.length + tag[2].length));
      content = `<strong><span style="color: #6554c0">${safeTag}</span></strong>${rest}`;
    }
    return `${indentHtml}${content}${index < lines.length - 1 ? '<br />' : ''}`;
  }).join('');
}

function renderList(items, field) {
  if (items === undefined) return '';
  if (!Array.isArray(items) || items.length > MAX_NOTES) {
    throw new TypeError(`${field} must contain no more than ${MAX_NOTES} entries.`);
  }
  if (!items.length) return '';
  return `<ul>${items.map((item) => `<li>${renderText(requiredText(item, field))}</li>`).join('')}</ul>`;
}

export function formatJiraAgentComment(role, message) {
  if (!Object.hasOwn(JIRA_AGENT_ROLES, role)) throw new TypeError('A recognized authoring agent role is required.');
  const prefix = JIRA_AGENT_ROLES[role];
  const safeMessage = renderText(requiredText(message, 'Comment'));
  return `<p><strong>${prefix}</strong> ${safeMessage}</p>`;
}

export function renderJiraFeatureDescription(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('A Jira feature description is required.');
  }
  const allowedFields = new Set(['actor', 'capability', 'outcome', 'gherkin', 'productDecision', 'implementationNotes', 'outOfScope']);
  if (Object.keys(input).some((field) => !allowedFields.has(field))) {
    throw new TypeError('The Jira feature description contains an unsupported field.');
  }
  const actor = requiredText(input.actor, 'Actor', 200);
  const capability = requiredText(input.capability, 'Capability', 500);
  const outcome = requiredText(input.outcome, 'Outcome', 500);
  const gherkin = requiredText(input.gherkin, 'Gherkin', MAX_GHERKIN_LENGTH);
  const validation = validateGherkinRequirements(gherkin);
  if (!validation.valid) throw new TypeError('The Gherkin acceptance criteria are invalid.');

  const productDecision = input.productDecision === undefined
    ? ''
    : `<div data-type="panel-info"><p><strong>Product decision</strong> ${renderText(requiredText(input.productDecision, 'Product decision'))}</p></div>`;
  const implementationNotes = renderList(input.implementationNotes, 'Implementation note');
  const outOfScope = renderList(input.outOfScope, 'Out of scope item');
  return [
    productDecision,
    '<h2>Feature</h2>',
    `<p>As a ${renderText(actor)}<br />I want ${renderText(capability)}<br />So that ${renderText(outcome)}</p>`,
    '<h2>Gherkin acceptance criteria</h2>',
    `<div data-type="panel-note"><p>${renderGherkin(gherkin)}</p></div>`,
    implementationNotes ? `<h2>Implementation notes</h2>${implementationNotes}` : '',
    outOfScope ? `<h2>Out of scope</h2>${outOfScope}` : '',
  ].filter(Boolean).join('');
}
