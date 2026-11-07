export function filePaths(repository: { directory: string; relativePath: string }, path: string) {
  const separator = repository.directory.includes("\\") ? "\\" : "/";
  return {
    absolute: `${repository.directory.replace(/[\\/]+$/, "")}${separator}${path.split("/").join(separator)}`,
    relative: [repository.relativePath.replace(/\\/g, "/").replace(/^\.$/, ""), path]
      .filter(Boolean)
      .join("/"),
  };
}
