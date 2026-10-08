import { createHash } from 'node:crypto';
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';

export const MAX_REQUIREMENTS_LENGTH = 60_000;

function collectScenarios(children = []) {
  return children.flatMap((child) => {
    if (child.scenario) return [child.scenario];
    if (child.rule) return collectScenarios(child.rule.children);
    return [];
  });
}

function issue(code, message, line) {
  return { code, message, ...(Number.isInteger(line) ? { line } : {}) };
}

function stableScenarioId(scenario, index) {
  const normalizedName = scenario.name.trim().toLocaleLowerCase('en');
  const digest = createHash('sha256').update(`${index}\0${normalizedName}`).digest('hex').slice(0, 20);
  return `scenario-${digest}`;
}

export function validateGherkinRequirements(source) {
  if (typeof source !== 'string' || !source.trim()) {
    return { valid: false, issues: [issue('EMPTY_REQUIREMENTS', 'Enter a Gherkin feature before saving.')] };
  }
  if (source.length > MAX_REQUIREMENTS_LENGTH) {
    return { valid: false, issues: [issue('REQUIREMENTS_TOO_LONG', `Gherkin requirements must be ${MAX_REQUIREMENTS_LENGTH} characters or fewer.`)] };
  }

  let document;
  try {
    const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
    document = parser.parse(source);
  } catch (error) {
    const line = error?.location?.line ?? error?.errors?.[0]?.location?.line;
    return { valid: false, issues: [issue('INVALID_GHERKIN', 'Gherkin syntax could not be parsed. Review the feature keywords and indentation.', line)] };
  }

  const feature = document.feature;
  if (!feature?.name?.trim()) {
    return { valid: false, issues: [issue('FEATURE_REQUIRED', 'Add a named Feature.', feature?.location?.line)] };
  }

  const narrative = feature.description || '';
  const actor = narrative.match(/^\s*As an?\s+([^\r\n]+)\s*$/im)?.[1]?.trim();
  const genericActor = /^(?:a |an )?(?:user|users|person|people|someone|anyone|customer|customers|team|tbd|<.+>)$/i;
  const issues = [];
  if (!actor || genericActor.test(actor)) {
    issues.push(issue('REAL_ACTOR_REQUIRED', 'State a specific actor in the Feature narrative using “As a …” or “As an …”.', feature.location?.line));
  }
  if (!/^\s*I want\s+\S.+$/im.test(narrative)) {
    issues.push(issue('CAPABILITY_REQUIRED', 'State the actor’s observable capability in the Feature narrative using “I want …”.', feature.location?.line));
  }
  if (!/^\s*So that\s+\S.+$/im.test(narrative)) {
    issues.push(issue('OUTCOME_REQUIRED', 'State the intended outcome in the Feature narrative using “So that …”.', feature.location?.line));
  }

  const scenarios = collectScenarios(feature.children);
  if (scenarios.length === 0) {
    issues.push(issue('SCENARIO_REQUIRED', 'Add at least one Scenario or Scenario Outline.', feature.location?.line));
  }

  const scenarioSummaries = scenarios.map((scenario, index) => {
    const keywords = new Set(scenario.steps.map((step) => step.keyword.trim().toLocaleLowerCase('en')));
    const line = scenario.location?.line;
    if (!scenario.name.trim()) {
      issues.push(issue('SCENARIO_NAME_REQUIRED', 'Give every scenario a specific, observable outcome in its title.', line));
    }
    for (const keyword of ['given', 'when', 'then']) {
      if (!keywords.has(keyword)) {
        issues.push(issue(`STEP_${keyword.toUpperCase()}_REQUIRED`, `Scenario “${scenario.name || 'untitled'}” needs an explicit ${keyword} step.`, line));
      }
    }
    return {
      id: stableScenarioId(scenario, index),
      name: scenario.name.trim(),
      type: scenario.keyword,
      line,
      tags: (scenario.tags || []).map((tag) => tag.name),
    };
  });

  return { valid: issues.length === 0, issues, scenarios: scenarioSummaries };
}
