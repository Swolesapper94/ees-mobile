"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureDraft,
  DraftArtifact,
  ArtifactType,
  LeadershipDimension,
  MobileBootstrap,
  ObservationFeedbackType,
  PerformanceEntry,
  PilotKpiSummary,
  PilotMetricEventType,
  RaterAssignment,
  SubmissionState,
  leadershipDimensions,
} from "../lib/contracts";
import {
  DemoProfileId,
  clearSelectedDemoProfile,
  demoProfiles,
  eesGateway,
  readSelectedDemoProfileId,
  selectDemoProfile,
} from "../lib/ees-gateway";
import { isMobileDemoMode, signInToMerit, useDevelopmentIdentity } from "../lib/auth";

type Screen = "home" | "capture" | "evidence" | "success" | "record" | "detail" | "clarify" | "impact";
type CaptureLane = "SOLDIER_ENTRY" | "RATER_OBSERVATION";
type ActivePilotWorkflow = { workflowId: string; workflowType: CaptureLane; startedAt: number };

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
  clientRequestId: crypto.randomUUID(),
  rawText: "",
  section: "LEADS",
  eventDate: new Date().toISOString().slice(0, 10),
  artifacts: [],
  flaggedByServiceMember: false,
  attested: false,
});

const DRAFT_KEY = "merit-mobile-entry-draft-v2";
const DRAFT_DB = "merit-mobile-drafts";
const DRAFT_STORE = "capture-drafts";
const MAX_ARTIFACTS = 3;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const artifactTypes: Array<{ value: ArtifactType; label: string }> = [
  { value: "PHOTO", label: "Photo" },
  { value: "CERTIFICATE", label: "Certificate / award" },
  { value: "SCORE_SHEET", label: "Score sheet" },
  { value: "DOCUMENT", label: "Document" },
  { value: "OTHER", label: "Other" },
];

type StoredDraft = CaptureDraft & { supportFormId: string };

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAFT_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DRAFT_STORE)) request.result.createObjectStore(DRAFT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDraftLocally(supportFormId: string, draft: CaptureDraft) {
  try {
    const database = await openDraftDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DRAFT_STORE, "readwrite");
      transaction.objectStore(DRAFT_STORE).put({ ...draft, supportFormId } satisfies StoredDraft, supportFormId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    const { artifacts: _files, ...serializable } = draft;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...serializable, supportFormId }));
  }
}

async function loadDraftLocally(supportFormId: string): Promise<CaptureDraft | null> {
  try {
    const database = await openDraftDatabase();
    const stored = await new Promise<StoredDraft | undefined>((resolve, reject) => {
      const request = database.transaction(DRAFT_STORE).objectStore(DRAFT_STORE).get(supportFormId);
      request.onsuccess = () => resolve(request.result as StoredDraft | undefined);
      request.onerror = () => reject(request.error);
    });
    database.close();
    if (stored) {
      const { supportFormId: _formId, ...draft } = stored;
      return draft;
    }
  } catch {
    // Fall through to the text-only compatibility draft.
  }
  const saved = localStorage.getItem(DRAFT_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as Partial<CaptureDraft> & { supportFormId?: string };
    return parsed.supportFormId === supportFormId ? { ...emptyDraft(), ...parsed, artifacts: [] } : null;
  } catch {
    localStorage.removeItem(DRAFT_KEY);
    return null;
  }
}

async function clearDraftLocally(supportFormId: string) {
  localStorage.removeItem(DRAFT_KEY);
  try {
    const database = await openDraftDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DRAFT_STORE, "readwrite");
      transaction.objectStore(DRAFT_STORE).delete(supportFormId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // A missing IndexedDB draft is already effectively cleared.
  }
}

function defaultArtifactType(file: File): ArtifactType {
  if (file.type.startsWith("image/")) return "PHOTO";
  return "DOCUMENT";
}

async function normalizeEvidence(file: File): Promise<File> {
  const heic = /\.(heic|heif)$/i.test(file.name) || /image\/(heic|heif)/i.test(file.type);
  if (file.type === "application/pdf") {
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} exceeds the 20 MB limit.`);
    return file;
  }
  if (!file.type.startsWith("image/") && !heic) {
    throw new Error("Only JPEG, PNG, WEBP, HEIC/HEIF, and PDF evidence is accepted.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(heic
      ? "This browser cannot convert HEIC evidence. Choose a JPEG/PDF or use a browser with HEIC support."
      : `Unable to read ${file.name}. Choose another image.`);
  }
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error(`Unable to prepare ${file.name} for upload.`);
  if (blob.size > MAX_FILE_BYTES) throw new Error(`${file.name} remains larger than 20 MB after compression.`);
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
}

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
  const [demoProfileId, setDemoProfileId] = useState<DemoProfileId | null>(() => readSelectedDemoProfileId());
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
  const [submissionState, setSubmissionState] = useState<SubmissionState>("IDLE");
  const [failedArtifacts, setFailedArtifacts] = useState<DraftArtifact[]>([]);
  const [clarificationResponse, setClarificationResponse] = useState("");
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [pilotSummary, setPilotSummary] = useState<PilotKpiSummary | null>(null);
  const [pilotDays, setPilotDays] = useState(30);
  const [pilotLoading, setPilotLoading] = useState(false);
  const [pilotError, setPilotError] = useState("");
  const [showProfileSwitcher, setShowProfileSwitcher] = useState(false);
  const submissionLock = useRef(false);
  const activePilotWorkflow = useRef<ActivePilotWorkflow | null>(null);

  const refresh = useCallback(async () => {
    const next = await eesGateway.bootstrap();
    setData(next);
    setSelected((current) =>
      current ? next.entries.find((entry) => entry.id === current.id) ?? current : null,
    );
  }, []);

  useEffect(() => {
    if (isMobileDemoMode && !demoProfileId) return;
    refresh().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Unable to load MERIT Mobile."),
    );
    const update = () => void refresh().catch(() => undefined);
    window.addEventListener("ees-demo-updated", update);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") update();
    }, 15_000);
    return () => {
      window.removeEventListener("ees-demo-updated", update);
      window.clearInterval(poll);
    };
  }, [demoProfileId, refresh]);

  useEffect(() => {
    if (!data?.supportForm || !["capture", "evidence"].includes(screen)) return;
    void saveDraftLocally(data.supportForm.id, draft);
  }, [data?.supportForm, draft, screen]);

  const pending = useMemo(
    () => data?.entries.filter((entry) => entry.confirmationStatus === "UNREVIEWED") ?? [],
    [data],
  );

  function recordPilotEvent(eventType: PilotMetricEventType, details: { hasEvidence?: boolean; evidenceCount?: number } = {}) {
    const workflow = activePilotWorkflow.current;
    if (!workflow) return;
    const includeDuration = eventType === "WORKFLOW_COMPLETED" || eventType === "WORKFLOW_FAILED";
    void eesGateway.trackPilotEvent({
      clientEventId: crypto.randomUUID(),
      pilotId: "MERIT_MOBILE_PILOT",
      workflowId: workflow.workflowId,
      workflowType: workflow.workflowType,
      eventType,
      ...(includeDuration ? { durationMs: Math.max(0, Date.now() - workflow.startedAt) } : {}),
      ...details,
      occurredAt: new Date().toISOString(),
    }).catch(() => undefined);
  }

  async function openPilotImpact(days = pilotDays) {
    if (!data?.canViewPilotImpact || data.user.applicationSupportRole !== "ADMINISTRATOR") {
      setPilotSummary(null);
      setScreen("home");
      return;
    }
    setPilotDays(days);
    setPilotLoading(true);
    setPilotError("");
    setScreen("impact");
    try {
      setPilotSummary(await eesGateway.pilotSummary(days));
    } catch (cause) {
      setPilotError(cause instanceof Error ? cause.message : "Pilot impact could not be loaded.");
    } finally {
      setPilotLoading(false);
    }
  }

  async function startCapture() {
    if (!data?.supportForm) return;
    setCaptureLane("SOLDIER_ENTRY");
    setRaterTarget(null);
    const recoveredDraft = await loadDraftLocally(data.supportForm.id);
    const nextDraft = recoveredDraft ?? emptyDraft();
    setDraft(nextDraft);
    activePilotWorkflow.current = { workflowId: nextDraft.clientRequestId, workflowType: "SOLDIER_ENTRY", startedAt: Date.now() };
    recordPilotEvent("WORKFLOW_STARTED");
    if (recoveredDraft) recordPilotEvent("DRAFT_RECOVERED");
    setError("");
    setScreen("capture");
  }

  function startObservation(target: RaterAssignment) {
    setCaptureLane("RATER_OBSERVATION");
    setRaterTarget(target);
    setFeedbackType("NEUTRAL");
    const nextDraft = emptyDraft();
    setDraft(nextDraft);
    activePilotWorkflow.current = { workflowId: nextDraft.clientRequestId, workflowType: "RATER_OBSERVATION", startedAt: Date.now() };
    recordPilotEvent("WORKFLOW_STARTED");
    setError("");
    setScreen("capture");
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const available = MAX_ARTIFACTS - draft.artifacts.length;
    const files = [...(event.target.files ?? [])].slice(0, available);
    event.target.value = "";
    if (!files.length) {
      setError(`You can attach up to ${MAX_ARTIFACTS} artifacts.`);
      return;
    }
    setError("");
    try {
      const prepared = await Promise.all(files.map(async (file) => {
        const normalized = await normalizeEvidence(file);
        return { id: crypto.randomUUID(), file: normalized, type: defaultArtifactType(normalized) } satisfies DraftArtifact;
      }));
      setDraft((current) => ({ ...current, artifacts: [...current.artifacts, ...prepared] }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to prepare that evidence.");
    }
  }

  function validateEventDate() {
    if (!data?.supportForm) return "No active support form is available.";
    const eventDate = draft.eventDate.slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (eventDate > today) return "The event date cannot be in the future.";
    if (eventDate < data.supportForm.ratingPeriodStart.slice(0, 10) || eventDate > data.supportForm.ratingPeriodEnd.slice(0, 10)) {
      return "The event date must fall within the active rating period.";
    }
    return "";
  }

  function continueToEvidence() {
    if (!draft.rawText.trim()) return setError("Describe the accomplishment to continue.");
    const dateError = validateEventDate();
    if (dateError) return setError(dateError);
    setError("");
    recordPilotEvent("EVIDENCE_STEP_REACHED", { hasEvidence: draft.artifacts.length > 0, evidenceCount: draft.artifacts.length });
    setScreen("evidence");
  }

  async function submit() {
    if (busy || submissionLock.current) return;
    if (!draft.rawText.trim()) {
      setError("Describe the accomplishment before submitting.");
      setScreen("capture");
      return;
    }
    if (!draft.attested) {
      setError("Confirm the factual attestation before submitting.");
      return;
    }
    const dateError = validateEventDate();
    if (dateError) return setError(dateError);
    if (draft.flaggedByServiceMember && !draft.artifacts.length) {
      return setError("Attach evidence before reporting a discrepancy.");
    }
    if (draft.flaggedByServiceMember && !draft.flagNote?.trim()) {
      return setError("Explain the discrepancy before submitting.");
    }
    submissionLock.current = true;
    setBusy(true);
    setError("");
    setSubmissionWarning("");
    let recordCreated = false;
    try {
      const result = await eesGateway.createEntry(draft, setSubmissionState);
      recordCreated = true;
      recordPilotEvent("WORKFLOW_COMPLETED", { hasEvidence: draft.artifacts.length > 0, evidenceCount: draft.artifacts.length });
      await refresh();
      setSelected(result.entry);
      setSubmissionWarning(result.uploadWarning ?? "");
      setFailedArtifacts(result.failedArtifacts ?? []);
      if (data?.supportForm) await clearDraftLocally(data.supportForm.id);
      setScreen("success");
    } catch (cause: unknown) {
      if (!recordCreated) recordPilotEvent("WORKFLOW_FAILED", { hasEvidence: draft.artifacts.length > 0, evidenceCount: draft.artifacts.length });
      setError(cause instanceof Error ? cause.message : "Submission failed.");
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  }

  async function retryEvidence() {
    if (!selected || !failedArtifacts.length || busy || submissionLock.current) return;
    submissionLock.current = true;
    setBusy(true);
    setError("");
    try {
      const retryDraft = { ...draft, artifacts: failedArtifacts };
      const result = await eesGateway.retryEvidence(selected, retryDraft, setSubmissionState);
      setSelected(result.entry);
      setFailedArtifacts(result.failedArtifacts);
      setSubmissionWarning(result.failedArtifacts.length ? "Evidence upload failed again. The saved entry remains available." : "");
      await refresh();
    } catch (cause) {
      setSubmissionState("UPLOAD_FAILED");
      setSubmissionWarning(cause instanceof Error ? cause.message : "Evidence upload failed. The entry remains saved.");
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  }

  function startClarification(entry: PerformanceEntry) {
    setSelected(entry);
    setClarificationResponse("");
    setDraft({ ...emptyDraft(), rawText: entry.rawText, section: entry.section, goalId: entry.goalId, eventDate: entry.entryDate.slice(0, 10) });
    setError("");
    setScreen("clarify");
  }

  async function resubmitClarification() {
    if (!selected || busy || submissionLock.current) return;
    if (!clarificationResponse.trim()) return setError("Describe how you corrected or clarified the entry.");
    if (!draft.rawText.trim()) return setError("The corrected accomplishment cannot be empty.");
    if (draft.flaggedByServiceMember && (!draft.artifacts.length || !draft.flagNote?.trim())) {
      return setError("A discrepancy requires attached evidence and an explanation.");
    }
    submissionLock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await eesGateway.resubmitClarification(selected, draft, clarificationResponse, setSubmissionState);
      if (result.failedArtifacts.length) {
        setFailedArtifacts(result.failedArtifacts);
        setError("Replacement evidence upload failed. The original entry is unchanged; retry the evidence before resubmitting.");
        return;
      }
      setSelected(result.entry);
      setFailedArtifacts([]);
      setSubmissionWarning("");
      await refresh();
      setScreen("success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Clarification resubmission failed.");
    } finally {
      submissionLock.current = false;
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
    let recordCreated = false;
    try {
      await eesGateway.createObservation({
        clientRequestId: draft.clientRequestId,
        supportFormId: raterTarget.supportFormId,
        factualNote: draft.rawText,
        sectionKey: draft.section,
        feedbackType,
        occurredAt: draft.eventDate,
        goalId: draft.goalId || undefined,
      });
      recordCreated = true;
      recordPilotEvent("WORKFLOW_COMPLETED", { hasEvidence: false, evidenceCount: 0 });
      setSelected(null);
      setScreen("success");
    } catch (cause: unknown) {
      if (!recordCreated) recordPilotEvent("WORKFLOW_FAILED", { hasEvidence: false, evidenceCount: 0 });
      setError(cause instanceof Error ? cause.message : "Observation submission failed.");
    } finally {
      setBusy(false);
    }
  }

  function openEntry(entry: PerformanceEntry) {
    setSelected(entry);
    setShowWithdraw(false);
    setWithdrawalReason("");
    setScreen("detail");
  }

  async function withdrawEntry() {
    if (!selected || busy || submissionLock.current) return;
    submissionLock.current = true;
    setBusy(true);
    setError("");
    try {
      await eesGateway.withdrawEntry(selected, withdrawalReason);
      setSelected(null);
      await refresh();
      setScreen("record");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The entry could not be withdrawn.");
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
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

  async function enterDemoProfile(profileId: DemoProfileId) {
    selectDemoProfile(profileId);
    setDemoProfileId(profileId);
    setData(null);
    setError("");
    setScreen("home");
    setSelected(null);
    setPilotSummary(null);
    setPilotError("");
    setShowProfileSwitcher(false);
    setDraft(emptyDraft());
    setCaptureLane("SOLDIER_ENTRY");
    setRaterTarget(null);
    setSubmissionWarning("");
    setFailedArtifacts([]);
    activePilotWorkflow.current = null;
    try {
      await refresh();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Unable to open that demo profile.");
    }
  }

  function returnToDemoLogin() {
    clearSelectedDemoProfile();
    setDemoProfileId(null);
    setData(null);
    setError("");
    setScreen("home");
    setSelected(null);
    setPilotSummary(null);
    setShowProfileSwitcher(false);
    activePilotWorkflow.current = null;
  }

  if (isMobileDemoMode && !demoProfileId) {
    return <DemoLogin onSelect={(profileId) => void enterDemoProfile(profileId)} />;
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
                <p className="authHint">Use a MERIT account. Local development also accepts Davis, Johnson, or Smith with password <code>testpass</code>.</p>
                <label>Email<input type="email" autoComplete="username" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /></label>
                <label>Password<input type="password" autoComplete="current-password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void signIn(); }} /></label>
                <button disabled={busy} onClick={() => void signIn()}>{busy ? "Signing in…" : "Sign in"}</button>
                {import.meta.env.DEV && (
                  <div className="devIdentities">
                    <span>Or choose a local development identity</span>
                    <button onClick={() => void useDevIdentity("james.davis@army.mil")}>SGT Davis · Soldier</button>
                    <button onClick={() => void useDevIdentity("marcus.johnson@army.mil")}>SSG Johnson · Rater</button>
                    <button onClick={() => void useDevIdentity("peter.smith@army.mil")}>CPT Smith · Platform admin</button>
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

  const establishedDimensions = new Set(data.supportForm?.goalsEstablishedDimensions ?? []);
  const goalsEstablished = establishedDimensions.size;
  const currentDemoProfile = demoProfiles.find((profile) => profile.id === demoProfileId);
  const homeEyebrow = data.canViewPilotImpact
    ? "PRIVATE PILOT FEEDBACK LOOP"
    : data.raterAssignments.length > 0
      ? "SOLDIER + LEADER WORKSPACE"
      : "SOLDIER WORKSPACE · FY26";
  const homeDescription = data.canViewPilotImpact
    ? "Review aggregate adoption, speed, reliability, and outcomes without opening personnel content."
    : data.raterAssignments.length > 0
      ? "Maintain your own record and document direct observations for Soldiers in your authorized roster."
      : "Capture performance now. Your rating official reviews it in MERIT.";

  return (
    <main className="stage">
      <section className="phone" aria-label="MERIT Mobile performance capture">
        <div className="statusbar">
          {isMobileDemoMode ? (
            <>
              <span className="demoBadge">DEMO</span>
              <button className="demoProfileTrigger" onClick={() => setShowProfileSwitcher(true)} aria-haspopup="dialog">
                {currentDemoProfile?.identityLabel ?? `${data.user.rank} ${data.user.displayName}`} <span aria-hidden="true">⌄</span>
              </button>
            </>
          ) : <span>9:41</span>}
          <span>●●● 5G ▰</span>
        </div>

        {isMobileDemoMode && showProfileSwitcher && (
          <div className="demoProfileOverlay" role="dialog" aria-modal="true" aria-labelledby="profileSwitcherTitle">
            <section className="demoProfileSheet">
              <header>
                <div><p className="eyebrow dark">DEMO PROFILE</p><h2 id="profileSwitcherTitle">Switch MERIT view</h2></div>
                <button onClick={() => setShowProfileSwitcher(false)} aria-label="Close profile selector">×</button>
              </header>
              <p className="profileSwitcherHelp">A Leader is also a rated Soldier. Observer access comes from an authorized relationship; pilot metrics remain separate.</p>
              <div className="profileSwitcherList">
                {demoProfiles.map((profile) => {
                  const active = profile.id === demoProfileId;
                  return (
                    <button key={profile.id} className={active ? "active" : ""} onClick={() => void enterDemoProfile(profile.id)} aria-current={active ? "true" : undefined}>
                      <span className="demoAvatar">{profile.initials}</span>
                      <span><small>{profile.roleLabel}</small><strong>{profile.identityLabel}</strong><em>{profile.accessLabel}</em></span>
                      <b aria-hidden="true">{active ? "✓" : "›"}</b>
                    </button>
                  );
                })}
              </div>
              <button className="returnToLogin" onClick={returnToDemoLogin}>Return to demo sign-in</button>
            </section>
          </div>
        )}

        {screen === "home" && (
          <div className="screen">
            <header className="hero">
              <div className="brand"><img src="/army-star.jpg" alt="" /> MERIT</div>
              <p className="eyebrow">{homeEyebrow}</p>
              <h1>Good afternoon,<br />{data.user.rank} {data.user.displayName.split(" ")[1]}.</h1>
              <p>{homeDescription}</p>
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
                    <span>Personal record</span>
                    <strong>Rating-official review required</strong>
                    <p>Every participant may capture their own work. The submission remains self-reported evidence until an authorized rating official reviews it.</p>
                  </div>
                </>
              )}

              {data.raterAssignments.length > 0 && (
                <section className="leaderCapture">
                  <p className="eyebrow dark">AUTHORIZED OBSERVER LANE</p>
                  <h2>Record a direct observation</h2>
                  <p>This capability comes from an authorized Soldier relationship—not rank or pilot-admin access. Observations remain attributable and private until counseling release.</p>
                  <div className="soldierChoices">
                    {data.raterAssignments.map((assignment) => (
                      <button key={assignment.supportFormId} onClick={() => startObservation(assignment)}>
                        <span><strong>{assignment.rank} {assignment.displayName}</strong><small>Authorized roster · record factual observation</small></span>
                        <b>→</b>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {data.canViewPilotImpact && (
                <button className="impactCta" onClick={() => void openPilotImpact()}>
                  <span className="impactCtaIcon">↗</span>
                  <span><strong>Pilot impact</strong><small>Adoption, speed, quality, and evaluation use</small></span>
                  <b>›</b>
                </button>
              )}

              {data.supportForm && <article className="card readiness">
                <div className="row">
                  <div><p className="eyebrow dark">SUPPORT FORM STATUS</p><h2>{data.supportForm.status.replaceAll("_", " ")}</h2></div>
                  <strong className="score">{Math.round((goalsEstablished / 6) * 100)}%</strong>
                </div>
                <p className="readinessFact">Goals established: <strong>{goalsEstablished} of 6 dimensions</strong></p>
                <p className="readinessFact">Entries awaiting rater review: <strong>{pending.length}</strong></p>
                <div className="progress"><span style={{ width: `${(goalsEstablished / 6) * 100}%` }} /></div>
                <div className="dimensions">
                  {leadershipDimensions.map((dimension) => (
                    <span className={establishedDimensions.has(dimension) ? "active" : ""} key={dimension}>
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
              eyebrow={captureLane === "SOLDIER_ENTRY" ? "PERSONAL RECORD" : `AUTHORIZED OBSERVATION · ${raterTarget?.rank ?? ""} ${raterTarget?.displayName ?? ""}`}
              title={captureLane === "SOLDIER_ENTRY" ? "Capture accomplishment" : "Record observation"}
              count={captureLane === "SOLDIER_ENTRY" ? "1 / 2" : undefined}
              onBack={() => setScreen("home")}
            />
            <div className="content">
              <p className="helper">
                {captureLane === "SOLDIER_ENTRY"
                  ? "Keep it factual. This is your self-reported evidence; your rater must review it before use."
                  : "Record only what you directly observed. MERIT retains who observed it and routes the record through the Soldier's authorized rating relationship."}
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
                    onClick={() => setDraft({ ...draft, section: dimension, goalId: data.goals.some((goal) => goal.id === draft.goalId && goal.sectionKey === dimension) ? draft.goalId : undefined })}
                  >
                    {labels[dimension]}
                  </button>
                ))}
              </div>

              <label htmlFor="goal">Link to a goal <em>Optional</em></label>
              <select id="goal" value={draft.goalId ?? ""} onChange={(event) => setDraft({ ...draft, goalId: event.target.value })}>
                <option value="">No linked goal</option>
                {(captureLane === "RATER_OBSERVATION" ? raterTarget?.goals ?? [] : data.goals.filter((goal) => goal.sectionKey === draft.section)).map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
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
                  : continueToEvidence()}
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
              <div className="policyWarning"><strong>Before taking a photo</strong><span>Do not upload classified information, controlled operational material, medical records, or evidence containing unnecessary personal information.</span></div>
              <label className="upload" htmlFor="evidenceFile">
                <span>↑</span><strong>Attach proof</strong><small>Up to 3 JPEG, PNG, WEBP, HEIC, or PDF files · 20 MB each</small>
                <input id="evidenceFile" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf" onChange={(event) => void chooseFile(event)} />
              </label>
              <div className="uploadOptions">
                <label className="secondary" htmlFor="cameraFile">◎ Take photo</label>
                <label className="secondary" htmlFor="evidenceFile">▣ Browse files</label>
              </div>
              <input className="hiddenInput" id="cameraFile" type="file" accept="image/*" capture="environment" onChange={(event) => void chooseFile(event)} />

              {draft.artifacts.map((artifact) => (
                <div className="proof" key={artifact.id}>
                  <span className="fileIcon">{artifact.file.type.startsWith("image/") ? "IMG" : "PDF"}</span>
                  <span><strong>{artifact.file.name}</strong><small>{bytes(artifact.file.size)} · Ready to upload</small><select aria-label={`Evidence type for ${artifact.file.name}`} value={artifact.type} onChange={(event) => setDraft((current) => ({ ...current, artifacts: current.artifacts.map((item) => item.id === artifact.id ? { ...item, type: event.target.value as ArtifactType } : item) }))}>{artifactTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></span>
                  <button aria-label={`Remove ${artifact.file.name}`} onClick={() => setDraft((current) => { const artifacts = current.artifacts.filter((item) => item.id !== artifact.id); return { ...current, artifacts, flaggedByServiceMember: artifacts.length ? current.flaggedByServiceMember : false, flagNote: artifacts.length ? current.flagNote : "" }; })}>×</button>
                </div>
              ))}

              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.flaggedByServiceMember}
                  disabled={!draft.artifacts.length}
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
            <footer className="fixed"><button className="primary" disabled={busy} onClick={submit}>{busy ? submissionLabel(submissionState) : "Submit for rater review →"}</button></footer>
          </div>
        )}

        {screen === "success" && (selected || captureLane === "RATER_OBSERVATION") && (
          <div className="screen">
            <Subhead title="MERIT" onBack={() => setScreen("home")} close />
            <div className="success">
              <span className="successIcon">✓</span>
              <p className="eyebrow dark">{captureLane === "RATER_OBSERVATION" ? "PRIVATE OBSERVATION RECORDED" : "ENTRY SUBMITTED"}</p>
              <h1>{captureLane === "RATER_OBSERVATION" ? "Direct context preserved." : "Captured while it was fresh."}</h1>
              <p>{captureLane === "RATER_OBSERVATION"
                ? `Your observation about ${raterTarget?.rank ?? ""} ${raterTarget?.displayName ?? "the Soldier"} remains private until discussed and released through counseling.`
                : "Your accomplishment is self-reported evidence awaiting rater review. The rater can confirm it, request clarification, or mark it not used."}</p>
              {submissionWarning && <p className="submissionWarning">{submissionWarning}</p>}
              <SubmissionProgress state={submissionState} hasEvidence={Boolean(selected?.artifacts.length || failedArtifacts.length)} />
              <div className="card audit"><span>⌁</span><div><strong>{captureLane === "RATER_OBSERVATION" ? "Observer-attributed record created" : "Evidence trail created"}</strong><small>{captureLane === "RATER_OBSERVATION" ? "Private until counseling release" : `Submitted by ${selected?.submittedBy ?? "you"}`}</small></div></div>
              {failedArtifacts.length > 0 && <button className="secondaryWide" disabled={busy} onClick={() => void retryEvidence()}>{busy ? "Retrying evidence…" : `Retry ${failedArtifacts.length} failed upload${failedArtifacts.length === 1 ? "" : "s"}`}</button>}
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
            <BottomNav screen={screen} onHome={() => setScreen("home")} onCapture={data.supportForm ? startCapture : undefined} onRecord={data.supportForm ? () => setScreen("record") : undefined} onImpact={data.canViewPilotImpact ? () => void openPilotImpact() : undefined} />
          </div>
        )}

        {screen === "impact" && data.canViewPilotImpact && data.user.applicationSupportRole === "ADMINISTRATOR" && (
          <div className="screen">
            <Subhead eyebrow="PILOT OWNER ONLY" title="Pilot impact" onBack={() => setScreen("home")} />
            <div className="content impactDashboard">
              <div className="impactToolbar">
              <div><p className="eyebrow dark">MEASUREMENT WINDOW</p><strong>Pilot-wide aggregate</strong></div>
                <div className="rangeToggle" aria-label="Pilot measurement window">
                  {[30, 90].map((days) => <button key={days} className={pilotDays === days ? "selected" : ""} onClick={() => void openPilotImpact(days)}>{days}d</button>)}
                </div>
              </div>
              {pilotLoading && <div className="impactLoading">Loading pilot measures…</div>}
              {pilotError && <div className="impactError"><strong>Impact data unavailable</strong><p>{pilotError}</p><button onClick={() => void openPilotImpact()}>Try again</button></div>}
              {!pilotLoading && pilotSummary && <PilotImpactDashboard summary={pilotSummary} />}
            </div>
            <BottomNav screen={screen} onHome={() => setScreen("home")} onCapture={data.supportForm ? startCapture : undefined} onRecord={data.supportForm ? () => setScreen("record") : undefined} onImpact={() => void openPilotImpact()} />
          </div>
        )}

        {screen === "detail" && selected && (
          <div className="screen">
            <Subhead eyebrow="PERFORMANCE ENTRY" title={labels[selected.section]} onBack={() => setScreen("record")} />
            <div className="content detail">
              <div className="badges"><Status entry={selected} /><span className="dimensionBadge">{labels[selected.section]}</span></div>
              <p className="entryText">{selected.rawText}</p>
              {selected.confirmationStatus === "NEEDS_CLARIFICATION" && (
                <section className="clarificationRequest">
                  <strong>Rater clarification request</strong>
                  <p>{selected.clarificationNote}</p>
                  <button onClick={() => startClarification(selected)}>Respond, correct, and resubmit</button>
                </section>
              )}
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
                    {artifact.aiCaptionStatus === "PENDING" ? "Analyzing evidence" : artifact.aiCaptionStatus === "COMPLETE" ? "Analysis complete" : "Analysis failed · evidence available"}
                  </span>
                  {artifact.aiCaption && <p>{artifact.aiCaption}</p>}
                  {artifact.flaggedByServiceMember && <p className="warning">Soldier disclosure: {artifact.flagNote || "Verification requested."}</p>}
                </div>
              ))}
              <div className="reviewBoundary"><b>Leader review remains independent</b><p>Evidence provides context. It does not prove a rating or replace rater judgment.</p></div>
              {selected.confirmationStatus === "UNREVIEWED" && !selected.usedInEvalId && (
                <section className="withdrawEntry">
                  {!showWithdraw ? <button onClick={() => setShowWithdraw(true)}>Withdraw this unreviewed entry</button> : <><label htmlFor="withdrawalReason">Withdrawal reason <em>Optional</em></label><textarea id="withdrawalReason" rows={2} value={withdrawalReason} onChange={(event) => setWithdrawalReason(event.target.value)} /><div><button disabled={busy} onClick={() => void withdrawEntry()}>{busy ? "Withdrawing…" : "Confirm withdrawal"}</button><button onClick={() => setShowWithdraw(false)}>Cancel</button></div></>}
                  <p>Confirmed entries and evidence already used in an evaluation are locked.</p>
                </section>
              )}
              {error && <p className="error">{error}</p>}
            </div>
          </div>
        )}

        {screen === "clarify" && selected && (
          <div className="screen formScreen">
            <Subhead eyebrow="CLARIFICATION REQUEST" title="Correct and resubmit" onBack={() => setScreen("detail")} />
            <div className="content">
              <section className="clarificationRequest"><strong>Rater note</strong><p>{selected.clarificationNote}</p></section>
              <label htmlFor="clarificationResponse">Your response</label>
              <textarea id="clarificationResponse" rows={3} value={clarificationResponse} placeholder="Explain what you corrected or clarified." onChange={(event) => setClarificationResponse(event.target.value)} />
              <label htmlFor="correctedEntry">Corrected accomplishment</label>
              <textarea id="correctedEntry" rows={5} maxLength={5000} value={draft.rawText} onChange={(event) => setDraft({ ...draft, rawText: event.target.value })} />
              <div className="policyWarning"><strong>Replacement evidence</strong><span>Optional. Do not upload classified information, controlled operational material, medical records, or evidence containing unnecessary personal information.</span></div>
              <label className="upload compactUpload" htmlFor="clarificationEvidence"><span>↑</span><strong>Add replacement evidence</strong><small>Up to 3 classified artifacts · 20 MB each</small><input id="clarificationEvidence" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf" onChange={(event) => void chooseFile(event)} /></label>
              {draft.artifacts.map((artifact) => <div className="proof" key={artifact.id}><span className="fileIcon">{artifact.file.type.startsWith("image/") ? "IMG" : "PDF"}</span><span><strong>{artifact.file.name}</strong><small>{bytes(artifact.file.size)} · Replacement evidence</small><select aria-label={`Evidence type for ${artifact.file.name}`} value={artifact.type} onChange={(event) => setDraft((current) => ({ ...current, artifacts: current.artifacts.map((item) => item.id === artifact.id ? { ...item, type: event.target.value as ArtifactType } : item) }))}>{artifactTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></span><button aria-label={`Remove ${artifact.file.name}`} onClick={() => setDraft((current) => ({ ...current, artifacts: current.artifacts.filter((item) => item.id !== artifact.id) }))}>×</button></div>)}
              {error && <p className="error">{error}</p>}
            </div>
            <footer className="fixed"><button className="primary" disabled={busy} onClick={() => void resubmitClarification()}>{busy ? submissionLabel(submissionState) : "Resubmit for rater review"}</button></footer>
          </div>
        )}

        {screen !== "record" && screen !== "impact" && screen !== "capture" && screen !== "evidence" && screen !== "success" && screen !== "detail" && screen !== "clarify" && (
          <BottomNav screen={screen} onHome={() => setScreen("home")} onCapture={data.supportForm ? startCapture : undefined} onRecord={data.supportForm ? () => setScreen("record") : undefined} onImpact={data.canViewPilotImpact ? () => void openPilotImpact() : undefined} />
        )}
      </section>

      <aside className="demoNotes">
        <p className="eyebrow dark">{currentDemoProfile?.roleLabel ?? "MERIT MOBILE"}</p>
        <h2>{currentDemoProfile?.identityLabel ?? "The capture layer"}</h2>
        <p>{currentDemoProfile?.description ?? "A focused field workflow that feeds the same support-form record used by the full MERIT platform."}</p>
        <ol>{demoViewSteps(demoProfileId).map((step) => <li key={step}>{step}</li>)}</ol>
        <p className="demoMode">Demo mode uses local browser storage. Production mode writes through the authorized MERIT support-form and evidence routes.</p>
      </aside>
    </main>
  );
}

function demoViewSteps(profileId: DemoProfileId | null): string[] {
  if (profileId === "leader") return [
    "Maintain your own record as a rated Soldier.",
    "Observe Soldiers only within your authorized roster.",
    "Keep observations attributable and private until counseling release.",
  ];
  if (profileId === "pilot_owner") return [
    "Open the pilot-wide aggregate.",
    "Review adoption, speed, reliability, and workflow outcomes.",
    "Measure the pilot without opening personnel narratives or ranking people.",
  ];
  return [
    "Capture the accomplishment when it happens.",
    "Attach a photo or document and disclose discrepancies.",
    "Submit it for independent rater review.",
  ];
}

function DemoLogin({ onSelect }: { onSelect: (profileId: DemoProfileId) => void }) {
  return (
    <main className="demoLoginStage">
      <section className="demoLoginCard" aria-labelledby="demoLoginTitle">
        <div className="demoLoginHeader">
          <div className="brand"><img src="/army-star.jpg" alt="" /> MERIT</div>
          <span>INTERACTIVE DEMONSTRATION</span>
        </div>
        <div className="demoLoginIntro">
          <p className="eyebrow dark">MERIT MOBILE</p>
          <h1 id="demoLoginTitle">Choose a profile</h1>
          <p>Compare the Soldier, Leader, and private Pilot Owner views. A person can be both rated and a leader; pilot analytics are a separate access boundary.</p>
        </div>
        <div className="demoProfileGrid">
          {demoProfiles.map((profile) => (
            <button key={profile.id} className="demoProfileCard" onClick={() => onSelect(profile.id)}>
              <span className="demoAvatar">{profile.initials}</span>
              <span className="demoProfileCopy">
                <small>{profile.roleLabel}</small>
                <strong>{profile.identityLabel}</strong>
                <span>{profile.description}</span>
                <em className={profile.id === "pilot_owner" ? "hasImpact" : ""}>{profile.accessLabel}</em>
              </span>
              <b aria-hidden="true">›</b>
            </button>
          ))}
        </div>
        <p className="demoDisclosure"><strong>Staged demonstration:</strong> Names, records, and measures are synthetic and stay in this browser. No Army account, live MERIT API, or production database is used.</p>
      </section>
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
  const analysisFailed = entry.artifacts.some((artifact) => artifact.aiCaptionStatus === "FAILED");
  const analyzing = entry.artifacts.some((artifact) => artifact.aiCaptionStatus === "PENDING");
  const analysisComplete = entry.artifacts.length > 0 && entry.artifacts.every((artifact) => artifact.aiCaptionStatus === "COMPLETE");
  if (analysisFailed) return <span className="pill failed">Analysis failed · evidence available</span>;
  if (analyzing) return <span className="pill processing">Analyzing evidence</span>;
  if (entry.confirmationStatus === "CONFIRMED") return <span className="pill confirmed">Confirmed</span>;
  if (entry.confirmationStatus === "NEEDS_CLARIFICATION") return <span className="pill clarification">Clarify</span>;
  if (entry.confirmationStatus === "NOT_USED") return <span className="pill muted">Not used</span>;
  if (analysisComplete) return <span className="pill complete">Analysis complete</span>;
  return <span className="pill pending">Awaiting rater</span>;
}

function submissionLabel(state: SubmissionState) {
  const labels: Record<SubmissionState, string> = {
    IDLE: "Working…",
    SAVING_ENTRY: "Saving entry…",
    UPLOADING_EVIDENCE: "Uploading evidence…",
    EVIDENCE_SECURED: "Evidence secured",
    ANALYZING_EVIDENCE: "Analyzing evidence…",
    ANALYSIS_COMPLETE: "Analysis complete",
    UPLOAD_FAILED: "Upload failed — retry",
    ANALYSIS_FAILED: "Analysis failed — evidence still available",
  };
  return labels[state];
}

function SubmissionProgress({ state, hasEvidence }: { state: SubmissionState; hasEvidence: boolean }) {
  if (!hasEvidence && state === "ANALYSIS_COMPLETE") return null;
  return (
    <div className={`submissionProgress ${state.toLowerCase()}`}>
      <strong>{submissionLabel(state)}</strong>
      {state === "UPLOAD_FAILED" && <span>The entry is saved. Retry only the evidence upload.</span>}
      {state === "ANALYSIS_FAILED" && <span>AI failure never deletes secured evidence.</span>}
      {state === "ANALYZING_EVIDENCE" && <span>The upload is secured; analysis runs separately.</span>}
      {state === "ANALYSIS_COMPLETE" && <span>The evidence remains attached to this entry.</span>}
    </div>
  );
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

function PilotImpactDashboard({ summary }: { summary: PilotKpiSummary }) {
  const maxWeekly = Math.max(1, ...summary.weeklyTrend.map((week) => week.records));
  const valueSteps = [
    { label: "Mobile records", value: summary.outcomes.mobileRecords, width: 100 },
    { label: "Reviewed or released", value: summary.outcomes.reviewedRecords, width: summary.outcomes.mobileRecords ? Math.round((summary.outcomes.reviewedRecords / summary.outcomes.mobileRecords) * 100) : 0 },
    { label: "Used in evaluation", value: summary.outcomes.usedInEvaluation, width: summary.outcomes.mobileRecords ? Math.round((summary.outcomes.usedInEvaluation / summary.outcomes.mobileRecords) * 100) : 0 },
  ];
  return (
    <>
      <div className={`dataBanner ${summary.dataStatus === "SYNTHETIC_DEMO" ? "demo" : "live"}`}>
        <strong>{summary.dataStatus === "SYNTHETIC_DEMO" ? "Illustrative pilot data" : "Live pilot-wide aggregate"}</strong>
        <span>{summary.dataStatus === "SYNTHETIC_DEMO" ? "Seeded to demonstrate the platform view; not an Army result." : `${summary.scope.unitCount} unit${summary.scope.unitCount === 1 ? "" : "s"} in scope.`}</span>
      </div>

      <section className="impactKpis" aria-label="Pilot headline measures">
        <article><span>Active people</span><strong>{summary.adoption.activeParticipants}</strong><small>{summary.adoption.repeatParticipants} repeat users</small></article>
        <article><span>Mobile records</span><strong>{summary.outcomes.mobileRecords}</strong><small>{summary.outcomes.soldierEntries} Soldier · {summary.outcomes.raterObservations} leader</small></article>
        <article><span>Median capture</span><strong>{summary.speed.medianCaptureSeconds === null ? "—" : formatDuration(summary.speed.medianCaptureSeconds)}</strong><small>n={summary.speed.measuredCompletions} completed</small></article>
        <article><span>Completion</span><strong>{summary.adoption.completionRate}%</strong><small>{summary.adoption.workflowsFailed} failed workflows</small></article>
      </section>

      <section className="impactSection">
        <div className="impactTitle"><div><p className="eyebrow dark">OPERATIONAL VALUE</p><h2>Record-to-evaluation chain</h2></div><span>{summary.period.days} days</span></div>
        <div className="valueChain">
          {valueSteps.map((step) => <div className="valueStep" key={step.label}><div><span>{step.label}</span><strong>{step.value}</strong></div><div className="valueBar"><span style={{ width: `${Math.min(100, step.width)}%` }} /></div></div>)}
        </div>
        <p className="sectionNote">Use in an evaluation is the strongest product outcome shown here. It does not imply a particular rating.</p>
      </section>

      <section className="impactSection">
        <div className="impactTitle"><div><p className="eyebrow dark">STREAMLINING</p><h2>Weekly records captured</h2></div><span>{summary.outcomes.releasedObservations} released in counseling</span></div>
        <div className="weeklyChart" aria-label="Weekly mobile records">
          {summary.weeklyTrend.map((week) => <div className="weekColumn" key={week.weekStart}><strong>{week.records}</strong><div><span style={{ height: `${Math.max(6, Math.round((week.records / maxWeekly) * 100))}%` }} /></div><small>{formatWeek(week.weekStart)}</small></div>)}
        </div>
      </section>

      <section className="impactSection">
        <div className="impactTitle"><div><p className="eyebrow dark">RECORD QUALITY</p><h2>Useful context, not activity theater</h2></div></div>
        <div className="qualityGrid">
          <article><strong>{summary.quality.evidenceBackedPercent}%</strong><span>Evidence-backed entries</span><small>{summary.quality.evidenceBackedEntries} entries</small></article>
          <article><strong>{summary.quality.goalLinkedPercent}%</strong><span>Goal-linked records</span><small>{summary.quality.goalLinkedRecords} records</small></article>
          <article><strong>{summary.quality.medianReviewLagHours === null ? "—" : `${Math.round(summary.quality.medianReviewLagHours)}h`}</strong><span>Median review lag</span><small>n={summary.quality.measuredReviews} reviewed</small></article>
          <article><strong>{summary.quality.needsClarification}</strong><span>Clarifications</span><small>{summary.quality.awaitingReview} awaiting review</small></article>
        </div>
        <div className="dimensionBars">
          {summary.dimensionCoverage.map((item) => <div key={item.dimension}><span>{labels[item.dimension]}</span><div><i style={{ width: `${item.percent}%` }} /></div><strong>{item.records}</strong></div>)}
        </div>
      </section>

      <section className="baselineCard">
        <span>△</span><div><strong>Do not claim saved hours yet</strong><p>{summary.speed.timeSavings.message}</p><small>Next pilot instrument: time the current monthly support-form and evaluation-prep process before MERIT.</small></div>
      </section>

      <p className="privacyNote">{summary.privacy.message} Sample: {summary.sampleSize.mobileRecords} records and {summary.sampleSize.telemetryEvents} workflow events.</p>
    </>
  );
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatWeek(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function BottomNav({ screen, onHome, onCapture, onRecord, onImpact }: { screen: Screen; onHome: () => void; onCapture?: () => void; onRecord?: () => void; onImpact?: () => void }) {
  return (
    <nav className="bottomNav">
      <button className={screen === "home" ? "active" : ""} onClick={onHome}><span>⌂</span>Home</button>
      {onCapture && <button className="captureNav" onClick={onCapture}><span>＋</span>Capture</button>}
      {onRecord && <button className={screen === "record" ? "active" : ""} onClick={onRecord}><span>☷</span>Record</button>}
      {onImpact && <button className={screen === "impact" ? "active" : ""} onClick={onImpact}><span>↗</span>Impact</button>}
    </nav>
  );
}
