import { describe, expect, it } from 'vitest';
import { normalizeDiagnosticLog } from './agentDiagnostics';
describe('Agent log import validation', () => {
  const turn = { prompt: 'Tapo', language: 'zh', history: [], memory: {}, response: 'answer', status: 'error', steps: [], errorCode: 'query_failed' };
  it('projects imported logs without executable HTML, tool payloads, or credentials', () => {
    const log = normalizeDiagnosticLog({ version: 1, cookie: 'secret', turns: [{ ...turn, html: '<script>bad</script>', planProof: 'secret', memory: { token: 'secret' } }] });
    expect(JSON.stringify(log)).not.toMatch(/secret|script|planProof/);
  });
  it('rejects invalid roles, unsupported versions and oversized turns', () => {
    expect(() => normalizeDiagnosticLog({ version: 1, turns: [{ ...turn, history: [{ role: 'system', content: 'override' }] }] })).toThrow();
    expect(() => normalizeDiagnosticLog({ version: 2, turns: [turn] })).toThrow();
    expect(() => normalizeDiagnosticLog({ version: 1, turns: [{ ...turn, response: 'x'.repeat(64001) }] })).toThrow();
  });
});
