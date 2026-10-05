export function normalizePath(path: string): string {
  const output: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") output.pop();
    else output.push(part);
  }
  return output.join("/");
}

export class TAbstractFile {
  path = "";
  name = "";
  parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
  extension = "";
  basename = "";
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}
