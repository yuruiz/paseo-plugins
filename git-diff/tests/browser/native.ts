export function copyText(text: string) {
  const host = globalThis as unknown as {
    navigator: { clipboard: { writeText(value: string): Promise<void> } };
  };
  return host.navigator.clipboard.writeText(text);
}
