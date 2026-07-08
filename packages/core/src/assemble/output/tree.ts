import type { Layer } from "@codingverse/shared";

/**
 * Directory-structure rendering for pack output.
 * Builds an ASCII tree from file paths, annotating each file with its layer
 * marker so readers can see at a glance what was compressed.
 *
 *   src/
 *     ingest/
 *       walker.ts        [full]
 *       reader.ts        [skeleton]
 *     index.ts           [outline]
 */

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  layer?: Layer; // set on leaf (file) nodes
}

const LAYER_MARK: Record<Layer, string> = {
  full: "full",
  skeleton: "skeleton",
  outline: "outline",
  omit: "omit",
};

const newNode = (name: string): TreeNode => ({ name, children: new Map() });

/** Build a directory tree from a list of {path, layer}. */
const buildTree = (files: { path: string; layer: Layer }[]): TreeNode => {
  const root = newNode("");
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      let child = node.children.get(part);
      if (!child) {
        child = newNode(part);
        node.children.set(part, child);
      }
      node = child;
      if (i === parts.length - 1) node.layer = file.layer;
    }
  }
  return root;
};

/** Sort: directories first, then files, each alphabetical. */
const sortedChildren = (node: TreeNode): TreeNode[] =>
  [...node.children.values()].sort((a, b) => {
    const aDir = a.children.size > 0;
    const bDir = b.children.size > 0;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

/**
 * Render a directory structure string. Includes layer markers unless
 * `showLayers` is false.
 */
export const renderTree = (
  files: { path: string; layer: Layer }[],
  showLayers = true,
): string => {
  const root = buildTree(files);
  const lines: string[] = [];

  const walk = (node: TreeNode, depth: number): void => {
    for (const child of sortedChildren(node)) {
      const indent = "  ".repeat(depth);
      const isDir = child.children.size > 0;
      if (isDir) {
        lines.push(`${indent}${child.name}/`);
        walk(child, depth + 1);
      } else {
        const mark =
          showLayers && child.layer ? `  [${LAYER_MARK[child.layer]}]` : "";
        lines.push(`${indent}${child.name}${mark}`);
      }
    }
  };

  walk(root, 0);
  return lines.join("\n");
};
