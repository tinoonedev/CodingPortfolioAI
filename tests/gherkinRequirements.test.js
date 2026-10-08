import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_REQUIREMENTS_LENGTH, validateGherkinRequirements } from '../src/domain/gherkinRequirements.js';

const validFeature = `Feature: Save client requirements
  As a workspace owner
  I want to store reviewable requirements
  So that approved work keeps a clear scope

  Rule: Every scenario is observable
    Scenario: Owner saves a valid revision
      Given the owner has an approved client brief
      And the owner is signed in
      When the owner saves the requirements
      Then the revision is stored with its scenarios
      But the browser never receives a provider credential
`;

test('accepts structured Gherkin and returns stable scenario identifiers', () => {
  const first = validateGherkinRequirements(validFeature);
  const second = validateGherkinRequirements(validFeature);

  assert.equal(first.valid, true);
  assert.deepEqual(first.issues, []);
  assert.equal(first.scenarios.length, 1);
  assert.equal(first.scenarios[0].name, 'Owner saves a valid revision');
  assert.equal(first.scenarios[0].id, second.scenarios[0].id);
  assert.equal(first.scenarios[0].type, 'Scenario');
});

test('supports Scenario Outline, Examples, tags, and feature-level user story', () => {
  const outline = validFeature.replace(
    'Scenario: Owner saves a valid revision\n      Given the owner has an approved client brief\n      And the owner is signed in\n      When the owner saves the requirements\n      Then the revision is stored with its scenarios\n      But the browser never receives a provider credential',
    '@smoke\n    Scenario Outline: Owner saves a <kind> revision\n      Given the owner has an approved client brief\n      When the owner saves a <kind> revision\n      Then the revision is stored\n\n      Examples:\n        | kind |\n        | full |\n        | small |',
  );
  const result = validateGherkinRequirements(outline);

  assert.equal(result.valid, true);
  assert.equal(result.scenarios[0].type, 'Scenario Outline');
  assert.deepEqual(result.scenarios[0].tags, ['@smoke']);
});

test('rejects a generic actor and reports missing scenario steps', () => {
  const invalid = validFeature
    .replace('As a workspace owner', 'As a user')
    .replace('      When the owner saves the requirements\n', '');
  const result = validateGherkinRequirements(invalid);

  assert.equal(result.valid, false);
  assert.ok(result.issues.some(({ code }) => code === 'REAL_ACTOR_REQUIRED'));
  assert.ok(result.issues.some(({ code }) => code === 'STEP_WHEN_REQUIRED'));
  assert.ok(result.issues.every(({ message }) => !message.includes('approved client brief')));
});

test('reports malformed Gherkin without returning the submitted content', () => {
  const result = validateGherkinRequirements('Feature: Secret customer project\n  Scenario: invalid\n    Given setup\n    When action\n    Then outcome\n    And');

  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, 'INVALID_GHERKIN');
  assert.equal(JSON.stringify(result).includes('Secret customer project'), false);
});

test('rejects empty and oversized documents before parsing', () => {
  assert.equal(validateGherkinRequirements(' ').issues[0].code, 'EMPTY_REQUIREMENTS');
  const oversized = validateGherkinRequirements('x'.repeat(MAX_REQUIREMENTS_LENGTH + 1));
  assert.equal(oversized.issues[0].code, 'REQUIREMENTS_TOO_LONG');
});
