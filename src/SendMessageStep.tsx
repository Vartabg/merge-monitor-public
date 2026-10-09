import type { RefObject } from "react";

export function SendMessageStep({
  done,
  owner,
  titleRef,
  onDone,
  onRestart,
}: {
  done: boolean;
  owner?: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onDone: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="handoff-step">
      <p className="step-label">
        {done ? "Your part is done for now" : "Step 2 of 2"}
      </p>
      <h3 ref={titleRef} tabIndex={-1}>
        {done
          ? "You can leave this page now."
          : "Send the message in your AI chat."}
      </h3>
      {done ? (
        <>
          <p>Come back after your AI chat replies.</p>
          <p className="helper">
            The work still needs to be checked. Nothing was changed in your
            project by pressing this button.
          </p>
          <button className="text-button" onClick={onRestart}>
            Read the next step again
          </button>
        </>
      ) : (
        <>
          <p>The message is copied. It has not been sent.</p>
          <ol className="send-instructions">
            <li>
              {owner ? (
                <>
                  Open your chat: <strong>{owner}</strong>.
                </>
              ) : (
                "Open the AI chat where you asked for this work."
              )}
            </li>
            <li>Paste the message into the box where you usually type.</li>
            <li>
              Press <strong>Send</strong> in that chat.
            </li>
          </ol>
          <details className="paste-help">
            <summary>How do I paste?</summary>
            <p>
              Click inside the message box. Hold the <strong>⌘ Command</strong>{" "}
              key and press <strong>V</strong> on a Mac. On Windows, hold{" "}
              <strong>Ctrl</strong> and press <strong>V</strong>.
            </p>
            <p>
              You can also right-click inside the box and choose{" "}
              <strong>Paste</strong>. On a phone or tablet, touch and hold
              inside the box, then choose <strong>Paste</strong>.
            </p>
            <p>
              The words should appear in the box. Then press{" "}
              <strong>Send</strong>.
            </p>
          </details>
          {!owner && (
            <details className="paste-help">
              <summary>Which chat should I open?</summary>
              <p>
                Return to the conversation where you asked for the work named
                above. This tool cannot see your chats or choose one for you.
              </p>
              <p>
                If you are unsure, stop here and ask the person helping with
                your project. You can leave this page and come back later.
              </p>
            </details>
          )}
          <p className="helper sent-instruction">
            After you send it, press the button below.
          </p>
          <button className="button" onClick={onDone}>
            I sent the message
          </button>
        </>
      )}
    </div>
  );
}
