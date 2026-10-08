import { formatJiraAgentComment, renderJiraFeatureDescription } from '../src/domain/jiraContent.js';

const MAX_INPUT_BYTES = 80_000;

async function readInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new Error('Input too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

try {
  const request = await readInput();
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid input.');
  if (request.type === 'feature-description') {
    if (Object.keys(request).some((key) => !['type', 'input'].includes(key))) throw new Error('Invalid input.');
    process.stdout.write(`${renderJiraFeatureDescription(request.input)}\n`);
  } else if (request.type === 'agent-comment') {
    if (Object.keys(request).some((key) => !['type', 'role', 'message'].includes(key))) throw new Error('Invalid input.');
    process.stdout.write(`${formatJiraAgentComment(request.role, request.message)}\n`);
  } else {
    throw new Error('Invalid input.');
  }
} catch {
  process.stderr.write('Jira content rendering failed. Check the request shape, role, and Gherkin syntax.\n');
  process.exitCode = 1;
}
