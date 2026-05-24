export interface IssueDraft {
  number: number;
  title: string;
  body: string;
}

export interface PublishedIssue {
  number: number;
  title: string;
  url: string;
}

export interface PublishResult {
  created: PublishedIssue[];
  localFallback: string[];
  skipped: string[];
  outputDir: string;
}

export interface PublishDeps {
  execGh(args: string[]): { ok: boolean; stdout: string; stderr: string };
  confirm(prompt: string): Promise<boolean>;
  writeFile(path: string, content: string): void;
  mkdir(path: string): void;
}
