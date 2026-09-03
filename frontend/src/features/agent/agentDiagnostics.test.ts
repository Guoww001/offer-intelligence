import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentDiagnostics from './AgentDiagnostics.vue';
import { normalizeDiagnosticLog } from './agentDiagnostics';
const log = normalizeDiagnosticLog({ version: 1, turns: [{ prompt: 'Tapo', language: 'zh', history: [], memory: {}, response: '', status: 'error', errorCode: 'failed', steps: [] }] });
afterEach(() => vi.unstubAllGlobals());
describe('Diagnostic upload and replay controls', () => {
  it('uploads only on request and keeps retry available after server failure', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, id: 'case-id' }) });
    vi.stubGlobal('fetch', fetch);
    const wrapper = mount(AgentDiagnostics, { props: { language: 'zh', turns: log.turns, running: false } });
    expect(fetch).not.toHaveBeenCalled();
    await wrapper.get('[data-agent-log-upload]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('上传失败');
    expect(wrapper.get('[data-agent-log-upload]').attributes('disabled')).toBeUndefined();
    await wrapper.get('[data-agent-log-upload]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('case-id');
    expect(fetch).toHaveBeenCalledWith('/api/chat/stream?operation=agent_debug', expect.objectContaining({ credentials: 'same-origin', method: 'POST' }));
    wrapper.unmount();
  });
  it('imports a file without running it, then replays the selected original context', async () => {
    const wrapper = mount(AgentDiagnostics, { props: { language: 'en', turns: [], running: false } });
    const input = wrapper.get('[data-agent-log-import]');
    Object.defineProperty(input.element, 'files', { value: [{ size: 100, text: async () => JSON.stringify(log) }], configurable: true });
    await input.trigger('change'); await flushPromises();
    expect(wrapper.emitted('replay')).toBeUndefined();
    await wrapper.get('[data-agent-log-replay]').trigger('click');
    expect(wrapper.emitted('replay')?.[0]?.[0]).toEqual(log.turns[0]);
    wrapper.unmount();
  });
});
