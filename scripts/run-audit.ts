import { spawn } from 'node:child_process';

const procs: ReturnType<typeof spawn>[] = [];
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    procs.forEach(p => p.kill(sig));
    process.exit(1);
  });
}

function runLabeled(cmd: string[], label: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    procs.push(proc);

    const prefix = (line: string) => process.stdout.write(`${label} ${line}\n`);

    let stdoutBuf = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop()!;
      lines.forEach(prefix);
    });

    let stderrBuf = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop()!;
      lines.forEach(prefix);
    });

    proc.on('close', (code) => {
      if (stdoutBuf) prefix(stdoutBuf);
      if (stderrBuf) prefix(stderrBuf);
      resolve(code ?? 1);
    });
  });
}

const [playwrightCode, personaCode] = await Promise.all([
  runLabeled(['npm', 'run', 'test:audit'], '[playwright]'),
  runLabeled(['npm', 'run', 'discover:agentic'], '[persona]'),
]);

if (playwrightCode !== 0) {
  console.error(`[run-audit] Playwright audit failed with code ${playwrightCode}`);
  process.exit(1);
}

if (personaCode !== 0) {
  console.warn(`[run-audit] WARN: discover:agentic exited with code ${personaCode} — continuing`);
}
