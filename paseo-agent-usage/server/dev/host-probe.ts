/** Dev-only: count codex rollout files / token_count events, split by forked vs normal. */
import { readHostsFile } from "../remote/hosts-file";
import { probeHost } from "../remote/ssh";
import { pluginDataDir } from "../scan/state";

const SCRIPT = `
cd "$HOME/.codex" 2>/dev/null || { echo "no ~/.codex"; exit 0; }
total_files=0; forked_files=0; total_tc=0; forked_tc=0; normal_tc=0
find sessions archived_sessions -name '*.jsonl' 2>/dev/null | while IFS= read -r f; do
  n=$(grep -c '"token_count"' "$f" 2>/dev/null)
  if head -1 "$f" | grep -q "forked_from_id"; then
    forked_files=$((forked_files+1)); forked_tc=$((forked_tc+n))
  else
    normal_tc=$((normal_tc+n))
  fi
  total_files=$((total_files+1)); total_tc=$((total_tc+n))
done
echo "files_total=$total_files forked_files=$forked_files"
echo "tc_events_total=$total_tc forked_tc=$forked_tc normal_tc=$normal_tc"
f=$(find sessions archived_sessions -name '*.jsonl' 2>/dev/null | head -200 | while IFS= read -r x; do head -1 "$x" | grep -q "forked_from_id" && { echo "$x"; break; }; done)
if [ -n "$f" ]; then
  echo "sample_forked_file=$f"
  head -1 "$f" | head -c 400; echo
  grep '"token_count"' "$f" | head -3 | cut -c1-260
  echo "..."
  grep '"token_count"' "$f" | tail -2 | cut -c1-260
fi
`;

async function main(): Promise<void> {
  const dir = pluginDataDir();
  const hosts = await readHostsFile(dir);
  const name = process.argv[2];
  const host = name ? hosts.find((item) => item.name === name) : hosts.find((item) => item.enabled);
  if (!host) {
    console.log("no matching host. configured:", hosts.map((item) => item.name));
    return;
  }
  const result = await probeHost(host, dir, SCRIPT);
  console.log(`ok=${result.ok}`);
  console.log(result.stdout.trim());
  if (!result.ok) console.log("stderr:", result.stderr.slice(-500));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
