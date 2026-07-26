"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  CaptureDraft,
  LeadershipDimension,
  MobileBootstrap,
  ObservationFeedbackType,
  PerformanceEntry,
  RaterAssignment,
  leadershipDimensions,
} from "../lib/contracts";
import { eesGateway } from "../lib/ees-gateway";
import { isMobileDemoMode, signInToMerit, useDevelopmentIdentity } from "../lib/auth";

type Screen = "home" | "capture" | "evidence" | "success" | "record" | "detail";
type CaptureLane = "SOLDIER_ENTRY" | "RATER_OBSERVATION";

const labels: Record<LeadershipDimension, string> = {
  CHARACTER: "Character",
  PRESENCE: "Presence",
  INTELLECT: "Intellect",
  LEADS: "Leads",
  DEVELOPS: "Develops",
  ACHIEVES: "Achieves",
};

const shortLabels: Record<LeadershipDimension, string> = {
  CHARACTER: "CH",
  PRESENCE: "PR",
  INTELLECT: "IN",
  LEADS: "LD",
  DEVELOPS: "DV",
  ACHIEVES: "AC",
};

const emptyDraft = (): CaptureDraft => ({
  rawText: "",
  section: "LEADS",
  eventDate: new Date().toISOString().slice(0, 10),
  flaggedByServiceMember: false,
  attested: false,
});

function bytes(size: number) {
  if (size === 0) return "Stored evidence";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date.slice(0, 10)}T12:00:00`));
}

export function MeritMobile() {
  const [screen, setScreen] = useState<Screen>("home");
  const [data, setData] = useState<MobileBootstrap | null>(null);
  const [draft, setDraft] = useState<CaptureDraft>(emptyDraft);
  const [selected, setSelected] = useState<PerformanceEntry | null>(null);
  const [captureLane, setCaptureLane] = useState<CaptureLane>("SOLDIER_ENTRY");
  const [raterTarget, setRaterTarget] = useState<RaterAssignment | null>(null);
  const [feedbackType, setFeedbackType] = useState<ObservationFeedbackType>("NEUTRAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [submissionWarning, setSubmissionWarning] = useState("");

  const refresh = useCallback(async () => {
    const next = await eesGateway.bootstrap();
    setData(next);
    setSelected((current) =>
      current ? next.entries.find((entry) => entry.id === current.id) ?? current : null,
    );
  }, []);

  useEffect(() => {
    refresh().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Unable to load MERIT Mobile."),
    );
    const update = () => void refresh().catch(() => undefined);
    window.addEventListener("ees-demo-updated", update);
    return () => window.removeEventListener("ees-demo-updated", update);
  }, [refresh]);

  const pending = useMemo(
    () => data?.entries.filter((entry) => entry.confirmationStatus === "UNREVIEWED") ?? [],
    [data],
  );

  function startCapture() {
    if (!data?.supportForm) return;
    setCaptureLane("SOLDIER_ENTRY");
    setRaterTarget(null);
    setDraft(emptyDraft());
    setError("");
    setScreen("capture");
  }

  function startObservation(target: RaterAssignment) {
    setCaptureLane("RATER_OBSERVATION");
    setRaterTarget(target);
    setFeedbackType("NEUTRAL");
    setDraft(emptyDraft());
    setError("");
    setScreen("capture");
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) setDraft((current) => ({ ...current, artifact: file }));
  }

  async function submit() {
    if (!draft.rawText.trim()) {
      setError("Describe the accomplishment before submitting.");
      setScreen("capture");
      return;
    }
    if (!draft.attested) {
      setError("Confirm the factual attestation before submitting.");
      return;
    }
    setBusy(true);
    setError("");
    setSubmissionWarning("");
    try {
      const result = await eesGateway.createEntry(draft);
      await refresh();
      setSelected(result.entry);
      setSubmissionWarning(result.uploadWarning ?? "");
      setScreen("success");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Submission failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitObservation() {
    if (!draft.rawText.trim() || !raterTarget) {
      setError("Record the factual observation before submitting.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await eesGateway.createObservation({
        supportFormId: raterTarget.supportFormId,
        factualNote: draft.rawText,
        sectionKey: draft.section,
        feedbackType,
        occurredAt: draft.eventDate,
        goalId: draft.goalId || undefined,
      });
      setSelected(null);
      setScreen("success");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Observation submission failed.");
    } finally {
      setBusy(false);
    }
  }

  function openEntry(entry: PerformanceEntry) {
    setSelected(entry);
    setScreen("detail");
  }

  async function signIn() {
    if (!authEmail.trim() || !authPassword) {
      setError("Enter your MERIT email and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await signInToMerit(authEmail, authPassword);
      setAuthPassword("");
      await refresh();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in to MERIT.");
    } finally {
      setBusy(false);
    }
  }

  async function useDevIdentity(email: string) {
    useDevelopmentIdentity(email);
    setError("");
    try {
      await refresh();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Unable to establish the development session.");
    }
  }

  if (!data) {
    return (
      <main className="loading">
        {error ? (
          <div className="loadingState">
            <div className="brand"><img src="/army-star.jpg" alt="" /> MERIT</div>
            <h1>{isMobileDemoMode ? "Mobile capture is unavailable" : "Sign in to MERIT Mobile"}</h1>
            <p>{error}</p>
            {!isMobileDemoMode && (
              <div className="authForm">
                <p className="authHint">Use a MERIT account. Local development also accepts Davis or Johnson with password <code>testpass</code>.</p>
                <label>Email<input type="email" autoComplete="username" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /></label>
                <label>Password<input type="password" autoComplete="current-password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void signIn(); }} /></label>
                <button disabled={busy} onClick={() => void signIn()}>{busy ? "Signing in…" : "Sign in"}</button>
                {import.meta.env.DEV && (
                  <div className="devIdentities">
                    <span>Or choose a local development identity</span>
                    <button onClick={() => void useDevIdentity("james.davis@army.mil")}>SGT Davis · Soldier</button>
                    <button onClick={() => void useDevIdentity("marcus.johnson@army.mil")}>SSG Johnson · Rater</button>
                  </div>
                )}
              </div>
            )}
            {isMobileDemoMode && <button onClick={() => { setError(""); void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load MERIT Mobile.")); }}>Try again</button>}
          </div>
        ) : "Loading MERIT Mobile…"}
      </main>
    );
  }

  const activeDimensions = new Set(data.entries.map((entry) => entry.section)).size;

  return (
    <main className="stage">
      <section className="phone" aria-label="MERIT Mobile performance capture">
        <div className="statusbar">
          <span>9:41</span>
          <span>●●● 5G ▰</span>
        </div>

        {screen === "home" && (
          <div className="screen">
            <header className="hero">
              <div className="brand"><img src="/army-star.jpg" alt="" /> MERIT</div>
              <p className="eyebrow">SUPPORT FORM · FY26</p>
              <h1>Good afternoon,<br />{data.user.rank} {data.user.displayName.split(" ")[1]}.</h1>
              <p>{data.supportForm ? "Capture performance now. Your rater reviews it in MERIT." : "Record direct observations for the Soldiers you rate."}</p>
            </header>
            <div className="content overlap">
              {data.supportForm && (
                <>
                  <button className="captureCta" onClick={startCapture}>
                    <span className="plus">＋</span>
                    <span><strong>Capture accomplishment</strong><small>Log it now. Keep the proof.</small></span>
                    <b>→</b>
                  </button>

                  <div className="authorityStrip">
                    <span>Rated Soldier lane</span>
                    <strong>Rater review required</strong>
                    <p>Your submission is self-reported evidence until an authorized rating official reviews it.</p>
                  </div>
                </>
              )}

              {data.raterAssignments.length > 0 && (
                <section className="leaderCapture">
                  <p className="eyebrow dark">ASSIGNED RATER LANE</p>
                  <h2>Record a leader observation</h2>
                  <p>Direct observations stay private to you until discussed and released through counseling.</p>
                  <div className="soldierChoices">
                    {data.raterAssignments.map((assignment) => (
                      <button key={assignment.supportFormId} onClick={() => startObservation(assignment)}>
                        <span><strong>{assignment.rank} {assignment.displayName}</strong><small>Record factual observation</small></span>
                        <b>→</b>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {data.supportForm && <article className="card readiness">
                <div className="row">
                  <div><p className="eyebrow dark">EVALUATION READINESS</p><h2>{activeDimensions} of 6 dimensions active</h2></div>
                  <strong className="score">{Math.round((activeDimensions / 6) * 100)}%</strong>
                </div>
                <div className="progress"><span style={{ width: `${(activeDimensions / 6) * 100}%` }} /></div>
                <div className="dimensions">
                  {leadershipDimensions.map((dimension) => (
                    <span className={data.entries.some((entry) => entry.section === dimension) ? "active" : ""} key={dimension}>
                      {shortLabels[dimension]}
                    </span>
                  ))}
                </div>
                <button className="linkButton" onClick={() => setScreen("record")}>View performance record →</button>
              </article>}

              {data.supportForm && <section className="section">
                <div className="row"><h2>Awaiting rater review</h2><button className="textButton" onClick={() => setScreen("record")}>See all</button></div>
                {pending.length ? pending.slice(0, 2).map((entry) => (
                  <EntryRow key={entry.id} entry={entry} onOpen={() => openEntry(entry)} />
                )) : <p className="empty">No entries awaiting review.</p>}
              </section>}

              {data.supportForm && <section className="section">
                <h2>Recent activity</h2>
                {data.entries.filter((entry) => entry.confirmationStatus !== "UNREVIEWED").slice(0, 2).map((entry) => (
                  <EntryRow key={entry.id} entry={entry} onOpen={() => openEntry(entry)} />
                ))}
              </section>}
            </div>
          </div>
        )}

        {screen === "capture" && (
          <div className="screen formScreen">
            <Subhead
              eyebrow={captureLane === "SOLDIER_ENTRY" ? "RATED SOLDIER SUBMISSION" : `RATER OBSERVATION · ${raterTarget?.rank ?? ""} ${raterTarget?.displayName ?? ""}`}
              title={captureLane === "SOLDIER_ENTRY" ? "Capture accomplishment" : "Record observation"}
              count={captureLane === "SOLDIER_ENTRY" ? "1 / 2" : undefined}
              onBack={() => setScreen("home")}
            />
            <div className="content">
              <p className="helper">
                {captureLane === "SOLDIER_ENTRY"
                  ? "Keep it factual. This is your self-reported evidence; your rater must review it before use."
                  : "Record only what you directly observed. This remains private until you discuss and release it through counseling."}
              </p>
              <label>{captureLane === "SOLDIER_ENTRY" ? "What happened?" : "What did you directly observe?"}</label>
              <textarea
                value={draft.rawText}
                maxLength={500}
                rows={5}
                placeholder={captureLane === "SOLDIER_ENTRY" ? "Example: Led a squad through range density validation; corrected discrepancies before live-fire training." : "Example: On 18 July, led the pre-combat check and identified two missing crew-served weapon components before movement."}
                onChange={(event) => setDraft({ ...draft, rawText: event.target.value })}
              />
              <div className="counter"><span>Use the outcome, scale, and your role.</span><span>{draft.rawText.length} / 500</span></div>

              {captureLane === "RATER_OBSERVATION" && (
                <>
                  <label>Feedback type</label>
                  <div className="choiceGrid feedbackChoices">
                    {(["POSITIVE", "DEVELOPMENTAL", "NEUTRAL"] as ObservationFeedbackType[]).map((type) => (
                      <button type="button" className={feedbackType === type ? "selected" : ""} key={type} onClick={() => setFeedbackType(type)}>
                        {type.charAt(0) + type.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <label>Leadership dimension</label>
              <div className="choiceGrid">
                {leadershipDimensions.map((dimension) => (
                  <button
                    type="button"
                    className={draft.section === dimension ? "selected" : ""}
                    key={dimension}
                    onClick={() => setDraft({ ...draft, section: dimension })}
                  >
                    {labels[dimension]}
                  </button>
                ))}
              </div>

              <label htmlFor="goal">Link to a goal <em>Optional</em></label>
              <select id="goal" value={draft.goalId ?? ""} onChange={(event) => setDraft({ ...draft, goalId: event.target.value })}>
                <option value="">No linked goal</option>
                {(captureLane === "RATER_OBSERVATION" ? raterTarget?.goals ?? [] : data.goals).map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
              </select>

              <label htmlFor="date">Date of event</label>
              <input id="date" type="date" value={draft.eventDate} onChange={(event) => setDraft({ ...draft, eventDate: event.target.value })} />
              {error && <p className="error">{error}</p>}
            </div>
            <footer className="fixed">
              <button
                className="primary"
                disabled={busy}
                onClick={() => captureLane === "RATER_OBSERVATION"
                  ? void submitObservation()
                  : draft.rawText.trim() ? setScreen("evidence") : setError("Describe the accomplishment to continue.")}
              >
                {captureLane === "RATER_OBSERVATION" ? (busy ? "Recording…" : "Record private observation") : "Continue to evidence →"}
              </button>
            </footer>
          </div>
        )}

        {screen === "evidence" && (
          <div className="screen formScreen">
            <Subhead eyebrow="NEW ENTRY" title="Add supporting evidence" count="2 / 2" onBack={() => setScreen("capture")} />
            <div className="content">
              <div className="notice"><b>i</b><span>Evidence is optional. It supports leader review, but it does not determine a rating.</span></div>
              <label className="upload" htmlFor="evidenceFile">
                <span>↑</span><strong>Attach proof</strong><small>JPEG, PNG, WEBP, or PDF · up to 20 MB</small>
                <input id="evidenceFile" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={chooseFile} />
              </label>
              <div className="uploadOptions">
                <label className="secondary" htmlFor="cameraFile">◎ Take photo</label>
                <label className="secondary" htmlFor="evidenceFile">▣ Browse files</label>
              </div>
              <input className="hiddenInput" id="cameraFile" type="file" accept="image/*" capture="environment" onChange={chooseFile} />

              {draft.artifact && (
                <div className="proof">
                  <span className="fileIcon">{draft.artifact.type.startsWith("image/") ? "IMG" : "DOC"}</span>
                  <span><strong>{draft.artifact.name}</strong><small>{bytes(draft.artifact.size)} · Ready to upload</small></span>
                  <button onClick={() => setDraft({ ...draft, artifact: undefined })}>×</button>
                </div>
              )}

              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.flaggedByServiceMember}
                  onChange={(event) => setDraft({ ...draft, flaggedByServiceMember: event.target.checked })}
                />
                <span>This evidence may not yet be reflected correctly in an authoritative record.</span>
              </label>
              {draft.flaggedByServiceMember && (
                <textarea
                  rows={3}
                  placeholder="Explain the discrepancy or what the rater should verify."
                  value={draft.flagNote ?? ""}
                  onChange={(event) => setDraft({ ...draft, flagNote: event.target.value })}
                />
              )}

              <label className="check attestation">
                <input
                  type="checkbox"
                  checked={draft.attested}
                  onChange={(event) => setDraft({ ...draft, attested: event.target.checked })}
                />
                <span>I certify this entry is factual to the best of my knowledge.</span>
              </label>
              {error && <p className="error">{error}</p>}
            </div>
            <footer className="fixed"><button className="primary" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit for rater review →"}</button></footer>
          </div>
        )}

        {screen === "success" && (selected || captureLane === "RATER_OBSERVATION") && (
          <div className="screen">
            <Subhead title="MERIT" onBack={() => setScreen("home")} close />
            <div className="success">
              <span className="successIcon">✓</span>
              <p className="eyebrow dark">{captureLane === "RATER_OBSERVATION" ? "PRIVATE OBSERVATION RECORDED" : "ENTRY SUBMITTED"}</p>
              <h1>{captureLane === "RATER_OBSERVATION" ? "Leader context preserved." : "Captured while it was fresh."}</h1>
              <p>{captureLane === "RATER_OBSERVATION"
                ? `Your observation about ${raterTarget?.rank ?? ""} ${raterTarget?.displayName ?? "the Soldier"} remains private until discussed and released through counseling.`
                : "Your accomplishment is self-reported evidence awaiting rater review. The rater can confirm it, request clarification, or mark it not used."}</p>
              {submissionWarning && <p className="submissionWarning">{submissionWarning}</p>}
              <div className="card audit"><span>⌁</span><div><strong>{captureLane === "RATER_OBSERVATION" ? "Rater-owned record created" : "Evidence trail created"}</strong><small>{captureLane === "RATER_OBSERVATION" ? "Private until counseling release" : `Submitted by ${selected?.submittedBy ?? "you"}`}</small></div></div>
              {selected && <button className="secondaryWide" onClick={() => openEntry(selected)}>View submitted entry</button>}
            </div>
            <footer className="fixed"><button className="primary" onClick={() => setScreen("home")}>Done</button></footer>
          </div>
        )}

        {screen === "record" && (
          <div className="screen">
            <Subhead eyebrow={(data.supportForm?.label ?? "MERIT").toUpperCase()} title="Performance record" onBack={() => setScreen("home")} />
            <div className="content">
              <div className="card summary">
                <div><strong>{data.entries.length}</strong><span>Entries</span></div>
                <div><strong>{pending.length}</strong><span>Awaiting review</span></div>
                <div><strong>{data.entries.filter((entry) => entry.confirmationStatus === "CONFIRMED").length}</strong><span>Confirmed</span></div>
              </div>
              <p className="period">{data.supportForm?.ratingPeriod ?? "No personal support form"}</p>
              <div className="timeline">
                {data.entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} onOpen={() => openEntry(entry)} />
                ))}
              </div>
            </div>
            <BottomNav screen={screen} onHome={() => setScreen("home")} onCapture={startCapture} onRecord={() => setScreen("record")} />
          </div>
        )}

        {screen === "detail" && selected && (
          <div className="screen">
            <Subhead eyebrow="PERFORMANCE ENTRY" title={labels[selected.section]} onBack={() => setScreen("record")} />
            <div className="content detail">
              <div className="badges"><Status entry={selected} /><span className="dimensionBadge">{labels[selected.section]}</span></div>
              <p className="entryText">{selected.rawText}</p>
              <dl>
                <div><dt>Date of event</dt><dd>{formatDate(selected.entryDate)}</dd></div>
                <div><dt>Submitted by</dt><dd>{selected.submittedBy}</dd></div>
              </dl>
              <h2>Supporting evidence</h2>
              {!selected.artifacts.length && <p className="empty">No artifact attached.</p>}
              {selected.artifacts.map((artifact) => (
                <div className="artifactCard" key={artifact.id}>
                  {artifact.previewUrl ? <img src={artifact.previewUrl} alt="" /> : <span className="fileIcon">{artifact.mimeType.startsWith("image/") ? "IMG" : "DOC"}</span>}
                  <div><strong>{artifact.name}</strong><small>{bytes(artifact.size)}</small></div>
                  <span className={`caption ${artifact.aiCaptionStatus.toLowerCase()}`}>
                    {artifact.aiCaptionStatus === "PENDING" ? "Processing" : artifact.aiCaptionStatus === "COMPLETE" ? "Ready" : "Unavailable"}
                  </span>
                  {artifact.aiCaption && <p>{artifact.aiCaption}</p>}
                  {artifact.flaggedByServiceMember && <p className="warning">Soldier disclosure: {artifact.flagNote || "Verification requested."}</p>}
                </div>
              ))}
              <div className="reviewBoundary"><b>Leader review remains independent</b><p>Evidence provides context. It does not prove a rating or replace rater judgment.</p></div>
            </div>
          </div>
        )}

        {screen !== "record" && screen !== "capture" && screen !== "evidence" && screen !== "success" && screen !== "detail" && (
          <BottomNav screen={screen} onHome={() => setScreen("home")} onCapture={startCapture} onRecord={() => setScreen("record")} />
        )}
      </section>

      <aside className="demoNotes">
        <p className="eyebrow dark">MERIT MOBILE</p>
        <h2>The capture layer</h2>
        <p>A focused field workflow that feeds the same support-form record used by the full MERIT platform.</p>
        <ol>
          <li>Capture the accomplishment when it happens.</li>
          <li>Attach a photo or document and disclose discrepancies.</li>
          <li>Submit immediately with a processing state.</li>
          <li>Preserve the entry for independent rater review.</li>
        </ol>
        <p className="demoMode">Demo mode uses local browser storage. Production mode writes through the authorized MERIT support-form and evidence routes.</p>
      </aside>
    </main>
  );
}

function EntryRow({ entry, onOpen }: { entry: PerformanceEntry; onOpen: () => void }) {
  return (
    <button className="entryRow" onClick={onOpen}>
      <span className={`entryIcon ${entry.confirmationStatus === "CONFIRMED" ? "confirmed" : ""}`}>
        {entry.confirmationStatus === "CONFIRMED" ? "✓" : "⌁"}
      </span>
      <span className="entryCopy"><strong>{entry.rawText}</strong><small>{formatDate(entry.entryDate)} · {labels[entry.section]}</small></span>
      <Status entry={entry} />
      <b className="chevron">›</b>
    </button>
  );
}

function Status({ entry }: { entry: PerformanceEntry }) {
  const processing = entry.artifacts.some((artifact) => artifact.aiCaptionStatus === "PENDING");
  if (processing) return <span className="pill processing">Processing</span>;
  if (entry.confirmationStatus === "CONFIRMED") return <span className="pill confirmed">Confirmed</span>;
  if (entry.confirmationStatus === "NEEDS_CLARIFICATION") return <span className="pill clarification">Clarify</span>;
  if (entry.confirmationStatus === "NOT_USED") return <span className="pill muted">Not used</span>;
  return <span className="pill pending">Awaiting rater</span>;
}

function Subhead({ eyebrow, title, count, onBack, close }: { eyebrow?: string; title: string; count?: string; onBack: () => void; close?: boolean }) {
  return (
    <header className="subhead">
      <button onClick={onBack} aria-label={close ? "Close" : "Back"}>{close ? "×" : "‹"}</button>
      <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1></div>
      {count && <span>{count}</span>}
    </header>
  );
}

function BottomNav({ screen, onHome, onCapture, onRecord }: { screen: Screen; onHome: () => void; onCapture: () => void; onRecord: () => void }) {
  return (
    <nav className="bottomNav">
      <button className={screen === "home" ? "active" : ""} onClick={onHome}><span>⌂</span>Home</button>
      <button className="captureNav" onClick={onCapture}><span>＋</span>Capture</button>
      <button className={screen === "record" ? "active" : ""} onClick={onRecord}><span>☷</span>Record</button>
    </nav>
  );
}
