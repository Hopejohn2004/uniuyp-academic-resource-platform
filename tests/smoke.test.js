const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

test('application exports an Express app', () => {
  assert.equal(typeof app, 'function');
});

test('public login route is available', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/login`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Welcome Back/);
    assert.match(body, /csrfToken/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
