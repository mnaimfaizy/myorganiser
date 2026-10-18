import { describe, expect, test } from '@jest/globals';
import express from 'express';
import type { Server } from 'net';
import request from 'supertest';

// supertestLoopback.ts is a Jest setup file for this project. Every backend
// suite that drives an app with `request(app)` depends on it binding 127.0.0.1:
// on the wildcard, another process holding the same port on loopback answers
// instead (issue #1169). These tests pin that it is installed and still works
// through each way the suites call supertest.

let lastServer: Server | undefined;

function makeApp() {
  const app = express();
  app.get('/whoami', (req, res) => {
    lastServer = (req.socket as typeof req.socket & { server: Server }).server;
    res.json({ localAddress: req.socket.localAddress });
  });
  return app;
}

describe('supertest binds its ephemeral server to 127.0.0.1', () => {
  test('request(app) is served from a 127.0.0.1 listener, not the wildcard', async () => {
    const res = await request(makeApp()).get('/whoami');

    expect(res.status).toBe(200);
    // A dual-stack wildcard listener reports '::ffff:127.0.0.1' here.
    expect(res.body.localAddress).toBe('127.0.0.1');
  });

  test('the server supertest started is closed after the response', async () => {
    await request(makeApp()).get('/whoami');

    expect(lastServer?.listening).toBe(false);
  });

  test('the callback form with .expect still sends and asserts', (done) => {
    request(makeApp()).get('/whoami').expect(200, done);
  });

  test('concurrent requests each reach their own app', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => request(makeApp()).get('/whoami')),
    );

    expect(results.map((res) => res.body.localAddress)).toEqual(
      Array(10).fill('127.0.0.1'),
    );
  });

  test('an agent reuses one app across sequential requests', async () => {
    const agent = request.agent(makeApp());

    const first = await agent.get('/whoami');
    const second = await agent.get('/whoami');

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body.localAddress).toBe('127.0.0.1');
  });

  test('a server the suite already listens on is used as given', async () => {
    const server = makeApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const res = await request(server).get('/whoami');

      expect(res.status).toBe(200);
      expect(server.listening).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
