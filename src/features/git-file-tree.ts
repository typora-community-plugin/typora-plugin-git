import type { GitFileInfo } from './git-client'

export interface GitTreeNode {
  /** last path segment shown in the row */
  name: string
  /** vault-relative path of the file or directory */
  path: string
  isDir: boolean
  children: GitTreeNode[]
  /** present on file nodes */
  file?: GitFileInfo
}

/** Build a directory tree from a flat, vault-relative file list. */
export function buildGitTree(files: GitFileInfo[]): GitTreeNode[] {
  const roots: GitTreeNode[] = []
  for (const file of files) {
    insert(roots, file, '')
  }
  sortTree(roots)
  return roots
}

function insert(nodes: GitTreeNode[], file: GitFileInfo, base: string) {
  const segments = file.path.split('/').filter(Boolean)
  let current = nodes
  let prefix = base

  for (let i = 0; i < segments.length; i++) {
    const name = segments[i]
    const nodePath = prefix ? prefix + '/' + name : name
    const isLeaf = i === segments.length - 1

    if (isLeaf) {
      if (file.isDir) {
        // untracked directory reported by git as a single "dir/" entry
        const existing = current.find(n => n.isDir && n.name === name)
        if (existing) existing.file = file
        else current.push({ name, path: nodePath, isDir: true, children: [], file })
      } else {
        current.push({ name, path: nodePath, isDir: false, children: [], file })
      }
      return
    }

    let dir = current.find(n => n.isDir && n.name === name)
    if (!dir) {
      dir = { name, path: nodePath, isDir: true, children: [] }
      current.push(dir)
    }
    current = dir.children
    prefix = nodePath
  }
}

function sortTree(nodes: GitTreeNode[]) {
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const node of nodes) {
    if (node.isDir) sortTree(node.children)
  }
}

/** Every file path contained in a node (the node itself for files). */
export function collectFilePaths(node: GitTreeNode): string[] {
  const paths: string[] = []
  collect(node, paths)
  return paths
}

function collect(node: GitTreeNode, out: string[]) {
  if (node.file) out.push(node.file.path)
  if (node.isDir) {
    for (const child of node.children) collect(child, out)
  }
}
