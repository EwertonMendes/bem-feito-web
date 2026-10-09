import assert from 'node:assert/strict';
const provider = 'projects/312978463343/locations/global/workloadIdentityPools/github-data/providers/github';
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.notEqual(process.env.GITHUB_REF, 'refs/heads/master');
const audience = `//iam.googleapis.com/${provider}`;
const tokenUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
tokenUrl.searchParams.set('audience', audience);
const tokenResponse = await fetch(tokenUrl, { headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
assert.equal(tokenResponse.status, 200);
const jwt = (await tokenResponse.json()).value;
const response = await fetch('https://sts.googleapis.com/v1/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audience, grantType: 'urn:ietf:params:oauth:grant-type:token-exchange', requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token', subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt', subjectToken: jwt, scope: 'https://www.googleapis.com/auth/cloud-platform' }) });
// Never print the GitHub JWT, response access token, or SDK authorization headers.
assert.ok([400, 403].includes(response.status), 'Untrusted branch unexpectedly received Google credentials');
const error = await response.json();
assert.ok(!error.access_token && ['invalid_grant', 'unauthorized_client', 'invalid_request'].includes(error.error), 'Unexpected STS response');
assert.match(String(error.error_description), /attribute condition|attribute mapping|attribute.*environment|environment.*(exist|present)/i, 'Denial must come from provider trust validation, not a malformed token-exchange request');
console.log(JSON.stringify({ result: 'UNTRUSTED_WORKFLOW_DENIED', status: response.status, reason: error.error }));
