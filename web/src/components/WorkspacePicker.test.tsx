// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspacePicker, WorkspaceControls } from './WorkspacePicker';

function controls(overrides: Partial<WorkspaceControls> = {}): WorkspaceControls {
  return {
    workspacePath: '/Users/dev/Projects/my-app',
    entries: ['src/', 'package.json', 'README.md'],
    isHomeDir: false,
    error: null,
    isChanging: false,
    canPickFolder: false,
    pickWorkspace: vi.fn(),
    changeWorkspace: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe('WorkspacePicker', () => {
  it('shows which folder the agent will work in before any prompt', () => {
    render(<WorkspacePicker workspace={controls()} variant="hero" />);
    expect(screen.getByText('my-app')).toBeDefined();
    expect(screen.getByText(/Projects\/my-app/)).toBeDefined();
  });

  it('warns when the workspace is still the home folder', () => {
    render(
      <WorkspacePicker
        workspace={controls({ workspacePath: '/Users/dev', isHomeDir: true, entries: [] })}
        variant="hero"
      />
    );
    // The default is almost never the project the user means.
    expect(screen.getByText(/This is your home folder/i)).toBeDefined();
  });

  it('opens the native folder picker on the desktop', async () => {
    const pickWorkspace = vi.fn();
    render(
      <WorkspacePicker workspace={controls({ canPickFolder: true, pickWorkspace })} variant="hero" />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    expect(pickWorkspace).toHaveBeenCalledTimes(1);
  });

  it('falls back to typing a path in the browser', async () => {
    const changeWorkspace = vi.fn();
    render(<WorkspacePicker workspace={controls({ changeWorkspace })} variant="hero" />);

    await userEvent.click(screen.getByRole('button', { name: 'Set folder' }));
    const input = screen.getByLabelText('Workspace folder path') as HTMLInputElement;

    // Pre-filled and selected, so typing replaces rather than appends — the
    // earlier behaviour produced "/Users/dev/Users/dev/...".
    expect(input.value).toBe('/Users/dev/Projects/my-app');
    await waitFor(() => expect(input.selectionEnd).toBe(input.value.length));
    expect(input.selectionStart).toBe(0);

    await userEvent.clear(input);
    await userEvent.type(input, '/Users/dev/other');
    await userEvent.click(screen.getByRole('button', { name: 'Set workspace' }));

    expect(changeWorkspace).toHaveBeenCalledWith('/Users/dev/other');
  });

  it('surfaces a rejected path', () => {
    render(
      <WorkspacePicker
        workspace={controls({ error: 'workspace path is not a directory' })}
        variant="hero"
      />
    );
    expect(screen.getByText(/not a directory/)).toBeDefined();
  });

  it('keeps the folder reachable from the composer once chatting', async () => {
    const changeWorkspace = vi.fn();
    render(<WorkspacePicker workspace={controls({ changeWorkspace })} variant="bar" />);

    expect(screen.getByText(/Projects\/my-app/)).toBeDefined();
    await userEvent.click(screen.getByText('change'));
    expect(screen.getByLabelText('Workspace folder path')).toBeDefined();
  });
});
