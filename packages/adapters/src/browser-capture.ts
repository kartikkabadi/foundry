/** Browser reference capture — summarized requirements only (no raw HTML in artifacts). */

export interface BrowserCaptureResult {
  ok: boolean;
  url: string;
  summary: string;
  message: string;
}

export interface BrowserCaptureAdapter {
  summarizeUrl(url: string): Promise<BrowserCaptureResult>;
  probe(): { ok: boolean; message: string };
}

export function createMockBrowserCaptureAdapter(
  summaryByUrl?: Record<string, string>,
): BrowserCaptureAdapter {
  return {
    probe() {
      return { ok: true, message: 'Browser capture mock available' };
    },
    async summarizeUrl(url: string) {
      const summary =
        summaryByUrl?.[url] ??
        `Requirements snippet from ${url}: capture key UX patterns and constraints without reproducing page HTML.`;
      return {
        ok: true,
        url,
        summary,
        message: 'Mock capture summarized URL',
      };
    },
  };
}

export function createPlaywrightBrowserCaptureAdapter(options: {
  exec: (cmd: string, args: string[]) => { ok: boolean; stdout: string };
}): BrowserCaptureAdapter {
  return {
    probe() {
      const result = options.exec('npx', ['playwright', '--version']);
      if (result.ok) {
        return {
          ok: true,
          message: `Browser capture probe ok (${result.stdout.trim()})`,
        };
      }
      return {
        ok: false,
        message: 'Browser capture unavailable (playwright probe failed).',
      };
    },
    async summarizeUrl(url: string) {
      const probe = this.probe();
      if (!probe.ok) {
        return {
          ok: false,
          url,
          summary: '',
          message: probe.message,
        };
      }
      return {
        ok: true,
        url,
        summary: `Live capture pending for ${url} — use mock in CI.`,
        message: 'Playwright probe passed; summarization requires live browser session.',
      };
    },
  };
}

export function createBrowserCaptureAdapter(
  exec?: (cmd: string, args: string[]) => { ok: boolean; stdout: string },
): BrowserCaptureAdapter {
  if (process.env.FOUNDRY_BROWSER_MOCK === '1' || !exec) {
    return createMockBrowserCaptureAdapter();
  }
  return createPlaywrightBrowserCaptureAdapter({ exec });
}
