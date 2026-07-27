export const queryKeys = {
  state: ['state'] as const,
  config: ['config'] as const,
  githubStatus: ['github', 'status'] as const,
  githubRepos: ['github', 'repos'] as const,
  githubBranches: (repo: string) => ['github', 'branches', repo] as const,
  githubDirs: (repo: string, branch: string) => ['github', 'dirs', repo, branch] as const,
  githubContents: (repo: string, branch: string, path: string) =>
    ['github', 'contents', repo, branch, path] as const,
  githubFile: (repo: string, branch: string, path: string) =>
    ['github', 'file', repo, branch, path] as const,
  groups: ['groups'] as const,
  services: (group: string) => ['services', group] as const,
  ports: ['ports'] as const,
  manage: ['manage'] as const,
  engine: ['engine'] as const,
  files: (path: string) => ['files', path] as const,
  filesPreview: (path: string) => ['files', 'preview', path] as const,
  activity: ['activity'] as const,
}
