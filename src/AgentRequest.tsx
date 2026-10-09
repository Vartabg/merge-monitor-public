import { useEffect, useId, useRef, useState } from "react";
import { SendMessageStep } from "./SendMessageStep";
import { agentRequest, requestLabel } from "./taskPresentation";
import type { Status, TaskContext, Worktree } from "./types";

export function AgentRequest({
  worktree,
  status,
  context,
  disabled,
  guided = false,
  onCopied,
  onRestart,
}: {
  worktree: Worktree;
  status: Status;
  context?: TaskContext;
  disabled: boolean;
  guided?: boolean;
  onCopied?: () => void;
  onRestart?: () => void;
}) {
  const id = useId();
  const disclosure = useRef<HTMLDetailsElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const restartFocus = useRef(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState<"copy" | "paste" | "done">("copy");
  const [copiedRequest, setCopiedRequest] = useState<string | null>(null);
  const stepTitle = useRef<HTMLHeadingElement>(null);
  const request = agentRequest(worktree, status, context);
  useEffect(() => {
    if (guided && step !== "copy") stepTitle.current?.focus();
    if (step === "copy" && restartFocus.current) {
      copyButton.current?.focus();
      restartFocus.current = false;
    }
  }, [guided, step]);
  useEffect(() => {
    if (failed) {
      if (disclosure.current) disclosure.current.open = true;
      field.current?.focus();
      field.current?.select();
    }
  }, [failed]);
  function continueToPaste(text: string) {
    setCopiedRequest(text);
    setFailed(false);
    setStep("paste");
    onCopied?.();
  }
  async function copy() {
    setMessage("");
    try {
      await navigator.clipboard.writeText(request);
      setFailed(false);
      setCopiedRequest(request);
      if (guided) {
        continueToPaste(request);
      }
      setMessage(
        `Request copied. Paste it into ${context?.owner || "the agent task responsible for this work"}. Nothing has been sent.`,
      );
    } catch {
      setCopiedRequest(request);
      setFailed(true);
      setMessage(
        guided
          ? "The copy button did not work. The message below is selected. Copy it yourself, then continue."
          : "Clipboard access is unavailable. Select and copy the request below, then paste it into your agent task.",
      );
    }
  }
  return (
    <div
      className="agent-request"
      role="group"
      aria-label={
        guided ? "Message for your AI chat" : "Continue with your agent"
      }
    >
      {guided && step !== "copy" ? (
        <SendMessageStep
          done={step === "done"}
          owner={context?.owner}
          titleRef={stepTitle}
          onDone={() => setStep("done")}
          onRestart={() => {
            restartFocus.current = true;
            setStep("copy");
            setCopiedRequest(null);
            onRestart?.();
          }}
        />
      ) : (
        <>
          {guided && <p className="step-label">Step 1 of 2</p>}
          <button
            ref={copyButton}
            className="button"
            onClick={copy}
            disabled={disabled}
          >
            {guided ? "Copy the message" : requestLabel(worktree)}
          </button>
          <p className="help-text">
            {disabled
              ? "Refresh the board before copying a request based on these results."
              : guided
                ? "This copies a ready-written message. It does not send it or change your project."
                : "Paste the request into the responsible agent task to continue the work."}
          </p>
        </>
      )}
      {message && (!guided || failed) && (
        <p role={failed ? "alert" : "status"} className="action-message">
          {message}
        </p>
      )}
      {step !== "done" && (
        <details
          className="files"
          ref={disclosure}
          hidden={guided && step === "copy" && !failed}
        >
          <summary>
            {guided ? "Read the prepared message" : "Read the request"}
          </summary>
          <label htmlFor={id}>
            {guided
              ? "Message for your AI chat"
              : "Request to send to your agent"}
          </label>
          <textarea
            ref={field}
            id={id}
            readOnly
            value={copiedRequest || request}
            rows={8}
          />
          {guided && failed && (
            <>
              <p>
                Hold ⌘ Command and press C on a Mac, or hold Ctrl and press C on
                Windows. You can also right-click the selected words and choose
                Copy.
              </p>
              <button
                className="button"
                onClick={() => continueToPaste(copiedRequest || request)}
              >
                I copied it — continue
              </button>
            </>
          )}
        </details>
      )}
    </div>
  );
}
