// Convert only plugin-authored notes from the initial release. Provider output stays unchanged.
const legacyNotes: Record<string, string> = {
  "上次发送结果未知，请检查对话后手动继续。":
    "The previous send result is unknown. Check the conversation and continue manually.",
  "已关闭自动恢复，并取消本次等待。": "Auto-resume is off. The pending recovery has been canceled.",
  "已关闭自动恢复，不再安排后续尝试。":
    "Auto-resume is off. No further attempts will be scheduled.",
  "检测到额度限制，可以预约恢复后继续。":
    "Quota limit detected. You can schedule a continuation after it resets.",
  "无法确定恢复时间，请手动设置时间。":
    "The reset time could not be determined. Please choose a time.",
  "已达到恢复尝试上限，请检查额度后手动继续。":
    "The recovery attempt limit has been reached. Check your quota and continue manually.",
  "已取消本次等待。": "This recovery has been canceled.",
  "对话已开始新一轮，旧预约已取消。":
    "A new turn has started. The previous recovery has been canceled.",
  "已恢复；本轮已结束。": "Resumed. The turn has finished.",
  "已达到恢复尝试上限。": "The recovery attempt limit has been reached.",
  "对话已有变化或需要审批，未自动发送。":
    "The conversation has changed or needs approval. No continuation was sent.",
  "暂时无法连接对话，一分钟后重新检查。":
    "The conversation is temporarily unreachable. Checking again in one minute.",
  "正在发送继续指令…": "Sending a continuation…",
  "发送前已取消。": "Canceled before sending.",
  "已发送继续指令，正在等待本轮结果。": "Continuation sent. Waiting for the turn to finish.",
  "发送结果未知，请检查对话后手动继续。":
    "The send result is unknown. Check the conversation and continue manually.",
  "本轮被取消，自动恢复等待已取消。":
    "The turn was canceled. The pending recovery has been canceled.",
  "对话已归档，等待已取消。":
    "The conversation was archived. The pending recovery has been canceled.",
  "工作区已归档，等待已取消。":
    "The workspace was archived. The pending recovery has been canceled.",
};
export function englishNote(note: string): string {
  const buffered = note.match(/^将在恢复时间后缓冲 (\d+) 秒继续本对话。$/);
  return buffered
    ? `The conversation will continue ${buffered[1]} seconds after the reset time.`
    : (legacyNotes[note] ?? note);
}
