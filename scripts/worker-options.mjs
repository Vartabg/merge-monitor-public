import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { localWorkerOrigin } from './worker-client.mjs';
import { workerUuid } from './worker-files.mjs';

export async function validateWorkerOptions(options) {
  for (const key of ['project', 'agent'])
    if (typeof options[key] !== 'string' || !options[key].trim() || options[key].length > 120 || [...options[key]].some(char => char.codePointAt(0) < 32 || char.codePointAt(0) === 127))
      throw new Error('Supply a project and unique agent identity.');
  if (!workerUuid.test(options.assignmentId) || options.adapter !== 'codex' ||
      !Number.isInteger(options.seconds) || options.seconds < 10 || options.seconds > 180)
    throw new Error('Use one assignment UUID, the codex adapter, and 10..180 seconds.');
  if (!isAbsolute(options.cwd) || !(await stat(options.cwd)).isDirectory())
    throw new Error('Supply an existing absolute working directory.');
  if (options.resultDir && !isAbsolute(options.resultDir)) throw new Error('Use an absolute result directory.');
  localWorkerOrigin(options.origin);
  return options;
}
export async function parseWorkerArgs(args) {
  if (args[0] !== 'once') throw new Error('Use once with an explicit assignment, cwd, adapter and seconds.');
  const values = {}, allowed = ['--project', '--agent', '--assignment', '--cwd', '--adapter', '--seconds', '--origin', '--result-dir'];
  for (let i = 1; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || Object.hasOwn(values, args[i]))
      throw new Error('Provide each supported worker option once, with a value.');
    values[args[i]] = args[i + 1];
  }
  return validateWorkerOptions({ project: values['--project'], agent: values['--agent'],
    assignmentId: values['--assignment'], cwd: values['--cwd'] || '', adapter: values['--adapter'],
    seconds: Number(values['--seconds']), origin: values['--origin'], resultDir: values['--result-dir'] });
}
