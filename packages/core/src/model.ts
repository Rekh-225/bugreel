// Portable, browser-compatible model shared by the local BugReel application and the Chrome extension.
// Nothing in packages/core may import Node.js modules.

export const ARIA_ROLES = ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option', 'switch', 'textbox', 'combobox', 'searchbox', 'spinbutton'] as const;
export type AriaRole = typeof ARIA_ROLES[number];
export const SELECTOR_KINDS = ['testId', 'role', 'id', 'label', 'placeholder', 'text', 'css'] as const;
export type SelectorKind = typeof SELECTOR_KINDS[number];

export type Selector = { kind: SelectorKind; value: string; confidence: 'stable' | 'fallback'; role?: AriaRole };
export type ElementInfo = { tag: string; testId?: string; id?: string; name?: string; ariaLabel?: string; placeholder?: string; text?: string; inputType?: string; role?: string };

/** Why a typed value is not present. `not-recorded` means the user did not enable value recording for the session. */
export type ValueOmission = 'password' | 'sensitive' | 'not-recorded';

export type RecordedEvent = {
  id: string; sequence: number; type: 'click' | 'input' | 'change' | 'submit' | 'navigation' | 'select';
  timestamp: string; elapsedMs: number; url: string; selector?: Selector; element?: ElementInfo;
  value?: string; viaClick?: boolean; causedByAction?: boolean;
  valueOmitted?: ValueOmission; reload?: boolean; sameDocument?: boolean;
};

export type ActionType = 'goto' | 'click' | 'fill' | 'press' | 'waitForURL' | 'select' | 'reload';
export type Action = {
  id: string; type: ActionType; label: string;
  timestamp: string; elapsedMs: number; selector?: Selector; value?: string; url?: string;
  valueOmitted?: ValueOmission;
};
