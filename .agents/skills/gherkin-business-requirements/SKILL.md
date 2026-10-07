---
name: gherkin-business-requirements
description: Write precise business requirements and acceptance criteria as testable Gherkin scenarios before implementation.
---

# Gherkin business requirements

1. Read the approved Jira task and confirm its human comment gate before starting.
2. Write requirements in `.agents/templates/feature-requirements.feature` format. Use `Feature`, `Rule`, and one behavior per `Scenario`, with `Given` preconditions, `When` action, and `Then` observable result.
3. Name the actor and system boundary. Include permissions, state, data conditions, failure behavior, and externally visible side effects when relevant.
4. Use measurable thresholds for words such as fast, recent, large, or secure. Replace subjective terms with explicit values and conditions.
5. Keep implementation details out unless they are a constraint. Separate confirmed requirements, assumptions, and open questions.
6. Ask QA to challenge coverage and return ambiguous scenarios to the business owner. Do not let developers invent missing business behavior.
7. Link every scenario to Jira and its smoke, sanity, or regression coverage before marking scope ready.
