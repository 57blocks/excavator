import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep, posix } from 'node:path';

export class ProjectBoundaryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProjectBoundaryError';
    this.code = 'containment';
  }
}

function inside(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Bind one server instance to one canonical project root. */
export function bindProjectRoot(root) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new ProjectBoundaryError('an explicit project root is required');
  }
  let realRoot;
  try {
    realRoot = realpathSync(resolve(root));
    if (!lstatSync(realRoot).isDirectory()) throw new Error('not a directory');
  } catch (error) {
    throw new ProjectBoundaryError(`invalid project root: ${error.message}`);
  }
  return realRoot;
}

/** Reject noncanonical protocol paths before using them as source identities. */
export function canonicalSourcePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')
    || path.includes('\\') || isAbsolute(path) || path.startsWith('/')) {
    throw new ProjectBoundaryError('source path must be a canonical project-relative path');
  }
  if (path === '.' || path.startsWith('../') || path.split('/').includes('..')
    || posix.normalize(path) !== path || path.split('/').includes('.')) {
    throw new ProjectBoundaryError('source path must be a canonical project-relative path');
  }
  return path;
}

/** The snapshot listing is the read allowlist; real paths cannot escape it. */
export function assertSourcePath(root, path, snapshot) {
  const rel = canonicalSourcePath(path);
  if (!snapshot?.listFiles().includes(rel)) {
    throw new ProjectBoundaryError(`source path is not part of the current snapshot: ${rel}`);
  }
  const target = join(root, rel);
  if (existsSync(target) && !inside(root, realpathSync(target))) {
    throw new ProjectBoundaryError(`source path resolves outside project root: ${rel}`);
  }
  return rel;
}

/** Read/write products may only live in the project's real .excavator dir. */
export function assertDataDir(root) {
  const dataDir = join(root, '.excavator');
  try {
    const stat = lstatSync(dataDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new ProjectBoundaryError('.excavator must be a real directory inside the project');
    }
    if (!inside(root, realpathSync(dataDir))) {
      throw new ProjectBoundaryError('.excavator resolves outside project root');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return dataDir;
}

/** Prevent a symlinked product file from turning a read into an external read. */
export function assertDataFile(root, name) {
  if (!/^[a-z][a-z0-9-]*\.json$/.test(name)) {
    throw new ProjectBoundaryError('unrecognized data product name');
  }
  const dataDir = assertDataDir(root);
  const path = join(dataDir, name);
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || !inside(root, realpathSync(path))) {
      throw new ProjectBoundaryError(`data product is not a regular in-project file: ${name}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return path;
}

/** A sync writes several known products and intermediate files; reject links in that tree. */
export function assertDataTree(root) {
  const dataDir = assertDataDir(root);
  if (!existsSync(dataDir)) return dataDir;
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new ProjectBoundaryError(`symlink inside .excavator is not allowed: ${relative(dataDir, path)}`);
      }
      if (stat.isDirectory()) visit(path);
    }
  };
  visit(dataDir);
  return dataDir;
}
