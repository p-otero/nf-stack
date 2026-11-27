const GITHUB_HOST = "github.com";
const PROTOCOLS = new Set(["http:", "https:", "ssh:", "git:"]);
const SCP_REMOTE = /^([^@\s]+)@([^:/\s]+):(?!\/)(.+)$/;

const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

function remoteUrlObject(remote: string): URL | null {
  const trimmed = remote.trim();
  const scp = SCP_REMOTE.exec(trimmed);
  const normalized = scp === null ? trimmed : `ssh://${scp[1]}@${scp[2]}/${scp[3]}`;
  try {
    const url = new URL(normalized);
    return PROTOCOLS.has(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export interface GitHubRepository {
  readonly owner: string;
  readonly name: string;
}

/** The owner and repository a GitHub remote in any of git's URL forms names, else null. */
export function githubRepository(remoteUrl: string | null): GitHubRepository | null {
  if (remoteUrl === null) return null;
  const url = remoteUrlObject(remoteUrl);
  if (url === null || url.hostname !== GITHUB_HOST) return null;
  const path = url.pathname
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  const segments = path.split("/");
  if (segments.length !== 2) return null;
  const [owner = "", name = ""] = segments;
  return owner.length === 0 || name.length === 0 ? null : { owner, name };
}

/** `https://github.com/owner/repo` for a GitHub remote in any of git's URL forms, else null. */
export function githubRepoUrl(remoteUrl: string | null): string | null {
  const repository = githubRepository(remoteUrl);
  return repository === null
    ? null
    : `https://${GITHUB_HOST}/${repository.owner}/${repository.name}`;
}

/**
 * What `nf attempt update --pr` records: `12`, `#12` and a full pull request URL, resolved to a
 * URL. A bare number needs the project's GitHub remote; `null` means the value is not one of these.
 */
export function pullRequestHref(ref: string, remoteUrl: string | null): string | null {
  const text = ref.trim();
  const number = /^#?(\d+)$/.exec(text);
  if (number !== null) {
    const repo = githubRepoUrl(remoteUrl);
    return repo === null ? null : `${repo}/pull/${number[1]}`;
  }
  try {
    const url = new URL(text);
    return PROTOCOLS.has(url.protocol) && url.hostname.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export function pullRequestNumber(href: string): number | null {
  const match = /\/pull\/(\d+)(?:[/?#]|$)/.exec(href);
  return match === null ? null : Number(match[1]);
}

export const repositoryTreeUrl = (repoUrl: string, ref: string): string =>
  `${repoUrl}/tree/${encodePath(ref)}`;

export const repositoryCommitUrl = (repoUrl: string, sha: string): string =>
  `${repoUrl}/commit/${encodeURIComponent(sha)}`;
