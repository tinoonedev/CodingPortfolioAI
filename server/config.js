const REQUIRED_VARIABLES = [
  'DATABASE_URL',
  'STUDIO_WORKSPACE_ID',
  'STUDIO_WORKSPACE_NAME',
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function readRuntimeConfig(env = process.env) {
  const isDevelopment = env.NODE_ENV !== 'production';
  const missing = REQUIRED_VARIABLES.filter((name) => !env[name]?.trim());
  const invalid = [];
  const rawAppOrigin = (env.APP_ORIGIN || (isDevelopment ? 'http://127.0.0.1:4173' : '')).trim();
  let appOrigin = '';
  const workspaceId = env.STUDIO_WORKSPACE_ID?.trim();
  const rawPort = env.PORT || env.API_PORT || '3001';
  const rawTrustProxyHops = env.TRUST_PROXY_HOPS || '0';
  const port = /^\d+$/.test(rawPort) ? Number.parseInt(rawPort, 10) : Number.NaN;
  const trustProxyHops = /^\d+$/.test(rawTrustProxyHops) ? Number.parseInt(rawTrustProxyHops, 10) : Number.NaN;

  if (rawAppOrigin) {
    try {
      const parsed = new URL(rawAppOrigin);
      const secureProtocol = parsed.protocol === 'https:' || (isDevelopment && parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
      if (!secureProtocol || parsed.username || parsed.password || parsed.search || parsed.hash) invalid.push('APP_ORIGIN');
    } catch {
      invalid.push('APP_ORIGIN');
    }
  }
  if (rawAppOrigin) {
    try {
      const parsed = new URL(rawAppOrigin);
      if (parsed.pathname !== '/' || parsed.search || parsed.hash) invalid.push('APP_ORIGIN');
      appOrigin = parsed.origin;
    } catch {
      invalid.push('APP_ORIGIN');
    }
  }
  if (workspaceId && !UUID_PATTERN.test(workspaceId)) invalid.push('STUDIO_WORKSPACE_ID');
  if (env.DATABASE_URL && !/^postgres(?:ql)?:\/\//i.test(env.DATABASE_URL)) invalid.push('DATABASE_URL');
  if (!isDevelopment && env.DATABASE_SSL !== 'true') invalid.push('DATABASE_SSL');
  if (!isDevelopment && !env.APP_ORIGIN?.trim()) missing.push('APP_ORIGIN');
  if (!Number.isInteger(port) || port < 1 || port > 65535) invalid.push('PORT');
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) invalid.push('TRUST_PROXY_HOPS');

  return {
    ready: missing.length === 0 && invalid.length === 0,
    missing: [...new Set(missing)],
    invalid: [...new Set(invalid)],
    isDevelopment,
    databaseUrl: env.DATABASE_URL,
    databaseSsl: env.DATABASE_SSL === 'true',
    appOrigin,
    workspaceId,
    workspaceName: env.STUDIO_WORKSPACE_NAME?.trim(),
    port,
    trustProxyHops,
    cookieName: isDevelopment ? 'fieldwork_session' : '__Host-fieldwork_session',
  };
}

export function validateClientProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, error: 'Project details must be an object.' };
  }
  if (input.approved !== true) {
    return { valid: false, error: 'The project brief must be explicitly approved before it is saved.' };
  }

  const limits = {
    name: 70,
    client: 70,
    problem: 500,
    targetUser: 250,
    successSignal: 250,
  };
  const project = {};

  for (const [field, maxLength] of Object.entries(limits)) {
    const value = input[field];
    if (typeof value !== 'string') {
      return { valid: false, error: `${field} must be text.` };
    }
    const trimmed = value.trim();
    if (!trimmed) return { valid: false, error: `${field} is required.` };
    if (trimmed.length > maxLength) {
      return { valid: false, error: `${field} must be ${maxLength} characters or fewer.` };
    }
    project[field] = trimmed;
  }

  return { valid: true, project };
}
