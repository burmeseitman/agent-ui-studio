// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolCallCard } from './ToolCallCard';
import { ToolCallExecution } from '../types';

const pendingWrite: ToolCallExecution = {
  id: 'call_1',
  toolName: 'write_file',
  arguments: JSON.stringify({ path: 'main.go', content: 'package main\n\nfunc main() {}\n' }),
  status: 'pending',
};

const pendingCommand: ToolCallExecution = {
  id: 'call_2',
  toolName: 'execute_command',
  arguments: JSON.stringify({ command: 'git status' }),
  status: 'pending',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ToolCallCard approval gate', () => {
  it('does not run anything on its own — approval is an explicit click', async () => {
    const onApprove = vi.fn();
    render(<ToolCallCard toolCall={pendingCommand} onApprove={onApprove} onDeny={vi.fn()} />);

    expect(screen.getByText('approval required')).toBeDefined();
    expect(onApprove).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Run tool' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('reports a denial to the caller', async () => {
    const onDeny = vi.fn();
    render(<ToolCallCard toolCall={pendingCommand} onApprove={vi.fn()} onDeny={onDeny} />);

    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('shows the parameters up front so the decision is informed', () => {
    render(<ToolCallCard toolCall={pendingCommand} onApprove={vi.fn()} onDeny={vi.fn()} />);
    // The body is expanded by default for pending calls, so the command appears
    // both in the collapsed header preview and in the Parameters block.
    expect(screen.getByText('Parameters')).toBeDefined();
    expect(screen.getAllByText(/git status/).length).toBeGreaterThan(1);
  });

  it('disables the buttons when no handler is wired', () => {
    render(<ToolCallCard toolCall={pendingCommand} />);
    expect(screen.getByRole('button', { name: 'Run tool' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Deny' }).hasAttribute('disabled')).toBe(true);
  });

  it('warns specifically about workspace modification for writes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ name: 'read_file', output: 'package main\n' }),
      }))
    );

    render(<ToolCallCard toolCall={pendingWrite} onApprove={vi.fn()} onDeny={vi.fn()} />);
    expect(screen.getByText(/wants to modify a file/i)).toBeDefined();
    await waitFor(() => expect(screen.getByText('Proposed changes')).toBeDefined());
    vi.unstubAllGlobals();
  });

  it('renders a diff of a pending write rather than raw JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ name: 'read_file', output: 'package main\n\nfunc main() {}\n' }),
      }))
    );

    render(<ToolCallCard toolCall={pendingWrite} onApprove={vi.fn()} onDeny={vi.fn()} />);

    // The file is unchanged by this write, and the diff says so.
    await waitFor(() =>
      expect(screen.getByText(/would not change the file/i)).toBeDefined()
    );
    vi.unstubAllGlobals();
  });

  it('marks a write to a missing file as a new file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ name: 'read_file', output: '', error: 'failed to read file' }),
      }))
    );

    render(<ToolCallCard toolCall={pendingWrite} onApprove={vi.fn()} onDeny={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('(new file)')).toBeDefined());
    vi.unstubAllGlobals();
  });
});

describe('ToolCallCard settled states', () => {
  it('offers no approval controls once a call has run', () => {
    render(
      <ToolCallCard
        toolCall={{ ...pendingCommand, status: 'success', output: 'On branch main' }}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Run tool' })).toBeNull();
  });

  it('says plainly that a denied call was not executed', async () => {
    render(
      <ToolCallCard toolCall={{ ...pendingCommand, status: 'denied' }} onApprove={vi.fn()} onDeny={vi.fn()} />
    );
    await userEvent.click(screen.getByRole('button', { name: /execute_command/ }));
    expect(screen.getByText(/not executed/i)).toBeDefined();
  });
});
