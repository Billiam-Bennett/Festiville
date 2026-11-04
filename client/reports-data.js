// Labels for the staff Reports screen. The action ids match ACTIONS in server/moderation.js
// (plus "dismiss"); the server decides what each one actually does.
export const REASON_LABELS = {
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  sexual: "Sexual content",
  spam: "Spam or scams",
  cheating: "Cheating",
  other: "Something else",
};

export const ACTION_BUTTONS = [
  { id: "dismiss", label: "Dismiss" },
  { id: "mute15", label: "Mute 15 min" },
  { id: "mute24h", label: "Mute 1 day" },
  { id: "kick", label: "Kick", confirm: true },
  { id: "ban1d", label: "Ban 1 day", danger: true, confirm: true },
  { id: "ban7d", label: "Ban 7 days", danger: true, confirm: true },
  { id: "banForever", label: "Ban forever", danger: true, confirm: true },
];
