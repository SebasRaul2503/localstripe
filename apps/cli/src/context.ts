import type { Command } from 'commander';
import { LocalStripe, type List } from '@localstripe/sdk';
import {
  credentialsPath,
  readFileIfExists,
  resolveApiKey,
  resolveApiUrl,
  type Env,
  type GlobalOptions,
  type ReadFile,
} from './config.js';
import { createColors, renderDetails, renderTable, type Colors } from './format.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Env;
  color: boolean;
  readFile?: ReadFile;
  fetch?: typeof fetch;
}

export class CliError extends Error {}

/** Shared services for command actions: option resolution, the SDK client and output. */
export class CliContext {
  readonly colors: Colors;

  constructor(readonly io: CliIo) {
    this.colors = createColors(io.color);
  }

  options(command: Command): GlobalOptions {
    return command.optsWithGlobals<GlobalOptions>();
  }

  apiUrl(command: Command): string {
    return resolveApiUrl(this.options(command), this.io.env);
  }

  client(command: Command, { requireKey = true } = {}): LocalStripe {
    const options = this.options(command);
    const apiKey = resolveApiKey(options, this.io.env, this.io.readFile ?? readFileIfExists);
    if (!apiKey && requireKey) {
      throw new CliError(
        `No API key found. Pass --api-key, set LOCALSTRIPE_API_KEY, or run inside the API container (${credentialsPath(this.io.env)}).`,
      );
    }
    return new LocalStripe({
      apiKey,
      baseUrl: resolveApiUrl(options, this.io.env),
      maxNetworkRetries: 1,
      ...(this.io.fetch && { fetch: this.io.fetch }),
    });
  }

  json(command: Command): boolean {
    return Boolean(this.options(command).json);
  }

  print(text: string): void {
    this.io.stdout(`${text}\n`);
  }

  printJson(value: unknown): void {
    this.print(JSON.stringify(value, null, 2));
  }

  printList<T>(
    command: Command,
    list: List<T>,
    headers: string[],
    toRow: (item: T) => string[],
  ): void {
    if (this.json(command)) return this.printJson(list);
    if (list.data.length === 0) return this.print(this.colors.dim('No results.'));
    this.print(renderTable(headers, list.data.map(toRow), this.colors));
    if (list.has_more) {
      this.print(this.colors.dim(`\nShowing ${list.data.length}; more available (use --limit).`));
    }
  }

  printObject(command: Command, object: object): void {
    if (this.json(command)) return this.printJson(object);
    this.print(renderDetails(object as Record<string, unknown>, this.colors));
  }
}
