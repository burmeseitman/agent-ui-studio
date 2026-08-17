// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LivePreview } from './LivePreview';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LivePreview', () => {
  it('renders raw HTML content directly in the sandboxed iframe', () => {
    render(<LivePreview rawHtml="<h1>Calculator App</h1>" onClose={vi.fn()} />);

    expect(screen.getByText('HTML Preview')).toBeDefined();
    const iframe = screen.getByTitle('Live App Preview') as HTMLIFrameElement;
    expect(iframe).toBeDefined();
    expect(iframe.srcdoc).toContain('<h1>Calculator App</h1>');
  });

  it('fetches and renders workspace HTML files', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'read_file',
          output: '<html><body><button id="btn">7</button></body></html>',
        }),
      }))
    );

    render(<LivePreview filePath="scientific-calculator-app/index.html" onClose={vi.fn()} />);

    expect(screen.getByText('scientific-calculator-app/index.html')).toBeDefined();

    await waitFor(() => {
      const iframe = screen.getByTitle('Live App Preview') as HTMLIFrameElement;
      expect(iframe.srcdoc).toContain('<button id="btn">7</button>');
    });

    vi.unstubAllGlobals();
  });

  it('displays error notice if file loading fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'read_file',
          error: 'file does not exist',
        }),
      }))
    );

    render(<LivePreview filePath="missing.html" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load missing.html/)).toBeDefined();
    });

    vi.unstubAllGlobals();
  });

  it('allows switching device viewports', async () => {
    render(<LivePreview rawHtml="<p>Test</p>" onClose={vi.fn()} />);

    const mobileBtn = screen.getByTitle('Mobile (375px)');
    const tabletBtn = screen.getByTitle('Tablet (768px)');
    const desktopBtn = screen.getByTitle('Desktop (1024px)');

    await userEvent.click(mobileBtn);
    expect(document.querySelector('.w-\\[375px\\]')).toBeDefined();

    await userEvent.click(tabletBtn);
    expect(document.querySelector('.w-\\[768px\\]')).toBeDefined();

    await userEvent.click(desktopBtn);
    expect(document.querySelector('.w-\\[1024px\\]')).toBeDefined();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(<LivePreview rawHtml="<p>Test</p>" onClose={onClose} />);

    const closeBtn = screen.getByTitle('Close Preview');
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('toggles and clears console log drawer', async () => {
    render(<LivePreview rawHtml="<p>Test</p>" onClose={vi.fn()} />);

    const consoleToggle = screen.getByTitle('Toggle Console Logs');
    await userEvent.click(consoleToggle);

    expect(screen.getByText(/Console Output/i)).toBeDefined();
    expect(screen.getByText('No console messages logged.')).toBeDefined();

    // Trigger clear
    const clearBtn = screen.getByTitle('Clear Console');
    await userEvent.click(clearBtn);
    expect(screen.getByText('No console messages logged.')).toBeDefined();
  });
});
