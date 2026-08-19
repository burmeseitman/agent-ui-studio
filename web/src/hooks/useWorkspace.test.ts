// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useWorkspace } from './useWorkspace';

const createStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
};

let storageMock = createStorageMock();

beforeEach(() => {
  storageMock = createStorageMock();
  Object.defineProperty(window, 'localStorage', {
    value: storageMock,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  storageMock.clear();
  vi.restoreAllMocks();
});

describe('useWorkspace persistence', () => {
  it('loads the saved workspace path from localStorage upon startup', async () => {
    storageMock.setItem('agentui_workspace_path', '/Users/dev/Projects/calculator');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        if (typeof url === 'string' && url.includes('/api/v1/workspace') && init?.method === 'POST') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              path: '/Users/dev/Projects/calculator',
              entries: ['index.html', 'style.css'],
              is_home_dir: false,
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            path: '/Users/dev',
            entries: ['Desktop', 'Downloads'],
            is_home_dir: true,
          }),
        };
      })
    );

    const { result } = renderHook(() => useWorkspace(true));

    await waitFor(() => {
      expect(result.current.workspacePath).toBe('/Users/dev/Projects/calculator');
      expect(result.current.entries).toEqual(['index.html', 'style.css']);
      expect(result.current.isHomeDir).toBe(false);
    });

    vi.unstubAllGlobals();
  });

  it('saves the selected workspace path to localStorage when changed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        if (typeof url === 'string' && url.includes('/api/v1/workspace') && init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              path: body.path,
              entries: ['main.py'],
              is_home_dir: false,
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            path: '/Users/dev',
            entries: [],
            is_home_dir: true,
          }),
        };
      })
    );

    const { result } = renderHook(() => useWorkspace(true));

    await waitFor(() => {
      expect(result.current.workspacePath).toBe('/Users/dev');
    });

    let ok = false;
    await act(async () => {
      ok = await result.current.changeWorkspace('/Users/dev/Projects/python-agent');
    });

    expect(ok).toBe(true);
    await waitFor(() => {
      expect(result.current.workspacePath).toBe('/Users/dev/Projects/python-agent');
    });
    expect(storageMock.getItem('agentui_workspace_path')).toBe('/Users/dev/Projects/python-agent');

    vi.unstubAllGlobals();
  });

  it('falls back to default workspace and clears localStorage if saved path is invalid', async () => {
    storageMock.setItem('agentui_workspace_path', '/Users/dev/Projects/deleted-folder');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        if (typeof url === 'string' && url.includes('/api/v1/workspace') && init?.method === 'POST') {
          return {
            ok: false,
            status: 400,
            text: async () => 'directory does not exist',
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            path: '/Users/dev',
            entries: ['Downloads'],
            is_home_dir: true,
          }),
        };
      })
    );

    const { result } = renderHook(() => useWorkspace(true));

    await waitFor(() => {
      expect(result.current.workspacePath).toBe('/Users/dev');
      expect(result.current.isHomeDir).toBe(true);
    });

    expect(storageMock.getItem('agentui_workspace_path')).toBeNull();

    vi.unstubAllGlobals();
  });
});
